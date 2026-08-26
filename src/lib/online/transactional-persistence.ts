import {
  verifyOnlineRoomSnapshotV1,
  type OnlineRoomPersistenceV1,
  type OnlineRoomSnapshotV1,
} from './room-authority'

export interface TransactionalKeyValueTransactionV1 {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

/**
 * Minimal structural contract implemented by Durable Object storage and by
 * database adapters that expose a serializable transaction. The transaction
 * must commit all writes atomically or commit none of them.
 */
export interface TransactionalKeyValueStorageV1 extends TransactionalKeyValueTransactionV1 {
  transaction<T>(operation: (transaction: TransactionalKeyValueTransactionV1) => Promise<T>): Promise<T>
}

function safeRoomId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error('[online-persistence:protocol] roomId 无效')
  }
  return value
}

function primaryKey(namespace: string, roomId: string): string {
  return `${namespace}/rooms/${encodeURIComponent(safeRoomId(roomId))}/current`
}

function backupKey(namespace: string, roomId: string, slot: number): string {
  return `${namespace}/rooms/${encodeURIComponent(safeRoomId(roomId))}/backup/${slot}`
}

function snapshotBytes(snapshot: OnlineRoomSnapshotV1): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
}

/**
 * Atomic room persistence with a bounded rolling backup ring. The current
 * snapshot and its backup slot are written in the same serializable
 * transaction, so a storage fault cannot leave a new primary without a
 * recoverable copy (or vice versa).
 */
export class TransactionalOnlineRoomPersistenceV1 implements OnlineRoomPersistenceV1 {
  private readonly namespace: string
  private readonly backupSlots: number
  private readonly maximumSnapshotBytes: number

  constructor(private readonly storage: TransactionalKeyValueStorageV1, input?: {
    namespace?: string
    backupSlots?: number
    maximumSnapshotBytes?: number
  }) {
    this.namespace = input?.namespace?.trim() || 'storyforge.online.v1'
    this.backupSlots = input?.backupSlots ?? 32
    this.maximumSnapshotBytes = input?.maximumSnapshotBytes ?? 8_000_000
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(this.namespace)) {
      throw new Error('[online-persistence:configuration] namespace 无效')
    }
    if (!Number.isInteger(this.backupSlots) || this.backupSlots < 2 || this.backupSlots > 1_024) {
      throw new Error('[online-persistence:configuration] backupSlots 无效')
    }
    if (!Number.isInteger(this.maximumSnapshotBytes) || this.maximumSnapshotBytes < 64_000
      || this.maximumSnapshotBytes > 128_000_000) {
      throw new Error('[online-persistence:configuration] maximumSnapshotBytes 无效')
    }
  }

  async load(roomId: string): Promise<OnlineRoomSnapshotV1 | null> {
    const snapshot = await this.storage.get<OnlineRoomSnapshotV1>(primaryKey(this.namespace, roomId))
    return snapshot ? structuredClone(snapshot) : null
  }

  async compareAndSwap(input: {
    roomId: string
    expectedRevision: number | null
    snapshot: OnlineRoomSnapshotV1
  }): Promise<boolean> {
    const roomId = safeRoomId(input.roomId)
    if (input.snapshot.roomId !== roomId) {
      throw new Error('[online-persistence:room_mismatch] 快照 roomId 与存储分区不一致')
    }
    const expectedNextRevision = input.expectedRevision == null ? 1 : input.expectedRevision + 1
    if (input.snapshot.revision !== expectedNextRevision) {
      throw new Error('[online-persistence:revision_invalid] 快照 revision 不是预期下一版本')
    }
    const size = snapshotBytes(input.snapshot)
    if (size > this.maximumSnapshotBytes) {
      throw new Error(`[online-persistence:snapshot_too_large] 房间快照 ${size} bytes 超过上限`)
    }
    const currentKey = primaryKey(this.namespace, roomId)
    const slot = input.snapshot.revision % this.backupSlots
    return this.storage.transaction(async transaction => {
      const current = await transaction.get<OnlineRoomSnapshotV1>(currentKey)
      if ((current?.revision ?? null) !== input.expectedRevision) return false
      const snapshot = structuredClone(input.snapshot)
      await transaction.put(currentKey, snapshot)
      await transaction.put(backupKey(this.namespace, roomId, slot), snapshot)
      return true
    })
  }

  /** Returns an exact historical snapshot only while its bounded ring slot remains valid. */
  async loadBackup(roomId: string, revision: number): Promise<OnlineRoomSnapshotV1 | null> {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error('[online-persistence:protocol] backup revision 无效')
    }
    const snapshot = await this.storage.get<OnlineRoomSnapshotV1>(
      backupKey(this.namespace, roomId, revision % this.backupSlots),
    )
    if (!snapshot || snapshot.roomId !== roomId || snapshot.revision !== revision) return null
    return structuredClone(snapshot)
  }

  /** Restore a verified historical room only into a new, empty room partition. */
  async restoreToEmpty(input: {
    roomId: string
    snapshot: OnlineRoomSnapshotV1
  }): Promise<void> {
    const roomId = safeRoomId(input.roomId)
    if (input.snapshot.roomId !== roomId) {
      throw new Error('[online-persistence:room_mismatch] 快照 roomId 与恢复分区不一致')
    }
    const size = snapshotBytes(input.snapshot)
    if (size > this.maximumSnapshotBytes) {
      throw new Error(`[online-persistence:snapshot_too_large] 房间快照 ${size} bytes 超过上限`)
    }
    await verifyOnlineRoomSnapshotV1(input.snapshot, roomId)
    const currentKey = primaryKey(this.namespace, roomId)
    const restored = await this.storage.transaction(async transaction => {
      if (await transaction.get<OnlineRoomSnapshotV1>(currentKey)) return false
      const snapshot = structuredClone(input.snapshot)
      await transaction.put(currentKey, snapshot)
      await transaction.put(backupKey(this.namespace, roomId, snapshot.revision % this.backupSlots), snapshot)
      return true
    })
    if (!restored) throw new Error('[online-persistence:restore_target_not_empty] 房间恢复目标不是空分区')
  }
}
