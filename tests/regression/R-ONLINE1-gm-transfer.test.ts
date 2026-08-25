import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../src/lib/agent/run/hash";
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomDomainAdapterV1,
  type OnlineRoomPersistenceV1,
  type OnlineRoomSnapshotV1,
} from "../../src/lib/online/room-authority";

class MemoryRoomStore implements OnlineRoomPersistenceV1 {
  readonly snapshots = new Map<string, OnlineRoomSnapshotV1>();
  failNext = false;

  async load(roomId: string): Promise<OnlineRoomSnapshotV1 | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async compareAndSwap(input: {
    roomId: string;
    expectedRevision: number | null;
    snapshot: OnlineRoomSnapshotV1;
  }): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false;
      return false;
    }
    const current = this.snapshots.get(input.roomId);
    if ((current?.revision ?? null) !== input.expectedRevision) return false;
    this.snapshots.set(input.roomId, structuredClone(input.snapshot));
    return true;
  }
}

function adapter(): OnlineRoomDomainAdapterV1 & { history: unknown[] } {
  const result: OnlineRoomDomainAdapterV1 & { history: unknown[] } = {
    history: [],
    apply: async ({ sequence, command, member }) => {
      const event = {
        sequence,
        memberId: member.memberId,
        role: member.role,
        actorKey: command.actorKey,
        kind: command.kind,
      };
      result.history.push(event);
      return {
        eventType: `room.${command.kind}`,
        publicPayload: event,
        gmPrivatePayload: { gmOnly: sequence },
        resultingStateHash: await hashCanonicalValue(result.history),
      };
    },
    project: async ({ sequence, member }) => ({
      sequence,
      history: structuredClone(result.history),
      ...(member.role === "gm" ? { gmOnlyState: true } : {}),
    }),
    exportCheckpoint: async () => structuredClone(result.history),
    restoreCheckpoint: async (checkpoint) => {
      result.history.splice(
        0,
        result.history.length,
        ...structuredClone(checkpoint as unknown[]),
      );
    },
  };
  return result;
}

function command(input: {
  roomId: string;
  releaseHash: string;
  requestId: string;
  memberId: string;
  authToken: string;
  expectedSequence: number;
  kind: OnlineRoomCommandV1["kind"];
  actorKey?: string | null;
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
    payload: {},
  };
}

async function table(input: {
  now: () => number;
  persistence?: OnlineRoomPersistenceV1;
}) {
  const releaseHash = "7".repeat(64);
  const created = await AuthoritativeOnlineRoomV1.create({
    roomId: "room.gm-transfer",
    releaseHash,
    gmDisplayName: "原主持",
    adapter: adapter(),
    now: input.now,
    persistence: input.persistence,
  });
  const playerInvite = await created.room.issueInvite({
    gmMemberId: created.gm.member.memberId,
    gmAuthToken: created.gm.authToken,
    role: "player",
    actorKey: "actor.detective",
    expiresAt: input.now() + 60_000,
  });
  const spectatorInvite = await created.room.issueInvite({
    gmMemberId: created.gm.member.memberId,
    gmAuthToken: created.gm.authToken,
    role: "spectator",
    expiresAt: input.now() + 60_000,
  });
  const player = await created.room.join({
    ...playerInvite,
    displayName: "候选主持",
  });
  const spectator = await created.room.join({
    ...spectatorInvite,
    displayName: "观战者",
  });
  return { ...created, player, spectator, releaseHash };
}

describe("PLATFORM-1B · two-party GM handover", () => {
  it("只允许当前 GM 向在线有角色玩家发起，并由目标本人确认", async () => {
    const now = 1_900_000_000_000;
    const current = await table({ now: () => now });
    const unusedInvite = await current.room.issueInvite({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      role: "player",
      actorKey: "actor.unused",
      expiresAt: now + 60_000,
    });

    await expect(
      current.room.proposeGmTransfer({
        gmMemberId: current.spectator.member.memberId,
        gmAuthToken: current.spectator.authToken,
        targetMemberId: current.player.member.memberId,
        expiresAt: now + 60_000,
      }),
    ).rejects.toThrow("只有当前 GM");
    await current.room.disconnect(
      current.player.member.memberId,
      current.player.authToken,
    );
    await expect(
      current.room.proposeGmTransfer({
        gmMemberId: current.gm.member.memberId,
        gmAuthToken: current.gm.authToken,
        targetMemberId: current.player.member.memberId,
        expiresAt: now + 60_000,
      }),
    ).rejects.toThrow("当前在线且已绑定角色");
    await current.room.reconnect({
      memberId: current.player.member.memberId,
      authToken: current.player.authToken,
      afterSequence: 0,
    });
    await expect(
      current.room.proposeGmTransfer({
        gmMemberId: current.gm.member.memberId,
        gmAuthToken: current.gm.authToken,
        targetMemberId: current.player.member.memberId,
        expiresAt: now + 10 * 60_000 + 1,
      }),
    ).rejects.toThrow("未来 10 分钟内");

    const proposed = await current.room.proposeGmTransfer({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      targetMemberId: current.player.member.memberId,
      expiresAt: now + 60_000,
    });
    expect(proposed).toMatchObject({
      acceptedSequence: 1,
      target: { role: "player", actorKey: "actor.detective" },
    });
    await expect(
      current.room.acceptGmTransfer({
        memberId: current.spectator.member.memberId,
        authToken: current.spectator.authToken,
        transferId: proposed.transferId,
      }),
    ).rejects.toThrow("不属于当前成员");
    await expect(
      current.room.acceptGmTransfer({
        memberId: current.player.member.memberId,
        authToken: "forged.credential",
        transferId: proposed.transferId,
      }),
    ).rejects.toThrow("成员凭据无效");

    const transferred = await current.room.acceptGmTransfer({
      memberId: current.player.member.memberId,
      authToken: current.player.authToken,
      transferId: proposed.transferId,
    });
    expect(transferred).toMatchObject({
      acceptedSequence: 2,
      formerGm: { role: "player", actorKey: "actor.detective" },
      gm: { role: "gm", actorKey: null },
    });

    const oldGmView = await current.room.reconnect({
      memberId: current.gm.member.memberId,
      authToken: current.gm.authToken,
      afterSequence: 0,
    });
    const newGmView = await current.room.reconnect({
      memberId: current.player.member.memberId,
      authToken: current.player.authToken,
      afterSequence: 0,
    });
    expect(oldGmView.member).toMatchObject({
      role: "player",
      actorKey: "actor.detective",
    });
    expect(oldGmView.events.map((event) => event.eventType)).toEqual([
      "room.gm-transfer.proposed",
      "room.gm-transferred",
    ]);
    expect(oldGmView.events[0].publicPayload).toMatchObject({
      transferId: proposed.transferId,
      targetMemberId: current.player.member.memberId,
    });
    expect(JSON.stringify(oldGmView.projection)).not.toContain("gmOnlyState");
    expect(newGmView.member).toMatchObject({ role: "gm", actorKey: null });
    expect(JSON.stringify(newGmView.projection)).toContain("gmOnlyState");

    await expect(
      current.room.issueInvite({
        gmMemberId: current.gm.member.memberId,
        gmAuthToken: current.gm.authToken,
        role: "spectator",
        expiresAt: now + 60_000,
      }),
    ).rejects.toThrow("只有 GM");
    await expect(
      current.room.join({ ...unusedInvite, displayName: "旧邀请" }),
    ).rejects.toThrow("邀请不存在、已过期或凭据无效");
    await expect(
      current.room.submit(
        command({
          roomId: current.room.roomId,
          releaseHash: current.releaseHash,
          requestId: "old-gm.scene",
          memberId: current.gm.member.memberId,
          authToken: current.gm.authToken,
          expectedSequence: 2,
          kind: "scene.open",
        }),
      ),
    ).rejects.toThrow("只允许 GM");
    await expect(
      current.room.submit(
        command({
          roomId: current.room.roomId,
          releaseHash: current.releaseHash,
          requestId: "new-gm.scene",
          memberId: current.player.member.memberId,
          authToken: current.player.authToken,
          expectedSequence: 2,
          kind: "scene.open",
        }),
      ),
    ).resolves.toMatchObject({ acceptedSequence: 3 });
    await expect(
      current.room.submit(
        command({
          roomId: current.room.roomId,
          releaseHash: current.releaseHash,
          requestId: "former-gm.action",
          memberId: current.gm.member.memberId,
          authToken: current.gm.authToken,
          expectedSequence: 3,
          kind: "rule.action",
          actorKey: "actor.detective",
        }),
      ),
    ).resolves.toMatchObject({ acceptedSequence: 4 });
  });

  it("支持取消和过期拒绝，取消本身也进入连续事件流", async () => {
    let now = 1_900_000_100_000;
    const current = await table({ now: () => now });
    const first = await current.room.proposeGmTransfer({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      targetMemberId: current.player.member.memberId,
      expiresAt: now + 1_000,
    });
    await expect(
      current.room.cancelGmTransfer({
        gmMemberId: current.player.member.memberId,
        gmAuthToken: current.player.authToken,
        transferId: first.transferId,
      }),
    ).rejects.toThrow("不能取消");
    await expect(
      current.room.cancelGmTransfer({
        gmMemberId: current.gm.member.memberId,
        gmAuthToken: current.gm.authToken,
        transferId: first.transferId,
      }),
    ).resolves.toEqual({ cancelled: true, acceptedSequence: 2 });
    await expect(
      current.room.acceptGmTransfer({
        memberId: current.player.member.memberId,
        authToken: current.player.authToken,
        transferId: first.transferId,
      }),
    ).rejects.toThrow("不存在、已过期");

    const expiring = await current.room.proposeGmTransfer({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      targetMemberId: current.player.member.memberId,
      expiresAt: now + 1_000,
    });
    now += 1_001;
    await expect(
      current.room.acceptGmTransfer({
        memberId: current.player.member.memberId,
        authToken: current.player.authToken,
        transferId: expiring.transferId,
      }),
    ).rejects.toThrow("不存在、已过期");
  });

  it("服务重启后保留待确认交接，CAS 失败时角色与交接状态一并回滚", async () => {
    const now = 1_900_000_200_000;
    const store = new MemoryRoomStore();
    const current = await table({ now: () => now, persistence: store });
    const proposed = await current.room.proposeGmTransfer({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      targetMemberId: current.player.member.memberId,
      expiresAt: now + 60_000,
    });

    const restored = await AuthoritativeOnlineRoomV1.restore({
      roomId: current.room.roomId,
      adapter: adapter(),
      persistence: store,
      now: () => now,
    });
    store.failNext = true;
    await expect(
      restored.acceptGmTransfer({
        memberId: current.player.member.memberId,
        authToken: current.player.authToken,
        transferId: proposed.transferId,
      }),
    ).rejects.toThrow("持久化版本冲突");
    expect(
      (
        await restored.reconnect({
          memberId: current.player.member.memberId,
          authToken: current.player.authToken,
          afterSequence: 0,
        })
      ).member,
    ).toMatchObject({ role: "player", actorKey: "actor.detective" });

    await expect(
      restored.acceptGmTransfer({
        memberId: current.player.member.memberId,
        authToken: current.player.authToken,
        transferId: proposed.transferId,
      }),
    ).resolves.toMatchObject({ acceptedSequence: 2, gm: { role: "gm" } });
    const snapshot = (await store.load(current.room.roomId))!;
    expect(snapshot.pendingGmTransfer).toBeNull();
    expect(
      snapshot.members.filter((member) => member.role === "gm"),
    ).toHaveLength(1);
  });

  it("即使重算完整性哈希，也拒绝引用不存在成员的待确认交接快照", async () => {
    const now = 1_900_000_300_000;
    const store = new MemoryRoomStore();
    const current = await table({ now: () => now, persistence: store });
    await current.room.proposeGmTransfer({
      gmMemberId: current.gm.member.memberId,
      gmAuthToken: current.gm.authToken,
      targetMemberId: current.player.member.memberId,
      expiresAt: now + 60_000,
    });
    const corrupt = (await store.load(current.room.roomId))!;
    corrupt.pendingGmTransfer!.targetMemberId = "member.missing";
    const { integrityHash: _ignored, ...payload } = corrupt;
    corrupt.integrityHash = await hashCanonicalValue(payload);
    store.snapshots.set(current.room.roomId, corrupt);

    await expect(
      AuthoritativeOnlineRoomV1.restore({
        roomId: current.room.roomId,
        adapter: adapter(),
        persistence: store,
        now: () => now,
      }),
    ).rejects.toThrow("待确认主持移交引用无效");
  });
});
