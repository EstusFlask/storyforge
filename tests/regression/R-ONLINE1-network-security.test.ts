import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../src/lib/agent/run/hash";
import { HttpOnlineRoomTransportV1 } from "../../src/lib/online/http-transport";
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomDomainAdapterV1,
} from "../../src/lib/online/room-authority";
import {
  createOnlineRoomGatewayV1,
  type OnlineRoomGatewayAuditV1,
} from "../../src/lib/online/room-gateway";

const GM_CANARY = "CANARY_GM_VAULT_DO_NOT_LEAK";
const PLAYER_A_CANARY = "CANARY_PLAYER_A_PRIVATE";
const PLAYER_B_CANARY = "CANARY_PLAYER_B_PRIVATE";
const ATTACK_PAYLOAD = "CANARY_ATTACK_BODY_MUST_NOT_ENTER_AUDIT";

function command(input: {
  roomId: string;
  releaseHash: string;
  requestId: string;
  memberId: string;
  authToken: string;
  expectedSequence: number;
  kind: OnlineRoomCommandV1["kind"];
  actorKey?: string | null;
  payload?: unknown;
}): OnlineRoomCommandV1 {
  return {
    protocolVersion: 1,
    roomId: input.roomId,
    releaseHash: input.releaseHash,
    requestId: input.requestId,
    memberId: input.memberId,
    authToken: input.authToken,
    expectedSequence: input.expectedSequence,
    kind: input.kind,
    actorKey: input.actorKey ?? null,
    payload: input.payload ?? {},
  };
}

describe("PLATFORM-1B · online network isolation attacks", () => {
  it("跨完整 HTTP 合同隔离 GM/玩家秘密，并 fail-closed 拒绝身份、角色、版本、游标和重放攻击", async () => {
    const privateByMember = new Map<string, string>();
    const history: unknown[] = [];
    const adapter: OnlineRoomDomainAdapterV1 = {
      apply: async ({ sequence, command: submitted }) => {
        const publicPayload = {
          sequence,
          kind: submitted.kind,
          accepted: true,
        };
        history.push(publicPayload);
        return {
          eventType: `security.${submitted.kind}`,
          publicPayload,
          gmPrivatePayload: { canary: GM_CANARY },
          privatePayloadByMemberId: Object.fromEntries(privateByMember),
          resultingStateHash: await hashCanonicalValue(history),
        };
      },
      project: async ({ sequence, member }) => ({
        sequence,
        visibleRole: member.role,
        ...(member.role === "gm" ? { canary: GM_CANARY } : {}),
        ...(privateByMember.has(member.memberId)
          ? { canary: privateByMember.get(member.memberId) }
          : {}),
      }),
    };
    const releaseHash = "8".repeat(64);
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: "room.network-security",
      releaseHash,
      gmDisplayName: "主持人",
      adapter,
    });
    const inviteA = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: "actor.a",
      expiresAt: Date.now() + 60_000,
    });
    const inviteB = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: "actor.b",
      expiresAt: Date.now() + 60_000,
    });
    const inviteSpectator = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "spectator",
      expiresAt: Date.now() + 60_000,
    });
    const playerA = await created.room.join({
      ...inviteA,
      displayName: "玩家 A",
    });
    const playerB = await created.room.join({
      ...inviteB,
      displayName: "玩家 B",
    });
    const spectator = await created.room.join({
      ...inviteSpectator,
      displayName: "观战者",
    });
    privateByMember.set(playerA.member.memberId, PLAYER_A_CANARY);
    privateByMember.set(playerB.member.memberId, PLAYER_B_CANARY);

    const audits: OnlineRoomGatewayAuditV1[] = [];
    const gateway = createOnlineRoomGatewayV1({
      rooms: {
        load: async (roomId) =>
          roomId === created.room.roomId ? created.room : null,
      },
      audit: (entry) => {
        audits.push(entry);
      },
    });
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: "https://rooms.storyforge.test",
      fetch: async (url, init) => {
        const result = await gateway({
          method: init.method,
          path: new URL(url).pathname,
          contentType: init.headers["content-type"],
          body: JSON.parse(init.body),
          signal: init.signal,
        });
        return {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          json: async () => structuredClone(result.body),
        };
      },
    });
    await transport.submit(
      command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: "network.accepted.1",
        memberId: playerA.member.memberId,
        authToken: playerA.authToken,
        expectedSequence: 0,
        kind: "chat.message",
        actorKey: "actor.a",
        payload: { text: "安全消息" },
      }),
    );

    const views = await Promise.all([
      transport.reconnect({
        roomId: created.room.roomId,
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        afterSequence: 0,
      }),
      transport.reconnect({
        roomId: created.room.roomId,
        memberId: playerA.member.memberId,
        authToken: playerA.authToken,
        afterSequence: 0,
      }),
      transport.reconnect({
        roomId: created.room.roomId,
        memberId: playerB.member.memberId,
        authToken: playerB.authToken,
        afterSequence: 0,
      }),
      transport.reconnect({
        roomId: created.room.roomId,
        memberId: spectator.member.memberId,
        authToken: spectator.authToken,
        afterSequence: 0,
      }),
    ]);
    const [gmBody, playerABody, playerBBody, spectatorBody] = views.map(
      (value) => JSON.stringify(value),
    );
    expect(gmBody).toContain(GM_CANARY);
    expect(gmBody).not.toContain(PLAYER_A_CANARY);
    expect(gmBody).not.toContain(PLAYER_B_CANARY);
    expect(playerABody).toContain(PLAYER_A_CANARY);
    expect(playerABody).not.toContain(GM_CANARY);
    expect(playerABody).not.toContain(PLAYER_B_CANARY);
    expect(playerBBody).toContain(PLAYER_B_CANARY);
    expect(playerBBody).not.toContain(GM_CANARY);
    expect(playerBBody).not.toContain(PLAYER_A_CANARY);
    expect(spectatorBody).not.toContain(GM_CANARY);
    expect(spectatorBody).not.toContain(PLAYER_A_CANARY);
    expect(spectatorBody).not.toContain(PLAYER_B_CANARY);

    const attack = (body: unknown) =>
      gateway({
        method: "POST",
        path: "/v1/rooms/commands",
        contentType: "application/json",
        body,
      });
    const attackBase = {
      roomId: created.room.roomId,
      releaseHash,
      memberId: playerA.member.memberId,
      authToken: playerA.authToken,
      expectedSequence: 1,
      payload: { text: ATTACK_PAYLOAD },
    };
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.role-escalation",
          kind: "scene.open",
        }),
      ),
    ).resolves.toMatchObject({ status: 403, body: { code: "forbidden" } });
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.actor-spoof",
          kind: "dice.request",
          actorKey: "actor.b",
        }),
      ),
    ).resolves.toMatchObject({ status: 403, body: { code: "actor_spoof" } });
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.bad-token",
          authToken: "forged.room.credential",
          kind: "chat.message",
        }),
      ),
    ).resolves.toMatchObject({ status: 401, body: { code: "unauthorized" } });
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.release-spoof",
          releaseHash: "9".repeat(64),
          kind: "chat.message",
        }),
      ),
    ).resolves.toMatchObject({ status: 409, body: { code: "release_spoof" } });
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.stale",
          expectedSequence: 0,
          kind: "chat.message",
        }),
      ),
    ).resolves.toMatchObject({ status: 409, body: { code: "stale_cursor" } });
    await expect(
      attack(
        command({
          ...attackBase,
          requestId: "attack.spectator",
          memberId: spectator.member.memberId,
          authToken: spectator.authToken,
          kind: "rule.action",
          actorKey: "actor.a",
        }),
      ),
    ).resolves.toMatchObject({ status: 403, body: { code: "forbidden" } });
    await expect(
      attack({
        ...command({
          ...attackBase,
          requestId: "attack.inject-field",
          kind: "chat.message",
        }),
        role: "gm",
      }),
    ).resolves.toMatchObject({ status: 422, body: { code: "protocol" } });

    const original = command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: "network.accepted.1",
      memberId: playerA.member.memberId,
      authToken: playerA.authToken,
      expectedSequence: 0,
      kind: "chat.message",
      actorKey: "actor.a",
      payload: { text: "安全消息" },
    });
    await expect(attack(original)).resolves.toMatchObject({
      status: 200,
      body: { duplicate: true, acceptedSequence: 1 },
    });
    await expect(
      attack({ ...original, payload: { text: ATTACK_PAYLOAD } }),
    ).resolves.toMatchObject({
      status: 409,
      body: { code: "request_conflict" },
    });
    await expect(
      transport.submit(
        command({
          roomId: created.room.roomId,
          releaseHash,
          requestId: "network.accepted.2",
          memberId: playerB.member.memberId,
          authToken: playerB.authToken,
          expectedSequence: 1,
          kind: "chat.message",
          actorKey: "actor.b",
          payload: { text: "攻击后仍连续" },
        }),
      ),
    ).resolves.toMatchObject({ acceptedSequence: 2 });

    const auditBody = JSON.stringify(audits);
    expect(auditBody).not.toContain(created.gm.authToken);
    expect(auditBody).not.toContain(playerA.authToken);
    expect(auditBody).not.toContain(playerB.authToken);
    expect(auditBody).not.toContain(ATTACK_PAYLOAD);
    expect(auditBody).not.toContain(GM_CANARY);
    expect(history).toHaveLength(2);
  });
});
