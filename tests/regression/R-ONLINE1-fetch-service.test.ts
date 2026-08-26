import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createOnlineRoomFetchHandlerV1 } from '../../src/lib/online/fetch-service'
import { HttpOnlineRoomTransportV1 } from '../../src/lib/online/http-transport'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomDomainAdapterV1,
} from '../../src/lib/online/room-authority'
import { createOnlineRoomGatewayV1 } from '../../src/lib/online/room-gateway'

function domainAdapter(): OnlineRoomDomainAdapterV1 {
  const history: string[] = []
  return {
    apply: async ({ command }) => {
      history.push(command.kind)
      return {
        eventType: `test.${command.kind}`,
        publicPayload: { accepted: command.kind },
        gmPrivatePayload: { hiddenAnswer: 'only-gm' },
        resultingStateHash: await hashCanonicalValue(history),
      }
    },
    project: async ({ member, sequence }) => ({
      sequence,
      role: member.role,
      hiddenAnswer: member.role === 'gm' ? 'only-gm' : null,
    }),
  }
}

function serviceRequest(input: {
  url: string
  method?: string
  origin?: string
  contentType?: string
  body?: string
}): Request {
  const headers = new Map<string, string>()
  if (input.origin) headers.set('origin', input.origin)
  if (input.contentType) headers.set('content-type', input.contentType)
  const body = input.body ?? ''
  return {
    url: input.url,
    method: input.method ?? 'GET',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body,
  } as unknown as Request
}

describe('PLATFORM-1B · Web fetch service composition', () => {
  it('从严格 HTTP 客户端端到端完成建房、邀请、加入、行动和按角色重连投影', async () => {
    const rooms = new Map<string, AuthoritativeOnlineRoomV1>()
    const gateway = createOnlineRoomGatewayV1({
      rooms: {
        load: async roomId => rooms.get(roomId) ?? null,
        create: async input => {
          const created = await AuthoritativeOnlineRoomV1.create({
            roomId: input.roomId,
            releaseHash: input.releaseHash,
            gmDisplayName: input.gmDisplayName,
            adapter: domainAdapter(),
          })
          rooms.set(input.roomId, created.room)
          return created
        },
      },
    })
    const handler = createOnlineRoomFetchHandlerV1({
      gateway,
      allowedOrigins: ['https://app.storyforge.test'],
      serviceVersion: 'test-1',
    })
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: 'https://online.storyforge.test',
      fetch: async (url, init) => handler(new Request(url, {
        method: init.method,
        headers: { ...init.headers, origin: 'https://app.storyforge.test' },
        body: init.body,
        signal: init.signal,
      })),
    })
    const releaseHash = 'a'.repeat(64)
    const gm = await transport.createRoom({
      requestId: 'create.fetch.1',
      roomId: 'room.fetch',
      releaseHash,
      selectedCharacterKeys: ['player.1'],
      creatorAccessToken: 'identity.token',
      gmDisplayName: '主持人',
    })
    const invite = await transport.issueInvite({
      roomId: gm.roomId,
      gmMemberId: gm.member.memberId,
      gmAuthToken: gm.authToken,
      role: 'player',
      actorKey: 'player.1',
      expiresAt: Date.now() + 60_000,
      maximumUses: 1,
    })
    const player = await transport.joinRoom({
      roomId: gm.roomId,
      ...invite,
      displayName: '玩家一号',
    })
    const receipt = await transport.submit({
      protocolVersion: 1,
      roomId: gm.roomId,
      releaseHash,
      requestId: 'chat.fetch.1',
      memberId: player.member.memberId,
      authToken: player.authToken,
      expectedSequence: 0,
      kind: 'chat.message',
      actorKey: player.member.actorKey,
      payload: { text: '从真实 HTTP 边界提交' },
    })
    expect(receipt).toMatchObject({ acceptedSequence: 1, duplicate: false })
    expect(JSON.stringify(receipt)).not.toContain('only-gm')
    const playerReconnect = await transport.reconnect({
      roomId: gm.roomId,
      memberId: player.member.memberId,
      authToken: player.authToken,
      afterSequence: 0,
    })
    const gmReconnect = await transport.reconnect({
      roomId: gm.roomId,
      memberId: gm.member.memberId,
      authToken: gm.authToken,
      afterSequence: 0,
    })
    expect(playerReconnect.projection).toEqual({ sequence: 1, role: 'player', hiddenAnswer: null })
    expect(JSON.stringify(playerReconnect.events)).not.toContain('only-gm')
    expect(gmReconnect.projection).toEqual({ sequence: 1, role: 'gm', hiddenAnswer: 'only-gm' })
    expect(JSON.stringify(gmReconnect.events)).toContain('only-gm')
  })

  it('在网关之前关闭恶意 Origin、query、畸形 JSON 和超限 UTF-8 请求，并提供无状态健康检查', async () => {
    let gatewayCalls = 0
    const handler = createOnlineRoomFetchHandlerV1({
      gateway: async () => {
        gatewayCalls += 1
        return { status: 200, headers: {}, body: { ok: true } }
      },
      allowedOrigins: ['https://app.storyforge.test'],
      serviceVersion: 'release-42',
      maximumBodyBytes: 1_024,
    })
    const forbidden = await handler(serviceRequest({
      url: 'https://online.storyforge.test/v1/rooms',
      method: 'POST', origin: 'https://evil.test', contentType: 'application/json', body: '{}',
    }))
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await handler(serviceRequest({
      url: 'https://online.storyforge.test/v1/rooms',
      method: 'OPTIONS', origin: 'https://app.storyforge.test',
    }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.storyforge.test')
    const query = await handler(serviceRequest({
      url: 'https://online.storyforge.test/v1/rooms?token=must-not-appear',
      method: 'POST', origin: 'https://app.storyforge.test', contentType: 'application/json', body: '{}',
    }))
    expect(query.status).toBe(400)
    const invalidJson = await handler(serviceRequest({
      url: 'https://online.storyforge.test/v1/rooms',
      method: 'POST', origin: 'https://app.storyforge.test', contentType: 'application/json', body: '{',
    }))
    expect(invalidJson.status).toBe(400)
    const oversized = await handler(serviceRequest({
      url: 'https://online.storyforge.test/v1/rooms',
      method: 'POST', origin: 'https://app.storyforge.test', contentType: 'application/json',
      body: JSON.stringify({ padding: '界'.repeat(400) }),
    }))
    expect(oversized.status).toBe(413)
    const health = await handler(serviceRequest({ url: 'https://online.storyforge.test/healthz' }))
    expect(await health.json()).toEqual({ status: 'ok', protocolVersion: 1, serviceVersion: 'release-42' })
    expect(gatewayCalls).toBe(0)
  })
})
