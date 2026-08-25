import { describe, expect, it } from 'vitest'
import {
  CommunityPlatformAuthorityV1,
  type CommunityPlatformPersistenceV1,
  type CommunityPlatformSnapshotV1,
  type CommunityPrincipalV1,
} from '../../src/lib/community/authority'
import { createCommunityFetchHandlerV1 } from '../../src/lib/community/fetch-service'
import { createCommunityGatewayV1 } from '../../src/lib/community/gateway'
import { CommunityHttpClientV1 } from '../../src/lib/community/http-client'
import {
  CommunityLfgRoomHandoffServiceV1,
  InMemoryCommunityLfgRoomHandoffPersistenceV1,
  InMemoryCommunityLfgRoomSecretVaultV1,
} from '../../src/lib/community/lfg-room-handoff'

class Store implements CommunityPlatformPersistenceV1 {
  snapshot: CommunityPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommunityPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const RELEASE = 'f'.repeat(64)
const HOST = 'token-community-host-12345'
const PLAYER = 'token-community-player-123'
const principals = new Map<string, CommunityPrincipalV1>([
  [HOST, { userId: 'user.host', permissions: [] }],
  [PLAYER, { userId: 'user.player', permissions: [] }],
])

describe('PLATFORM-1F · Community Web boundary and strict client', () => {
  it('两个账号通过真实 Request/Response 完成资料、招募、申请、主持审核和个人状态查询', async () => {
    const now = 1_900_000_000_000
    const authority = await CommunityPlatformAuthorityV1.create({
      persistence: new Store(), now: () => now,
      releasePolicy: {
        canHost: async (userId, releaseHash) => userId === 'user.host' && releaseHash === RELEASE,
        canRegisterOriginal: async () => false,
        reviewEligibility: async (userId, releaseHash) => ({
          entitled: userId === 'user.player' && releaseHash === RELEASE, creator: false,
        }),
      },
    })
    const handoff = new CommunityLfgRoomHandoffServiceV1({
      community: authority,
      online: {
        issueMatchmakingInvite: async input => ({
          roomId: input.roomId, releaseHash: RELEASE,
          inviteId: `invite.${input.requestId}`, inviteToken: `secret-invite.${input.requestId}`,
        }),
      } as never,
      persistence: new InMemoryCommunityLfgRoomHandoffPersistenceV1(),
      vault: new InMemoryCommunityLfgRoomSecretVaultV1(), now: () => now,
    })
    const gateway = createCommunityGatewayV1({
      authority, roomHandoff: handoff, now: () => now,
      identity: { authenticate: async token => structuredClone(principals.get(token) ?? null) },
    })
    const handler = createCommunityFetchHandlerV1({
      gateway, allowedOrigins: ['https://app.storyforge.test'], serviceVersion: 'test',
    })
    const client = new CommunityHttpClientV1({
      baseUrl: 'https://api.storyforge.test',
      fetch: async (url, init) => handler(new Request(url, {
        ...init, headers: { ...init.headers, origin: 'https://app.storyforge.test' },
      })),
    })
    await client.upsertProfile({
      accessToken: HOST, requestId: 'profile.host', handle: 'host', displayName: '主持人', bio: '',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    })
    await client.upsertProfile({
      accessToken: PLAYER, requestId: 'profile.player', handle: 'player', displayName: '玩家', bio: '',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    })
    await client.setSocialEdge({
      accessToken: PLAYER, requestId: 'social.favorite', kind: 'favorite-listing',
      targetId: 'listing.community', active: true,
    })
    await expect(client.mySocialEdges(PLAYER)).resolves.toMatchObject([{
      kind: 'favorite-listing', targetId: 'listing.community', active: true,
    }])
    const post = await client.createLfg({
      accessToken: HOST, requestId: 'lfg.create', releaseHash: RELEASE,
      title: '雾港周末团', summary: '使用 X-card 与界限清单', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      startsAt: now + 3_600_000, durationMinutes: 180, playerCapacity: 4, waitlistCapacity: 2,
      audience: 'all-ages', safetyTags: ['X-card', 'lines-and-veils'],
    })
    await expect(client.discoverLfg({ releaseHash: RELEASE })).resolves.toMatchObject([
      { post: { postId: post.postId }, availableSeats: 4 },
    ])
    const application = await client.applyToLfg({
      accessToken: PLAYER, requestId: 'lfg.apply', postId: post.postId,
      characterPreference: '调查员', note: '接受全部安全工具',
    })
    await expect(client.applicationsForPost({ accessToken: PLAYER, postId: post.postId }))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(client.applicationsForPost({ accessToken: HOST, postId: post.postId }))
      .resolves.toMatchObject([{ applicationId: application.applicationId, note: '接受全部安全工具' }])
    await client.decideApplication({
      accessToken: HOST, requestId: 'lfg.accept', applicationId: application.applicationId, decision: 'accept',
    })
    await expect(client.myApplications(PLAYER)).resolves.toMatchObject([
      { applicationId: application.applicationId, status: 'accepted' },
    ])
    await client.markAttendance({
      accessToken: HOST, requestId: 'attendance.confirm', applicationId: application.applicationId, status: 'confirmed',
    })
    await expect(client.attendanceForPost({ accessToken: HOST, postId: post.postId })).resolves.toMatchObject([
      { applicationId: application.applicationId, status: 'confirmed' },
    ])
    await expect(client.myParticipation(PLAYER)).resolves.toMatchObject([{
      post: { postId: post.postId }, application: { applicationId: application.applicationId },
      attendance: { status: 'confirmed' },
    }])
    const handoffs = await client.bindRoomHandoffs({
      accessToken: HOST, requestId: 'handoff.bind', postId: post.postId,
      roomId: 'room.community', releaseHash: RELEASE, expiresAt: now + 86_400_000,
      bindings: [{ applicationId: application.applicationId, actorKey: 'investigator.1' }],
    })
    expect(JSON.stringify(handoffs)).not.toContain('secret-invite')
    await expect(client.claimRoomHandoff({
      accessToken: PLAYER, applicationId: application.applicationId,
    })).resolves.toMatchObject({
      roomId: 'room.community', actorKey: 'investigator.1',
      inviteId: expect.stringMatching(/^invite\./), inviteToken: expect.stringMatching(/^secret-invite\./),
      displayName: '玩家',
    })
    await expect(client.listReviews({ subjectType: 'release', releaseHash: RELEASE })).resolves.toMatchObject({
      aggregate: { count: 0, average: null }, reviews: [],
    })
    await client.upsertReview({
      accessToken: PLAYER, requestId: 'review.release', subjectType: 'release', releaseHash: RELEASE,
      postId: null, rating: 5, title: '完整可玩', body: '规则与在线交接都很清楚。',
      tags: ['规则清楚'], containsSpoilers: false,
    })
    await expect(client.listReviews({ subjectType: 'release', releaseHash: RELEASE })).resolves.toMatchObject({
      aggregate: { count: 1, average: 5, histogram: { '5': 1 } },
      reviews: [{ verification: 'entitlement', title: '完整可玩' }],
    })
    await expect(client.reviewCapabilities({
      accessToken: PLAYER, subjectType: 'release', releaseHash: RELEASE,
    })).resolves.toMatchObject({ ownReviewId: expect.stringMatching(/^review\./), respondableReviewIds: [] })
    const report = await client.createReport({
      accessToken: PLAYER, requestId: 'report.lfg', subjectType: 'lfg', subjectId: post.postId,
      category: 'unsafe-content', details: '治理正文只应在案件投影中返回。',
    })
    expect(report).toMatchObject({ relation: 'reporter', subjectId: post.postId, status: 'open' })
    await expect(client.myReports(PLAYER)).resolves.toMatchObject([{
      reportId: report.reportId, details: '治理正文只应在案件投影中返回。',
    }])
    await expect(client.myAppeals(PLAYER)).resolves.toEqual([])
  })
})
