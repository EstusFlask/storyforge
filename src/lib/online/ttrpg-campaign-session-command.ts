import { OnlineRoomAuthorityError } from "./room-authority";

export type OnlineTtrpgCampaignSessionCommandV1 =
  | { kind: "start"; title: string }
  | {
      kind: "complete";
      publicNote: string;
      memorySummary: string;
      memoryAudience: "party" | "gm-only" | `actor:${string}`;
    };

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("domain_protocol", message);
}

function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(field => !expected.includes(field))) {
    fail(`${label} 字段不符合闭集协议`);
  }
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const result = value.trim().normalize("NFC");
  if ((!allowEmpty && !result) || result.length > maximum) fail(`${label} 无效`);
  return result;
}

export function parseOnlineTtrpgCampaignSessionStartV1(
  value: unknown,
): Extract<OnlineTtrpgCampaignSessionCommandV1, { kind: "start" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("campaign.session.start.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  exact(row, ["title"], "campaign.session.start.payload");
  return { kind: "start", title: text(row.title, "title", 300) };
}

export function parseOnlineTtrpgCampaignSessionCompleteV1(
  value: unknown,
): Extract<OnlineTtrpgCampaignSessionCommandV1, { kind: "complete" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("campaign.session.complete.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  exact(
    row,
    ["publicNote", "memorySummary", "memoryAudience"],
    "campaign.session.complete.payload",
  );
  const audience = text(row.memoryAudience, "memoryAudience", 220);
  if (
    audience !== "party" &&
    audience !== "gm-only" &&
    !/^actor:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(audience)
  ) {
    fail("memoryAudience 无效");
  }
  return {
    kind: "complete",
    publicNote: text(row.publicNote, "publicNote", 8_000, true),
    memorySummary: text(row.memorySummary, "memorySummary", 8_000, true),
    memoryAudience: audience as "party" | "gm-only" | `actor:${string}`,
  };
}
