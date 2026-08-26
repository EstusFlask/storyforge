import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../src/lib/agent/run/hash";
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomDomainAdapterV1,
} from "../../src/lib/online/room-authority";
import {
  createOnlineRoomGatewayV1,
  type OnlineRoomGatewayAuditV1,
} from "../../src/lib/online/room-gateway";

function adapter(): OnlineRoomDomainAdapterV1 {
  const history: unknown[] = [];
  return {
    apply: async ({ sequence, command }) => {
      history.push({ sequence, kind: command.kind });
      return {
        eventType: `room.${command.kind}`,
        publicPayload: { sequence },
        gmPrivatePayload: { secret: "must-not-leak" },
        resultingStateHash: await hashCanonicalValue(history),
      };
    },
    project: async ({ member, sequence }) => ({
      sequence,
      ...(member.role === "gm" ? { secret: "gm-only" } : {}),
    }),
  };
}

describe("PLATFORM-1B · room HTTP gateway boundary", () => {
  it("经部署身份边界创建房间、签发邀请并加入，凭据始终只存在请求/响应正文", async () => {
    const rooms = new Map<string, AuthoritativeOnlineRoomV1>();
    const audits: OnlineRoomGatewayAuditV1[] = [];
    const gateway = createOnlineRoomGatewayV1({
      rooms: {
        load: async (roomId) => rooms.get(roomId) ?? null,
        create: async (input) => {
          if (input.creatorAccessToken !== "identity.valid")
            throw new Error("identity provider rejected");
          const created = await AuthoritativeOnlineRoomV1.create({
            roomId: input.roomId,
            releaseHash: input.releaseHash,
            gmDisplayName: input.gmDisplayName,
            adapter: adapter(),
          });
          rooms.set(input.roomId, created.room);
          return created;
        },
        joinAuthenticated: async (input) => {
          const room = rooms.get(input.roomId)!;
          const member = await room.join({
            inviteId: input.inviteId,
            inviteToken: input.inviteToken,
            displayName: input.displayName,
            principalBinding: "account.player.1",
            memberAuthToken: "member.account.session",
          });
          return { room, member };
        },
        resumeAuthenticated: async (input) => {
          const room = rooms.get(input.roomId)!;
          const member = await room.resumeMemberByPrincipal({
            principalBinding: "account.player.1",
            memberAuthToken: "member.account.session",
          });
          return { room, member };
        },
      },
      audit: (entry) => {
        audits.push(entry);
      },
    });
    const created = await gateway({
      method: "POST",
      path: "/v1/rooms",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        requestId: "room.create.1",
        roomId: "room.lifecycle",
        releaseHash: "c".repeat(64),
        selectedCharacterKeys: ["player.1"],
        creatorAccessToken: "identity.valid",
        gmDisplayName: "主持人",
      },
    });
    expect(created).toMatchObject({
      status: 201,
      body: { roomId: "room.lifecycle", cursor: 0 },
    });
    const credentials = created.body as {
      member: { memberId: string };
      authToken: string;
    };
    const invite = await gateway({
      method: "POST",
      path: "/v1/rooms/invites",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: "room.lifecycle",
        gmMemberId: credentials.member.memberId,
        gmAuthToken: credentials.authToken,
        role: "player",
        actorKey: "player.1",
        expiresAt: Date.now() + 60_000,
        maximumUses: 1,
      },
    });
    expect(invite).toMatchObject({
      status: 200,
      body: { inviteId: expect.any(String), inviteToken: expect.any(String) },
    });
    const joined = await gateway({
      method: "POST",
      path: "/v1/rooms/join-account",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        requestId: "room.join.1",
        roomId: "room.lifecycle",
        ...(invite.body as object),
        memberAccessToken: "identity.player.token",
        displayName: "玩家",
      },
    });
    expect(joined).toMatchObject({
      status: 200,
      body: { cursor: 0, member: { role: "player", actorKey: "player.1" } },
    });
    const joinedBody = joined.body as { member: { memberId: string } };
    const resumed = await gateway({
      method: "POST",
      path: "/v1/rooms/session",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: "room.lifecycle",
        memberAccessToken: "identity.player.token",
      },
    });
    expect(resumed).toMatchObject({
      status: 200,
      body: {
        authToken: "member.account.session",
        member: { memberId: joinedBody.member.memberId, role: "player" },
      },
    });
    expect(JSON.stringify(audits)).not.toContain("identity.valid");
    expect(JSON.stringify(audits)).not.toContain("identity.player.token");
    expect(JSON.stringify(audits)).not.toContain("member.account.session");
    expect(JSON.stringify(audits)).not.toContain(credentials.authToken);
    expect(audits[0]).toMatchObject({
      requestId: "room.create.1",
      status: 201,
    });
  });

  it("桥接 command/reconnect/disconnect，错误响应与审计均不泄漏 token、payload 或 GM secret", async () => {
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: "room.gateway",
      releaseHash: "a".repeat(64),
      gmDisplayName: "主持人",
      adapter: adapter(),
    });
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: "player.1",
      expiresAt: Date.now() + 60_000,
    });
    const player = await created.room.join({ ...invite, displayName: "玩家" });
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
    const command: OnlineRoomCommandV1 = {
      protocolVersion: 1,
      roomId: created.room.roomId,
      releaseHash: created.room.releaseHash,
      requestId: "request.gateway.1",
      memberId: player.member.memberId,
      authToken: player.authToken,
      expectedSequence: 0,
      kind: "chat.message",
      actorKey: "player.1",
      payload: { text: "this-payload-must-not-enter-audit" },
    };
    const accepted = await gateway({
      method: "POST",
      path: "/v1/rooms/commands",
      contentType: "application/json",
      body: command,
    });
    expect(accepted).toMatchObject({
      status: 200,
      headers: { "cache-control": "no-store" },
    });
    expect(JSON.stringify(accepted)).not.toContain("must-not-leak");

    const reconnect = await gateway({
      method: "POST",
      path: "/v1/rooms/reconnect",
      contentType: "application/json; charset=utf-8",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        afterSequence: 0,
      },
    });
    expect(reconnect).toMatchObject({ status: 200, body: { cursor: 1 } });
    expect(JSON.stringify(reconnect)).toContain("gm-only");

    const badToken = await gateway({
      method: "POST",
      path: "/v1/rooms/disconnect",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: created.gm.member.memberId,
        authToken: "forged.token",
      },
    });
    expect(badToken).toMatchObject({
      status: 401,
      body: { code: "unauthorized" },
    });
    expect(JSON.stringify(audits)).not.toContain(created.gm.authToken);
    expect(JSON.stringify(audits)).not.toContain(
      "this-payload-must-not-enter-audit",
    );
    expect(JSON.stringify(audits)).not.toContain("gm-only");
    expect(audits).toMatchObject([
      { requestId: "request.gateway.1", outcome: "accepted", status: 200 },
      { requestId: null, outcome: "accepted", status: 200 },
      {
        requestId: null,
        outcome: "rejected",
        code: "unauthorized",
        status: 401,
      },
    ]);
  });

  it("桥接成员列表与双确认主持移交，广播游标但不广播凭据", async () => {
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: "room.gateway-transfer",
      releaseHash: "d".repeat(64),
      gmDisplayName: "原主持",
      adapter: adapter(),
    });
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: "player",
      actorKey: "player.1",
      expiresAt: Date.now() + 60_000,
    });
    const player = await created.room.join({
      ...invite,
      displayName: "候选主持",
    });
    const notifications: Array<{ roomId: string; cursor: number }> = [];
    const audits: OnlineRoomGatewayAuditV1[] = [];
    const gateway = createOnlineRoomGatewayV1({
      rooms: {
        load: async (roomId) =>
          roomId === created.room.roomId ? created.room : null,
      },
      realtime: {
        notify: async (roomId, cursor) => {
          notifications.push({ roomId, cursor });
        },
        waitForAdvance: async () => ({ cursor: 0, timedOut: true }),
      },
      audit: (entry) => {
        audits.push(entry);
      },
    });
    const members = await gateway({
      method: "POST",
      path: "/v1/rooms/members",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
      },
    });
    expect(members).toMatchObject({
      status: 200,
      body: { members: [{ role: "gm" }, { role: "player" }] },
    });
    const forbiddenMembers = await gateway({
      method: "POST",
      path: "/v1/rooms/members",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: player.member.memberId,
        authToken: player.authToken,
      },
    });
    expect(forbiddenMembers).toMatchObject({
      status: 403,
      body: { code: "forbidden" },
    });

    const proposed = await gateway({
      method: "POST",
      path: "/v1/rooms/gm-transfer",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        gmMemberId: created.gm.member.memberId,
        gmAuthToken: created.gm.authToken,
        targetMemberId: player.member.memberId,
        expiresAt: Date.now() + 60_000,
      },
    });
    expect(proposed).toMatchObject({
      status: 200,
      body: {
        transferId: expect.stringMatching(/^transfer\./),
        acceptedSequence: 1,
      },
    });
    const transferId = (proposed.body as { transferId: string }).transferId;
    const accepted = await gateway({
      method: "POST",
      path: "/v1/rooms/gm-transfer/accept",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: player.member.memberId,
        authToken: player.authToken,
        transferId,
      },
    });
    expect(accepted).toMatchObject({
      status: 200,
      body: {
        acceptedSequence: 2,
        formerGm: { role: "player" },
        gm: { role: "gm" },
      },
    });
    expect(notifications).toEqual([
      { roomId: created.room.roomId, cursor: 1 },
      { roomId: created.room.roomId, cursor: 2 },
    ]);
    expect(JSON.stringify(audits)).not.toContain(created.gm.authToken);
    expect(JSON.stringify(audits)).not.toContain(player.authToken);

    const expanded = await gateway({
      method: "POST",
      path: "/v1/rooms/gm-transfer/accept",
      contentType: "application/json",
      body: {
        protocolVersion: 1,
        roomId: created.room.roomId,
        memberId: player.member.memberId,
        authToken: player.authToken,
        transferId,
        injectedRole: "gm",
      },
    });
    expect(expanded).toMatchObject({ status: 422, body: { code: "protocol" } });
  });

  it("在加载房间和领域适配器前拒绝方法、MIME、字段扩张和过大请求", async () => {
    let loads = 0;
    const gateway = createOnlineRoomGatewayV1({
      rooms: {
        load: async () => {
          loads += 1;
          return null;
        },
      },
    });
    await expect(
      gateway({
        method: "GET",
        path: "/v1/rooms/reconnect",
        contentType: "application/json",
        body: {},
      }),
    ).resolves.toMatchObject({ status: 405 });
    await expect(
      gateway({
        method: "POST",
        path: "/v1/rooms/reconnect",
        contentType: "text/plain",
        body: {},
      }),
    ).resolves.toMatchObject({ status: 415 });
    await expect(
      gateway({
        method: "POST",
        path: "/v1/rooms/reconnect",
        contentType: "application/json",
        body: {
          roomId: "room.gateway",
          memberId: "member.1",
          authToken: "token",
          afterSequence: 0,
          protocolVersion: 1,
          extra: true,
        },
      }),
    ).resolves.toMatchObject({ status: 422, body: { code: "protocol" } });
    await expect(
      gateway({
        method: "POST",
        path: "/v1/rooms/invites",
        contentType: "application/json",
        body: {
          protocolVersion: 1,
          roomId: "room.gateway",
          gmMemberId: "member.1",
          gmAuthToken: "token",
          role: "player",
          actorKey: 123,
          expiresAt: Date.now() + 60_000,
          maximumUses: 1,
        },
      }),
    ).resolves.toMatchObject({ status: 422, body: { code: "protocol" } });
    await expect(
      gateway({
        method: "POST",
        path: "/v1/rooms/reconnect",
        contentType: "application/json",
        body: { roomId: "room.gateway", padding: "x".repeat(96_001) },
      }),
    ).resolves.toMatchObject({
      status: 422,
      body: { code: "payload_too_large" },
    });
    expect(loads).toBe(0);
  });
});
