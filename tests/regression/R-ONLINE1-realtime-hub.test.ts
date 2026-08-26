import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { AuthoritativeOnlineRoomV1, type OnlineRoomDomainAdapterV1 } from '../../src/lib/online/room-authority'
import { createOnlineRoomGatewayV1 } from '../../src/lib/online/room-gateway'
import {
  FanoutBackedOnlineRoomRealtimeV1,
  OnlineRoomRealtimeHubV1,
  type OnlineRoomRealtimeFanoutTransportV1,
  type OnlineRoomRealtimeSignalV1,
} from '../../src/lib/online/realtime-hub'

const RELEASE = 'f'.repeat(64)

function adapter(): OnlineRoomDomainAdapterV1 {
  let state: unknown[] = []
  return {
    apply: async ({ sequence, command }) => {
      state.push(command.payload)
      return {
        eventType: command.kind,
        publicPayload: { sequence },
        gmPrivatePayload: { secret: 'server-only' },
        resultingStateHash: await hashCanonicalValue(state),
      }
    },
    project: async () => ({ count: state.length }),
    exportCheckpoint: async () => structuredClone(state),
    restoreCheckpoint: async checkpoint => { state = structuredClone(checkpoint as unknown[]) },
  }
}

describe('ONLINE-1 · cursor-only realtime fanout', () => {
  it('两个服务实例经保留式外部 fanout 唤醒等待者，传输层只观察 roomId 和游标', async () => {
    const latest = new Map<string, number>()
    const waiters = new Set<{
      roomId: string
      afterSequence: number
      resolve(value: { cursor: number; timedOut: boolean }): void
    }>()
    const signals: OnlineRoomRealtimeSignalV1[] = []
    const transport: OnlineRoomRealtimeFanoutTransportV1 = {
      async publish(signal) {
        signals.push(structuredClone(signal))
        latest.set(signal.roomId, Math.max(latest.get(signal.roomId) ?? 0, signal.cursor))
        for (const waiter of [...waiters]) {
          if (waiter.roomId === signal.roomId && signal.cursor > waiter.afterSequence) {
            waiters.delete(waiter)
            waiter.resolve({ cursor: signal.cursor, timedOut: false })
          }
        }
      },
      async waitForCursor(input) {
        const retained = latest.get(input.roomId) ?? 0
        if (retained > input.afterSequence) return { cursor: retained, timedOut: false }
        return new Promise((resolve, reject) => {
          const waiter = { roomId: input.roomId, afterSequence: input.afterSequence, resolve }
          waiters.add(waiter)
          const timer = setTimeout(() => {
            waiters.delete(waiter)
            resolve({ cursor: input.afterSequence, timedOut: true })
          }, input.timeoutMs)
          input.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            waiters.delete(waiter)
            reject(new Error('aborted'))
          }, { once: true })
        })
      },
    }
    const producer = new FanoutBackedOnlineRoomRealtimeV1(transport)
    const consumer = new FanoutBackedOnlineRoomRealtimeV1(transport)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.external-fanout', releaseHash: RELEASE, gmDisplayName: '主持人', adapter: adapter(),
    })
    await expect(consumer.waitForAdvance({
      room: created.room, memberId: created.gm.member.memberId,
      authToken: 'invalid-auth-token-123456', afterSequence: 0, timeoutMs: 1_000,
    })).rejects.toThrow('成员凭据无效')
    expect(waiters.size).toBe(0)

    const waiting = consumer.waitForAdvance({
      room: created.room, memberId: created.gm.member.memberId,
      authToken: created.gm.authToken, afterSequence: 0, timeoutMs: 1_000,
    })
    await Promise.resolve()
    const receipt = await created.room.submit({
      protocolVersion: 1, roomId: created.room.roomId, releaseHash: RELEASE,
      requestId: 'external.fanout.command', memberId: created.gm.member.memberId,
      authToken: created.gm.authToken, expectedSequence: 0, kind: 'gm.narrate',
      actorKey: null, payload: { text: '雾钟响起' },
    })
    await producer.notify(created.room.roomId, receipt.acceptedSequence)
    await expect(waiting).resolves.toEqual({ cursor: 1, timedOut: false })
    expect(signals).toEqual([{
      protocolVersion: 1, type: 'cursor.advanced', roomId: 'room.external-fanout', cursor: 1,
    }])
    expect(JSON.stringify(signals)).not.toContain('雾钟')
  })

  it('订阅先鉴权，通知只含游标；客户端仍通过 reconnect 获取按成员过滤的事件', async () => {
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.realtime', releaseHash: RELEASE, gmDisplayName: '主持人', adapter: adapter(),
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'actor.player', expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家' })
    const hub = new OnlineRoomRealtimeHubV1()
    const signals: OnlineRoomRealtimeSignalV1[] = []
    await expect(hub.subscribe({
      room: created.room, memberId: player.member.memberId, authToken: 'invalid-token-123456',
      afterSequence: 0, send: signal => { signals.push(signal) },
    })).rejects.toThrow('成员凭据无效')
    const subscription = await hub.subscribe({
      room: created.room, memberId: player.member.memberId, authToken: player.authToken,
      afterSequence: 0, send: signal => { signals.push(signal) },
    })
    expect(hub.activeSubscriptions('room.realtime')).toBe(1)

    const gateway = createOnlineRoomGatewayV1({
      rooms: { load: async roomId => roomId === created.room.roomId ? created.room : null },
      realtime: hub,
    })
    const waiting = gateway({
      method: 'POST', path: '/v1/rooms/wait', contentType: 'application/json',
      body: {
        protocolVersion: 1, roomId: created.room.roomId,
        memberId: player.member.memberId, authToken: player.authToken,
        afterSequence: 0, timeoutMs: 1_000,
      },
    })
    const accepted = await gateway({
      method: 'POST', path: '/v1/rooms/commands', contentType: 'application/json',
      body: {
        protocolVersion: 1, roomId: created.room.roomId, releaseHash: RELEASE,
        requestId: 'gm.narrate.1', memberId: created.gm.member.memberId,
        authToken: created.gm.authToken, expectedSequence: 0, kind: 'gm.narrate',
        actorKey: null, payload: { text: '钟声响起。' },
      },
    })
    expect(accepted.status).toBe(200)
    await expect(waiting).resolves.toMatchObject({
      status: 200, body: { cursor: 1, timedOut: false },
    })
    expect(signals).toEqual([{ protocolVersion: 1, type: 'cursor.advanced', roomId: 'room.realtime', cursor: 1 }])
    expect(JSON.stringify(signals)).not.toContain('钟声')
    expect(JSON.stringify(signals)).not.toContain('server-only')

    const recovered = await created.room.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })
    expect(recovered.events).toMatchObject([{ sequence: 1, publicPayload: { sequence: 1 }, privatePayload: null }])
    expect(JSON.stringify(recovered)).not.toContain('server-only')
    subscription.close()
    expect(hub.activeSubscriptions()).toBe(0)
  })

  it('失败的发送端会被隔离，不阻塞其他订阅者', async () => {
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.fanout', releaseHash: RELEASE, gmDisplayName: '主持人', adapter: adapter(),
    })
    const hub = new OnlineRoomRealtimeHubV1({ total: 3, perRoom: 3 })
    const delivered: number[] = []
    await hub.subscribe({
      room: created.room, memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      afterSequence: 0, send: async () => { throw new Error('socket closed') },
    })
    await hub.subscribe({
      room: created.room, memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      afterSequence: 0, send: signal => { delivered.push(signal.cursor) },
    })
    await hub.notify(created.room.roomId, 1)
    expect(delivered).toEqual([1])
    expect(hub.activeSubscriptions()).toBe(1)
  })

  it('长轮询超时和调用方取消都会关闭订阅，不泄漏连接容量', async () => {
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.wait-cleanup', releaseHash: RELEASE, gmDisplayName: '主持人', adapter: adapter(),
    })
    const hub = new OnlineRoomRealtimeHubV1({ total: 2, perRoom: 2 })
    await expect(hub.waitForAdvance({
      room: created.room,
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      afterSequence: 0,
      timeoutMs: 100,
    })).resolves.toEqual({ cursor: 0, timedOut: true })
    expect(hub.activeSubscriptions()).toBe(0)
    const controller = new AbortController()
    const waiting = hub.waitForAdvance({
      room: created.room,
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      afterSequence: 0,
      timeoutMs: 1_000,
      signal: controller.signal,
    })
    const rejected = waiting.catch(error => error)
    controller.abort()
    await expect(rejected).resolves.toMatchObject({ code: 'request_aborted' })
    expect(hub.activeSubscriptions()).toBe(0)
  })
})
