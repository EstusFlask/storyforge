import { describe, expect, it } from 'vitest'
import {
  CommunityPlatformAuthorityV1,
  type CommunityPlatformPersistenceV1,
  type CommunityPlatformSnapshotV1,
  type CommunityPrincipalV1,
  type CommunityReleasePolicyV1,
} from '../../src/lib/community/authority'

const RELEASE_A = 'a'.repeat(64)
const RELEASE_B = 'b'.repeat(64)

class MemoryCommunityStore implements CommunityPlatformPersistenceV1 {
  snapshot: CommunityPlatformSnapshotV1 | null = null
  failNext = false

  async load(): Promise<CommunityPlatformSnapshotV1 | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null
  }

  async compareAndSwap(input: {
    expectedRevision: number | null
    snapshot: CommunityPlatformSnapshotV1
  }): Promise<boolean> {
    if (this.failNext) {
      this.failNext = false
      return false
    }
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

class MemoryReleasePolicy implements CommunityReleasePolicyV1 {
  readonly hosts = new Set<string>()
  readonly owners = new Set<string>()
  readonly reviewers = new Set<string>()

  async canHost(userId: string, releaseHash: string): Promise<boolean> {
    return this.hosts.has(`${userId}:${releaseHash}`)
  }

  async canRegisterOriginal(userId: string, releaseHash: string): Promise<boolean> {
    return this.owners.has(`${userId}:${releaseHash}`)
  }

  async reviewEligibility(userId: string, releaseHash: string) {
    return {
      entitled: this.reviewers.has(`${userId}:${releaseHash}`),
      creator: this.owners.has(`${userId}:${releaseHash}`),
    }
  }

  async isReleaseCreator(userId: string, releaseHash: string) {
    return this.owners.has(`${userId}:${releaseHash}`)
  }
}

const principal = (userId: string, permissions: CommunityPrincipalV1['permissions'] = []): CommunityPrincipalV1 => ({
  userId,
  permissions,
})

async function profile(
  authority: CommunityPlatformAuthorityV1,
  userId: string,
  ageBand: 'adult' | 'minor' | 'unknown' = 'adult',
) {
  return authority.upsertProfile({
    principal: principal(userId), requestId: `profile.${userId}`, handle: userId.replaceAll('.', '-'),
    displayName: userId, bio: '', locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand,
  })
}

describe('COMMUNITY-1 · identity, discovery, LFG, remix and governance authority', () => {
  it('社区资料和关系具有唯一性、幂等冲突检测，并能跨进程恢复', async () => {
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy })
    await profile(authority, 'user.alice')
    await expect(authority.upsertProfile({
      principal: principal('user.bob'), requestId: 'profile.duplicate', handle: 'USER-ALICE',
      displayName: 'Bob', bio: '', locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
    })).rejects.toThrow('handle 已被使用')
    await profile(authority, 'user.bob')

    const followed = await authority.setSocialEdge({
      principal: principal('user.alice'), requestId: 'follow.1', kind: 'follow-creator',
      targetId: 'user.bob', active: true,
    })
    await expect(authority.setSocialEdge({
      principal: principal('user.alice'), requestId: 'follow.1', kind: 'follow-creator',
      targetId: 'user.bob', active: true,
    })).resolves.toEqual(followed)
    await expect(authority.setSocialEdge({
      principal: principal('user.alice'), requestId: 'follow.1', kind: 'follow-creator',
      targetId: 'user.bob', active: false,
    })).rejects.toThrow('requestId 已被不同命令使用')

    const restored = await CommunityPlatformAuthorityV1.restore({ persistence: store, releasePolicy: policy })
    expect(restored.profile('user.alice')).toMatchObject({ handle: 'user-alice', status: 'active' })
    expect(restored.socialEdges('user.alice')).toMatchObject([{ edgeId: followed.edgeId, active: true }])
  })

  it('派生作品必须绑定受控 Release、父版本许可与署名，来源图拒绝自循环', async () => {
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    policy.owners.add(`user.creator:${RELEASE_A}`)
    policy.owners.add(`user.remixer:${RELEASE_B}`)
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy })
    await profile(authority, 'user.creator')
    await profile(authority, 'user.remixer')
    await authority.registerReleaseLineage({
      principal: principal('user.creator'), requestId: 'lineage.original', releaseHash: RELEASE_A,
      parentReleaseHash: null, licenseId: 'license.remix-v1', attribution: ['StoryForge Creator'],
    })
    await expect(authority.registerReleaseLineage({
      principal: principal('user.remixer'), requestId: 'lineage.no-auth', releaseHash: RELEASE_B,
      parentReleaseHash: RELEASE_A, licenseId: 'license.remix-v1', attribution: [],
    })).rejects.toThrow('缺少匹配许可或署名授权')
    const child = await authority.registerReleaseLineage({
      principal: principal('user.remixer'), requestId: 'lineage.child', releaseHash: RELEASE_B,
      parentReleaseHash: RELEASE_A, licenseId: 'license.remix-v1', attribution: ['StoryForge Creator'],
      remixAuthorization: {
        sourceReleaseHash: RELEASE_A, licenseId: 'license.remix-v1', attributionRequired: true,
      },
    })
    expect(child).toMatchObject({ releaseHash: RELEASE_B, parentReleaseHash: RELEASE_A, creatorId: 'user.remixer' })
    expect(authority.lineage(RELEASE_B)?.attribution).toEqual(['StoryForge Creator'])
    await expect(authority.registerReleaseLineage({
      principal: principal('user.creator'), requestId: 'lineage.self', releaseHash: RELEASE_A,
      parentReleaseHash: RELEASE_A, licenseId: 'license.remix-v1', attribution: [],
    })).rejects.toThrow('已登记来源')
  })

  it('LFG 受权益、年龄、席位和候补约束，取消时原子撤回全部有效申请', async () => {
    let now = 1_800_000_000_000
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    policy.hosts.add(`user.host:${RELEASE_A}`)
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy, now: () => now })
    await Promise.all([
      profile(authority, 'user.host'), profile(authority, 'user.adult-1'),
      profile(authority, 'user.adult-2'), profile(authority, 'user.adult-3'),
      profile(authority, 'user.minor', 'minor'),
    ])
    await expect(authority.createLfgPost({
      principal: principal('user.adult-1'), requestId: 'lfg.no-rights', releaseHash: RELEASE_A,
      title: '无权主持', summary: '不应成功', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      startsAt: now + 3_600_000, durationMinutes: 180, playerCapacity: 1, waitlistCapacity: 1,
      audience: 'adult-only', safetyTags: ['X-card'],
    })).rejects.toThrow('有效权益')
    const post = await authority.createLfgPost({
      principal: principal('user.host'), requestId: 'lfg.create', releaseHash: RELEASE_A,
      title: '雾港周末团', summary: '含安全工具的成人悬疑团', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      startsAt: now + 3_600_000, durationMinutes: 180, playerCapacity: 1, waitlistCapacity: 1,
      audience: 'adult-only', safetyTags: ['X-card', 'lines-and-veils'],
    })
    await expect(authority.applyToLfg({
      principal: principal('user.minor'), requestId: 'apply.minor', postId: post.postId,
      characterPreference: '', note: '',
    })).rejects.toThrow('仅面向已确认成年用户')
    const applications = []
    for (const suffix of ['1', '2', '3']) {
      applications.push(await authority.applyToLfg({
        principal: principal(`user.adult-${suffix}`), requestId: `apply.${suffix}`, postId: post.postId,
        characterPreference: '调查员', note: '接受安全工具',
      }))
    }
    await expect(authority.decideLfgApplication({
      principal: principal('user.host'), requestId: 'decide.1', applicationId: applications[0].applicationId,
      decision: 'accept',
    })).resolves.toMatchObject({ status: 'accepted' })
    await expect(authority.decideLfgApplication({
      principal: principal('user.host'), requestId: 'decide.2', applicationId: applications[1].applicationId,
      decision: 'accept',
    })).resolves.toMatchObject({ status: 'waitlisted' })
    await expect(authority.decideLfgApplication({
      principal: principal('user.host'), requestId: 'decide.3', applicationId: applications[2].applicationId,
      decision: 'accept',
    })).rejects.toThrow('候补均已满')
    expect(authority.discoverLfg({ includeFull: false })).toEqual([])
    expect(authority.discoverLfg({ includeFull: true })[0]).toMatchObject({ accepted: 1, waitlisted: 1, availableSeats: 0 })

    await authority.markLfgAttendance({
      principal: principal('user.host'), requestId: 'attendance.absent',
      applicationId: applications[0].applicationId, status: 'no-show',
    })
    const promoted = await authority.promoteLfgWaitlist({
      principal: principal('user.host'), requestId: 'waitlist.promote',
      absentApplicationId: applications[0].applicationId,
      replacementApplicationId: applications[1].applicationId,
    })
    expect(promoted).toMatchObject({
      absent: { status: 'withdrawn' }, replacement: { status: 'accepted' },
      attendance: { status: 'replaced', replacementApplicationId: applications[1].applicationId },
    })
    expect(authority.attendanceForPost({ principal: principal('user.host'), postId: post.postId })).toHaveLength(1)

    await authority.closeLfgPost({
      principal: principal('user.host'), requestId: 'lfg.cancel', postId: post.postId, status: 'cancelled',
    })
    expect(authority.applicationsForPost({ principal: principal('user.host'), postId: post.postId })
      .map(row => row.status)).toEqual(['withdrawn', 'withdrawn', 'withdrawn'])
    now += 4_000_000
    expect(authority.discoverLfg({ includeFull: true })).toEqual([])
  })

  it('举报裁决会冻结主体，冻结账号仍可申诉；独立复核撤销后恢复且审计不泄露正文', async () => {
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy })
    await profile(authority, 'user.reporter')
    await profile(authority, 'user.subject')
    const secretDetails = '仅治理人员可见的举报正文 934882'
    const report = await authority.createReport({
      principal: principal('user.reporter'), requestId: 'report.1', subjectType: 'profile',
      subjectId: 'user.subject', category: 'harassment', details: secretDetails,
    })
    await authority.decideReport({
      principal: principal('user.moderator', ['community:moderate']), requestId: 'report.decide',
      reportId: report.reportId, action: 'suspend', reasonCode: 'safety.harassment',
    })
    expect(authority.profile('user.subject')?.status).toBe('suspended')
    expect(authority.reportsForPrincipal({ principal: principal('user.reporter') })).toMatchObject([{
      relation: 'reporter', reportId: report.reportId, details: secretDetails,
    }])
    expect(authority.reportsForPrincipal({ principal: principal('user.subject') })).toMatchObject([{
      relation: 'subject', reportId: report.reportId, details: null, action: 'suspend', reasonCode: 'safety.harassment',
    }])
    expect(() => authority.setSocialEdge({
      principal: principal('user.subject'), requestId: 'suspended.follow', kind: 'follow-creator',
      targetId: 'user.reporter', active: true,
    })).toThrow('冻结状态')
    const appeal = await authority.appealReport({
      principal: principal('user.subject'), requestId: 'appeal.1', reportId: report.reportId,
      statement: '请求独立复核上下文。',
    })
    expect(authority.appealsForPrincipal({ principal: principal('user.subject') })).toMatchObject([{
      appealId: appeal.appealId, status: 'open',
    }])
    await authority.resolveAppeal({
      principal: principal('user.reviewer', ['community:appeal-review']), requestId: 'appeal.resolve',
      appealId: appeal.appealId, decision: 'reverse',
    })
    expect(authority.profile('user.subject')?.status).toBe('active')
    await expect(authority.setSocialEdge({
      principal: principal('user.subject'), requestId: 'restored.follow', kind: 'follow-creator',
      targetId: 'user.reporter', active: true,
    })).resolves.toMatchObject({ active: true })
    expect(JSON.stringify(authority.auditLog())).not.toContain(secretDetails)
  })

  it('发行评价只接受已验证买家且每人一条，治理移除可由作者申诉并恢复', async () => {
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    policy.owners.add(`user.creator:${RELEASE_A}`)
    policy.reviewers.add(`user.creator:${RELEASE_A}`)
    policy.reviewers.add(`user.buyer:${RELEASE_A}`)
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy })
    await Promise.all([profile(authority, 'user.creator'), profile(authority, 'user.buyer'), profile(authority, 'user.reporter')])
    await expect(authority.upsertReview({
      principal: principal('user.creator'), requestId: 'review.self', subjectType: 'release', releaseHash: RELEASE_A,
      postId: null, rating: 5, title: '自评', body: '不应允许', tags: [], containsSpoilers: false,
    })).rejects.toThrow('创作者不能评价')
    const first = await authority.upsertReview({
      principal: principal('user.buyer'), requestId: 'review.create', subjectType: 'release', releaseHash: RELEASE_A,
      postId: null, rating: 4, title: '规则扎实', body: '内容完整，规则索引清楚。', tags: ['规则清楚'], containsSpoilers: false,
    })
    const updated = await authority.upsertReview({
      principal: principal('user.buyer'), requestId: 'review.update', subjectType: 'release', releaseHash: RELEASE_A,
      postId: null, rating: 5, title: '长期体验更好', body: '二次开团后确认回放也稳定。', tags: ['规则清楚', '可回放'], containsSpoilers: false,
    })
    expect(updated.reviewId).toBe(first.reviewId)
    expect(authority.reviewsFor({ subjectType: 'release', releaseHash: RELEASE_A })).toMatchObject({
      aggregate: { count: 1, average: 5, histogram: { '5': 1 } },
      reviews: [{ verification: 'entitlement', rating: 5 }],
    })
    await expect(authority.reviewCapabilities({
      principal: principal('user.creator'), subjectType: 'release', releaseHash: RELEASE_A,
    })).resolves.toEqual({ ownReviewId: null, respondableReviewIds: [first.reviewId] })
    await authority.respondToReview({
      principal: principal('user.creator'), requestId: 'review.response', reviewId: first.reviewId,
      response: '感谢反馈，已把规则索引加入下一版。',
    })
    expect(authority.reviewsFor({ subjectType: 'release', releaseHash: RELEASE_A }).reviews[0].creatorResponse)
      .toContain('规则索引')
    const report = await authority.createReport({
      principal: principal('user.reporter'), requestId: 'review.report', subjectType: 'review',
      subjectId: first.reviewId, category: 'other', details: '申请治理复核。',
    })
    await authority.decideReport({
      principal: principal('user.moderator', ['community:moderate']), requestId: 'review.remove',
      reportId: report.reportId, action: 'remove', reasonCode: 'review.policy',
    })
    expect(authority.reviewsFor({ subjectType: 'release', releaseHash: RELEASE_A }).aggregate.count).toBe(0)
    const appeal = await authority.appealReport({
      principal: principal('user.buyer'), requestId: 'review.appeal', reportId: report.reportId,
      statement: '请求独立复核评价上下文。',
    })
    await authority.resolveAppeal({
      principal: principal('user.reviewer', ['community:appeal-review']), requestId: 'review.appeal.resolve',
      appealId: appeal.appealId, decision: 'reverse',
    })
    expect(authority.reviewsFor({ subjectType: 'release', releaseHash: RELEASE_A }).aggregate.count).toBe(1)
    const restored = await CommunityPlatformAuthorityV1.restore({ persistence: store, releasePolicy: policy })
    expect(restored.reviewsFor({ subjectType: 'release', releaseHash: RELEASE_A }).reviews[0].rating).toBe(5)
  })

  it('实际参团评价只接受已确认出席且正常结束的对应场次', async () => {
    let now = 1_900_000_000_000
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    policy.hosts.add(`user.host:${RELEASE_A}`)
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy, now: () => now })
    await Promise.all([profile(authority, 'user.host'), profile(authority, 'user.player'), profile(authority, 'user.other')])
    const post = await authority.createLfgPost({
      principal: principal('user.host'), requestId: 'actual.create', releaseHash: RELEASE_A,
      title: '实际体验团', summary: '完成后验证评价', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      startsAt: now + 1_000, durationMinutes: 120, playerCapacity: 2, waitlistCapacity: 0,
      audience: 'all-ages', safetyTags: ['X-card'],
    })
    const application = await authority.applyToLfg({
      principal: principal('user.player'), requestId: 'actual.apply', postId: post.postId,
      characterPreference: '调查员', note: '',
    })
    await authority.decideLfgApplication({
      principal: principal('user.host'), requestId: 'actual.accept', applicationId: application.applicationId, decision: 'accept',
    })
    await authority.markLfgAttendance({
      principal: principal('user.host'), requestId: 'actual.attendance', applicationId: application.applicationId, status: 'confirmed',
    })
    await authority.closeLfgPost({
      principal: principal('user.host'), requestId: 'actual.close', postId: post.postId, status: 'closed',
    })
    await expect(authority.upsertReview({
      principal: principal('user.player'), requestId: 'actual.too-early', subjectType: 'actual-play',
      releaseHash: RELEASE_A, postId: post.postId, rating: 5, title: '过早', body: '尚未开场', tags: [], containsSpoilers: false,
    })).rejects.toThrow('场次尚未正常结束')
    now += 2_000
    await expect(authority.upsertReview({
      principal: principal('user.other'), requestId: 'actual.not-attended', subjectType: 'actual-play',
      releaseHash: RELEASE_A, postId: post.postId, rating: 5, title: '未参团', body: '不应允许', tags: [], containsSpoilers: false,
    })).rejects.toThrow('已验证出席')
    await expect(authority.upsertReview({
      principal: principal('user.player'), requestId: 'actual.review', subjectType: 'actual-play',
      releaseHash: RELEASE_A, postId: post.postId, rating: 5, title: '安全且流畅',
      body: '主持清晰，安全工具有效。', tags: ['安全工具'], containsSpoilers: false,
    })).resolves.toMatchObject({ verification: 'attendance', subjectType: 'actual-play' })
    expect(authority.reviewsFor({ subjectType: 'actual-play', releaseHash: RELEASE_A, postId: post.postId }).aggregate)
      .toMatchObject({ count: 1, average: 5 })
  })

  it('快照篡改 fail-closed，CAS 冲突回滚本地状态且同一请求可以安全重试', async () => {
    const store = new MemoryCommunityStore()
    const policy = new MemoryReleasePolicy()
    const authority = await CommunityPlatformAuthorityV1.create({ persistence: store, releasePolicy: policy })
    await profile(authority, 'user.alice')
    await profile(authority, 'user.bob')
    store.failNext = true
    await expect(authority.setSocialEdge({
      principal: principal('user.alice'), requestId: 'follow.rollback', kind: 'follow-creator',
      targetId: 'user.bob', active: true,
    })).rejects.toThrow('持久化版本冲突')
    expect(authority.socialEdges('user.alice')).toEqual([])
    await expect(authority.setSocialEdge({
      principal: principal('user.alice'), requestId: 'follow.rollback', kind: 'follow-creator',
      targetId: 'user.bob', active: true,
    })).resolves.toMatchObject({ active: true })

    store.snapshot!.profiles[0].status = 'suspended'
    await expect(CommunityPlatformAuthorityV1.restore({ persistence: store, releasePolicy: policy }))
      .rejects.toThrow('完整性校验失败')
  })
})
