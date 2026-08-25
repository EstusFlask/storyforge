import { describe, expect, it } from 'vitest'
import {
  CommunityPlatformAuthorityV1,
  type CommunityPlatformPersistenceV1,
  type CommunityPlatformSnapshotV1,
} from '../../src/lib/community/authority'
import { createCommunityGatewayV1, type CommunityGatewayAuditV1 } from '../../src/lib/community/gateway'

class Store implements CommunityPlatformPersistenceV1 {
  snapshot: CommunityPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommunityPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const RELEASE = 'e'.repeat(64)
const TOKEN = 'token-user-host-1234567890'
const APPLICANT_TOKEN = 'token-user-applicant-12345'

function request(path: string, body: unknown, authorization?: string) {
  return {
    method: 'POST', path, contentType: 'application/json',
    headers: authorization ? { authorization: `Bearer ${authorization}` } : {}, body,
  }
}

describe('COMMUNITY-1 · authenticated HTTP gateway', () => {
  it('Bearer 身份只在边界解析；创建、发现和错误映射不泄露凭据或自由正文', async () => {
    const authority = await CommunityPlatformAuthorityV1.create({
      persistence: new Store(),
      releasePolicy: {
        canHost: async (userId, releaseHash) => userId === 'user.host' && releaseHash === RELEASE,
        canRegisterOriginal: async () => false,
      },
    })
    const audits: CommunityGatewayAuditV1[] = []
    const gateway = createCommunityGatewayV1({
      authority,
      identity: {
        authenticate: async accessToken => accessToken === TOKEN
          ? { userId: 'user.host', permissions: [] }
          : accessToken === APPLICANT_TOKEN ? { userId: 'user.applicant', permissions: [] } : null,
      },
      audit: entry => { audits.push(entry) },
    })

    const missing = await gateway(request('/v1/community/profiles', {
      requestId: 'profile.unauthorized', handle: 'host', displayName: 'Host', bio: '',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    }))
    expect(missing).toMatchObject({ status: 401, body: { code: 'unauthorized' } })
    const profile = await gateway(request('/v1/community/profiles', {
      requestId: 'profile.host', handle: 'host', displayName: 'Host', bio: '',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    }, TOKEN))
    expect(profile).toMatchObject({ status: 200, body: { userId: 'user.host', handle: 'host' } })

    const secretSummary = '只应保存在领域快照中的组队说明 42017'
    const created = await gateway(request('/v1/community/lfg', {
      requestId: 'lfg.create', releaseHash: RELEASE, title: '周末团', summary: secretSummary,
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', startsAt: Date.now() + 3_600_000,
      durationMinutes: 120, playerCapacity: 4, waitlistCapacity: 1,
      audience: 'all-ages', safetyTags: ['X-card'],
    }, TOKEN))
    expect(created.status).toBe(201)
    const discovered = await gateway(request('/v1/community/lfg/discover', { releaseHash: RELEASE }))
    expect(discovered).toMatchObject({ status: 200, body: [{ post: { title: '周末团' }, availableSeats: 4 }] })
    await gateway(request('/v1/community/profiles', {
      requestId: 'profile.applicant', handle: 'applicant', displayName: 'Applicant', bio: '',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    }, APPLICANT_TOKEN))
    const postId = (created.body as { postId: string }).postId
    const applied = await gateway(request('/v1/community/lfg/applications', {
      requestId: 'application.create', postId, characterPreference: '调查员', note: '接受安全工具',
    }, APPLICANT_TOKEN))
    expect(applied).toMatchObject({ status: 201, body: { status: 'pending' } })
    await expect(gateway(request('/v1/community/lfg/applications/list', { postId }, APPLICANT_TOKEN)))
      .resolves.toMatchObject({ status: 403, body: { code: 'forbidden' } })
    await expect(gateway(request('/v1/community/lfg/applications/list', { postId }, TOKEN)))
      .resolves.toMatchObject({ status: 200, body: [{ userId: 'user.applicant', note: '接受安全工具' }] })
    await expect(gateway(request('/v1/community/lfg/my-applications', {}, APPLICANT_TOKEN)))
      .resolves.toMatchObject({ status: 200, body: [{ postId, status: 'pending' }] })
    const malformed = await gateway(request('/v1/community/social', {
      requestId: 'social.hidden', kind: 'follow-creator', targetId: 'user.other', active: true,
      hiddenPrivilege: true,
    }, TOKEN))
    expect(malformed).toMatchObject({ status: 422, body: { code: 'protocol' } })
    const coerced = await gateway(request('/v1/community/lfg', {
      requestId: 'lfg.coercion', releaseHash: RELEASE, title: '类型欺骗', summary: '字符串数值不能被接受',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', startsAt: String(Date.now() + 3_600_000),
      durationMinutes: '120', playerCapacity: '4', waitlistCapacity: '1',
      audience: 'all-ages', safetyTags: ['X-card'],
    }, TOKEN))
    expect(coerced).toMatchObject({ status: 422, body: { code: 'protocol' } })
    expect(JSON.stringify(audits)).not.toContain(TOKEN)
    expect(JSON.stringify(audits)).not.toContain(secretSummary)
    expect(audits.slice(0, 2)).toMatchObject([
      { userId: null, outcome: 'rejected', status: 401 },
      { userId: 'user.host', outcome: 'accepted', status: 200 },
    ])
  })

  it('错误方法、媒体类型、超大载荷和未知端点均 fail-closed', async () => {
    const authority = await CommunityPlatformAuthorityV1.create({
      persistence: new Store(),
      releasePolicy: { canHost: async () => false, canRegisterOriginal: async () => false },
    })
    const gateway = createCommunityGatewayV1({
      authority,
      identity: { authenticate: async () => ({ userId: 'user.any', permissions: [] }) },
    })
    await expect(gateway({ ...request('/v1/community/lfg/discover', {}), method: 'GET' }))
      .resolves.toMatchObject({ status: 405 })
    await expect(gateway({ ...request('/v1/community/lfg/discover', {}), contentType: 'text/plain' }))
      .resolves.toMatchObject({ status: 415 })
    await expect(gateway(request('/v1/community/lfg/discover', { locale: 'x'.repeat(65_000) })))
      .resolves.toMatchObject({ status: 422, body: { code: 'payload_too_large' } })
    await expect(gateway(request('/v1/community/lfg/discover', { includeFull: 'true' })))
      .resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/community/unknown', {}, TOKEN)))
      .resolves.toMatchObject({ status: 404, body: { code: 'endpoint_not_found' } })
  })
})
