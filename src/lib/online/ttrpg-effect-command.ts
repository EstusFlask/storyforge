import type {
  TtrpgEffectLedgerEntryV2,
  TtrpgEffectPlanV2,
  TtrpgPendingEffectChoiceV2,
} from "../types";
import { parseTtrpgEffectPlanV2 } from "../ttrpg/effect-plan";
import type { OnlineRoomMemberV1 } from "./room-authority";

export interface OnlineTtrpgEffectCommandV1 {
  actionSequence: number;
  plan: TtrpgEffectPlanV2;
}

export interface OnlineTtrpgEffectChoiceProposalCommandV1 {
  actionSequence: number;
  ownerActorKey: string;
  plan: TtrpgEffectPlanV2;
}

export interface OnlineTtrpgEffectChoiceResolutionCommandV1 {
  choiceKey: string;
  selectedEffectKey: string;
}

function fail(message: string): never {
  throw new Error(`[online-ttrpg-effect] ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((field) => !expected.includes(field))
  ) {
    fail(`${label} 字段不符合闭集协议`);
  }
}

/**
 * The client is never allowed to choose the EffectPlan idempotency key. The
 * authoritative adapter binds it to the authenticated room request commandId.
 */
export function buildOnlineTtrpgEffectCommandV1(input: {
  payload: unknown;
  commandId: string;
}): OnlineTtrpgEffectCommandV1 {
  const root = record(input.payload, "effects.apply.payload");
  exact(root, ["actionSequence", "plan"], "effects.apply.payload");
  if (
    !Number.isInteger(root.actionSequence) ||
    Number(root.actionSequence) < 1 ||
    Number(root.actionSequence) > Number.MAX_SAFE_INTEGER
  ) {
    fail("actionSequence 无效");
  }
  const plan = record(root.plan, "effects.apply.payload.plan");
  exact(
    plan,
    [
      "schema",
      "version",
      "planKey",
      "degree",
      "sourceEventId",
      "ruleRef",
      "reason",
      "audience",
      "status",
      "effects",
    ],
    "effects.apply.payload.plan",
  );
  return {
    actionSequence: Number(root.actionSequence),
    plan: parseTtrpgEffectPlanV2({
      ...structuredClone(plan),
      idempotencyKey: input.commandId,
    }),
  };
}

export function buildOnlineTtrpgEffectChoiceProposalCommandV1(input: {
  payload: unknown;
  commandId: string;
}): OnlineTtrpgEffectChoiceProposalCommandV1 {
  const root = record(input.payload, "effects.choice.propose.payload");
  exact(root, ["actionSequence", "ownerActorKey", "plan"], "effects.choice.propose.payload");
  if (!Number.isInteger(root.actionSequence) || Number(root.actionSequence) < 1) {
    fail("actionSequence 无效");
  }
  if (typeof root.ownerActorKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(root.ownerActorKey)) {
    fail("ownerActorKey 无效");
  }
  const plan = record(root.plan, "effects.choice.propose.payload.plan");
  exact(
    plan,
    [
      "schema", "version", "planKey", "degree", "sourceEventId", "ruleRef",
      "reason", "audience", "status", "effects",
    ],
    "effects.choice.propose.payload.plan",
  );
  return {
    actionSequence: Number(root.actionSequence),
    ownerActorKey: root.ownerActorKey,
    plan: parseTtrpgEffectPlanV2({
      ...structuredClone(plan),
      idempotencyKey: input.commandId,
    }),
  };
}

export function parseOnlineTtrpgEffectChoiceResolutionCommandV1(
  payload: unknown,
): OnlineTtrpgEffectChoiceResolutionCommandV1 {
  const root = record(payload, "effects.choice.resolve.payload");
  exact(root, ["choiceKey", "selectedEffectKey"], "effects.choice.resolve.payload");
  for (const field of ["choiceKey", "selectedEffectKey"] as const) {
    if (typeof root[field] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(root[field])) {
      fail(`${field} 无效`);
    }
  }
  return { choiceKey: root.choiceKey as string, selectedEffectKey: root.selectedEffectKey as string };
}

export function createOnlineTtrpgEffectChoiceVisiblePayloadsV1(input: {
  choice: TtrpgPendingEffectChoiceV2;
  members: OnlineRoomMemberV1[];
}): {
  publicPayload: unknown;
  gmPrivatePayload: TtrpgPendingEffectChoiceV2;
  privatePayloadByMemberId?: Record<string, TtrpgPendingEffectChoiceV2>;
} {
  const choice = structuredClone(input.choice);
  const memberId = input.members.find(
    member => member.role === "player" && member.actorKey === choice.ownerActorKey,
  )?.memberId;
  return {
    publicPayload: { proposed: true, visibility: "restricted", ownerActorKey: choice.ownerActorKey },
    gmPrivatePayload: choice,
    privatePayloadByMemberId: memberId ? { [memberId]: choice } : undefined,
  };
}

export function createOnlineTtrpgEffectVisiblePayloadsV1(input: {
  entry: TtrpgEffectLedgerEntryV2;
  members: OnlineRoomMemberV1[];
}): {
  publicPayload: unknown;
  gmPrivatePayload: TtrpgEffectLedgerEntryV2;
  privatePayloadByMemberId?: Record<string, TtrpgEffectLedgerEntryV2>;
} {
  const entry = structuredClone(input.entry);
  if (entry.audience === "public" || entry.audience === "party") {
    return {
      publicPayload: { applied: true, receipt: entry },
      gmPrivatePayload: entry,
    };
  }
  if (entry.audience === "gm") {
    return {
      publicPayload: { applied: true, visibility: "restricted" },
      gmPrivatePayload: entry,
    };
  }
  const actorKey = entry.audience.slice("actor:".length);
  const memberId = input.members.find(
    (member) => member.role === "player" && member.actorKey === actorKey,
  )?.memberId;
  return {
    publicPayload: { applied: true, visibility: "restricted" },
    gmPrivatePayload: entry,
    privatePayloadByMemberId: memberId ? { [memberId]: entry } : undefined,
  };
}
