import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import {
  commitTtrpgEffectPlanV2,
  commitTtrpgIntentDispositionV2,
  commitTtrpgItemCommandV2,
  classifyTtrpgSubmittedIntentV2,
  completeTtrpgRestV2,
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  recordTtrpgHumanResponseV2,
  resolveTtrpgRuleAction,
  submitTtrpgActionIntentV2,
} from "../../src/lib/simulation/runtime";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  saveGameRulePackV1,
  saveTtrpgCampaignModuleV1,
} from "../../src/lib/ttrpg/authoring";
import { parseTtrpgCampaignContentV1 } from "../../src/lib/ttrpg/campaign";
import { createDeterministicGmSynthesisFrameV2 } from "../../src/lib/ttrpg/action-feedback";
import {
  createTtrpgAutomaticSessionRecapsV2,
  createTtrpgViewerProjectionV1,
} from "../../src/lib/ttrpg/viewer-projection";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import { parseRulePackV1 } from "../../src/lib/ttrpg/rule-pack";
import { createStoryForgeRulePackV1 } from "../../src/lib/ttrpg/storyforge-rule-pack";
import type {
  RulePackV1,
  SimulationSession,
  TtrpgCampaignContentV1,
  TtrpgEffectPlanV2,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../../src/lib/types";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";

const NOW = 1_795_000_000_000;

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      {
        _exportId: 0,
        name: "林舟",
        identity: "擅长从纸张、气味与墨迹重建现场的档案调查员",
        location: "雾港档案室",
        roleWeight: "main",
      },
      {
        _exportId: 1,
        name: "岑遥",
        identity: "负责现场复核与风险判断的调查搭档",
        location: "雾港档案室",
        roleWeight: "main",
      },
      {
        _exportId: 2,
        name: "档案员秦墨",
        identity: "知道封锁记录去向、但对外来调查者保持戒心的档案员",
        location: "雾港档案室",
        roleWeight: "npc",
      },
      {
        _exportId: 3,
        name: "外廊守卫",
        identity: "守在档案室外廊，不在室内现场",
        location: "雾港外廊",
        roleWeight: "npc",
      },
    ],
    characterRelations: [],
    importantLocations: [
      {
        _exportId: 0,
        name: "雾港档案室",
        description: "潮湿木架、封蜡卷宗与退潮钟声共同构成的封闭调查现场。",
      },
      {
        _exportId: 1,
        name: "雾港外廊",
        description: "与档案室隔着厚门，听不清室内低声交谈。",
      },
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
    worldCode: "golden-archive",
    worldName: "潮汐界",
    workTitle: "封蜡卷宗",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

async function createGoldenSession(): Promise<{
  session: SimulationSession;
  scope: WorkspaceScope;
  campaign: TtrpgCampaignContentV1;
  rulePack: RulePackV1;
  pcA: string;
  pcB: string;
  clerk: string;
  outsideGuard: string;
}> {
  const projectId = (await db.projects.add({
    name: "Golden 单回合规则验收",
    genre: "mystery",
    genres: ["mystery"],
    status: "drafting",
    description: "",
    targetWordCount: 100_000,
    createdAt: NOW,
    updatedAt: NOW,
  } as never)) as number;
  const scope = (await ensureWorkspaceOwnership(projectId)).scope;
  const manifest = worldManifest();
  const contentHash = await hashGameProductionValueV2(manifest);
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界 Golden v1",
    manifestJson: JSON.stringify(manifest),
    contentHash,
    sourceWorldCode: manifest.worldCode,
    createdAt: NOW,
  })) as number;

  const rulePack = createStoryForgeRulePackV1();
  rulePack.ruleSystemVersion = "2.0.1";
  rulePack.title = "StoryForge Golden 调查规则";
  const investigate = rulePack.actions.find((action) => action.key === "investigate")!;
  investigate.usage = {
    mode: "charges",
    maximum: 1,
    resourceKey: null,
    cost: null,
    sharedPoolKey: null,
    cooldownRounds: null,
    reset: ["long-rest"],
  };
  rulePack.items.find((item) => item.key === "protective-gear")!.mechanics = {
    category: "armor",
    stackPolicy: "unique",
    maxStack: 1,
    weight: 2,
    equipSlots: ["body"],
    requiresAttunement: false,
    maximumCharges: null,
    maximumDurability: 6,
  };
  const ruleRow = await saveGameRulePackV1({ scope, rulePack });
  const compiled = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope,
    worldReleaseId,
    rulePackId: ruleRow.id,
    fixtureOnly: true,
    confirmDefaultMappings: true,
  });
  const authored = JSON.parse(compiled.contentJson) as TtrpgCampaignContentV1;
  const players = authored.characterTemplates.filter((item) => item.role === "player");
  const npcs = authored.characterTemplates.filter((item) => item.role === "npc");
  expect(players).toHaveLength(2);
  expect(npcs).toHaveLength(2);
  const [pcA, pcB] = players.map((item) => item.characterKey);
  const [clerk, outsideGuard] = npcs.map((item) => item.characterKey);
  for (const template of authored.characterTemplates) {
    template.actionKeys = [
      ...new Set([...template.actionKeys, "investigate", "overcome", "assist"]),
    ];
  }
  const pcATemplate = authored.characterTemplates.find(
    (item) => item.characterKey === pcA,
  )!;
  pcATemplate.skills.investigate = 2;
  if (pcATemplate.characterSheet) {
    pcATemplate.characterSheet.rules.skills.investigate = 2;
  }
  const clerkTemplate = authored.characterTemplates.find(
    (item) => item.characterKey === clerk,
  )!;
  clerkTemplate.gmProfile = {
    objective: "阻止调查者找到被替换印章背后的航行日志",
    leverage: "掌握档案室钥匙和卷宗登记权",
    secret: "真正的航行日志藏在第三排空心书脊",
    portrayal: "克制、谨慎，受到威胁时会先收拢文件再转移话题",
    escalation: "先隐瞒，随后阻止继续翻查并提高警戒",
  };
  const opening = authored.scenes.find(
    (item) => item.sceneKey === authored.openingSceneKey,
  )!;
  opening.title = "封锁档案室";
  opening.description =
    "潮湿木架挤压视线，退潮钟声每隔数分钟穿过封蜡卷宗之间的缝隙。";
  opening.gmSecret = "档案员秦墨已经把真正的航行日志藏进第三排空心书脊。";
  opening.participantKeys = [pcA, pcB, clerk];
  opening.actionKeys = [
    ...new Set([...opening.actionKeys, "investigate", "overcome", "assist"]),
  ];
  const clue = authored.clues.find((item) => opening.clueKeys.includes(item.clueKey))!;
  clue.visibility = "discoverable";
  authored.informationPolicy = {
    characterPrivateChannels: true,
    gmSecrets: true,
    hiddenNpcState: true,
    hiddenDice: "allowed",
    interPlayerWhispers: true,
    revealAuditTrail: true,
  };
  const campaignRow = await saveTtrpgCampaignModuleV1({
    scope,
    sourceWorldReleaseId: worldReleaseId,
    rulePackId: ruleRow.id!,
    campaign: authored,
    status: "validated",
  });
  const release = await publishTtrpgCampaignReleaseV1({
    scope,
    campaignModuleId: campaignRow.id!,
    testOnlyAllowFixtureCampaign: true,
  });
  const session = await createWorldInstance({
    scope,
    kind: "ttrpg",
    title: "Golden 封蜡卷宗",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: "golden-turn-kernel",
  });
  return {
    session,
    scope,
    campaign: parseTtrpgCampaignContentV1(authored, parseRulePackV1(rulePack)),
    rulePack: parseRulePackV1(rulePack),
    pcA,
    pcB,
    clerk,
    outsideGuard,
  };
}

async function currentVersion(sessionId: number) {
  return readSimulationStateVersion(sessionId);
}

async function resolveCurrentActorUntil(input: {
  sessionId: number;
  actorKey: string;
  commandPrefix: string;
}): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    const state = await readSimulationState(input.sessionId);
    if (state.ttrpg!.activeActorKey === input.actorKey) return;
    const version = await currentVersion(input.sessionId);
    await resolveTtrpgRuleAction({
      sessionId: input.sessionId,
      commandId: `${input.commandPrefix}.${index}`,
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      actionKey: "overcome",
      actorKey: state.ttrpg!.activeActorKey!,
      targetKey: null,
      difficulty: 7,
    });
  }
  throw new Error(`未能在有界轮转内到达行动者:${input.actorKey}`);
}

describe("TTRPG-3L · Golden single-turn kernel", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("冻结完整行动上下文，原子结算后果，阻止重复技能与并发复制物品，并由长休精确恢复", async () => {
    const { session, campaign, rulePack, pcA, pcB, clerk, outsideGuard } =
      await createGoldenSession();
    let state = await readSimulationState(session.id!);
    let version = await currentVersion(session.id!);
    await completeTtrpgSessionZero({
      sessionId: session.id!,
      commandId: "golden.zero",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: [pcA, pcB],
      completedBy: "gm",
    });
    version = await currentVersion(session.id!);
    await openTtrpgCampaignScene({
      sessionId: session.id!,
      commandId: "golden.open",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      sceneKey: campaign.openingSceneKey,
    });
    await resolveCurrentActorUntil({
      sessionId: session.id!,
      actorKey: pcA,
      commandPrefix: "golden.preroll",
    });

    state = await readSimulationState(session.id!);
    const dualResourceRulePack = structuredClone(rulePack);
    const dualResourceAction = dualResourceRulePack.actions.find(
      (item) => item.key === "investigate",
    )!;
    dualResourceAction.usage.resourceKey = "focus";
    dualResourceAction.usage.cost = 1;
    dualResourceAction.costResourceKey = "stamina";
    dualResourceAction.costAmount = 2;
    state.entities[pcA]!.attributes["resource.focus"] = 1;
    state.entities[pcA]!.attributes["resource.stamina"] = 1;
    expect(
      classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack: dualResourceRulePack,
        actorKey: pcA,
        actionKey: "investigate",
        targetKey: null,
      }),
    ).toMatchObject({
      status: "rejected-illegal",
      reason: expect.stringContaining("stamina 需要 2，当前 1"),
    });

    const prerequisiteRulePack = structuredClone(rulePack);
    prerequisiteRulePack.actions.find(
      (item) => item.key === "investigate",
    )!.requirements = [
      {
        kind: "resource",
        resourceKey: "vigor",
        operator: "at-most",
        value: 0,
      },
    ];
    state.entities[pcA]!.attributes["resource.vigor"] = 1;
    expect(
      classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack: prerequisiteRulePack,
        actorKey: pcA,
        actionKey: "investigate",
        targetKey: null,
      }),
    ).toMatchObject({
      status: "rejected-illegal",
      reason: expect.stringContaining("行动前置条件未满足"),
    });
    expect(
      createTtrpgViewerProjectionV1({
        state,
        campaign,
        rulePack: prerequisiteRulePack,
        role: "player",
        actorKey: pcA,
      }).availableActions.map((action) => action.actionKey),
    ).not.toContain("investigate");
    state.entities[pcA]!.attributes["resource.vigor"] = 0;
    expect(
      classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack: prerequisiteRulePack,
        actorKey: pcA,
        actionKey: "investigate",
        targetKey: null,
      }).status,
    ).toBeNull();
    expect(
      createTtrpgViewerProjectionV1({
        state,
        campaign,
        rulePack: prerequisiteRulePack,
        role: "player",
        actorKey: pcA,
      }).availableActions.map((action) => action.actionKey),
    ).toContain("investigate");

    version = await currentVersion(session.id!);
    await submitTtrpgActionIntentV2({
      sessionId: session.id!,
      commandId: "golden.pc-a.no-roll",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      intentKey: `intent.${version.sequence + 1}.${pcA}.assist`,
      actorKey: pcA,
      rawInput: "我把整理好的索引递给岑遥，协助她核对下一批卷宗。",
      actionKey: "assist",
      targetKey: pcB,
      submittedBy: { role: "gm", viewerKey: "gm" },
    });
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.product!.actionHistory.at(-1)?.receipt).toMatchObject({
      terminalStatus: "resolved-no-roll",
      context: { declaredIntent: { intentKey: expect.stringContaining("assist") } },
    });
    await resolveCurrentActorUntil({
      sessionId: session.id!,
      actorKey: pcA,
      commandPrefix: "golden.after-no-roll",
    });

    const pcASeat = await db.ttrpgSessionParticipants
      .where("sessionId")
      .equals(session.id!)
      .filter((row) => row.role === "player" && row.actorKey === pcA)
      .first();
    expect(pcASeat).toMatchObject({
      assignmentState: "claimed",
      sessionZeroAcceptedAtSequence: expect.any(Number),
    });
    version = await currentVersion(session.id!);
    await expect(
      commitTtrpgIntentDispositionV2({
        sessionId: session.id!,
        commandId: "golden.disposition.spoofed",
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        intentKey: `intent.${version.sequence + 1}.${pcA}.spoofed`,
        actorKey: pcA,
        rawInput: "伪造其他玩家的撤回。",
        actionKey: null,
        targetKey: null,
        terminalStatus: "cancelled",
        reason: "越权撤回不应写入。",
        submittedBy: { role: "player", viewerKey: "viewer.someone-else" },
      }),
    ).rejects.toThrow("席位权限");

    for (const disposition of [
      {
        suffix: "queued",
        terminalStatus: "queued/deferred" as const,
        actionKey: "investigate",
        reason: "玩家明确选择等待同伴确认暗号后再执行；没有掷骰或消耗。",
      },
      {
        suffix: "interrupted",
        terminalStatus: "interrupted" as const,
        actionKey: "investigate",
        reason: "KP 确认警铃的即时规则反应先行生效；本行动尚未掷骰，次数与资源全部保留。",
      },
      {
        suffix: "cancelled",
        terminalStatus: "cancelled" as const,
        actionKey: null,
        reason: "原玩家撤回尚未确认的声明；没有掷骰、消耗或状态变化。",
      },
    ]) {
      version = await currentVersion(session.id!);
      await commitTtrpgIntentDispositionV2({
        sessionId: session.id!,
        commandId: `golden.disposition.${disposition.suffix}`,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        intentKey: `intent.${version.sequence + 1}.${pcA}.${disposition.suffix}`,
        actorKey: pcA,
        rawInput: `Golden ${disposition.suffix} 行动声明`,
        actionKey: disposition.actionKey,
        targetKey: null,
        terminalStatus: disposition.terminalStatus,
        reason: disposition.reason,
        submittedBy:
          disposition.terminalStatus === "queued/deferred"
            ? { role: "player" as const, viewerKey: pcASeat!.viewerKey }
            : { role: "gm" as const, viewerKey: "gm" },
      });
    }

    version = await currentVersion(session.id!);
    const clarificationInput = {
      sessionId: session.id!,
      commandId: "golden.pc-a.clarify",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      intentKey: `intent.${version.sequence + 1}.${pcA}`,
      actorKey: pcA,
      rawInput: "我检查一下这里。",
      actionKey: null,
      targetKey: null,
      submittedBy: { role: "gm" as const, viewerKey: "gm" },
    };
    const clarification = await submitTtrpgActionIntentV2(clarificationInput);
    expect((await submitTtrpgActionIntentV2(clarificationInput)).id).toBe(
      clarification.id,
    );
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.product!.intentReceipts).toEqual([
      expect.objectContaining({ terminalStatus: "queued/deferred" }),
      expect.objectContaining({ terminalStatus: "interrupted" }),
      expect.objectContaining({ terminalStatus: "cancelled" }),
      expect.objectContaining({
        terminalStatus: "needs-clarification",
        reason: expect.stringContaining("确认"),
      }),
    ]);
    expect(state.ttrpg!.activeActorKey).toBe(pcA);

    version = await currentVersion(session.id!);
    const actionEvent = await submitTtrpgActionIntentV2({
      sessionId: session.id!,
      commandId: "golden.pc-a.investigate",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      intentKey: `intent.${version.sequence + 1}.${pcA}`,
      rawInput:
        "我消耗最后一次洞察专注，检查印章是否被替换，并把发现告诉岑遥。",
      actionKey: "investigate",
      actorKey: pcA,
      targetKey: null,
      difficulty: 7,
      submittedBy: { role: "gm", viewerKey: "gm" },
    });
    state = await readSimulationState(session.id!);
    const action = state.ttrpg!.product!.actionHistory.find(
      (item) => item.eventSequence === actionEvent.sequence,
    )!;
    expect(action.check?.rule).toMatchObject({
      actionKey: "investigate",
      attributeKey: "mind",
      skillKey: "investigate",
      skillValue: 2,
    });
    expect(action.abilityChange).toMatchObject({
      before: { remainingUses: 1 },
      after: { remainingUses: 0 },
    });
    expect(action.receipt?.context).toMatchObject({
      actorKey: pcA,
      declaredIntent: {
        rawInput:
          "我消耗最后一次洞察专注，检查印章是否被替换，并把发现告诉岑遥。",
      },
      actorInventoryInstanceIds: expect.arrayContaining([expect.any(String)]),
      abilityUsesBefore: 1,
      sceneSnapshot: {
        title: "封锁档案室",
        description: expect.stringContaining("潮湿木架"),
        gmSecret: expect.stringContaining("第三排空心书脊"),
      },
      checkSnapshot: {
        attributeKey: "mind",
        attributeValue: expect.any(Number),
        skillKey: "investigate",
        skillValue: 2,
        difficulty: 7,
      },
    });
    expect(action.receipt?.terminalStatus).toBe("resolved-check");
    expect(action.receipt?.context.observers.map((item) => item.actorKey)).toEqual(
      expect.arrayContaining([pcA, pcB, clerk]),
    );
    expect(action.receipt?.context.observers).toHaveLength(3);
    expect(action.receipt?.context.observers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ actorKey: outsideGuard })]),
    );
    expect(action.receipt?.context.reactionCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorKey: clerk,
          responsePolicy: "gm-eligible",
          reactionType: "conceal-or-block",
          motivation: expect.stringContaining("阻止调查者"),
          publicReactionText: expect.stringMatching(/收拢.*阻止/),
        }),
        expect.objectContaining({
          actorKey: pcB,
          responsePolicy: "prompt-human",
          reactionType: "prompt-human",
          publicReactionText: null,
        }),
      ]),
    );
    expect(action.receipt?.context.reactionCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ actorKey: outsideGuard })]),
    );
    const deterministicFrame = createDeterministicGmSynthesisFrameV2(
      action.receipt!,
    );
    expect(deterministicFrame.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorKey: clerk,
          text: expect.stringMatching(/收拢.*阻止/),
        }),
        expect.objectContaining({ actorKey: pcB, text: null }),
      ]),
    );
    expect(deterministicFrame.reactions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ actorKey: outsideGuard })]),
    );

    const pcBSeat = await db.ttrpgSessionParticipants
      .where("sessionId")
      .equals(session.id!)
      .filter((row) => row.role === "player" && row.actorKey === pcB)
      .first();
    expect(createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "player", actorKey: pcB,
    }).pendingHumanResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionSequence: action.eventSequence,
        actionReceiptKey: action.receipt!.receiptKey,
        actorKey: pcB,
      }),
    ]));
    version = await currentVersion(session.id!);
    await expect(recordTtrpgHumanResponseV2({
      sessionId: session.id!, commandId: "golden.human-response.spoofed",
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionSequence: action.eventSequence, actionReceiptKey: action.receipt!.receiptKey,
      actorKey: pcB, kind: "speak", text: "伪造岑遥回应。", audience: "party",
      viewerKey: pcASeat!.viewerKey,
    })).rejects.toThrow("席位权限");
    const responseEvent = await recordTtrpgHumanResponseV2({
      sessionId: session.id!, commandId: "golden.human-response.pc-b",
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionSequence: action.eventSequence, actionReceiptKey: action.receipt!.receiptKey,
      actorKey: pcB, kind: "speak", text: "我接过索引，先核对纸张批次。", audience: "gm-only",
      viewerKey: pcBSeat!.viewerKey,
    });
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.product!.humanResponses).toEqual([
      expect.objectContaining({
        eventSequence: responseEvent.sequence,
        actionSequence: action.eventSequence,
        actorKey: pcB,
        text: "我接过索引，先核对纸张批次。",
        audience: "gm-only",
      }),
    ]);
    expect(createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "player", actorKey: pcA,
    }).humanResponses).toEqual([]);
    const pcBViewAfterResponse = createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "player", actorKey: pcB,
    });
    expect(pcBViewAfterResponse).toMatchObject({
      humanResponses: [expect.objectContaining({ actorKey: pcB, audience: "gm-only" })],
    });
    expect(pcBViewAfterResponse.pendingHumanResponses).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ actionSequence: action.eventSequence, actorKey: pcB }),
    ]));
    version = await currentVersion(session.id!);
    await expect(recordTtrpgHumanResponseV2({
      sessionId: session.id!, commandId: "golden.human-response.duplicate",
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionSequence: action.eventSequence, actionReceiptKey: action.receipt!.receiptKey,
      actorKey: pcB, kind: "decline", audience: "party", viewerKey: pcBSeat!.viewerKey,
    })).rejects.toThrow("已经回应");

    const opening = campaign.scenes.find(
      (item) => item.sceneKey === campaign.openingSceneKey,
    )!;
    const clueKey = opening.clueKeys[0];
    version = await currentVersion(session.id!);
    const effectCommandId = `golden.effects.${version.sequence}`;
    const degree = action.outcome === "automatic" ? "success" : action.outcome;
    const plan: TtrpgEffectPlanV2 = {
      schema: "storyforge.ttrpg-effect-plan",
      version: 2,
      planKey: `action-consequence.${action.eventSequence}`,
      degree,
      sourceEventId: `event.${action.eventSequence}`,
      ruleRef: action.actionKey,
      reason: "调查结算：发现封蜡线索、取得防护装备，并引发档案员戒心与警戒时钟。",
      audience: "party",
      idempotencyKey: effectCommandId,
      status: "immediate",
      effects: [
        {
          effectKey: "golden.clue",
          family: "story",
          operation: "clue.discover",
          targetRef: pcA,
          storyKey: clueKey,
          value: true,
        },
        {
          effectKey: "golden.item",
          family: "item",
          operation: "item.grant",
          targetRef: pcA,
          itemDefinitionRef: "protective-gear",
          itemInstanceRef: null,
          destinationRef: null,
          amount: 1,
        },
        {
          effectKey: "golden.clock",
          family: "story",
          operation: "clock.advance",
          targetRef: opening.sceneKey,
          storyKey: "alarm",
          value: 1,
        },
        {
          effectKey: "golden.social",
          family: "social",
          operation: "relationship",
          targetRef: clerk,
          socialKey: "suspicion",
          amount: 1,
        },
      ],
    };
    const effectEvent = await commitTtrpgEffectPlanV2({
      sessionId: session.id!,
      commandId: effectCommandId,
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      actionSequence: action.eventSequence,
      plan,
    });
    state = await readSimulationState(session.id!);
    const grantedItemId = `item.${effectEvent.sequence}.1`;
    expect(state.ttrpg!.product!.discoveredClues).toEqual(
      expect.arrayContaining([expect.objectContaining({ clueKey, actorKey: pcA })]),
    );
    expect(state.ttrpg!.product!.inventory!.items[grantedItemId]).toMatchObject({
      definitionRef: "protective-gear",
      ownerRef: pcA,
      acquiredByEventId: `event.${effectEvent.sequence}`,
    });
    expect(
      state.ttrpg!.product!.effectLedger!.storyClocks[`${opening.sceneKey}:alarm`],
    ).toBe(1);
    expect(
      state.ttrpg!.product!.effectLedger!.socialBalances[
        `${clerk}:relationship:suspicion`
      ],
    ).toBe(1);
    expect(state.ttrpg!.product!.effectLedger!.entries.at(-1)?.transitions).toHaveLength(
      4,
    );

    version = await currentVersion(session.id!);
    await expect(
      commitTtrpgEffectPlanV2({
        sessionId: session.id!,
        commandId: "golden.effects.duplicate",
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        actionSequence: action.eventSequence,
        plan: {
          ...plan,
          planKey: `${plan.planKey}.duplicate`,
          idempotencyKey: "golden.effects.duplicate",
        },
      }),
    ).rejects.toThrow("唯一后果计划");

    await resolveCurrentActorUntil({
      sessionId: session.id!,
      actorKey: pcA,
      commandPrefix: "golden.next-round",
    });
    state = await readSimulationState(session.id!);
    const checksBeforeRejectedReuse = state.ttrpg!.checks.length;
    version = await currentVersion(session.id!);
    const rejected = await submitTtrpgActionIntentV2({
      sessionId: session.id!,
      commandId: "golden.pc-a.exhausted",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      intentKey: `intent.${version.sequence + 1}.${pcA}`,
      rawInput: "我立刻再次使用洞察专注检查另一枚印章。",
      actionKey: "investigate",
      actorKey: pcA,
      targetKey: null,
      difficulty: 7,
      submittedBy: { role: "gm", viewerKey: "gm" },
    });
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.checks).toHaveLength(checksBeforeRejectedReuse);
    expect(state.ttrpg!.activeActorKey).toBe(pcA);
    expect(state.ttrpg!.product!.intentReceipts).toEqual([
      expect.objectContaining({ terminalStatus: "queued/deferred" }),
      expect.objectContaining({ terminalStatus: "interrupted" }),
      expect.objectContaining({ terminalStatus: "cancelled" }),
      expect.objectContaining({ terminalStatus: "needs-clarification" }),
      expect.objectContaining({
        eventSequence: rejected.sequence,
        terminalStatus: "rejected-illegal",
        reason: expect.stringMatching(/次数已耗尽.*长休恢复/),
      }),
    ]);

    version = await currentVersion(session.id!);
    await completeTtrpgRestV2({
      sessionId: session.id!,
      commandId: "golden.long-rest",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      restKey: "golden.long-rest",
      kind: "long-rest",
      actorKeys: [pcA, pcB],
      gmKey: "gm",
      reason: "调查组撤回安全住处完成长休。",
    });
    version = await currentVersion(session.id!);
    await resolveTtrpgRuleAction({
      sessionId: session.id!,
      commandId: "golden.pc-a.after-rest",
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      actionKey: "investigate",
      actorKey: pcA,
      targetKey: null,
      difficulty: 7,
    });

    version = await currentVersion(session.id!);
    const transfer = (commandId: string, destinationOwnerRef: string) =>
      commitTtrpgItemCommandV2({
        sessionId: session.id!,
        commandId,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        requestedBy: { role: "gm", actorKey: "gm" },
        command: {
          commandId,
          kind: "transfer",
          instanceId: grantedItemId,
          expectedOwnerRef: pcA,
          destinationOwnerRef,
        },
      });
    const concurrent = await Promise.allSettled([
      transfer("golden.transfer.pc-b", pcB),
      transfer("golden.transfer.clerk", clerk),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    state = await readSimulationState(session.id!);
    expect([pcB, clerk]).toContain(
      state.ttrpg!.product!.inventory!.items[grantedItemId].ownerRef,
    );
    expect(
      Object.values(state.ttrpg!.product!.inventory!.items).filter(
        (item) => item.itemInstanceId === grantedItemId,
      ),
    ).toHaveLength(1);
    expect(state.ttrpg!.product!.itemHistory).toEqual([
      expect.objectContaining({
        schema: "storyforge.ttrpg-item-receipt",
        operation: "transfer",
        itemInstanceId: grantedItemId,
        requestedBy: { role: "gm", actorKey: "gm" },
        before: expect.objectContaining({ ownerRef: pcA }),
        after: expect.objectContaining({
          ownerRef: state.ttrpg!.product!.inventory!.items[grantedItemId].ownerRef,
        }),
      }),
    ]);

    const gmRecap = createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "gm", actorKey: null,
    }).recap;
    expect(gmRecap).toMatchObject({
      schema: "storyforge.ttrpg-session-fact-recap",
      version: 2,
      scope: { status: "whole-instance" },
      viewerKind: "gm-complete",
      intentDispositionCount: 5,
    });
    expect(gmRecap.abilityChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorKey: pcA, abilityKey: "investigate", reason: "action", usesBefore: 1, usesAfter: 0 }),
      expect.objectContaining({ actorKey: pcA, abilityKey: "investigate", reason: "long-rest", usesBefore: 0, usesAfter: 1 }),
    ]));
    expect(gmRecap.itemChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemInstanceId: grantedItemId, operation: "item.grant", source: "effect-plan" }),
      expect.objectContaining({ itemInstanceId: grantedItemId, operation: "transfer", source: "direct-command", ownerBefore: pcA }),
    ]));
    expect(gmRecap.ledgerChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: "social", operation: "relationship", targetRef: clerk }),
      expect.objectContaining({ family: "story", operation: "clue.discover", targetRef: pcA }),
    ]));
    expect(gmRecap.unresolvedRequiredClues.visibleTitles.length).toBeGreaterThan(0);

    const pcARecap = createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "player", actorKey: pcA,
    }).recap;
    expect(pcARecap.viewerKind).toBe("character-private");
    expect(pcARecap.unresolvedRequiredClues.visibleTitles).toEqual([]);
    expect(pcARecap.unresolvedRequiredClues.hiddenCount).toBeGreaterThan(0);
    expect(pcARecap.itemChanges.map(change => change.itemInstanceId)).toContain(grantedItemId);
    const spectatorRecap = createTtrpgViewerProjectionV1({
      state, campaign, rulePack, role: "spectator", actorKey: null,
    }).recap;
    expect(spectatorRecap.viewerKind).toBe("spectator-public");
    expect(spectatorRecap.itemChanges).toEqual([]);
    const automaticRecaps = createTtrpgAutomaticSessionRecapsV2({
      state, campaign, rulePack, sessionKey: "session.golden", participantKeys: [pcA, pcB],
    });
    expect(automaticRecaps.memories).toHaveLength(4);
    expect(automaticRecaps.memories.map(memory => memory.audience)).toEqual([
      "party", "gm-only", `actor:${pcA}`, `actor:${pcB}`,
    ]);
    expect(automaticRecaps.gmSummary).toContain("未解必需线索：");
    expect(automaticRecaps.publicSummary).toContain("条未公开");
    expect(automaticRecaps.publicSummary).not.toContain(
      gmRecap.unresolvedRequiredClues.visibleTitles[0],
    );
    expect(automaticRecaps.memories.find(memory => memory.audience === `actor:${pcA}`)?.summary)
      .toContain("能力次数：");
  });
});
