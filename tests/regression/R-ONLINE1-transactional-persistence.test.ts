import { describe, expect, it } from "vitest";
import type { OnlineRoomSnapshotV1 } from "../../src/lib/online/room-authority";
import {
  TransactionalOnlineRoomPersistenceV1,
  type TransactionalKeyValueStorageV1,
  type TransactionalKeyValueTransactionV1,
} from "../../src/lib/online/transactional-persistence";
import { hashCanonicalValue } from "../../src/lib/agent/run/hash";

class AtomicMemoryStorage implements TransactionalKeyValueStorageV1 {
  readonly values = new Map<string, unknown>();
  failNextBackupWrite = false;
  private tail: Promise<void> = Promise.resolve();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value == null ? undefined : (structuredClone(value) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async transaction<T>(
    operation: (transaction: TransactionalKeyValueTransactionV1) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const staged = new Map(this.values);
    const transaction: TransactionalKeyValueTransactionV1 = {
      get: async <V>(key: string) => {
        const value = staged.get(key);
        return value == null ? undefined : (structuredClone(value) as V);
      },
      put: async <V>(key: string, value: V) => {
        if (this.failNextBackupWrite && key.includes("/backup/")) {
          this.failNextBackupWrite = false;
          throw new Error("injected backup failure");
        }
        staged.set(key, structuredClone(value));
      },
    };
    try {
      const result = await operation(transaction);
      this.values.clear();
      for (const [key, value] of staged) this.values.set(key, value);
      return result;
    } finally {
      release();
    }
  }
}

function snapshot(roomId: string, revision: number): OnlineRoomSnapshotV1 {
  return {
    schema: "storyforge.online-room-snapshot",
    version: 1,
    revision,
    roomId,
    releaseHash: "a".repeat(64),
    sequence: 0,
    members: [
      {
        memberId: "member.gm",
        displayName: "灾备主持",
        role: "gm",
        actorKey: null,
        connected: true,
        joinedAt: 1,
        lastSeenAt: 1,
        tokenHash: "c".repeat(64),
      },
    ],
    invites: [],
    events: [],
    receipts: [],
    rateWindows: [],
    domainCheckpoint: { state: revision },
    updatedAt: revision,
    integrityHash: "b".repeat(64),
  };
}

async function validSnapshot(
  roomId: string,
  revision: number,
): Promise<OnlineRoomSnapshotV1> {
  const { integrityHash: _ignored, ...body } = snapshot(roomId, revision);
  return { ...body, integrityHash: await hashCanonicalValue(body) };
}

describe("PLATFORM-1B · transactional room persistence", () => {
  it("并发 CAS 只有一个写入获胜，并把主快照与备份放在同一原子事务", async () => {
    const storage = new AtomicMemoryStorage();
    const persistence = new TransactionalOnlineRoomPersistenceV1(storage, {
      backupSlots: 4,
    });
    expect(
      await persistence.compareAndSwap({
        roomId: "room.atomic",
        expectedRevision: null,
        snapshot: snapshot("room.atomic", 1),
      }),
    ).toBe(true);
    const results = await Promise.all([
      persistence.compareAndSwap({
        roomId: "room.atomic",
        expectedRevision: 1,
        snapshot: snapshot("room.atomic", 2),
      }),
      persistence.compareAndSwap({
        roomId: "room.atomic",
        expectedRevision: 1,
        snapshot: snapshot("room.atomic", 2),
      }),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(await persistence.load("room.atomic")).toMatchObject({
      revision: 2,
    });
    expect(await persistence.loadBackup("room.atomic", 1)).toMatchObject({
      revision: 1,
    });
    expect(await persistence.loadBackup("room.atomic", 2)).toMatchObject({
      revision: 2,
    });
  });

  it("备份写入故障时整个事务回滚，且滚动槽不会把旧 revision 冒充可恢复备份", async () => {
    const storage = new AtomicMemoryStorage();
    const persistence = new TransactionalOnlineRoomPersistenceV1(storage, {
      backupSlots: 2,
    });
    await persistence.compareAndSwap({
      roomId: "room.rollback",
      expectedRevision: null,
      snapshot: snapshot("room.rollback", 1),
    });
    storage.failNextBackupWrite = true;
    await expect(
      persistence.compareAndSwap({
        roomId: "room.rollback",
        expectedRevision: 1,
        snapshot: snapshot("room.rollback", 2),
      }),
    ).rejects.toThrow("injected backup failure");
    expect(await persistence.load("room.rollback")).toMatchObject({
      revision: 1,
    });
    expect(await persistence.loadBackup("room.rollback", 2)).toBeNull();
    await persistence.compareAndSwap({
      roomId: "room.rollback",
      expectedRevision: 1,
      snapshot: snapshot("room.rollback", 2),
    });
    await persistence.compareAndSwap({
      roomId: "room.rollback",
      expectedRevision: 2,
      snapshot: snapshot("room.rollback", 3),
    });
    expect(await persistence.loadBackup("room.rollback", 1)).toBeNull();
    expect(await persistence.loadBackup("room.rollback", 3)).toMatchObject({
      revision: 3,
    });
  });

  it("拒绝跨房间、跳 revision 和超限快照，失败前不接触存储", async () => {
    const storage = new AtomicMemoryStorage();
    const persistence = new TransactionalOnlineRoomPersistenceV1(storage, {
      backupSlots: 2,
      maximumSnapshotBytes: 64_000,
    });
    await expect(
      persistence.compareAndSwap({
        roomId: "room.a",
        expectedRevision: null,
        snapshot: snapshot("room.b", 1),
      }),
    ).rejects.toThrow("roomId");
    await expect(
      persistence.compareAndSwap({
        roomId: "room.a",
        expectedRevision: null,
        snapshot: snapshot("room.a", 2),
      }),
    ).rejects.toThrow("revision");
    const huge = snapshot("room.a", 1);
    huge.domainCheckpoint = { value: "x".repeat(65_000) };
    await expect(
      persistence.compareAndSwap({
        roomId: "room.a",
        expectedRevision: null,
        snapshot: huge,
      }),
    ).rejects.toThrow("超过上限");
    expect(storage.values.size).toBe(0);
  });

  it("灾备只把通过领域完整性校验的历史房间恢复到空分区，并保留其原 revision", async () => {
    const historical = await validSnapshot("room.recovery", 17);
    const storage = new AtomicMemoryStorage();
    const persistence = new TransactionalOnlineRoomPersistenceV1(storage, {
      backupSlots: 4,
    });
    await persistence.restoreToEmpty({
      roomId: "room.recovery",
      snapshot: historical,
    });
    expect(await persistence.load("room.recovery")).toEqual(historical);
    expect(await persistence.loadBackup("room.recovery", 17)).toEqual(
      historical,
    );
    await expect(
      persistence.restoreToEmpty({
        roomId: "room.recovery",
        snapshot: historical,
      }),
    ).rejects.toThrow(/不是空分区/);

    const corrupt = structuredClone(historical);
    corrupt.updatedAt += 1;
    const empty = new TransactionalOnlineRoomPersistenceV1(
      new AtomicMemoryStorage(),
    );
    await expect(
      empty.restoreToEmpty({ roomId: "room.recovery", snapshot: corrupt }),
    ).rejects.toThrow(/完整性/);
    expect(await empty.load("room.recovery")).toBeNull();
  });
});
