import { describe, expect, it } from 'vitest'
import {
  CommercialPlatformAuthorityV1,
  type CommercialPlatformPersistenceV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import { createCommercialGatewayV1, type CommercialGatewayAuditV1 } from '../../src/lib/commercial/gateway'
import { signCommercialWebhookV1, type CommercialPaymentEventV1 } from '../../src/lib/commercial/webhook'

const SECRET = 'gateway-secret-at-least-16-characters'
const RELEASE = '9'.repeat(64)

class Store implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const tokens = new Map<string, CommercialPrincipalV1>([
  ['token-creator-123456789', { userId: 'user.creator', permissions: [] }],
  ['token-publisher-12345678', { userId: 'user.publisher', permissions: ['catalog:publish'] }],
  ['token-buyer-12345678901', { userId: 'user.buyer', permissions: [] }],
])

function request(path: string, body: unknown, token?: string) {
  return {
    method: 'POST', path, contentType: 'application/json',
    headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }
}

describe('COMMERCIAL-1 · authenticated and signed HTTP gateway', () => {
  it('目录发布、发现、下单与签名支付通过网关闭环，凭据和 provider reference 不进入审计', async () => {
    const now = 1_800_000_000_000
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: new Store(), now: () => now })
    const audits: CommercialGatewayAuditV1[] = []
    const gateway = createCommercialGatewayV1({
      authority, webhookSecret: SECRET, now: () => now,
      identity: { authenticate: async token => structuredClone(tokens.get(token) ?? null) },
      releaseDelivery: { hasVerifiedRelease: async () => true },
      checkoutProvider: { createOrResumeSession: async order => ({
        checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.test/checkout/${order.orderId}`, expiresAt: now + 60_000,
      }) },
      audit: entry => { audits.push(entry) },
    })
    const created = await gateway(request('/v1/commercial/listings', {
      requestId: 'listing.create', releaseHash: RELEASE, productType: 'ttrpg',
      title: '雾港战役', summary: '正式跑团内容包', contentWarnings: ['悬疑'],
      license: {
        licenseId: 'license.remix-v1', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: true, commercialReuse: false, requiresAttribution: true,
        termsUrl: 'https://storyforge.test/licenses/remix-v1',
      },
      currency: 'CNY', amountMinor: 2_900, creatorShareBps: 8_000,
    }, 'token-creator-123456789'))
    expect(created.status).toBe(201)
    const listingId = (created.body as { listingId: string }).listingId
    await expect(gateway(request('/v1/commercial/listings/submit', {
      requestId: 'listing.submit', listingId, rightsConfirmed: true,
    }, 'token-creator-123456789'))).resolves.toMatchObject({ status: 200, body: { status: 'submitted' } })
    await expect(gateway(request('/v1/commercial/listings/mine', {}, 'token-creator-123456789')))
      .resolves.toMatchObject({ status: 200, body: [{ listingId, status: 'submitted' }] })
    await expect(gateway(request('/v1/commercial/listings/review-queue', {}, 'token-publisher-12345678')))
      .resolves.toMatchObject({ status: 200, body: [{ listingId, status: 'submitted' }] })
    await expect(gateway(request('/v1/commercial/listings/review-queue', {}, 'token-creator-123456789')))
      .resolves.toMatchObject({ status: 403 })
    await expect(gateway(request('/v1/commercial/listings/request-changes', {
      requestId: 'listing.changes', listingId, reasonCode: 'catalog.summary-required',
    }, 'token-publisher-12345678'))).resolves.toMatchObject({
      status: 200, body: { status: 'changes-requested', reviewReasonCode: 'catalog.summary-required' },
    })
    await expect(gateway(request('/v1/commercial/listings/revise', {
      requestId: 'listing.revise', listingId, releaseHash: RELEASE,
      title: '雾港战役·修订版', summary: '补全后的正式跑团内容包', contentWarnings: ['悬疑'],
      license: {
        licenseId: 'license.remix-v1', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: true, commercialReuse: false, requiresAttribution: true,
        termsUrl: 'https://storyforge.test/licenses/remix-v1',
      }, currency: 'CNY', amountMinor: 2_900, creatorShareBps: 8_000,
    }, 'token-creator-123456789'))).resolves.toMatchObject({ status: 200, body: { status: 'draft' } })
    await expect(gateway(request('/v1/commercial/listings/submit', {
      requestId: 'listing.resubmit', listingId, rightsConfirmed: true,
    }, 'token-creator-123456789'))).resolves.toMatchObject({ status: 200, body: { status: 'submitted' } })
    await expect(gateway(request('/v1/commercial/listings/publish', {
      requestId: 'listing.publish', listingId, rightsConfirmed: true,
    }, 'token-publisher-12345678'))).resolves.toMatchObject({ status: 200, body: { status: 'published' } })
    await expect(gateway(request('/v1/commercial/discover', { query: '雾港' })))
      .resolves.toMatchObject({ status: 200, body: [{ listingId }] })
    const acquired = await gateway(request('/v1/commercial/acquisitions', {
      requestId: 'order.create', listingId,
    }, 'token-buyer-12345678901'))
    const orderId = (acquired.body as { order: { orderId: string } }).order.orderId
    expect(acquired.body).toMatchObject({ checkout: { orderId, checkoutUrl: expect.stringMatching(/^https:/) } })
    const event: CommercialPaymentEventV1 = {
      schema: 'storyforge.payment-event', version: 1, eventId: 'event.gateway.paid',
      type: 'payment.succeeded', orderId, providerReference: 'provider.private.reference',
      currency: 'CNY', amountMinor: 2_900, occurredAt: now,
    }
    const rawBody = JSON.stringify(event)
    const signature = await signCommercialWebhookV1({ rawBody, secret: SECRET, timestamp: now })
    const paid = await gateway({
      ...request('/v1/commercial/payment-webhook', {}), rawBody,
      headers: { 'x-storyforge-signature': signature },
    })
    expect(paid).toMatchObject({ status: 200, body: { order: { status: 'paid' }, entitlement: { hostedAccess: true } } })
    await expect(gateway(request('/v1/commercial/remix/authorize', {
      releaseHash: RELEASE,
    }, 'token-buyer-12345678901'))).resolves.toMatchObject({ status: 200, body: { sourceReleaseHash: RELEASE } })
    expect(JSON.stringify(audits)).not.toContain('provider.private.reference')
    expect(JSON.stringify(audits)).not.toContain(signature)
    expect(JSON.stringify(audits)).not.toContain('token-buyer')
  })

  it('字段类型欺骗、伪造签名、未知凭据和额外字段全部 fail-closed', async () => {
    const now = 1_800_000_100_000
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: new Store(), now: () => now })
    const gateway = createCommercialGatewayV1({
      authority, webhookSecret: SECRET, now: () => now,
      identity: { authenticate: async token => structuredClone(tokens.get(token) ?? null) },
      releaseDelivery: { hasVerifiedRelease: async () => true },
      checkoutProvider: { createOrResumeSession: async order => ({
        checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.test/checkout/${order.orderId}`, expiresAt: now + 60_000,
      }) },
    })
    await expect(gateway(request('/v1/commercial/listings', {
      requestId: 'listing.bad', releaseHash: RELEASE, productType: 'ttrpg', title: '错误', summary: '错误',
      contentWarnings: [], license: {}, currency: 'CNY', amountMinor: '2900', creatorShareBps: 8_000,
    }, 'token-creator-123456789'))).resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/commercial/discover', { query: '', hidden: true })))
      .resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/commercial/discover', { query: 123 })))
      .resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/commercial/acquisitions', {
      requestId: 'order.bad', listingId: 'listing.missing',
    }, 'unknown-token-123456789'))).resolves.toMatchObject({ status: 401, body: { code: 'unauthorized' } })
    await expect(gateway({
      ...request('/v1/commercial/payment-webhook', {}), rawBody: '{}',
      headers: { 'x-storyforge-signature': 't=1,v1='.concat('0'.repeat(64)) },
    })).resolves.toMatchObject({ status: 401, body: { code: 'stale' } })
    await expect(gateway({
      ...request('/v1/commercial/payment-webhook', {}), rawBody: '{}',
      headers: {
        'x-storyforge-signature': `t=${now},v1=${'0'.repeat(64)},v1=${'0'.repeat(64)}`,
      },
    })).resolves.toMatchObject({ status: 401, body: { code: 'signature' } })
  })

  it('secret manager 轮换窗只接受当前和一个未过期上一版，旧密钥与密钥内容不进入审计', async () => {
    const now = 1_800_000_200_000
    const current = 'gateway-current-secret-at-least-16'
    const previous = 'gateway-previous-secret-at-least-16'
    const retired = 'gateway-retired-secret-at-least-16'
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: new Store(), now: () => now })
    const audits: CommercialGatewayAuditV1[] = []
    const gateway = createCommercialGatewayV1({
      authority,
      now: () => now,
      identity: { authenticate: async () => null },
      releaseDelivery: { hasVerifiedRelease: async () => false },
      checkoutProvider: { createOrResumeSession: async () => { throw new Error('not reached') } },
      webhookSecrets: {
        async resolveVerificationKeys() {
          return [
            { keyId: 'payment.2026-08-current', role: 'current', secret: current, activeFrom: now - 1_000, expiresAt: null },
            { keyId: 'payment.2026-07-previous', role: 'previous', secret: previous, activeFrom: now - 60_000, expiresAt: now + 60_000 },
          ]
        },
      },
      audit: entry => { audits.push(entry) },
    })
    const paymentEvent = (eventId: string): CommercialPaymentEventV1 => ({
      schema: 'storyforge.payment-event', version: 1, eventId,
      type: 'payment.succeeded', orderId: 'order.rotation.missing',
      providerReference: 'provider.rotation.private', currency: 'CNY', amountMinor: 100, occurredAt: now,
    })
    const invoke = async (secret: string, eventId: string) => {
      const rawBody = JSON.stringify(paymentEvent(eventId))
      const signature = await signCommercialWebhookV1({ rawBody, secret, timestamp: now })
      return gateway({
        ...request('/v1/commercial/payment-webhook', {}), rawBody,
        headers: { 'x-storyforge-signature': signature },
      })
    }
    await expect(invoke(current, 'event.rotation.current')).resolves.toMatchObject({
      status: 404, body: { code: 'order_not_found' },
    })
    await expect(invoke(previous, 'event.rotation.previous')).resolves.toMatchObject({
      status: 404, body: { code: 'order_not_found' },
    })
    await expect(invoke(retired, 'event.rotation.retired')).resolves.toMatchObject({
      status: 401, body: { code: 'signature' },
    })
    expect(JSON.stringify(audits)).not.toContain(current)
    expect(JSON.stringify(audits)).not.toContain(previous)
    expect(JSON.stringify(audits)).not.toContain('provider.rotation.private')
  })
})
