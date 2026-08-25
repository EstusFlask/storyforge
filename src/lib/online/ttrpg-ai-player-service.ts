import type { TtrpgViewerProjectionV1 } from "../ttrpg/viewer-projection";
import { OnlineRoomAuthorityError } from "./room-authority";

export interface OnlineTtrpgAiPlayerServiceV1 {
  /**
   * Deployment-owned model boundary. The room passes a single-character safe
   * projection; the service returns intent only and must never roll dice or
   * invent consequences.
   */
  propose(input: {
    roomId: string;
    releaseHash: string;
    actorKey: string;
    objective: string;
    projection: TtrpgViewerProjectionV1;
  }): Promise<unknown>;
}

export interface OnlineTtrpgAiPlayerProposalV1 {
  runId: number;
  actionKey: string;
  targetKey: string | null;
  approach: string;
  spokenIntent: string | null;
}

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("ai_player_protocol", message);
}

function text(value: unknown, label: string, maximum: number, nullable = false): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== "string") fail(`${label} 必须是文本${nullable ? "或 null" : ""}`);
  const result = value.trim().normalize("NFC");
  if (!result || result.length > maximum) fail(`${label} 无效`);
  return result;
}

export function parseOnlineTtrpgAiPlayerObjectiveV1(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ai.player.run.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !("objective" in row)) {
    fail("ai.player.run.payload 字段不符合闭集协议");
  }
  return text(row.objective, "objective", 4_000)!;
}

export function parseOnlineTtrpgAiPlayerProposalV1(input: {
  value: unknown;
  projection: TtrpgViewerProjectionV1;
  actorKey: string;
}): OnlineTtrpgAiPlayerProposalV1 {
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("AI 玩家服务返回值必须是对象");
  }
  const row = input.value as Record<string, unknown>;
  const expected = ["runId", "actionKey", "targetKey", "approach", "spokenIntent"];
  const actual = Object.keys(row);
  if (actual.length !== expected.length || actual.some(field => !expected.includes(field))) {
    fail("AI 玩家服务返回字段不在闭集");
  }
  if (!Number.isInteger(row.runId) || Number(row.runId) < 1 || Number(row.runId) > Number.MAX_SAFE_INTEGER) {
    fail("AI 玩家 runId 无效");
  }
  const actionKey = text(row.actionKey, "actionKey", 200)!;
  const targetKey = text(row.targetKey, "targetKey", 200, true);
  const approach = text(row.approach, "approach", 4_000)!;
  const spokenIntent = text(row.spokenIntent, "spokenIntent", 2_000, true);
  const action = input.projection.availableActions.find(item => item.actionKey === actionKey);
  const actor = input.projection.actors.find(item => item.actorKey === input.actorKey);
  const target = targetKey == null
    ? null
    : input.projection.actors.find(item => item.actorKey === targetKey);
  if (!action || !actor) fail("AI 玩家引用了投影闭集之外的角色或行动");
  if (action.target === "self" && targetKey !== actor.actorKey) fail("自身行动目标必须是 AI 角色本人");
  if (action.target === "scene" && targetKey != null) fail("场景行动不得指定目标角色");
  if (action.target === "single-ally" && (!target || target.actorKey === actor.actorKey || target.role !== "player")) {
    fail("友方单体行动目标无效");
  }
  if (action.target === "single-enemy" && (!target || target.role !== "npc")) {
    fail("敌方单体行动目标无效");
  }
  if (/(?:掷|骰|d\d+|dc\s*\d+|难度\s*\d+|成功|失败|伤害\s*\d+|获得\s*\d+|失去\s*\d+)/iu.test(approach)) {
    fail("AI 玩家意图夹带尚未结算的机械结果");
  }
  return { runId: Number(row.runId), actionKey, targetKey, approach, spokenIntent };
}
