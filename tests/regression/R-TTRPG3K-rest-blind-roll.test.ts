import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import {
  appendSimulationEvent,
  completeTtrpgRestV2,
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  resolveTtrpgRuleAction,
} from "../../src/lib/simulation/runtime";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
  saveTtrpgCampaignModuleV1,
} from "../../src/lib/ttrpg/authoring";
import { parseTtrpgCampaignContentV1 } from "../../src/lib/ttrpg/campaign";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import { parseRulePackV1 } from "../../src/lib/ttrpg/rule-pack";
import { createTtrpgViewerProjectionV1 } from "../../src/lib/ttrpg/viewer-projection";
import type {
  SimulationSession,
  TtrpgCampaignContentV1,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../../src/lib/types";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";

const NOW = 1_794_000_000_000;

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      {
        _exportId: 0,
        name: "林舟",
        identity: "独自进入封锁档案室的调查者",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 1,
        name: "守潮人",
        identity: "掌握封锁区钥匙的档案员",
        location: "雾港",
        roleWeight: "npc",
      },
    ],
    characterRelations: [],
    importantLocations: [
      { _exportId: 0, name: "雾港档案室", description: "只在退潮时开放。" },
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
    worldCode: "blind-rest-harbor",
    worldName: "潮汐界",
    workTitle: "档案室暗骰",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

async function createSession(): Promise<{
  session: SimulationSession;
  scope: WorkspaceScope;
  campaign: TtrpgCampaignContentV1;
}> {
  const projectId = (await db.projects.add({
    name: "休息与暗骰验收",
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
  const worldContentHash = await hashGameProductionValueV2(manifest);
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界 v1",
    manifestJson: JSON.stringify(manifest),
    contentHash: worldContentHash,
    sourceWorldCode: manifest.worldCode,
    createdAt: NOW,
  })) as number;
  const ruleRow = await installStoryForgeRulePackV1(scope);
  const fixture = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope,
    worldReleaseId,
    rulePackId: ruleRow.id,
    fixtureOnly: true,
    confirmDefaultMappings: true,
  });
  const authored = JSON.parse(fixture.contentJson) as TtrpgCampaignContentV1;
  const playerKey = authored.characterTemplates.find((item) => item.role === "player")!.characterKey;
  const opening = authored.scenes.find((item) => item.sceneKey === authored.openingSceneKey)!;
  opening.participantKeys = [playerKey];
  opening.actionKeys = [...new Set([...opening.actionKeys, "recover"])];
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
    title: "暗骰与长休桌",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: "rest-blind-roll",
  });
  return {
    session,
    scope,
    campaign: parseTtrpgCampaignContentV1(authored, parseRulePackV1(ruleRow.rulePackJson)),
  };
}

async function version(sessionId: number) {
  return readSimulationStateVersion(sessionId);
}

describe("TTRPG-3K · formal rest and blind-roll privacy", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("长休只按冻结 reset trigger 恢复能力，幂等重试不重复且原始事件入口不能伪造", async () => {
    const { session } = await createSession();
    let state = await readSimulationState(session.id!);
    const playerKey = Object.values(state.entities).find((item) => item.kind === "player")!.entityKey;
    let current = await version(session.id!);
    await completeTtrpgSessionZero({
      sessionId: session.id!,
      commandId: "rest.zero",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: [playerKey],
      completedBy: "gm",
    });
    current = await version(session.id!);
    await openTtrpgCampaignScene({
      sessionId: session.id!,
      commandId: "rest.open",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      sceneKey: "scene.opening",
    });
    current = await version(session.id!);
    await resolveTtrpgRuleAction({
      sessionId: session.id!,
      commandId: "rest.use-recover",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      actionKey: "recover",
      actorKey: playerKey,
      targetKey: playerKey,
    });
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.product!.abilityStates![`${playerKey}::recover`].cooldownUntilRound).not.toBeNull();

    current = await version(session.id!);
    const completed = await completeTtrpgRestV2({
      sessionId: session.id!,
      commandId: "rest.long.1",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      restKey: "rest.long.1",
      kind: "long-rest",
      actorKeys: [playerKey],
      gmKey: "gm",
      reason: "队伍撤回安全营地完成长休。",
    });
    const replay = await completeTtrpgRestV2({
      sessionId: session.id!,
      commandId: "rest.long.1",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      restKey: "rest.long.1",
      kind: "long-rest",
      actorKeys: [playerKey],
      gmKey: "gm",
      reason: "队伍撤回安全营地完成长休。",
    });
    expect(replay.id).toBe(completed.id);
    state = await readSimulationState(session.id!);
    expect(state.ttrpg!.product!.abilityStates![`${playerKey}::recover`].cooldownUntilRound).toBeNull();
    expect(state.ttrpg!.product!.restHistory).toEqual([
      expect.objectContaining({
        restKey: "rest.long.1",
        kind: "long-rest",
        actorKeys: [playerKey],
        abilityChanges: [expect.objectContaining({ abilityKey: "recover" })],
      }),
    ]);
    await expect(
      appendSimulationEvent({
        sessionId: session.id!,
        type: "ttrpg.rest.completed",
        actorKey: "gm",
        targetKey: "rest.forged",
        payload: {},
      }),
    ).rejects.toThrow("专用 API");
  });

  it("暗骰保留 GM 完整证明，但玩家与旁观者看不到骰点、合计、等级或机械摘要", async () => {
    const { session, campaign } = await createSession();
    let state = await readSimulationState(session.id!);
    const playerKey = Object.values(state.entities).find((item) => item.kind === "player")!.entityKey;
    let current = await version(session.id!);
    await completeTtrpgSessionZero({
      sessionId: session.id!,
      commandId: "blind.zero",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: [playerKey],
      completedBy: "gm",
    });
    current = await version(session.id!);
    await openTtrpgCampaignScene({
      sessionId: session.id!,
      commandId: "blind.open",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      sceneKey: campaign.openingSceneKey,
    });
    current = await version(session.id!);
    await resolveTtrpgRuleAction({
      sessionId: session.id!,
      commandId: "blind.investigate",
      baseSequence: current.sequence,
      baseStateHash: current.stateHash,
      actionKey: "investigate",
      actorKey: playerKey,
      targetKey: null,
      difficulty: 10,
      rollVisibility: "gm-only",
    });
    state = await readSimulationState(session.id!);
    const manifest = JSON.parse((await db.gameReleases.get(session.gameReleaseId!))!.manifestJson);
    const rulePack = parseRulePackV1(manifest.runtimePackage.ttrpg.rulePack.content);
    const project = (role: "gm" | "player" | "spectator") =>
      createTtrpgViewerProjectionV1({
        state,
        campaign,
        rulePack,
        role,
        actorKey: role === "player" ? playerKey : null,
      });
    const gm = project("gm").recentActions[0];
    const player = project("player").recentActions[0];
    const spectator = project("spectator").recentActions[0];
    expect(gm).toMatchObject({
      actionKey: "investigate",
      total: expect.any(Number),
      difficulty: 10,
    });
    expect(gm.dice).toHaveLength(2);
    expect(gm.dice.every((die) => Number.isInteger(die))).toBe(true);
    const committedAction = state.ttrpg!.product!.actionHistory.at(-1)!;
    expect(committedAction.receipt?.context.sceneSnapshot).toEqual({
      title: expect.any(String),
      description: expect.any(String),
      locationKey: expect.anything(),
      failureForward: expect.any(String),
      gmSecret: expect.any(String),
    });
    expect(committedAction.receipt?.context.checkSnapshot).toEqual({
      checkKey: "standard",
      attributeKey: "mind",
      attributeValue: expect.any(Number),
      skillKey: "investigate",
      skillValue: 0,
      diceModelKey: "core-2d6",
      difficulty: 10,
    });
    for (const hidden of [player, spectator]) {
      expect(hidden).toMatchObject({
        outcome: "hidden",
        dice: [],
        modifier: null,
        total: null,
        difficulty: null,
        receipt: {
          mechanicalSummary: "暗骰结果仅 KP 可见，等待主持反馈。",
          actorConsequence: "等待 KP 描述行动反馈。",
        },
      });
      expect(hidden).not.toHaveProperty("receipt.context");
    }
    expect(state.ttrpg!.checks[0].rule?.proofHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
