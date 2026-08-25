import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomDomainAdapterV1,
  type OnlineRoomPersistenceV1,
  type OnlineRoomSnapshotV1,
} from '../../src/lib/online/room-authority'

class MemoryRoomStore implements OnlineRoomPersistenceV1 {
  readonly snapshots = new Map<string, OnlineRoomSnapshotV1>()
  failNext = false

  async load(roomId: string): Promise<OnlineRoomSnapshotV1 | null> {
    const snapshot = this.snapshots.get(roomId)
    return snapshot ? structuredClone(snapshot) : null
  }

  async compareAndSwap(input: {
    roomId: string
    expectedRevision: number | null
    snapshot: OnlineRoomSnapshotV1
  }): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false
      return false
    }
    const current = this.snapshots.get(input.roomId)
    if ((current?.revision ?? null) !== input.expectedRevision) return false
    this.snapshots.set(input.roomId, structuredClone(input.snapshot))
    return true
  }
}

function durableAdapter(): OnlineRoomDomainAdapterV1 & { history: unknown[] } {
  const result: OnlineRoomDomainAdapterV1 & { history: unknown[] } = {
    history: [],
    apply: async ({ sequence, command, member }) => {
      const publicPayload = { sequence, kind: command.kind, actorKey: command.actorKey }
      result.history.push(publicPayload)
      return {
        eventType: `room.${command.kind}`,
        publicPayload,
        gmPrivatePayload: { unrevealed: `gm-only-${sequence}` },
        privatePayloadByMemberId: { [member.memberId]: { ownSequence: sequence } },
        resultingStateHash: await hashCanonicalValue(result.history),
      }
    },
    project: async ({ sequence, member }) => ({
      sequence,
      history: structuredClone(result.history),
      ...(member.role === 'gm' ? { unrevealed: 'gm-state' } : {}),
    }),
    exportCheckpoint: async () => structuredClone(result.history),
    restoreCheckpoint: async checkpoint => {
      result.history.splice(0, result.history.length, ...structuredClone(checkpoint as unknown[]))
    },
  }
  return result
}

function command(input: {
  roomId: string
  releaseHash: string
  requestId: string
  memberId: string
  authToken: string
  expectedSequence: number
  kind?: OnlineRoomCommandV1['kind']
  actorKey?: string | null
}): OnlineRoomCommandV1 {
  return {
    protocolVersion: 1,
    roomId: input.roomId,
    releaseHash: input.releaseHash,
    requestId: input.requestId,
    memberId: input.memberId,
    authToken: input.authToken,
    expectedSequence: input.expectedSequence,
    kind: input.kind ?? 'rule.action',
    actorKey: input.actorKey ?? null,
    payload: { actionKey: 'investigate' },
  }
}

describe('PLATFORM-1B · durable authoritative room', () => {
  it('进程重启后恢复凭据、事件、领域状态、cursor 与 requestId 幂等', async () => {
    const store = new MemoryRoomStore()
    const releaseHash = 'e'.repeat(64)
    const firstAdapter = durableAdapter()
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.durable', releaseHash, gmDisplayName: '主持人',
      adapter: firstAdapter, persistence: store,
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: 'player',
      actorKey: 'player.1',
      expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家甲' })
    const firstCommand = command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'durable.request.1',
      memberId: player.member.memberId,
      authToken: player.authToken,
      expectedSequence: 0,
      actorKey: 'player.1',
    })
    await created.room.submit(firstCommand)
    await created.room.disconnect(player.member.memberId, player.authToken)

    const restoredAdapter = durableAdapter()
    const restored = await AuthoritativeOnlineRoomV1.restore({
      roomId: 'room.durable', adapter: restoredAdapter, persistence: store,
    })
    expect(restoredAdapter.history).toHaveLength(1)
    const reconnect = await restored.reconnect({
      memberId: player.member.memberId,
      authToken: player.authToken,
      afterSequence: 0,
    })
    expect(reconnect.cursor).toBe(1)
    expect(reconnect.events).toHaveLength(1)
    expect(JSON.stringify(reconnect)).not.toContain('gm-only-1')
    expect((await restored.submit(firstCommand)).duplicate).toBe(true)
  })

  it('并发同 cursor 命令被串行化，持久化失败同时回滚房间和领域状态', async () => {
    const store = new MemoryRoomStore()
    const currentAdapter = durableAdapter()
    const releaseHash = 'f'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.concurrent', releaseHash, gmDisplayName: '主持人',
      adapter: currentAdapter, persistence: store,
    })
    const base = {
      roomId: created.room.roomId,
      releaseHash,
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: 0,
      kind: 'chat.message' as const,
    }
    const concurrent = await Promise.allSettled([
      created.room.submit(command({ ...base, requestId: 'concurrent.1' })),
      created.room.submit(command({ ...base, requestId: 'concurrent.2' })),
    ])
    expect(concurrent.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect(currentAdapter.history).toHaveLength(1)

    const afterFirst = await store.load(created.room.roomId)
    expect(afterFirst?.sequence).toBe(1)
    store.failNext = true
    await expect(created.room.submit(command({
      ...base, requestId: 'rollback.1', expectedSequence: 1,
    }))).rejects.toThrow('持久化版本冲突')
    expect(currentAdapter.history).toHaveLength(1)
    expect((await store.load(created.room.roomId))?.sequence).toBe(1)
    await expect(created.room.submit(command({
      ...base, requestId: 'rollback.1', expectedSequence: 1,
    }))).resolves.toMatchObject({ acceptedSequence: 2, duplicate: false })
  })

  it('快照被修改或领域适配器没有 checkpoint 时 fail-closed', async () => {
    const store = new MemoryRoomStore()
    const releaseHash = '1'.repeat(64)
    await expect(AuthoritativeOnlineRoomV1.create({
      roomId: 'room.no-checkpoint', releaseHash, gmDisplayName: '主持人',
      persistence: store,
      adapter: { apply: async () => { throw new Error('unused') }, project: async () => ({}) },
    })).rejects.toThrow('要求领域适配器实现 checkpoint')

    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.corrupt', releaseHash, gmDisplayName: '主持人',
      persistence: store, adapter: durableAdapter(),
    })
    const snapshot = (await store.load(created.room.roomId))!
    snapshot.sequence = 9
    store.snapshots.set(created.room.roomId, snapshot)
    await expect(AuthoritativeOnlineRoomV1.restore({
      roomId: created.room.roomId, persistence: store, adapter: durableAdapter(),
    })).rejects.toThrow('完整性校验失败')
  })
})
