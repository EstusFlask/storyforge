import { describe, expect, it } from 'vitest'
import {
  CommercialPlatformAuthorityV1,
  type CommercialLicenseV1,
  type CommercialPlatformPersistenceV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import {
  signCommercialWebhookV1,
  verifyCommercialWebhookV1,
  type CommercialPaymentEventV1,
} from '../../src/lib/commercial/webhook'

const SECRET = 'test-secret-at-least-16-characters'
const RELEASE = 'a'.repeat(64)

class MemoryCommercialStore implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  failNext = false

  async load(): Promise<CommercialPlatformSnapshotV1 | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null
  }

  async compareAndSwap(input: {
    expectedRevision: number | null
    snapshot: CommercialPlatformSnapshotV1
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

const creator: CommercialPrincipalV1 = { userId: 'user.creator', permissions: [] }
const buyer: CommercialPrincipalV1 = { userId: 'user.buyer', permissions: [] }
const reviewer: CommercialPrincipalV1 = { userId: 'user.reviewer', permissions: ['catalog:publish'] }
const moderator: CommercialPrincipalV1 = { userId: 'user.moderator', permissions: ['catalog:moderate'] }

function license(overrides: Partial<CommercialLicenseV1> = {}): CommercialLicenseV1 {
  return {
    licenseId: 'storyforge.remix', licenseVersion: '1.0.0',
    allowOfflineExport: true, allowRemix: true, commercialReuse: false,
    requiresAttribution: true, termsUrl: 'https://storyforge.test/licenses/remix-1',
    ...overrides,
  }
}

async function publishedListing(input: {
  authority: CommercialPlatformAuthorityV1
  amountMinor?: number
  releaseHash?: string
}) {
  const listing = await input.authority.createListing({
    principal: creator, requestId: `create.${input.releaseHash ?? RELEASE}`,
    releaseHash: input.releaseHash ?? RELEASE, productType: 'ttrpg',
    title: '雾港跑团战役', summary: '一套冻结来源、规则和许可的正式战役。',
    contentWarnings: ['悬疑', '轻度危险'], license: license(), currency: 'CNY',
    amountMinor: input.amountMinor ?? 2_900, creatorShareBps: 8_000,
  })
  await input.authority.submitListing({
    principal: creator, requestId: `submit.${listing.listingId}`,
    listingId: listing.listingId, rightsConfirmed: true,
  })
  return input.authority.publishListing({
    principal: reviewer, requestId: `publish.${listing.listingId}`,
    listingId: listing.listingId, rightsConfirmed: true,
  })
}

async function paymentEvent(input: {
  orderId: string
  eventId: string
  type: CommercialPaymentEventV1['type']
  amountMinor?: number
  now: number
}) {
  const event: CommercialPaymentEventV1 = {
    schema: 'storyforge.payment-event', version: 1,
    eventId: input.eventId, type: input.type, orderId: input.orderId,
    providerReference: 'provider.checkout.1', currency: 'CNY',
    amountMinor: input.amountMinor ?? 2_900, occurredAt: input.now,
  }
  const rawBody = JSON.stringify(event)
  const signatureHeader = await signCommercialWebhookV1({ rawBody, secret: SECRET, timestamp: input.now })
  return verifyCommercialWebhookV1({ rawBody, signatureHeader, secret: SECRET, now: input.now })
}

describe('COMMERCIAL-1 · catalog, payment, entitlement and refund authority', () => {
  it('目录先审权再公开；付费前无权益，签名回执后原子授予权益并生成平衡账本', async () => {
    let now = 1_800_000_000_000
    const store = new MemoryCommercialStore()
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: store, now: () => now })
    const draft = await authority.createListing({
      principal: creator, requestId: 'listing.create.1', releaseHash: RELEASE, productType: 'ttrpg',
      title: '雾港跑团战役', summary: '正式战役', contentWarnings: ['悬疑'], license: license(),
      currency: 'CNY', amountMinor: 2_900, creatorShareBps: 8_000,
    })
    expect(authority.discover({})).toEqual([])
    await expect(authority.submitListing({
      principal: creator, requestId: 'listing.submit.invalid', listingId: draft.listingId, rightsConfirmed: false,
    })).rejects.toThrow('必须确认权利')
    await authority.submitListing({
      principal: creator, requestId: 'listing.submit.1', listingId: draft.listingId, rightsConfirmed: true,
    })
    expect(authority.listingsForCreator({ principal: creator })).toMatchObject([{ status: 'submitted' }])
    expect(authority.listingReviewQueue({ principal: reviewer })).toMatchObject([{ listingId: draft.listingId }])
    expect(() => authority.listingReviewQueue({ principal: creator })).toThrow('缺少权限')
    await authority.requestListingChanges({
      principal: reviewer, requestId: 'listing.changes.1', listingId: draft.listingId,
      reasonCode: 'catalog.summary-required',
    })
    expect(authority.listingsForCreator({ principal: creator })).toMatchObject([{
      status: 'changes-requested', reviewReasonCode: 'catalog.summary-required', rightsConfirmed: false,
    }])
    await expect(authority.submitListing({
      principal: creator, requestId: 'listing.resubmit.too-early', listingId: draft.listingId, rightsConfirmed: true,
    })).rejects.toThrow('只有草稿')
    await authority.reviseListing({
      principal: creator, requestId: 'listing.revise.1', listingId: draft.listingId,
      releaseHash: RELEASE, title: '雾港跑团战役·修订版', summary: '补全审核摘要',
      contentWarnings: ['悬疑'], license: license(), currency: 'CNY', amountMinor: 2_900,
      creatorShareBps: 8_000,
    })
    await authority.submitListing({
      principal: creator, requestId: 'listing.resubmit.1', listingId: draft.listingId, rightsConfirmed: true,
    })
    await expect(authority.publishListing({
      principal: reviewer, requestId: 'listing.publish.invalid', listingId: draft.listingId, rightsConfirmed: false,
    })).rejects.toThrow('必须确认权利')
    const published = await authority.publishListing({
      principal: reviewer, requestId: 'listing.publish.1', listingId: draft.listingId, rightsConfirmed: true,
    })
    expect(authority.discover({ query: '雾港' })).toMatchObject([{ listingId: published.listingId, status: 'published' }])

    const acquisition = await authority.beginAcquisition({
      principal: buyer, requestId: 'acquire.1', listingId: published.listingId,
    })
    expect(acquisition).toMatchObject({ order: { status: 'pending', amountMinor: 2_900 }, entitlement: null })
    expect(authority.entitlementFor({ principal: buyer, releaseHash: RELEASE })).toBeNull()
    await expect(authority.beginAcquisition({
      principal: buyer, requestId: 'acquire.2', listingId: published.listingId,
    })).rejects.toThrow('待支付订单')

    now += 1_000
    const verified = await paymentEvent({
      orderId: acquisition.order.orderId, eventId: 'event.paid.1', type: 'payment.succeeded', now,
    })
    const paid = await authority.applyPaymentEvent({ event: verified })
    expect(paid).toMatchObject({ order: { status: 'paid' }, entitlement: { status: 'active', hostedAccess: true }, duplicate: false })
    expect(authority.authorizeRemix({ principal: buyer, releaseHash: RELEASE })).toMatchObject({
      sourceReleaseHash: RELEASE, attributionRequired: true,
    })
    const ledger = authority.ledgerForOrder(acquisition.order.orderId)
    expect(ledger).toMatchObject([
      { account: 'cash', direction: 'debit', amountMinor: 2_900, reason: 'sale' },
      { account: 'creator-payable', direction: 'credit', amountMinor: 2_320, reason: 'sale' },
      { account: 'platform-revenue', direction: 'credit', amountMinor: 580, reason: 'sale' },
    ])
    const debit = ledger.filter(entry => entry.direction === 'debit').reduce((sum, entry) => sum + entry.amountMinor, 0)
    const credit = ledger.filter(entry => entry.direction === 'credit').reduce((sum, entry) => sum + entry.amountMinor, 0)
    expect(debit).toBe(credit)
    expect(JSON.stringify(authority.auditLog())).not.toContain(SECRET)
    expect(JSON.stringify(authority.auditLog())).not.toContain('provider.checkout.1')
  })

  it('进程重启保留幂等回执；重复支付不重复记账，退款撤销托管访问但不删除合法本地副本', async () => {
    let now = 1_800_000_100_000
    const store = new MemoryCommercialStore()
    const first = await CommercialPlatformAuthorityV1.create({ persistence: store, now: () => now })
    const listing = await publishedListing({ authority: first })
    const acquired = await first.beginAcquisition({ principal: buyer, requestId: 'buy.durable', listingId: listing.listingId })
    const paidEvent = await paymentEvent({
      orderId: acquired.order.orderId, eventId: 'event.durable.paid', type: 'payment.succeeded', now,
    })
    await first.applyPaymentEvent({ event: paidEvent })

    const restored = await CommercialPlatformAuthorityV1.restore({ persistence: store, now: () => now })
    const duplicate = await restored.applyPaymentEvent({ event: paidEvent })
    expect(duplicate.duplicate).toBe(true)
    expect(restored.ledgerForOrder(acquired.order.orderId)).toHaveLength(3)

    now += 1_000
    const refundEvent = await paymentEvent({
      orderId: acquired.order.orderId, eventId: 'event.durable.refund', type: 'refund.succeeded', now,
    })
    const refunded = await restored.applyPaymentEvent({ event: refundEvent })
    expect(refunded).toMatchObject({
      order: { status: 'refunded' },
      entitlement: { status: 'refunded', hostedAccess: false, localCopyPreserved: true },
    })
    expect(() => restored.authorizeRemix({ principal: buyer, releaseHash: RELEASE })).toThrow('有效权益')
    const ledger = restored.ledgerForOrder(acquired.order.orderId)
    expect(ledger).toHaveLength(6)
    const debits = ledger.filter(entry => entry.direction === 'debit').reduce((sum, entry) => sum + entry.amountMinor, 0)
    const credits = ledger.filter(entry => entry.direction === 'credit').reduce((sum, entry) => sum + entry.amountMinor, 0)
    expect(debits).toBe(credits)
  })

  it('免费领取也产生 Release 绑定权益；治理下架停止发现和托管，但保留离线副本权利', async () => {
    const store = new MemoryCommercialStore()
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: store })
    const freeRelease = 'b'.repeat(64)
    const listing = await publishedListing({ authority, amountMinor: 0, releaseHash: freeRelease })
    const acquired = await authority.beginAcquisition({ principal: buyer, requestId: 'claim.free', listingId: listing.listingId })
    expect(acquired).toMatchObject({
      order: { status: 'paid', providerReference: 'free' },
      entitlement: { releaseHash: freeRelease, status: 'active', hostedAccess: true },
    })
    await authority.suspendListing({
      principal: moderator, requestId: 'moderate.1', listingId: listing.listingId, reasonCode: 'rights.review',
    })
    expect(authority.discover({})).toEqual([])
    expect(authority.entitlementFor({ principal: buyer, releaseHash: freeRelease })).toMatchObject({
      status: 'moderation-hold', hostedAccess: false, localCopyPreserved: true,
    })
    expect(() => authority.authorizeRemix({ principal: buyer, releaseHash: freeRelease })).toThrow('有效权益')
  })

  it('伪造、过期、金额不符和冲突 eventId 全部 fail-closed，持久化冲突回滚本地状态', async () => {
    const now = 1_800_000_200_000
    const rawEvent: CommercialPaymentEventV1 = {
      schema: 'storyforge.payment-event', version: 1, eventId: 'event.security.1',
      type: 'payment.succeeded', orderId: 'order.missing', providerReference: 'provider.1',
      currency: 'CNY', amountMinor: 2_900, occurredAt: now,
    }
    const rawBody = JSON.stringify(rawEvent)
    const signature = await signCommercialWebhookV1({ rawBody, secret: SECRET, timestamp: now })
    await expect(verifyCommercialWebhookV1({
      rawBody: `${rawBody} `, signatureHeader: signature, secret: SECRET, now,
    })).rejects.toThrow('签名无效')
    await expect(verifyCommercialWebhookV1({
      rawBody, signatureHeader: signature, secret: SECRET, now: now + 600_000,
    })).rejects.toThrow('超出时间容差')

    const store = new MemoryCommercialStore()
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: store, now: () => now })
    const listing = await publishedListing({ authority })
    const acquisition = await authority.beginAcquisition({ principal: buyer, requestId: 'security.buy', listingId: listing.listingId })
    const mismatch = await paymentEvent({
      orderId: acquisition.order.orderId, eventId: 'event.mismatch', type: 'payment.succeeded', amountMinor: 1, now,
    })
    await expect(authority.applyPaymentEvent({ event: mismatch })).rejects.toThrow('金额或币种')
    expect(authority.entitlementFor({ principal: buyer, releaseHash: RELEASE })).toBeNull()

    store.failNext = true
    const valid = await paymentEvent({
      orderId: acquisition.order.orderId, eventId: 'event.rollback', type: 'payment.succeeded', now,
    })
    await expect(authority.applyPaymentEvent({ event: valid })).rejects.toThrow('持久化版本冲突')
    expect(authority.entitlementFor({ principal: buyer, releaseHash: RELEASE })).toBeNull()
    await expect(authority.applyPaymentEvent({ event: valid })).resolves.toMatchObject({ order: { status: 'paid' } })

    const conflict = { ...valid, type: 'refund.succeeded' as const }
    await expect(authority.applyPaymentEvent({ event: conflict })).rejects.toThrow('eventId 已被不同事件使用')
    expect(authority.ledgerForOrder(acquisition.order.orderId)).toHaveLength(3)
  })

  it('篡改快照即使只改一个订单状态也无法恢复', async () => {
    const store = new MemoryCommercialStore()
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: store })
    const listing = await publishedListing({ authority })
    await authority.beginAcquisition({ principal: buyer, requestId: 'snapshot.buy', listingId: listing.listingId })
    store.snapshot!.orders[0].status = 'paid'
    await expect(CommercialPlatformAuthorityV1.restore({ persistence: store })).rejects.toThrow('完整性校验失败')
  })
})
