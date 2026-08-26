import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import { verifyGameReleaseManifestV2 } from "../../src/lib/game-production/runtime-package";
import {
  activateTtrpgCampaignSupplementV2,
  appendSimulationEvent,
  branchSimulationSession,
  changeTtrpgCampaignRosterV2,
  completeTtrpgCampaignSessionV2,
  completeTtrpgSessionZero,
  createSimulationCheckpoint,
  readSimulationState,
  readSimulationStateVersion,
  recordTtrpgVersionTransitionV2,
  recordTtrpgWorldEvolutionV2,
  startTtrpgCampaignSessionV2,
  verifySimulationCheckpoint,
} from "../../src/lib/simulation/runtime";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from "../../src/lib/ttrpg/authoring";
import { parseTtrpgCampaignContentV1 } from "../../src/lib/ttrpg/campaign";
import {
  createTtrpgContinuationFromPlanV2,
  previewTtrpgContinuationV2,
} from "../../src/lib/ttrpg/continuity";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import { readTtrpgSessionParticipantsV2 } from "../../src/lib/ttrpg/participants";
import { parseRulePackV1 } from "../../src/lib/ttrpg/rule-pack";
import { createTtrpgViewerProjectionV1 } from "../../src/lib/ttrpg/viewer-projection";
import type {
  SimulationSession,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../../src/lib/types";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";

const now = 1_793_000_000_000;

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
        name: "祁岚",
        identity: "擅长交涉的档案员",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 2,
        name: "阿澈",
        identity: "准备加入调查的后备测绘员",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 3,
        name: "守潮人",
        identity: "知道旧港秘密的关键人物",
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
    worldCode: "long-mist-harbor",
    worldName: "潮汐界",
    workTitle: "雾港长团",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

async function createLongCampaignSession(): Promise<{
  session: SimulationSession;
  scope: WorkspaceScope;
}> {
  const projectId = (await db.projects.add({
    name: "TTRPG 十场长团验收",
    genre: "fantasy",
    genres: ["fantasy"],
    status: "drafting",
    description: "",
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as never)) as number;
  const scope = (await ensureWorkspaceOwnership(projectId)).scope;
  const manifest = worldManifest();
  const contentHash = await hashGameProductionValueV2(manifest);
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界长团 v1",
    manifestJson: JSON.stringify(manifest),
    contentHash,
    sourceWorldCode: manifest.worldCode,
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
    title: "雾港十场长团",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: "formal-ten-session-campaign",
  });
  return { session, scope };
}

async function commandVersion(sessionId: number) {
  return readSimulationStateVersion(sessionId);
}

describe("TTRPG-3I · long campaign continuity", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("十场分场保持编组、记忆、补充包、世界演化、版本计划与可验证重放一致", async () => {
    const { session } = await createLongCampaignSession();
    const initial = await readSimulationState(session.id!);
    const allPlayers = Object.values(initial.entities)
      .filter((entity) => entity.kind === "player")
      .map((entity) => entity.entityKey)
      .sort();
    expect(allPlayers).toHaveLength(3);
    let version = await commandVersion(session.id!);
    await completeTtrpgSessionZero({
      sessionId: session.id!,
      commandId: "long.session-zero",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      acceptedItemKeys: initial.ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: allPlayers.slice(0, 2),
      completedBy: "gm",
    });

    let branchThroughSequence = 0;
    for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
      const beforeStart = await readSimulationState(session.id!);
      const participantKeys = beforeStart
        .ttrpg!.campaign!.roster.filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey);
      version = await commandVersion(session.id!);
      const started = await startTtrpgCampaignSessionV2({
        sessionId: session.id!,
        commandId: `long.start.${ordinal}`,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        sessionKey: `session.${ordinal}`,
        title: `雾港第 ${ordinal} 夜`,
        participantKeys,
        gmKey: "gm",
      });
      if (ordinal === 1) {
        const replayed = await startTtrpgCampaignSessionV2({
          sessionId: session.id!,
          commandId: "long.start.1",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sessionKey: "session.1",
          title: "雾港第 1 夜",
          participantKeys,
          gmKey: "gm",
        });
        expect(replayed.id).toBe(started.id);
        const activeVersion = await commandVersion(session.id!);
        await expect(
          changeTtrpgCampaignRosterV2({
            sessionId: session.id!,
            commandId: "long.roster-during-session",
            baseSequence: activeVersion.sequence,
            baseStateHash: activeVersion.stateHash,
            characterKey: participantKeys[0],
            status: "retired",
            reason: "不得在分场中退役",
            gmKey: "gm",
          }),
        ).rejects.toThrow("两场之间");
      }
      version = await commandVersion(session.id!);
      await completeTtrpgCampaignSessionV2({
        sessionId: session.id!,
        commandId: `long.complete.${ordinal}`,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        sessionKey: `session.${ordinal}`,
        summary: `第 ${ordinal} 场推进了潮门调查，并保留了失败前进产生的后果。`,
        memories: [
          {
            memoryKey: `memory.party.${ordinal}`,
            subjectKey: "mist-gate",
            summary: `队伍记住了第 ${ordinal} 场公开线索。`,
            audience: "party",
          },
          {
            memoryKey: `memory.gm.${ordinal}`,
            subjectKey: "keeper-plan",
            summary: `仅 GM 知道的第 ${ordinal} 场幕后推进。`,
            audience: "gm-only",
          },
          {
            memoryKey: `memory.actor.${ordinal}`,
            subjectKey: participantKeys[0],
            summary: `第 ${ordinal} 场属于行动角色的私密记忆。`,
            audience: `actor:${participantKeys[0]}`,
          },
        ],
        gmKey: "gm",
      });

      if (ordinal === 2) {
        version = await commandVersion(session.id!);
        await activateTtrpgCampaignSupplementV2({
          sessionId: session.id!,
          commandId: "long.supplement.weather",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          supplementKey: "supplement.weather",
          title: "潮汐天气扩展",
          contentHash: "a".repeat(64),
          compatibility: "same-release",
          sourceRef: "author.local.weather-v1",
          gmKey: "gm",
        });
      }
      if (ordinal === 3) {
        version = await commandVersion(session.id!);
        await changeTtrpgCampaignRosterV2({
          sessionId: session.id!,
          commandId: "long.retire.first",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          characterKey: allPlayers[0],
          status: "retired",
          reason: "角色完成个人誓言后光荣退役。",
          gmKey: "gm",
        });
        version = await commandVersion(session.id!);
        await changeTtrpgCampaignRosterV2({
          sessionId: session.id!,
          commandId: "long.reinforce.third",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          characterKey: allPlayers[2],
          status: "active",
          replacementFor: allPlayers[0],
          reason: "后备向导接过退役角色留下的地图。",
          gmKey: "gm",
        });
        version = await commandVersion(session.id!);
        await recordTtrpgWorldEvolutionV2({
          sessionId: session.id!,
          commandId: "long.world.propose",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          candidateKey: "world-evolution.tide-gate",
          category: "location",
          summary: "潮门被玩家永久开启，雾港新增一条可通行航路。",
          sourceSessionKey: "session.3",
          status: "proposed",
          targetWorldRef: "release-location:0",
          gmKey: "gm",
        });
        version = await commandVersion(session.id!);
        await recordTtrpgWorldEvolutionV2({
          sessionId: session.id!,
          commandId: "long.world.approve",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          candidateKey: "world-evolution.tide-gate",
          category: "location",
          summary: "潮门被玩家永久开启，雾港新增一条可通行航路。",
          sourceSessionKey: "session.3",
          status: "approved-for-world-review",
          targetWorldRef: "release-location:0",
          gmKey: "gm",
        });
      }
      if (ordinal === 4) {
        const state = await readSimulationState(session.id!);
        version = await commandVersion(session.id!);
        await recordTtrpgVersionTransitionV2({
          sessionId: session.id!,
          commandId: "long.version.plan",
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          transitionKey: "transition.rule-v2",
          toRulePackContentHash: "b".repeat(64),
          toCampaignKey: `${state.ttrpg!.product!.campaignKey}.v2`,
          compatibility: "manual-migration",
          status: "planned",
          notes: "下一发布保留角色成长与公开记忆，重新核对规则字段。",
          gmKey: "gm",
        });
      }
      if (ordinal === 5) {
        branchThroughSequence = (await readSimulationState(session.id!))
          .lastSequence;
      }
    }

    const state = await readSimulationState(session.id!);
    expect(state.ttrpg?.campaign).toMatchObject({
      activeSessionKey: null,
      playSessions: expect.arrayContaining([
        expect.objectContaining({
          sessionKey: "session.10",
          ordinal: 10,
          status: "completed",
        }),
      ]),
      supplements: [
        expect.objectContaining({ supplementKey: "supplement.weather" }),
      ],
      worldEvolution: [
        expect.objectContaining({ status: "approved-for-world-review" }),
      ],
      versionTransitions: [expect.objectContaining({ status: "planned" })],
    });
    expect(state.ttrpg?.campaign?.playSessions).toHaveLength(10);
    expect(state.ttrpg?.campaign?.memories).toHaveLength(30);
    expect(
      state.ttrpg?.campaign?.roster.find(
        (entry) => entry.characterKey === allPlayers[0],
      ),
    ).toMatchObject({ status: "retired", leftSessionKey: "session.3" });
    expect(
      state.ttrpg?.campaign?.roster.find(
        (entry) => entry.characterKey === allPlayers[2],
      ),
    ).toMatchObject({
      status: "active",
      replacementFor: allPlayers[0],
      joinedSessionKey: "session.4",
    });

    const release = await db.gameReleases.get(session.gameReleaseId!);
    const manifest = await verifyGameReleaseManifestV2(release!.manifestJson);
    const rulePack = parseRulePackV1(
      manifest.runtimePackage.ttrpg!.rulePack.content,
    );
    const campaign = parseTtrpgCampaignContentV1(
      manifest.runtimePackage.ttrpg!.campaign,
      rulePack,
    );
    const playerView = createTtrpgViewerProjectionV1({
      state,
      campaign,
      rulePack,
      role: "player",
      actorKey: allPlayers[2],
    });
    const gmView = createTtrpgViewerProjectionV1({
      state,
      campaign,
      rulePack,
      role: "gm",
    });
    const spectatorView = createTtrpgViewerProjectionV1({
      state,
      campaign,
      rulePack,
      role: "spectator",
    });
    expect(gmView.continuity.memories).toHaveLength(30);
    expect(
      playerView.continuity.memories.some(
        (memory) => memory.audience === "gm-only",
      ),
    ).toBe(false);
    expect(
      spectatorView.continuity.memories.every(
        (memory) => memory.audience === "party",
      ),
    ).toBe(true);
    expect(spectatorView.continuity.worldEvolution).toHaveLength(1);
    expect(spectatorView.continuity.versionTransitions[0].notes).toBeNull();

    const checkpoint = await createSimulationCheckpoint({
      sessionId: session.id!,
      name: "ten-session-continuity",
    });
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true);
    const branch = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence: branchThroughSequence,
      title: "第五场后的长期战役分支",
    });
    expect(
      (await readSimulationState(branch.id!)).ttrpg?.campaign?.playSessions,
    ).toHaveLength(5);

    await expect(
      appendSimulationEvent({
        sessionId: session.id!,
        type: "ttrpg.campaign.session.started",
        actorKey: "gm",
        targetKey: null,
        payload: {},
      }),
    ).rejects.toThrow("专用 API");
  });

  it("拒绝原地激活不同冻结版本，要求走跨发布续团", async () => {
    const { session, scope } = await createLongCampaignSession();
    const state = await readSimulationState(session.id!);
    let version = await commandVersion(session.id!);
    await completeTtrpgSessionZero({
      sessionId: session.id!,
      commandId: "version.session-zero",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      completedBy: "gm",
    });
    version = await commandVersion(session.id!);
    await expect(
      recordTtrpgVersionTransitionV2({
        sessionId: session.id!,
        commandId: "version.illegal-hot-swap",
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        transitionKey: "transition.hot-swap",
        toRulePackContentHash: "c".repeat(64),
        toCampaignKey: "campaign.next",
        compatibility: "breaking",
        status: "activated",
        notes: "不得热替换冻结规则。",
        gmKey: "gm",
      }),
    ).rejects.toThrow("跨版本续团");

    const plan = await previewTtrpgContinuationV2({
      scope,
      parentSessionId: session.id!,
      targetGameReleaseId: session.gameReleaseId!,
      compatibility: "same-content",
      transitionKey: "transition.same-release-child",
      approvedBy: "gm",
    });
    expect(plan).toMatchObject({
      schema: "storyforge.ttrpg-continuation-plan",
      version: 2,
      parentSessionId: session.id,
      targetGameReleaseId: session.gameReleaseId,
      compatibility: "same-content",
    });
    expect(plan.carried.length).toBeGreaterThan(3);
    const child = await createTtrpgContinuationFromPlanV2({
      scope,
      plan,
      title: "同发布安全续团",
      seed: "continuation-child",
    });
    expect(child).toMatchObject({
      parentSessionId: session.id,
      parentThroughSequence: plan.parentSequence,
      gameReleaseId: session.gameReleaseId,
    });
    const childState = await readSimulationState(child.id!);
    expect(childState.ttrpg?.product?.sessionZero).toMatchObject({
      completed: false,
      selectedCharacterKeys: [],
    });
    expect(childState.ttrpg?.campaign?.versionTransitions).toEqual([
      expect.objectContaining({
        transitionKey: "transition.same-release-child",
        status: "activated",
        compatibility: "same-content",
      }),
    ]);
    expect(
      childState.ttrpg?.campaign?.roster.filter(
        (entry) => entry.status === "active",
      ),
    ).toHaveLength(3);
    const childParticipants = await readTtrpgSessionParticipantsV2(child.id!);
    expect(
      childParticipants.every(
        (row) =>
          row.sessionZeroAcceptedAtSequence == null &&
          !row.consent.safetyBoundariesAccepted,
      ),
    ).toBe(true);
    expect(
      (await readSimulationState(session.id!)).ttrpg?.product?.sessionZero
        .completed,
    ).toBe(true);
  });
});
