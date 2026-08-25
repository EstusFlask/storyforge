import { describe, expect, it } from "vitest";
import {
  HttpOnlineRoomTransportV1,
  OnlineRoomTransportErrorV1,
} from "../../src/lib/online/http-transport";
import type { OnlineRoomCommandV1 } from "../../src/lib/online/room-authority";

const HASH = "a".repeat(64);

function command(): OnlineRoomCommandV1 {
  return {
    protocolVersion: 1,
    roomId: "room.http",
    releaseHash: HASH,
    requestId: "request.http.1",
    memberId: "member.http",
    authToken: "sensitive.room.token",
    expectedSequence: 0,
    kind: "rule.action",
    actorKey: "player.1",
    payload: { actionKey: "investigate" },
  };
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(payload),
  };
}

function visibleEvent(sequence: number) {
  return {
    sequence,
    eventType: "room.rule.action",
    publicPayload: { actionKey: "investigate" },
    privatePayload: null,
    resultingStateHash: "b".repeat(64),
    createdAt: 1_800_000_000_000,
  };
}

describe("PLATFORM-1B · strict HTTP room transport", () => {
  it("房间创建、邀请与加入使用严格响应合同，身份/房间凭据不进入 URL", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const member = {
      memberId: "member.lifecycle",
      displayName: "主持人",
      role: "gm",
      actorKey: null,
      connected: true,
      joinedAt: 1,
      lastSeenAt: 1,
    };
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: "https://rooms.storyforge.test",
      fetch: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
        });
        if (url.endsWith("/invites"))
          return response({
            inviteId: "invite.1",
            inviteToken: "invite.secret",
          });
        if (url.endsWith("/join"))
          return response({
            roomId: "room.lifecycle",
            releaseHash: HASH,
            member: {
              ...member,
              memberId: "member.player",
              displayName: "玩家",
              role: "player",
              actorKey: "player.1",
            },
            authToken: "player.secret",
            cursor: 0,
          });
        if (url.endsWith("/join-account") || url.endsWith("/session"))
          return response({
            roomId: "room.lifecycle",
            releaseHash: HASH,
            member: {
              ...member,
              memberId: "member.account",
              displayName: "账号玩家",
              role: "player",
              actorKey: "player.1",
            },
            authToken: "account.room.secret",
            cursor: 0,
          });
        return response(
          {
            roomId: "room.lifecycle",
            releaseHash: HASH,
            member,
            authToken: "gm.secret",
            cursor: 0,
          },
          201,
        );
      },
    });
    const created = await transport.createRoom({
      requestId: "create.1",
      roomId: "room.lifecycle",
      releaseHash: HASH,
      selectedCharacterKeys: ["player.1"],
      creatorAccessToken: "identity.secret",
      gmDisplayName: "主持人",
    });
    const invite = await transport.issueInvite({
      roomId: created.roomId,
      gmMemberId: created.member.memberId,
      gmAuthToken: created.authToken,
      role: "player",
      actorKey: "player.1",
      expiresAt: 1000,
      maximumUses: 1,
    });
    const joined = await transport.joinRoom({
      roomId: created.roomId,
      ...invite,
      displayName: "玩家",
    });
    expect(joined).toMatchObject({
      roomId: "room.lifecycle",
      member: { role: "player", actorKey: "player.1" },
      authToken: "player.secret",
    });
    const accountJoined = await transport.joinAuthenticatedRoom({
      requestId: "join.account.1",
      roomId: created.roomId,
      ...invite,
      memberAccessToken: "identity.player.secret",
      displayName: "账号玩家",
    });
    const resumed = await transport.resumeAuthenticatedRoom({
      roomId: created.roomId,
      memberAccessToken: "identity.player.secret",
    });
    expect(accountJoined.member.memberId).toBe("member.account");
    expect(resumed).toEqual(accountJoined);
    expect(calls.map((call) => call.url)).toEqual([
      "https://rooms.storyforge.test/v1/rooms",
      "https://rooms.storyforge.test/v1/rooms/invites",
      "https://rooms.storyforge.test/v1/rooms/join",
      "https://rooms.storyforge.test/v1/rooms/join-account",
      "https://rooms.storyforge.test/v1/rooms/session",
    ]);
    expect(calls.every((call) => !call.url.includes("secret"))).toBe(true);
    expect(calls[0].body.creatorAccessToken).toBe("identity.secret");
    expect(calls[0].body.selectedCharacterKeys).toEqual(["player.1"]);
    expect(calls[1].body.gmAuthToken).toBe("gm.secret");
    expect(calls[2].body.inviteToken).toBe("invite.secret");
    expect(calls[3]).toMatchObject({
      body: {
        requestId: "join.account.1",
        memberAccessToken: "identity.player.secret",
      },
    });
    expect(calls[4].body.memberAccessToken).toBe("identity.player.secret");
  });

  it("命令和重连凭据只进入 JSON body，响应通过闭集和游标验证", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: "https://rooms.storyforge.test/",
      fetch: async (url, init) => {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        calls.push({ url, body });
        if (url.endsWith("/commands"))
          return response({
            requestId: "request.http.1",
            acceptedSequence: 1,
            event: visibleEvent(1),
            duplicate: false,
          });
        if (url.endsWith("/reconnect"))
          return response({
            cursor: 1,
            member: {
              memberId: "member.http",
              displayName: "玩家",
              role: "player",
              actorKey: "player.1",
              connected: true,
              joinedAt: 1_800_000_000_000,
              lastSeenAt: 1_800_000_000_001,
            },
            events: [visibleEvent(1)],
            projection: { sequence: 1, visibleScene: "scene.opening" },
          });
        return response({ disconnected: true });
      },
    });
    await expect(transport.submit(command())).resolves.toMatchObject({
      acceptedSequence: 1,
    });
    await expect(
      transport.reconnect({
        roomId: "room.http",
        memberId: "member.http",
        authToken: "sensitive.room.token",
        afterSequence: 0,
      }),
    ).resolves.toMatchObject({ cursor: 1, events: [{ sequence: 1 }] });
    await expect(
      transport.disconnect({
        roomId: "room.http",
        memberId: "member.http",
        authToken: "sensitive.room.token",
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
    expect(
      calls.every((call) => !call.url.includes("sensitive.room.token")),
    ).toBe(true);
    expect(
      calls.every((call) => call.body.authToken === "sensitive.room.token"),
    ).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "https://rooms.storyforge.test/v1/rooms/commands",
      "https://rooms.storyforge.test/v1/rooms/reconnect",
      "https://rooms.storyforge.test/v1/rooms/disconnect",
    ]);
  });

  it("成员列表与主持移交使用严格权限交换合同，凭据仍只进入正文", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const gm = {
      memberId: "member.gm",
      displayName: "原主持",
      role: "gm",
      actorKey: null,
      connected: true,
      joinedAt: 1,
      lastSeenAt: 2,
    } as const;
    const player = {
      memberId: "member.player",
      displayName: "候选主持",
      role: "player",
      actorKey: "player.1",
      connected: true,
      joinedAt: 1,
      lastSeenAt: 2,
    } as const;
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: "https://rooms.storyforge.test",
      fetch: async (url, init) => {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        calls.push({ url, body });
        if (url.endsWith("/members"))
          return response({ members: [gm, player] });
        if (url.endsWith("/gm-transfer/accept"))
          return response({
            formerGm: { ...gm, role: "player", actorKey: "player.1" },
            gm: { ...player, role: "gm", actorKey: null },
            acceptedSequence: 2,
          });
        if (url.endsWith("/gm-transfer/cancel"))
          return response({ cancelled: true, acceptedSequence: 2 });
        return response({
          transferId: "transfer.valid-id",
          target: player,
          expiresAt: 50_000,
          acceptedSequence: 1,
        });
      },
    });
    await expect(
      transport.listMembers({
        roomId: "room.http",
        memberId: gm.memberId,
        authToken: "gm.room.secret",
      }),
    ).resolves.toEqual([gm, player]);
    const proposed = await transport.proposeGmTransfer({
      roomId: "room.http",
      gmMemberId: gm.memberId,
      gmAuthToken: "gm.room.secret",
      targetMemberId: player.memberId,
      expiresAt: 50_000,
    });
    expect(proposed).toMatchObject({
      transferId: "transfer.valid-id",
      target: { memberId: player.memberId },
    });
    await expect(
      transport.acceptGmTransfer({
        roomId: "room.http",
        memberId: player.memberId,
        authToken: "player.room.secret",
        transferId: proposed.transferId,
      }),
    ).resolves.toMatchObject({
      formerGm: { role: "player" },
      gm: { role: "gm" },
      acceptedSequence: 2,
    });
    await expect(
      transport.cancelGmTransfer({
        roomId: "room.http",
        gmMemberId: gm.memberId,
        gmAuthToken: "gm.room.secret",
        transferId: proposed.transferId,
      }),
    ).resolves.toEqual({ cancelled: true, acceptedSequence: 2 });
    expect(calls.map((call) => call.url)).toEqual([
      "https://rooms.storyforge.test/v1/rooms/members",
      "https://rooms.storyforge.test/v1/rooms/gm-transfer",
      "https://rooms.storyforge.test/v1/rooms/gm-transfer/accept",
      "https://rooms.storyforge.test/v1/rooms/gm-transfer/cancel",
    ]);
    expect(calls.every((call) => !call.url.includes("secret"))).toBe(true);
    expect(calls[1].body.gmAuthToken).toBe("gm.room.secret");
    expect(calls[2].body.authToken).toBe("player.room.secret");

    const malformed = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () =>
        response({
          formerGm: gm,
          gm: { ...player, role: "gm", actorKey: null },
          acceptedSequence: 2,
        }),
    });
    await expect(
      malformed.acceptGmTransfer({
        roomId: "room.http",
        memberId: player.memberId,
        authToken: "player.room.secret",
        transferId: "transfer.valid-id",
      }),
    ).rejects.toMatchObject({ code: "protocol" });
  });

  it("实时长轮询只返回游标，严格校验超时语义并允许调用方取消", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: "https://rooms.storyforge.test",
      fetch: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
        });
        return response({ cursor: 4, timedOut: false });
      },
    });
    await expect(
      transport.waitForAdvance({
        roomId: "room.http",
        memberId: "member.http",
        authToken: "room.secret",
        afterSequence: 2,
        timeoutMs: 10_000,
      }),
    ).resolves.toEqual({ cursor: 4, timedOut: false });
    expect(calls).toEqual([
      {
        url: "https://rooms.storyforge.test/v1/rooms/wait",
        body: {
          protocolVersion: 1,
          roomId: "room.http",
          memberId: "member.http",
          authToken: "room.secret",
          afterSequence: 2,
          timeoutMs: 10_000,
        },
      },
    ]);
    const malformed = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () => response({ cursor: 3, timedOut: true }),
    });
    await expect(
      malformed.waitForAdvance({
        roomId: "room.http",
        memberId: "member.http",
        authToken: "room.secret",
        afterSequence: 2,
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ code: "protocol" });

    const controller = new AbortController();
    const cancellable = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    });
    const waiting = cancellable.waitForAdvance({
      roomId: "room.http",
      memberId: "member.http",
      authToken: "room.secret",
      afterSequence: 2,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({
      code: "request_aborted",
      retryable: true,
    });
  });

  it("保留服务端错误码与重试语义，并拒绝畸形成功响应", async () => {
    const rateLimited = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () =>
        response({ code: "rate_limited", message: "请稍后重试" }, 429),
    });
    const error = await rateLimited.submit(command()).catch((caught) => caught);
    expect(error).toBeInstanceOf(OnlineRoomTransportErrorV1);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryable: true,
      status: 429,
    });

    const malformed = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () =>
        response({
          requestId: "request.http.1",
          acceptedSequence: 2,
          event: visibleEvent(1),
          duplicate: false,
        }),
    });
    await expect(malformed.submit(command())).rejects.toMatchObject({
      code: "protocol",
      retryable: false,
    });
  });

  it("拒绝响应字段扩张、乱序重连事件和配置中的 query/fragment", async () => {
    expect(
      () =>
        new HttpOnlineRoomTransportV1({
          baseUrl: "https://rooms.test/?token=leak",
        }),
    ).toThrow("在线服务地址无效");
    const extraField = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () =>
        response({
          requestId: "request.http.1",
          acceptedSequence: 1,
          event: { ...visibleEvent(1), gmSecret: "leak" },
          duplicate: false,
        }),
    });
    await expect(extraField.submit(command())).rejects.toMatchObject({
      code: "protocol",
    });

    const reversed = new HttpOnlineRoomTransportV1({
      baseUrl: "/room-api",
      fetch: async () =>
        response({
          cursor: 2,
          member: {
            memberId: "member.http",
            displayName: "玩家",
            role: "player",
            actorKey: "player.1",
            connected: true,
            joinedAt: 1,
            lastSeenAt: 2,
          },
          events: [visibleEvent(2), visibleEvent(1)],
          projection: {},
        }),
    });
    await expect(
      reversed.reconnect({
        roomId: "room.http",
        memberId: "member.http",
        authToken: "token",
        afterSequence: 0,
      }),
    ).rejects.toMatchObject({ code: "protocol" });
  });
});
