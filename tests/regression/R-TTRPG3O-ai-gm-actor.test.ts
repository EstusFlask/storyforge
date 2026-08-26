import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import {
  commitTtrpgGmActorActionFromHarnessV1,
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  resolveTtrpgRuleAction,
} from "../../src/lib/simulation/runtime";
import {
  adoptTtrpgGmActorActionCandidateV1,
  evaluateTtrpgGmActorCandidateOutputV1,
  generateTtrpgGmActorActionCandidateV1,
} from "../../src/lib/ttrpg/gm-actor-harness";
import { loadTtrpgGmRuntimeViewV1 } from "../../src/lib/ttrpg/gm-context";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from "../../src/lib/ttrpg/authoring";
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from "../../src/lib/ttrpg/participants";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import type {
  SimulationSession,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../../src/lib/types";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";

const now = 1_792_100_000_000;
const validOutput = JSON.stringify({
  actionKey: "investigate",
  targetKey: null,
  approach: "依据当前掌握的现场事实检查痕迹，并对调查者的推进形成合理回应。",
  spokenIntent: "先让我看看这里留下了什么。",
});

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
        name: "顾棠",
        identity: "果断的记录者",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 2,
        name: "祁安",
        identity: "善于交涉的观察者",
        location: "雾港",
        roleWeight: "main",
      },
      {
        _exportId: 3,
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
    worldCode: "ai-gm-actor-harbor",
    worldName: "潮汐界",
    workTitle: "雾港纪事",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

async function createFormalSession(controller: "ai" | "hybrid"): Promise<{
  session: SimulationSession;
  scope: WorkspaceScope;
}> {
  const projectId = (await db.projects.add({
    name: "AI KP 角色行动验收",
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
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界 v1",
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashGameProductionValueV2(manifest),
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
    title: "AI KP NPC 行动桌",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: `ai-gm-actor-${controller}`,
  });
  const gm = (await readTtrpgSessionParticipantsV2(session.id!)).find(
    (row) => row.role === "gm",
  )!;
  await configureTtrpgSessionParticipantV2({
    sessionId: session.id!,
    seatKey: gm.seatKey,
    expectedRevision: gm.revision,
    commandId: `configure.gm.${controller}`,
    requestedByViewerKey: gm.viewerKey,
    controller,
    activation: "initiative",
    consent: {
      aiIdentityDisclosed: true,
      aiAdviceAllowed: controller === "hybrid",
    },
  });
  let version = await readSimulationStateVersion(session.id!);
  const initial = await readSimulationState(session.id!);
  await completeTtrpgSessionZero({
    sessionId: session.id!,
    commandId: `gm-actor.zero.${controller}`,
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    acceptedItemKeys: initial.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: "gm",
  });
  version = await readSimulationStateVersion(session.id!);
  await openTtrpgCampaignScene({
    sessionId: session.id!,
    commandId: `gm-actor.scene.${controller}`,
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    sceneKey: "scene.opening",
  });
  for (let guard = 0; guard < 8; guard += 1) {
    const state = await readSimulationState(session.id!);
    const active = state.ttrpg?.activeActorKey;
    if (!active) throw new Error("当前没有行动者");
    const template = state.entities[active];
    if (template?.kind === "npc") return { session, scope };
    version = await readSimulationStateVersion(session.id!);
    await resolveTtrpgRuleAction({
      sessionId: session.id!,
      commandId: `gm-actor.advance.${controller}.${guard}`,
      baseSequence: version.sequence,
      baseStateHash: version.stateHash,
      actorKey: active,
      actionKey: "investigate",
      difficulty: 8,
    });
  }
  throw new Error("未能推进到 NPC 回合");
}

describe("TTRPG-3O · governed AI GM actor turn", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("AI KP 只能从 GM 闭集选择 NPC 意图，采用后由 RulePack 结算并留下授权证据", async () => {
    const { session, scope } = await createFormalSession("ai");
    const view = await loadTtrpgGmRuntimeViewV1({
      scope,
      simulationSessionId: session.id!,
    });
    expect(view.activeTurn).toMatchObject({ role: "npc", gmController: "ai" });
    expect(view.activeTurn!.availableActions.length).toBeGreaterThan(0);
    expect(
      evaluateTtrpgGmActorCandidateOutputV1(
        JSON.stringify({
          actionKey: "investigate",
          targetKey: null,
          approach: "调查已经成功并造成 9 点伤害。",
          spokenIntent: null,
        }),
        view,
      ),
    ).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("机械结果"),
    });

    const version = await readSimulationStateVersion(session.id!);
    await expect(
      resolveTtrpgRuleAction({
        sessionId: session.id!,
        commandId: "manual-bypass.ai-gm",
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        actorKey: view.activeTurn!.actorKey,
        actionKey: "investigate",
        difficulty: 8,
      }),
    ).rejects.toThrow("AI KP 控制的 NPC 不能通过真人直提入口");

    const generated = await generateTtrpgGmActorActionCandidateV1({
      scope,
      simulationSessionId: session.id!,
      objective: "按 NPC 目标合理推进当前回合",
      runAI: async () => validOutput,
    });
    expect(generated.snapshot.projection.state).toBe("running");
    const adopted = await adoptTtrpgGmActorActionCandidateV1({
      scope,
      runId: generated.candidate.runId,
    });
    expect(adopted.snapshot.projection.state).toBe("completed");
    const result = (
      await readSimulationState(session.id!)
    ).ttrpg!.product!.actionHistory.at(-1)!;
    expect(result.actorAuthority).toMatchObject({
      source: "ai-gm-npc",
      viewerKey: "viewer.gm",
      runId: generated.candidate.runId,
      candidateHash: generated.candidate.candidateHash,
      contextManifestHash: generated.candidate.contextManifestHash,
    });
    expect(
      result.check?.dice.every((value) => value >= 1 && value <= 100),
    ).toBe(true);
  });

  it("混合 KP 的 NPC 候选在真人确认前不能进入正式规则事件", async () => {
    const { session, scope } = await createFormalSession("hybrid");
    const generated = await generateTtrpgGmActorActionCandidateV1({
      scope,
      simulationSessionId: session.id!,
      objective: "给真人 KP 一个 NPC 行动建议",
      runAI: async () => validOutput,
    });
    expect(generated.snapshot.projection.state).toBe("awaiting_confirmation");
    await expect(
      commitTtrpgGmActorActionFromHarnessV1({
        sessionId: session.id!,
        runId: generated.candidate.runId,
        candidateHash: generated.candidate.candidateHash,
      }),
    ).rejects.toThrow("尚未获得真人确认");
    const adopted = await adoptTtrpgGmActorActionCandidateV1({
      scope,
      runId: generated.candidate.runId,
    });
    expect(adopted.snapshot.projection.state).toBe("completed");
    expect(
      (await readSimulationState(session.id!)).ttrpg!.product!.actionHistory.at(
        -1,
      )!.actorAuthority?.source,
    ).toBe("hybrid-gm-confirmed");
  });
});
