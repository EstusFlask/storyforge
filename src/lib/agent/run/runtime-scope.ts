import { interactionVisibilityView } from "../../character-interaction/runtime";
import { db } from "../../db/schema";
import {
  readSimulationState,
  readSimulationStateVersion,
} from "../../simulation/runtime";
import type { AgentRunScopeV1, WorkspaceScope } from "../../types";
import { assertInstanceBinding } from "../../world-engine/instances";
import { assertGameReleaseUnchanged } from "../../text-game/releases";
import { assertReleaseUnchanged } from "../../world-engine/releases";
import { hashCanonicalValue } from "./hash";
import {
  adventureNarrativeProjection,
  availableAdventureActions,
} from "../../adventure/runtime";
import { parseAnyGameReleaseManifest } from "../../text-game/releases";
import {
  availableNarrativeSimulationActions,
  narrativeSimulationProjection,
  visibleNarrativeSimulationReports,
} from "../../narrative-simulation/runtime";
import { openWorldMainlineProjection } from "../../open-world/runtime";
import { loadTtrpgGmRuntimeViewV1 } from "../../ttrpg/gm-context";
import { loadTtrpgPlayerRuntimeViewV1 } from "../../ttrpg/player-context";

export interface RuntimeHarnessBoundaryV1 {
  scope: AgentRunScopeV1 & { runtime: NonNullable<AgentRunScopeV1["runtime"]> };
  boundaryHash: string;
}

function fail(message: string): never {
  throw new Error(`[runtime-harness] ${message}`);
}

async function releaseHash(sessionId: number): Promise<string> {
  const session = await db.simulationSessions.get(sessionId);
  if (!session) fail("运行实例不存在");
  if (session.gameReleaseId != null) {
    return (await assertGameReleaseUnchanged(session.gameReleaseId))
      .contentHash;
  }
  if (session.worldReleaseId != null) {
    await assertReleaseUnchanged(session.worldReleaseId);
    const release = await db.worldReleases.get(session.worldReleaseId);
    if (!release) fail("WorldRelease 在验证后丢失");
    return release.contentHash;
  }
  if (session.draftSnapshotHash?.trim()) return session.draftSnapshotHash;
  fail("运行实例没有可验证的发布或草稿快照哈希");
}

/** Capture the exact visible runtime input used by one character-facing model call. */
export async function captureRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
  participantKey: string;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertInstanceBinding(
    input.simulationSessionId,
    input.scope,
  );
  if (
    session.kind !== "chatgame" &&
    session.kind !== "textadventure" &&
    session.kind !== "textworld"
  ) {
    fail("角色互动技能只能绑定带冻结互动状态的正式实例");
  }
  const participantKey = input.participantKey.trim();
  if (!participantKey) fail("缺少角色参与者 key");
  const [version, state, frozenReleaseHash] = await Promise.all([
    readSimulationStateVersion(session.id!),
    readSimulationState(session.id!),
    releaseHash(session.id!),
  ]);
  if (!state.interaction) fail("实例没有 CHATGAME-2 互动状态");
  const visibilityHash = await hashCanonicalValue(
    interactionVisibilityView(state.interaction, participantKey),
  );
  const runtime = {
    simulationSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozenReleaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

/** Fail closed before a model retry or candidate adoption when SIM advanced. */
export async function assertRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
  participantKey: string;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
    participantKey: input.participantKey,
  });
  const expectedHash = await hashCanonicalValue(expected);
  if (current.boundaryHash !== expectedHash) {
    fail("运行状态、可见知识、场景参与者或发布来源已经变化");
  }
}

/** Capture the player-visible TEXTADV input without creating an AI side channel. */
export async function captureAdventureRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertInstanceBinding(
    input.simulationSessionId,
    input.scope,
  );
  if (
    (session.kind !== "textadventure" && session.kind !== "textworld") ||
    session.gameReleaseId == null
  ) {
    fail("文字冒险技能只能绑定带冻结冒险状态的正式实例");
  }
  const [version, state, frozenReleaseHash, release] = await Promise.all([
    readSimulationStateVersion(session.id!),
    readSimulationState(session.id!),
    releaseHash(session.id!),
    assertGameReleaseUnchanged(session.gameReleaseId),
  ]);
  if (!state.adventure) fail("实例没有 TEXTADV-1 冒险状态");
  const parsedManifest = parseAnyGameReleaseManifest(release.manifestJson);
  const manifest =
    parsedManifest.productType === "text-adventure" ||
    parsedManifest.productType === "text-open-world"
      ? parsedManifest
      : fail("实例没有可用的冻结冒险内容");
  const visibilityHash = await hashCanonicalValue({
    adventure: adventureNarrativeProjection(state.adventure),
    actions: availableAdventureActions(
      manifest.adventure,
      state.adventure,
      state.narrative?.variables,
    ).map((item) => ({
      key: item.action.key,
      available: item.available,
      reason: item.reason,
    })),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    simulationSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozenReleaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertAdventureRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureAdventureRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("冒险状态、可用行动、叙事选择或发布来源已经变化");
  }
}

/** Capture only deterministic state and player-visible reports for TEXTSIM. */
export async function captureNarrativeSimulationRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertInstanceBinding(
    input.simulationSessionId,
    input.scope,
  );
  if (
    (session.kind !== "textsimulation" && session.kind !== "textworld") ||
    session.gameReleaseId == null
  ) {
    fail("叙事模拟技能只能绑定带冻结模拟状态的正式实例");
  }
  const [version, state, frozenReleaseHash, release] = await Promise.all([
    readSimulationStateVersion(session.id!),
    readSimulationState(session.id!),
    releaseHash(session.id!),
    assertGameReleaseUnchanged(session.gameReleaseId),
  ]);
  if (!state.narrativeSimulation) fail("实例没有 TEXTSIM-1 模拟状态");
  const parsedManifest = parseAnyGameReleaseManifest(release.manifestJson);
  const manifest =
    parsedManifest.productType === "narrative-simulation" ||
    parsedManifest.productType === "text-open-world"
      ? parsedManifest
      : fail("实例没有可用的冻结模拟内容");
  const visibilityHash = await hashCanonicalValue({
    simulation: narrativeSimulationProjection(state.narrativeSimulation),
    actions: availableNarrativeSimulationActions(
      manifest.simulation,
      state.narrativeSimulation,
    ).map((item) => ({
      key: item.action.key,
      available: item.available,
      reason: item.reason,
    })),
    reports: visibleNarrativeSimulationReports(
      state.narrativeSimulation,
      "player",
    ),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    simulationSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozenReleaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertNarrativeSimulationRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureNarrativeSimulationRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("叙事模拟状态、玩家可见报告、可用行动、叙事选择或发布来源已经变化");
  }
}

/** Capture the exact player-visible TEXTWORLD region/task boundary. */
export async function captureOpenWorldRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertInstanceBinding(
    input.simulationSessionId,
    input.scope,
  );
  if (session.kind !== "textworld" || session.gameReleaseId == null) {
    fail("开放世界技能只能绑定正式 textworld 实例");
  }
  const [version, state, frozenReleaseHash, release] = await Promise.all([
    readSimulationStateVersion(session.id!),
    readSimulationState(session.id!),
    releaseHash(session.id!),
    assertGameReleaseUnchanged(session.gameReleaseId),
  ]);
  if (!state.openWorld) fail("实例没有 TEXTWORLD-1 区域状态");
  const manifest = parseAnyGameReleaseManifest(release.manifestJson);
  if (manifest.productType !== "text-open-world")
    fail("实例没有开放世界冻结发布");
  const region = manifest.openWorld.regions.find(
    (item) => item.key === state.openWorld!.currentRegionKey,
  );
  const projection = state.openWorld.regionalProjections.find(
    (item) => item.regionKey === state.openWorld!.currentRegionKey,
  );
  if (!region || !projection) fail("当前区域投影不完整");
  const visibilityHash = await hashCanonicalValue({
    world: openWorldMainlineProjection(
      state.openWorld,
      state.openWorld.mainlineQuestKeys,
    ),
    region,
    projection,
    visibleQuests: state.openWorld.questInstances.filter((item) =>
      ["revealed", "active", "resolved", "failed"].includes(item.status),
    ),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    simulationSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozenReleaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertOpenWorldRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureOpenWorldRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("开放世界区域、任务、叙事选择或发布来源已经变化");
  }
}

/** Capture the exact formal GM-only view for one post-resolution narration. */
export async function captureTtrpgGmRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await loadTtrpgGmRuntimeViewV1(input);
  if (!view.safety.completed || !view.scene || !view.latestAction) {
    fail("可信 AI GM 需要已完成 Session Zero、已打开场景和最近正式规则行动");
  }
  const [version, state] = await Promise.all([
    readSimulationStateVersion(view.session.id),
    readSimulationState(view.session.id),
  ]);
  if (
    version.sequence !== view.session.eventSequence ||
    state.ttrpg?.product?.gmNarrations.some(
      (item) => item.actionSequence === view.latestAction!.eventSequence,
    )
  ) {
    fail("最近正式规则行动已经变化或已有 GM 叙事");
  }
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    simulationSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgGmRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureTtrpgGmRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("TTRPG 场景、正式裁定、线索可见性、安全约束或发布来源已经变化");
  }
}

/** Capture one GM-controlled NPC turn before the RulePack action is chosen. */
export async function captureTtrpgGmActorRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await loadTtrpgGmRuntimeViewV1(input);
  if (
    !view.safety.completed ||
    view.safety.status !== "active" ||
    !view.scene ||
    !view.activeTurn ||
    !["ai", "hybrid"].includes(view.activeTurn.gmController) ||
    !view.activeTurn.availableActions.length
  ) {
    fail(
      "AI KP 角色行动需要活动场景、AI/混合 GM 权威和当前 NPC 的合法行动闭集",
    );
  }
  const version = await readSimulationStateVersion(view.session.id);
  if (version.sequence !== view.session.eventSequence)
    fail("AI KP 角色行动上下文已经变化");
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    simulationSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgGmActorRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("AI KP 角色行动 RunContract 缺少 runtime 输入边界");
  const current = await captureTtrpgGmActorRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("AI KP 当前 NPC、合法行动、场景、安全约束或发布来源已经变化");
  }
}

/** Capture exactly one AI player's visible state and currently legal actions. */
export async function captureTtrpgPlayerRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
  actorKey: string;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await loadTtrpgPlayerRuntimeViewV1(input);
  const [version, state] = await Promise.all([
    readSimulationStateVersion(view.session.id),
    readSimulationState(view.session.id),
  ]);
  if (
    version.sequence !== view.session.eventSequence ||
    state.ttrpg?.product?.safety.status !== "active" ||
    !view.projection.availableActions.length
  ) {
    fail("AI 玩家可见状态或可用行动已经变化");
  }
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    simulationSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgPlayerRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
  actorKey: string;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 AI 玩家 runtime 输入边界");
  const current = await captureTtrpgPlayerRuntimeHarnessBoundaryV1({
    scope: input.scope,
    simulationSessionId: expected.simulationSessionId,
    actorKey: input.actorKey,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("TTRPG 玩家可见场景、行动、线索、席位授权或发布来源已经变化");
  }
}
