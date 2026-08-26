import { describe, expect, it } from 'vitest'
import { CommercialOperationsAuthorityV1, type CommercialOperationsPersistenceV1, type CommercialOperationsSnapshotV1 } from '../../src/lib/commercial/operations-authority'
import { createCommercialOperationsGatewayV1, type CommercialOperationsGatewayAuditV1 } from '../../src/lib/commercial/operations-gateway'
import type { CommercialPrincipalV1 } from '../../src/lib/commercial/authority'

class Store implements CommercialOperationsPersistenceV1 {
  snapshot: CommercialOperationsSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialOperationsSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot); return true
  }
}

function request(path: string, body: unknown, token?: string) {
  return {
    method: 'POST', path, contentType: 'application/json',
    headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }
}

describe('COMMERCIAL-1 · strict operations HTTP gateway', () => {
  it('公开税务报价与状态页可读，运营写入鉴权且审计不含凭据或正文', async () => {
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: new Store(), now: () => 1_801_500_000_000 })
    const principals = new Map<string, CommercialPrincipalV1>([
      ['finance-access-token', { userId: 'ops.finance', permissions: ['commerce:finance'] }],
      ['incident-access-token', { userId: 'ops.incident', permissions: ['operations:incident'] }],
    ])
    const audits: CommercialOperationsGatewayAuditV1[] = []
    const gateway = createCommercialOperationsGatewayV1({
      authority, identity: { authenticate: async token => principals.get(token) ?? null },
      audit: entry => { audits.push(entry) }, now: () => 1_801_500_000_000,
    })
    await expect(gateway(request('/v1/operations/tax/rules', {
      requestId: 'tax.1', ruleId: 'tax.cn', jurisdiction: 'CN', buyerRegion: 'CN',
      currency: 'CNY', rateBps: 600, priceIncludesTax: true,
      effectiveFrom: 1_801_000_000_000, effectiveUntil: null,
    }, 'finance-access-token'))).resolves.toMatchObject({ status: 200 })
    const quote = await gateway(request('/v1/operations/tax/quote', {
      buyerRegion: 'CN', currency: 'CNY', listedAmountMinor: 10_600,
    }))
    expect(quote).toMatchObject({ status: 200, body: { subtotalMinor: 10_000, taxMinor: 600, totalMinor: 10_600 } })
    await gateway(request('/v1/operations/incidents', {
      requestId: 'incident.1', incidentId: null, title: '支付延迟', severity: 'minor',
      status: 'monitoring', publicMessage: '提供方恢复中。', affectedServices: ['checkout'],
    }, 'incident-access-token'))
    await expect(gateway(request('/v1/operations/status', {}))).resolves.toMatchObject({
      status: 200, body: { incidents: [{ title: '支付延迟', status: 'monitoring' }] },
    })
    expect(JSON.stringify(audits)).not.toContain('finance-access-token')
    expect(JSON.stringify(audits)).not.toContain('提供方恢复中')
  })

  it('客服工单保持内部备注隔离，并在领域调用前拒绝字段扩张和类型混淆', async () => {
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: new Store() })
    const principals = new Map<string, CommercialPrincipalV1>([
      ['buyer-access-token', { userId: 'user.buyer', permissions: [] }],
      ['support-access-token', { userId: 'ops.support', permissions: ['commerce:support'] }],
    ])
    const gateway = createCommercialOperationsGatewayV1({
      authority, identity: { authenticate: async token => principals.get(token) ?? null },
    })
    const opened = await gateway(request('/v1/operations/support/open', {
      requestId: 'ticket.1', category: 'access', subject: '无法进入房间',
      body: '邀请显示已占用。', orderId: null, priority: 'normal',
    }, 'buyer-access-token'))
    const ticketId = (opened.body as { ticketId: string }).ticketId
    await gateway(request('/v1/operations/support/reply', {
      requestId: 'ticket.internal', ticketId, body: '风控内部标签。', internal: true, resolve: false,
    }, 'support-access-token'))
    const visible = await gateway(request('/v1/operations/support/get', { ticketId }, 'buyer-access-token'))
    expect(JSON.stringify(visible)).not.toContain('风控内部标签')
    await expect(gateway(request('/v1/operations/support/reply', {
      requestId: 'ticket.coerce', ticketId, body: '不应接受', internal: 'false', resolve: false,
    }, 'buyer-access-token'))).resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/operations/support/get', { ticketId, extra: true }, 'buyer-access-token')))
      .resolves.toMatchObject({ status: 422, body: { code: 'protocol' } })
    await expect(gateway(request('/v1/operations/support/get', { ticketId })))
      .resolves.toMatchObject({ status: 401 })
  })
})
