import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import {
  completeTtrpgSessionZero,
  readSimulationState,
  readSimulationStateVersion,
} from "../../src/lib/simulation/runtime";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from "../../src/lib/ttrpg/authoring";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
} from "../../src/lib/online/room-authority";
import { BrowserFormalTtrpgRoomAdapterV1 } from "../../src/lib/online/ttrpg-browser-adapter";
import { parseOnlineTtrpgRoomProjectionV1 } from "../../src/lib/online/ttrpg-projection";
import { verifyOnlineDiceReceiptV1 } from "../../src/lib/online/verifiable-dice";
import type {
  SimulationSession,
  WorldReleaseManifestV2,
} from "../../src/lib/types";

const now = 1_800_500_000_000;

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      {
        _exportId: 0,
        name: "林舟",
        identity: "谨慎的调查者",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 1,
        name: "潮汐学者",
        identity: "负责交叉验证的同伴",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 2,
        name: "守潮人",
        identity: "知道旧港秘密的向导",
        location: "雾港",
        roleWeight: "npc",
      },
    ],
    characterRelations: [],
    importantLocations: [
      { _exportId: 0, name: "雾港", description: "退潮时显露的旧港。" },
    ],
    storyArcs: [],
    itemLedger: [],
    codexEntries: [],
    avgMediaAssets: [],
    narrativeModules: [],
    narrativeNodes: [],
  };
  return {
    schema: "storyforge.world-package",
    version: 2,
    worldCode: "mist-harbor-online",
    worldName: "潮汐界",
    workTitle: "雾港联机纪事",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

async function createFormalSession(): Promise<{
  session: SimulationSession;
  releaseHash: string;
}> {
  const projectId = (await db.projects.add({
    name: "TTRPG 在线适配器验收",
    genre: "fantasy",
    genres: ["fantasy"],
    status: "drafting",
    description: "",
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any)) as number;
  const scope = (await ensureWorkspaceOwnership(projectId)).scope;
  const manifest = worldManifest();
  const contentHash = await hashGameProductionValueV2(manifest);
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界 v1",
    manifestJson: JSON.stringify(manifest),
    contentHash,
    sourceWorldCode: "mist-harbor-online",
    createdAt: now,
  })) as number;
  const rule = await installStoryForgeRulePackV1(scope);
  const campaign = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope,
    worldReleaseId,
    rulePackId: rule.id,
    fixtureOnly: true,
    confirmDefaultMappings: true,
  });
  const release = await publishTtrpgCampaignReleaseV1({
    scope,
    campaignModuleId: campaign.id!,
    testOnlyAllowFixtureCampaign: true,
  });
  const session = await createWorldInstance({
    scope,
    kind: "ttrpg",
    title: "雾港在线调查战役",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: "formal-online-room",
  });
  let version = await readSimulationStateVersion(session.id!);
  const state = await readSimulationState(session.id!);
  await completeTtrpgSessionZero({
    sessionId: session.id!,
    commandId: "online.session-zero",
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: "gm",
  });
  version = await readSimulationStateVersion(session.id!);
  expect(version.sequence).toBeGreaterThan(0);
  return { session, releaseHash: release.contentHash };
}

function command(input: {
  roomId: string;
  releaseHash: string;
  requestId: string;
  memberId: string;
  authToken: string;
  expectedSequence: number;
  kind: OnlineRoomCommandV1["kind"];
  actorKey?: string | null;
  payload: unknown;
}): OnlineRoomCommandV1 {
  return { protocolVersion: 1, actorKey: input.actorKey ?? null, ...input };
}

describe("PLATFORM-1B · formal browser TTRPG room adapter", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("双账号从场景、规则行动、真人主持、私密线索到重连都使用正式状态与安全投影", async () => {
    const { session, releaseHash } = await createFormalSession();
    const memberByActor = new Map<string, string>();
    const adapter = await BrowserFormalTtrpgRoomAdapterV1.create({
      roomId: "room.formal-ttrpg",
      releaseHash,
      simulationSessionId: session.id!,
      maximumCommittedRolls: 4,
      memberIdForActor: (actorKey) => memberByActor.get(actorKey) ?? null,
    });
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: "room.formal-ttrpg",
      releaseHash,
      gmDisplayName: "真人主持",
      adapter,
    });
    await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "scene.opening",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: 0,
        kind: "scene.open",
        payload: { sceneKey: "scene.opening" },
      }),
    );
    let roomSequence = 1;
    const startedCampaignSession = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "campaign.session.start.1",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: "campaign.session.start",
        payload: { title: "雾港联机第一夜" },
      }),
    );
    roomSequence += 1;
    expect(startedCampaignSession.event.publicPayload).toMatchObject({
      sessionKey: "session.1",
      ordinal: 1,
      status: "active",
    });
    let runtimeState = await readSimulationState(session.id!);
    const selectedPlayerKeys = new Set(
      runtimeState.ttrpg!.product!.sessionZero.selectedCharacterKeys,
    );
    let activeActorKey = runtimeState.ttrpg!.activeActorKey!;
    // A scene may legitimately roll an NPC ahead of every player. Resolve those
    // GM-controlled turns before assigning the currently active player seat;
    // otherwise the test (and any caller copying it) would try to bind a player
    // credential to an NPC that Session Zero never selected.
    for (
      let guard = 0;
      !selectedPlayerKeys.has(activeActorKey) && guard < 20;
      guard += 1
    ) {
      await created.room.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: `npc.prejoin.${guard}`,
          memberId: created.gm.member.memberId,
          authToken: created.gm.authToken,
          expectedSequence: roomSequence,
          kind: "rule.action",
          actorKey: activeActorKey,
          payload: {
            actionKey: "investigate",
            targetKey: null,
            difficulty: 8,
            situationalModifier: 0,
          },
        }),
      );
      roomSequence += 1;
      runtimeState = await readSimulationState(session.id!);
      activeActorKey = runtimeState.ttrpg!.activeActorKey!;
    }
    expect(selectedPlayerKeys.has(activeActorKey)).toBe(true);
    const playerInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: activeActorKey,
      expiresAt: Date.now() + 60_000,
    });
    const player = await created.room.join({
      ...playerInvite,
      displayName: "当前行动玩家",
    });
    memberByActor.set(activeActorKey, player.member.memberId);
    const beforeAction = await created.room.reconnect({
      memberId: player.member.memberId,
      authToken: player.authToken,
      afterSequence: 0,
    });
    expect(beforeAction.cursor).toBe(roomSequence);
    const beforeActionProjection = parseOnlineTtrpgRoomProjectionV1(
      beforeAction.projection,
    );
    expect(beforeActionProjection.campaign).toMatchObject({
      role: "player",
      actorKey: activeActorKey,
      gmControls: null,
      turn: { activeActorKey },
    });
    expect(
      beforeActionProjection.campaign.availableActions.map(
        (item) => item.actionKey,
      ),
    ).toContain("investigate");
    expect(
      beforeActionProjection.campaign.actors.find(
        (item) => item.actorKey === activeActorKey,
      )?.controlledByViewer,
    ).toBe(true);
    expect(JSON.stringify(beforeActionProjection)).not.toContain(
      "两条线索分别指向时间与动机",
    );
    const clarification = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "intent.clarification",
        memberId: player.member.memberId,
        authToken: player.authToken,
        expectedSequence: roomSequence,
        kind: "intent.submit",
        actorKey: activeActorKey,
        payload: {
          intentKey: "intent.online.clarification",
          rawInput: "我仔细看一看。",
          actionKey: null,
          targetKey: null,
          goal: null,
          method: null,
          difficulty: null,
          situationalModifier: null,
          rollVisibility: null,
        },
      }),
    );
    roomSequence += 1;
    expect(clarification.event.publicPayload).toMatchObject({
      actorKey: activeActorKey,
      terminalStatus: "needs-clarification",
    });
    expect(JSON.stringify(clarification.event.publicPayload)).not.toContain("仔细看")
    expect(JSON.stringify(clarification.event.privatePayload)).toContain("仔细看")
    const action = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "action.investigate",
        memberId: player.member.memberId,
        authToken: player.authToken,
        expectedSequence: roomSequence,
        kind: "intent.submit",
        actorKey: activeActorKey,
        payload: {
          intentKey: "intent.online.investigate",
          rawInput: "我沿着潮湿封蜡的刻痕核对时间，并只把判断告诉同伴。",
          actionKey: "investigate",
          targetKey: null,
          goal: "确认记录时间是否被篡改",
          method: "比对封蜡刻痕",
          difficulty: 8,
          situationalModifier: 0,
          rollVisibility: "public",
        },
      }),
    );
    roomSequence += 1;
    expect(action.event.publicPayload).toMatchObject({
      actionKey: "investigate",
      actorKey: activeActorKey,
    });
    expect(JSON.stringify(action.event.publicPayload)).not.toContain("潮湿封蜡");
    expect(JSON.stringify(action.event.privatePayload)).toContain("潮湿封蜡");
    expect(JSON.stringify(action.event.privatePayload)).not.toContain(
      "两条线索分别指向时间与动机",
    );
    const actionSequence = (
      action.event.publicPayload as { eventSequence: number }
    ).eventSequence;
    const afterActionState = await readSimulationState(session.id!);
    const resolvedAction = afterActionState.ttrpg!.product!.actionHistory.find(
      (item) => item.eventSequence === actionSequence,
    )!;
    const promptedActorKey = resolvedAction.receipt!.context.observers.find(
      (item) =>
        item.responsePolicy === "prompt-human" &&
        item.actorKey !== activeActorKey,
    )!.actorKey;
    const responderInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: promptedActorKey,
      expiresAt: Date.now() + 60_000,
    });
    const responder = await created.room.join({
      ...responderInvite,
      displayName: "回应玩家",
    });
    memberByActor.set(promptedActorKey, responder.member.memberId);
    const humanResponsePayload = {
      actionSequence,
      actionReceiptKey: resolvedAction.receipt!.receiptKey,
      responseKind: "speak" as const,
      text: "我只向主持人指出封蜡背面的第二道划痕。",
      audience: "gm-only" as const,
    };
    await expect(
      created.room.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: "response.gm-spoof",
          memberId: created.gm.member.memberId,
          authToken: created.gm.authToken,
          expectedSequence: roomSequence,
          kind: "human.response",
          actorKey: promptedActorKey,
          payload: humanResponsePayload,
        }),
      ),
    ).rejects.toThrow("只能由已认证的玩家席位");
    await expect(
      created.room.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: "response.other-player-spoof",
          memberId: player.member.memberId,
          authToken: player.authToken,
          expectedSequence: roomSequence,
          kind: "human.response",
          actorKey: promptedActorKey,
          payload: humanResponsePayload,
        }),
      ),
    ).rejects.toThrow("只能回应自己");
    const humanResponse = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "response.owner",
        memberId: responder.member.memberId,
        authToken: responder.authToken,
        expectedSequence: roomSequence,
        kind: "human.response",
        actorKey: promptedActorKey,
        payload: humanResponsePayload,
      }),
    );
    roomSequence += 1;
    expect(JSON.stringify(humanResponse.event.publicPayload)).not.toContain(
      "第二道划痕",
    );
    expect(JSON.stringify(humanResponse.event.privatePayload)).toContain(
      "第二道划痕",
    );
    const actingPlayerAfterResponse = parseOnlineTtrpgRoomProjectionV1(
      (
        await created.room.reconnect({
          memberId: player.member.memberId,
          authToken: player.authToken,
          afterSequence: 0,
        })
      ).projection,
    );
    expect(
      JSON.stringify(actingPlayerAfterResponse.campaign.humanResponses),
    ).not.toContain("第二道划痕");
    const responderAfterResponse = parseOnlineTtrpgRoomProjectionV1(
      (
        await created.room.reconnect({
          memberId: responder.member.memberId,
          authToken: responder.authToken,
          afterSequence: 0,
        })
      ).projection,
    );
    expect(
      JSON.stringify(responderAfterResponse.campaign.humanResponses),
    ).toContain("第二道划痕");
    expect(
      responderAfterResponse.campaign.pendingHumanResponses,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionSequence,
          actorKey: promptedActorKey,
        }),
      ]),
    );
    const effectPayload = {
      actionSequence,
      plan: {
        schema: "storyforge.ttrpg-effect-plan" as const,
        version: 2 as const,
        planKey: `online.effect.${actionSequence}`,
        degree:
          resolvedAction.outcome === "automatic"
            ? ("success" as const)
            : resolvedAction.outcome,
        sourceEventId: `event.${actionSequence}`,
        ruleRef: resolvedAction.actionKey,
        reason: "仅行动角色与主持人可见的封蜡成长奖励。",
        audience: `actor:${activeActorKey}` as const,
        status: "immediate" as const,
        effects: [
          {
            effectKey: `online.effect.${actionSequence}.xp`,
            family: "advancement" as const,
            operation: "xp" as const,
            targetRef: activeActorKey,
            advancementKey: "session-xp",
            amount: 3,
          },
        ],
      },
    };
    await expect(
      created.room.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: "effect.player-denied",
          memberId: player.member.memberId,
          authToken: player.authToken,
          expectedSequence: roomSequence,
          kind: "effects.apply",
          actorKey: activeActorKey,
          payload: effectPayload,
        }),
      ),
    ).rejects.toThrow("只允许 GM");
    const effectReceipt = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "effect.gm-private",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: "effects.apply",
        payload: effectPayload,
      }),
    );
    roomSequence += 1;
    expect(JSON.stringify(effectReceipt.event.publicPayload)).not.toContain(
      "封蜡成长奖励",
    );
    expect(JSON.stringify(effectReceipt.event.privatePayload)).toContain(
      "封蜡成长奖励",
    );
    await expect(
      created.room.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: "effect.gm-duplicate-source",
          memberId: created.gm.member.memberId,
          authToken: created.gm.authToken,
          expectedSequence: roomSequence,
          kind: "effects.apply",
          payload: {
            ...effectPayload,
            plan: {
              ...effectPayload.plan,
              planKey: `online.effect.${actionSequence}.duplicate`,
            },
          },
        }),
      ),
    ).rejects.toThrow("唯一后果计划");
    const actingPlayerAfterEffect = parseOnlineTtrpgRoomProjectionV1(
      (
        await created.room.reconnect({
          memberId: player.member.memberId,
          authToken: player.authToken,
          afterSequence: 0,
        })
      ).projection,
    );
    expect(JSON.stringify(actingPlayerAfterEffect.campaign.effectReceipts)).toContain(
      "封蜡成长奖励",
    );
    const responderAfterEffect = parseOnlineTtrpgRoomProjectionV1(
      (
        await created.room.reconnect({
          memberId: responder.member.memberId,
          authToken: responder.authToken,
          afterSequence: 0,
        })
      ).projection,
    );
    expect(JSON.stringify(responderAfterEffect.campaign.effectReceipts)).not.toContain(
      "封蜡成长奖励",
    );
    const ownedItem = actingPlayerAfterResponse.campaign.inventory[0];
    expect(ownedItem).toBeDefined();
    const itemReceipt = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "item.owner-use",
        memberId: player.member.memberId,
        authToken: player.authToken,
        expectedSequence: roomSequence,
        kind: "item.command",
        actorKey: activeActorKey,
        payload: {
          operation: {
            kind: "use",
            instanceId: ownedItem.itemInstanceId,
            expectedOwnerRef: activeActorKey,
            amount: 1,
          },
        },
      }),
    );
    roomSequence += 1;
    expect(itemReceipt.event.publicPayload).toMatchObject({
      operation: "use",
      itemInstanceId: ownedItem.itemInstanceId,
      changed: true,
    });
    expect(itemReceipt.event.privatePayload).toMatchObject({
      operation: "use",
      requestedBy: { role: "player", actorKey: activeActorKey },
    });
    const restReceipt = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "rest.gm.short",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: "rest.complete",
        payload: {
          restKey: "rest.online.browser.1",
          restKind: "short-rest",
          actorKeys: [...selectedPlayerKeys],
          reason: "队伍在档案室门口短暂整备。",
        },
      }),
    );
    roomSequence += 1;
    expect(restReceipt.event.publicPayload).toMatchObject({
      restKey: "rest.online.browser.1",
      kind: "short-rest",
    });
    await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "gm.narration",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: "gm.narrate",
        payload: {
          actionSequence,
          text: "潮声退去，林舟从刻痕中确认了关键时间。",
        },
      }),
    );
    roomSequence += 1;
    const privateClue = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "clue.private",
        memberId: player.member.memberId,
        authToken: player.authToken,
        expectedSequence: roomSequence,
        kind: "clue.reveal",
        actorKey: activeActorKey,
        payload: {
          clueKey: "clue.timeline",
          actorKey: activeActorKey,
          visibility: "private",
        },
      }),
    );
    expect(JSON.stringify(privateClue.event.publicPayload)).not.toContain(
      "时间线",
    );
    expect(JSON.stringify(privateClue.event.privatePayload)).toContain(
      "clue.timeline",
    );
    roomSequence += 1;
    const completedCampaignSession = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "campaign.session.complete.1",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: "campaign.session.complete",
        payload: {
          publicNote: "队伍约定下次核验退潮记录。",
          memorySummary: "只有行动角色记得封蜡背面的隐秘刻痕。",
          memoryAudience: `actor:${activeActorKey}`,
        },
      }),
    );
    roomSequence += 1;
    expect(completedCampaignSession.event.publicPayload).toMatchObject({
      sessionKey: "session.1",
      status: "completed",
    });
    expect(JSON.stringify(completedCampaignSession.event.publicPayload)).not.toContain(
      "隐秘刻痕",
    );
    expect(JSON.stringify(completedCampaignSession.event.privatePayload)).toContain(
      "隐秘刻痕",
    );

    const spectatorInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "spectator",
      expiresAt: Date.now() + 60_000,
    });
    const spectator = await created.room.join({
      ...spectatorInvite,
      displayName: "观战者",
    });
    const spectatorView = await created.room.reconnect({
      memberId: spectator.member.memberId,
      authToken: spectator.authToken,
      afterSequence: 0,
    });
    expect(JSON.stringify(spectatorView)).not.toContain("clue.timeline");
    expect(JSON.stringify(spectatorView)).not.toContain(
      "两条线索分别指向时间与动机",
    );
    expect(JSON.stringify(spectatorView)).not.toContain("潮湿封蜡");
    expect(JSON.stringify(spectatorView)).not.toContain("第二道划痕");
    expect(JSON.stringify(spectatorView)).not.toContain("隐秘刻痕");
    expect(
      parseOnlineTtrpgRoomProjectionV1(spectatorView.projection).campaign,
    ).toMatchObject({
      role: "spectator",
      actorKey: null,
      gmControls: null,
      availableActions: [],
    });
    const playerView = await created.room.reconnect({
      memberId: player.member.memberId,
      authToken: player.authToken,
      afterSequence: 0,
    });
    expect(JSON.stringify(playerView.projection)).toContain("clue.timeline");
    expect(JSON.stringify(playerView.projection)).toContain("隐秘刻痕");
    const responderContinuity = parseOnlineTtrpgRoomProjectionV1(
      (
        await created.room.reconnect({
          memberId: responder.member.memberId,
          authToken: responder.authToken,
          afterSequence: 0,
        })
      ).projection,
    );
    expect(JSON.stringify(responderContinuity.campaign.continuity.memories)).not.toContain(
      "隐秘刻痕",
    );
    const gmView = await created.room.reconnect({
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      afterSequence: 0,
    });
    expect(JSON.stringify(gmView)).toContain("两条线索分别指向时间与动机");
    const parsedGm = parseOnlineTtrpgRoomProjectionV1(gmView.projection);
    expect(JSON.stringify(parsedGm.campaign.humanResponses)).toContain(
      "第二道划痕",
    );
    expect(
      parsedGm.campaign.gmControls?.currentClues.map((item) => item.clueKey),
    ).toContain("clue.timeline");
    const injected = structuredClone(playerView.projection) as Record<
      string,
      any
    >;
    injected.campaign.gmControls = parsedGm.campaign.gmControls;
    expect(() => parseOnlineTtrpgRoomProjectionV1(injected)).toThrow(
      "非 GM 投影包含主持控制",
    );
    const injectedPrivateResponse = structuredClone(playerView.projection) as Record<
      string,
      any
    >;
    injectedPrivateResponse.campaign.humanResponses = [{
      responseKey: "human-response.999.other-player",
      eventSequence: 999,
      actionSequence,
      actorKey: promptedActorKey,
      kind: "speak",
      text: "伪造泄露给其他玩家的私密回应。",
      audience: "gm-only",
    }];
    expect(() =>
      parseOnlineTtrpgRoomProjectionV1(injectedPrivateResponse),
    ).toThrow("泄露其他角色的 GM 私密回应");
    const injectedPrompt = structuredClone(playerView.projection) as Record<
      string,
      any
    >;
    injectedPrompt.campaign.pendingHumanResponses = [{
      actionSequence,
      actionReceiptKey: resolvedAction.receipt!.receiptKey,
      sourceActorKey: activeActorKey,
      actorKey: promptedActorKey,
    }];
    expect(() => parseOnlineTtrpgRoomProjectionV1(injectedPrompt)).toThrow(
      "玩家投影包含其他角色的回应窗口",
    );
    const injectedEffect = structuredClone(playerView.projection) as Record<string, any>;
    injectedEffect.campaign.effectReceipts = [{
      eventSequence: 999,
      planKey: "effect.injected",
      degree: "success",
      sourceEventId: "event.1",
      ruleRef: "investigate",
      reason: "伪造的其他角色私密奖励。",
      audience: `actor:${promptedActorKey}`,
      transitions: [{
        effectKey: "effect.injected.xp",
        family: "advancement",
        operation: "xp",
        targetRef: promptedActorKey,
      }],
    }];
    expect(() => parseOnlineTtrpgRoomProjectionV1(injectedEffect)).toThrow(
      "其他角色的私密效果账本",
    );
    const injectedPendingChoice = structuredClone(playerView.projection) as Record<string, any>;
    injectedPendingChoice.campaign.pendingEffectChoices = [{
      choiceKey: "choice.injected",
      proposedEventSequence: 999,
      actionSequence,
      ownerActorKey: promptedActorKey,
      degree: "success",
      reason: "伪造泄露给其他角色的私密后果选择。",
      options: [
        {
          effectKey: "choice.injected.one", family: "advancement",
          operation: "xp", targetRef: promptedActorKey, detail: "xp 1",
        },
        {
          effectKey: "choice.injected.two", family: "advancement",
          operation: "xp", targetRef: promptedActorKey, detail: "xp 2",
        },
      ],
    }];
    expect(() => parseOnlineTtrpgRoomProjectionV1(injectedPendingChoice)).toThrow(
      "其他角色的私密后果选择",
    );
    const injectedSceneSecret = structuredClone(playerView.projection) as Record<string, any>;
    injectedSceneSecret.campaign.scenes = injectedSceneSecret.campaign.scenes.map((scene: any) =>
      scene.status === "current" ? { ...scene, gmSecret: "伪造注入的主持秘密" } : scene,
    );
    expect(() => parseOnlineTtrpgRoomProjectionV1(injectedSceneSecret)).toThrow(
      "场景主持信息",
    );

    const state = await readSimulationState(session.id!);
    expect(state.ttrpg?.product?.gmNarrations[0]).toMatchObject({
      source: "human-gm",
      actionSequence,
      text: "潮声退去，林舟从刻痕中确认了关键时间。",
      candidateHash: null,
      runId: null,
      modelEvidence: null,
    });
    expect(state.ttrpg?.product?.humanResponses).toEqual([
      expect.objectContaining({
        actionSequence,
        actorKey: promptedActorKey,
        audience: "gm-only",
        text: "我只向主持人指出封蜡背面的第二道划痕。",
      }),
    ]);
    expect(state.ttrpg?.product?.itemHistory).toEqual([
      expect.objectContaining({
        operation: "use",
        itemInstanceId: ownedItem.itemInstanceId,
      }),
    ]);
    expect(state.ttrpg?.product?.effectLedger?.entries).toEqual([
      expect.objectContaining({
        sourceEventId: `event.${actionSequence}`,
        audience: `actor:${activeActorKey}`,
      }),
    ]);
    expect(state.ttrpg?.campaign?.playSessions).toEqual([
      expect.objectContaining({ sessionKey: "session.1", status: "completed" }),
    ]);
    expect(state.ttrpg?.product?.restHistory).toEqual([
      expect.objectContaining({
        restKey: "rest.online.browser.1",
        kind: "short-rest",
      }),
    ]);
  });

  it("独立骰子回执可验算，且浏览器适配器不会伪装成可事务恢复的服务端存储", async () => {
    const { session, releaseHash } = await createFormalSession();
    const adapter = await BrowserFormalTtrpgRoomAdapterV1.create({
      roomId: "room.dice-real",
      releaseHash,
      simulationSessionId: session.id!,
      maximumCommittedRolls: 2,
    });
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: "room.dice-real",
      releaseHash,
      gmDisplayName: "主持人",
      adapter,
    });
    const rolled = await created.room.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "dice.1",
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: 0,
        kind: "dice.request",
        payload: { expression: "2d6+1" },
      }),
    );
    const receipt = (
      rolled.event.publicPayload as {
        receipt: Parameters<typeof verifyOnlineDiceReceiptV1>[0]["receipt"];
      }
    ).receipt;
    expect(
      await verifyOnlineDiceReceiptV1({
        commitments: adapter.inspect().diceCommitments,
        receipt,
      }),
    ).toBe(true);

    await expect(
      AuthoritativeOnlineRoomV1.create({
        roomId: "room.must-not-fake-durable",
        releaseHash,
        gmDisplayName: "主持人",
        adapter,
        persistence: {
          load: async () => null,
          compareAndSwap: async () => true,
        },
      }),
    ).rejects.toThrow("checkpoint");
  });
});
