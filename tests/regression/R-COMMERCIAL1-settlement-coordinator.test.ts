import { describe, expect, it } from 'vitest'
import { CommercialPlatformAuthorityV1, type CommercialPlatformPersistenceV1, type CommercialPlatformSnapshotV1, type CommercialPrincipalV1 } from '../../src/lib/commercial/authority'
import { CommercialOperationsAuthorityV1, type CommercialOperationsPersistenceV1, type CommercialOperationsSnapshotV1, type CommercialTaxQuoteV1 } from '../../src/lib/commercial/operations-authority'
import { createCommercialGatewayV1 } from '../../src/lib/commercial/gateway'
import { createCommercialSettlementCoordinatorV1 } from '../../src/lib/commercial/settlement-coordinator'
import { signCommercialWebhookV1, type CommercialPaymentEventV1 } from '../../src/lib/commercial/webhook'

class CommercialStore implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) { if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false; this.snapshot = structuredClone(input.snapshot); return true }
}
class OperationsStore implements CommercialOperationsPersistenceV1 {
  snapshot: CommercialOperationsSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialOperationsSnapshotV1 }) { if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false; this.snapshot = structuredClone(input.snapshot); return true }
}

describe('COMMERCIAL-1 · payment to tax and creator settlement compensation', () => {
  it('下单冻结含税报价，签名支付幂等生成发票与创作者余额，退款再冲销', async () => {
    const now = 1_803_000_000_000
    const secret = 'settlement-secret-at-least-16'
    const creator: CommercialPrincipalV1 = { userId: 'user.creator', permissions: [] }
    const buyer: CommercialPrincipalV1 = { userId: 'user.buyer', permissions: [] }
    const publisher: CommercialPrincipalV1 = { userId: 'ops.publisher', permissions: ['catalog:publish'] }
    const finance: CommercialPrincipalV1 = { userId: 'ops.finance', permissions: ['commerce:finance'] }
    const commercial = await CommercialPlatformAuthorityV1.create({ persistence: new CommercialStore(), now: () => now })
    const operations = await CommercialOperationsAuthorityV1.create({ persistence: new OperationsStore(), now: () => now })
    await operations.upsertTaxRule({ principal: finance, requestId: 'tax.cn', ruleId: 'tax.cn.cny', jurisdiction: 'CN', buyerRegion: 'CN', currency: 'CNY', rateBps: 600, priceIncludesTax: true, effectiveFrom: now - 1 })
    const draft = await commercial.createListing({ principal: creator, requestId: 'listing', releaseHash: 'b'.repeat(64), productType: 'ttrpg', title: '含税战役', summary: '结算闭环', contentWarnings: [], license: { licenseId: 'standard', licenseVersion: '1', allowOfflineExport: true, allowRemix: false, commercialReuse: false, requiresAttribution: false, termsUrl: 'https://storyforge.test/license' }, currency: 'CNY', amountMinor: 10_600, creatorShareBps: 8_000 })
    await commercial.submitListing({ principal: creator, requestId: 'submit', listingId: draft.listingId, rightsConfirmed: true })
    await commercial.publishListing({ principal: publisher, requestId: 'publish', listingId: draft.listingId, rightsConfirmed: true })
    const quotes = new Map<string, CommercialTaxQuoteV1>()
    const paymentSettlement = createCommercialSettlementCoordinatorV1({
      operations, financePrincipal: finance,
      taxQuotes: {
        prepareForOrder: async ({ order }) => { const quote = await operations.quoteTax({ buyerRegion: 'CN', currency: order.currency, listedAmountMinor: order.amountMinor }); quotes.set(order.orderId, quote); return quote },
        quoteForOrder: async order => quotes.get(order.orderId) ?? null,
      },
    })
    const gateway = createCommercialGatewayV1({
      authority: commercial, webhookSecret: secret, now: () => now, paymentSettlement,
      identity: { authenticate: async token => token === 'buyer-access-token-1234' ? buyer : null },
      releaseDelivery: { hasVerifiedRelease: async () => true },
      checkoutProvider: { createOrResumeSession: async order => ({ checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId, checkoutUrl: 'https://pay.storyforge.test/checkout', expiresAt: now + 60_000 }) },
    })
    const acquired = await gateway({ method: 'POST', path: '/v1/commercial/acquisitions', contentType: 'application/json', headers: { authorization: 'Bearer buyer-access-token-1234' }, body: { requestId: 'acquire', listingId: draft.listingId } })
    const orderId = (acquired.body as { order: { orderId: string } }).order.orderId
    expect(quotes.get(orderId)).toMatchObject({ subtotalMinor: 10_000, taxMinor: 600, totalMinor: 10_600 })
    const webhook = async (event: CommercialPaymentEventV1) => {
      const rawBody = JSON.stringify(event)
      const signature = await signCommercialWebhookV1({ rawBody, secret, timestamp: now })
      return gateway({ method: 'POST', path: '/v1/commercial/payment-webhook', contentType: 'application/json', headers: { 'x-storyforge-signature': signature }, body: event, rawBody })
    }
    const paid: CommercialPaymentEventV1 = { schema: 'storyforge.payment-event', version: 1, eventId: 'event.paid', type: 'payment.succeeded', orderId, providerReference: 'provider.1', currency: 'CNY', amountMinor: 10_600, occurredAt: now }
    await expect(webhook(paid)).resolves.toMatchObject({ status: 200, body: { order: { status: 'paid' } } })
    await expect(webhook(paid)).resolves.toMatchObject({ status: 200, body: { duplicate: true } })
    expect(operations.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(8_480)
    expect(operations.auditLog().filter(row => row.kind === 'order.settled')).toHaveLength(1)
    const refunded: CommercialPaymentEventV1 = { ...paid, eventId: 'event.refund', type: 'refund.succeeded' }
    await expect(webhook(refunded)).resolves.toMatchObject({ status: 200, body: { order: { status: 'refunded' } } })
    expect(operations.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(0)
  })

  it('拒绝未含税或总额变化的报价，支付页不会在税务冻结失败时创建', async () => {
    const operations = await CommercialOperationsAuthorityV1.create({ persistence: new OperationsStore() })
    const finance: CommercialPrincipalV1 = { userId: 'ops.finance', permissions: ['commerce:finance'] }
    const settlement = createCommercialSettlementCoordinatorV1({ operations, financePrincipal: finance, taxQuotes: {
      prepareForOrder: async () => ({ quoteId: 'q', ruleId: 'r', jurisdiction: 'CN', buyerRegion: 'CN', currency: 'CNY', listedAmountMinor: 100, subtotalMinor: 100, taxMinor: 6, totalMinor: 106, priceIncludesTax: false, quotedAt: 1, expiresAt: 2, quoteHash: 'a'.repeat(64) }),
      quoteForOrder: async () => null,
    } })
    await expect(settlement.prepare({ buyer: { userId: 'u', permissions: [] }, order: { orderId: 'o', listingId: 'l', releaseHash: 'a'.repeat(64), buyerId: 'u', creatorId: 'c', currency: 'CNY', amountMinor: 100, creatorShareMinor: 80, platformShareMinor: 20, status: 'pending', providerReference: null, createdAt: 1, updatedAt: 1 } })).rejects.toThrow('总额必须等于')
  })
})
