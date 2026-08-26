import { describe, expect, it } from 'vitest'
import {
  CommercialPlatformAuthorityV1,
  type CommercialPlatformPersistenceV1,
  type CommercialPlatformSnapshotV1,
} from '../../src/lib/commercial/authority'
import {
  CommunityPlatformAuthorityV1,
  type CommunityPlatformPersistenceV1,
  type CommunityPlatformSnapshotV1,
} from '../../src/lib/community/authority'
import { CommercialCommunityReleasePolicyV1 } from '../../src/lib/community/commercial-release-policy'

const SOURCE = 'c'.repeat(64)
const REMIX = 'd'.repeat(64)

class Store<T extends { revision: number }> {
  snapshot: T | null = null
  async load(): Promise<T | null> { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: T }): Promise<boolean> {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const creator = { userId: 'user.creator', permissions: [] }
const player = { userId: 'user.player', permissions: [] }
const publisher = { userId: 'user.publisher', permissions: ['catalog:publish' as const] }

async function makeProfile(authority: CommunityPlatformAuthorityV1, userId: string) {
  return authority.upsertProfile({
    principal: { userId, permissions: [] }, requestId: `profile.${userId}`,
    handle: userId.replace('.', '-'), displayName: userId, bio: '', locale: 'zh-CN',
    timeZone: 'Asia/Shanghai', ageBand: 'adult',
  })
}

describe('PLATFORM-1C · commercial and community ownership boundary', () => {
  it('两个账号完成发布、发现、免费领取、主持授权、fork 与再发布来源登记', async () => {
    const commercialStore = new Store<CommercialPlatformSnapshotV1>() as CommercialPlatformPersistenceV1 & Store<CommercialPlatformSnapshotV1>
    const communityStore = new Store<CommunityPlatformSnapshotV1>() as CommunityPlatformPersistenceV1 & Store<CommunityPlatformSnapshotV1>
    const commercial = await CommercialPlatformAuthorityV1.create({ persistence: commercialStore })
    const community = await CommunityPlatformAuthorityV1.create({
      persistence: communityStore,
      releasePolicy: new CommercialCommunityReleasePolicyV1(commercial),
    })
    await makeProfile(community, creator.userId)
    await makeProfile(community, player.userId)

    const sourceDraft = await commercial.createListing({
      principal: creator, requestId: 'source.create', releaseHash: SOURCE, productType: 'ttrpg',
      title: '雾港调查团', summary: '允许署名派生的正式战役', contentWarnings: ['悬疑'],
      license: {
        licenseId: 'license.remix-v1', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: true, commercialReuse: false, requiresAttribution: true,
        termsUrl: 'https://storyforge.test/licenses/remix-v1',
      },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
    })
    await commercial.submitListing({
      principal: creator, requestId: 'source.submit', listingId: sourceDraft.listingId, rightsConfirmed: true,
    })
    const source = await commercial.publishListing({
      principal: publisher, requestId: 'source.publish', listingId: sourceDraft.listingId, rightsConfirmed: true,
    })
    expect(commercial.discover({ query: '雾港' })).toMatchObject([{ releaseHash: SOURCE }])
    await community.registerReleaseLineage({
      principal: { userId: creator.userId, permissions: [] }, requestId: 'source.lineage',
      releaseHash: SOURCE, licenseId: source.license.licenseId, attribution: ['Original Creator'],
    })

    await expect(community.createLfgPost({
      principal: { userId: player.userId, permissions: [] }, requestId: 'lfg.before-entitlement',
      releaseHash: SOURCE, title: '尚未领取', summary: '不允许主持', locale: 'zh-CN',
      timeZone: 'Asia/Shanghai', startsAt: Date.now() + 3_600_000, durationMinutes: 120,
      playerCapacity: 4, waitlistCapacity: 2, audience: 'all-ages', safetyTags: ['X-card'],
    })).rejects.toThrow('有效权益')
    const claim = await commercial.beginAcquisition({ principal: player, requestId: 'source.claim', listingId: source.listingId })
    expect(claim.entitlement).toMatchObject({ hostedAccess: true, releaseHash: SOURCE })
    const lfg = await community.createLfgPost({
      principal: { userId: player.userId, permissions: [] }, requestId: 'lfg.after-entitlement',
      releaseHash: SOURCE, title: '玩家主持团', summary: '已验证权益', locale: 'zh-CN',
      timeZone: 'Asia/Shanghai', startsAt: Date.now() + 3_600_000, durationMinutes: 120,
      playerCapacity: 4, waitlistCapacity: 2, audience: 'all-ages', safetyTags: ['X-card'],
    })
    expect(community.discoverLfg({ releaseHash: SOURCE })).toMatchObject([{ post: { postId: lfg.postId } }])

    const remixAuthorization = commercial.authorizeRemix({ principal: player, releaseHash: SOURCE })
    const remixDraft = await commercial.createListing({
      principal: player, requestId: 'remix.create', releaseHash: REMIX, productType: 'ttrpg',
      title: '雾港：另一条航线', summary: '合规派生战役', contentWarnings: ['悬疑'],
      license: remixAuthorization.license, currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
    })
    await community.registerReleaseLineage({
      principal: { userId: player.userId, permissions: [] }, requestId: 'remix.lineage',
      releaseHash: REMIX, parentReleaseHash: SOURCE,
      licenseId: remixAuthorization.license.licenseId, attribution: ['Original Creator'],
      remixAuthorization: {
        sourceReleaseHash: remixAuthorization.sourceReleaseHash,
        licenseId: remixAuthorization.license.licenseId,
        attributionRequired: remixAuthorization.attributionRequired,
      },
    })
    await commercial.submitListing({
      principal: player, requestId: 'remix.submit', listingId: remixDraft.listingId, rightsConfirmed: true,
    })
    await commercial.publishListing({
      principal: publisher, requestId: 'remix.publish', listingId: remixDraft.listingId, rightsConfirmed: true,
    })
    expect(commercial.discover({ query: '另一条航线' })).toMatchObject([{ releaseHash: REMIX, creatorId: player.userId }])
    expect(community.lineage(REMIX)).toMatchObject({ parentReleaseHash: SOURCE, creatorId: player.userId })
  })
})
