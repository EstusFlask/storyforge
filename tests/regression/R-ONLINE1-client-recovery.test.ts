import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { OnlineRoomClientV1, type OnlineRoomTransportV1 } from '../../src/lib/online/room-client'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomDomainAdapterV1,
} from '../../src/lib/online/room-authority'

function adapter(): OnlineRoomDomainAdapterV1 {
  const history: unknown[] = []
  return {
    apply: async ({ sequence, command }) => {
      const payload = { sequence, kind: command.kind, actorKey: command.actorKey }
      history.push(payload)
      return {
        eventType: `room.${command.kind}`,
        publicPayload: payload,
        gmPrivatePayload: { hidden: sequence },
        resultingStateHash: await hashCanonicalValue(history),
      }
    },
    project: async ({ sequence, member }) => ({
      sequence,
      publicCount: history.length,
      ...(member.role === 'gm' ? { hiddenCount: history.length } : {}),
    }),
  }
}

describe('PLATFORM-1B · reconnecting client outbox', () => {
  it('服务端已接受但响应丢失时重连并用同一 requestId 取幂等回执，不重复事件', async () => {
    const releaseHash = '2'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.client-loss', releaseHash, gmDisplayName: '主持人', adapter: adapter(),
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'player.1', expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家' })
    let dropAcceptedResponse = true
    const transport: OnlineRoomTransportV1 = {
      submit: async command => {
        const receipt = await created.room.submit(command)
        if (dropAcceptedResponse) {
          dropAcceptedResponse = false
          throw new Error('socket closed after server commit')
        }
        return receipt
      },
      reconnect: ({ memberId, authToken, afterSequence }) => created.room.reconnect({
        memberId, authToken, afterSequence,
      }),
      disconnect: ({ memberId, authToken }) => created.room.disconnect(memberId, authToken),
    }
    const client = new OnlineRoomClientV1({
      roomId: created.room.roomId,
      releaseHash,
      memberId: player.member.memberId,
      authToken: player.authToken,
      actorKey: 'player.1',
    }, transport)
    await client.connect()
    const afterDrop = await client.enqueue({
      requestId: 'client.loss.1', kind: 'rule.action', payload: { actionKey: 'investigate' },
    })
    expect(afterDrop).toMatchObject({ connection: 'recovering', cursor: 0, pendingRequestIds: ['client.loss.1'] })
    const recovered = await client.recover()
    expect(recovered).toMatchObject({ connection: 'online', cursor: 1, pendingRequestIds: [] })
    expect(recovered.projection).toMatchObject({ sequence: 1, publicCount: 1 })
    expect(recovered.events).toHaveLength(1)
    expect(JSON.stringify(recovered)).not.toContain('hidden')
  })

  it('网络分区期间不做乐观状态；恢复后先补事件，再重排未提交命令', async () => {
    const releaseHash = '3'.repeat(64)
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.partition', releaseHash, gmDisplayName: '主持人', adapter: adapter(),
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId,
      gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: 'player.1', expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '玩家' })
    let partitioned = false
    const transport: OnlineRoomTransportV1 = {
      submit: command => partitioned ? Promise.reject(new Error('offline')) : created.room.submit(command),
      reconnect: input => created.room.reconnect(input),
    }
    const client = new OnlineRoomClientV1({
      roomId: created.room.roomId, releaseHash,
      memberId: player.member.memberId, authToken: player.authToken, actorKey: 'player.1',
    }, transport)
    await client.connect()
    partitioned = true
    const queued = await client.enqueue({
      requestId: 'partition.player.1', kind: 'rule.action', payload: { actionKey: 'wait' },
    })
    expect(queued).toMatchObject({ cursor: 0, pendingRequestIds: ['partition.player.1'] })
    await created.room.submit({
      protocolVersion: 1,
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'partition.gm.1',
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: 0,
      kind: 'scene.open',
      actorKey: null,
      payload: { sceneKey: 'scene.2' },
    })
    partitioned = false
    const recovered = await client.recover()
    expect(recovered).toMatchObject({ connection: 'online', cursor: 2, pendingRequestIds: [] })
    expect(recovered.events.map(event => event.sequence)).toEqual([1, 2])
  })
})
