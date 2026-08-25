import { describe, expect, it } from 'vitest'
import type { CommercialOrderV1, CommercialPrincipalV1 } from '../../src/lib/commercial/authority'
import {
  CommercialOperationsAuthorityV1,
  type CommercialOperationsPersistenceV1,
  type CommercialOperationsSnapshotV1,
} from '../../src/lib/commercial/operations-authority'

class MemoryOperationsStore implements CommercialOperationsPersistenceV1 {
  snapshot: CommercialOperationsSnapshotV1 | null = null
  failNext = false
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialOperationsSnapshotV1 }) {
    if (this.failNext) { this.failNext = false; return false }
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

const creator: CommercialPrincipalV1 = { userId: 'user.creator', permissions: [] }
const buyer: CommercialPrincipalV1 = { userId: 'user.buyer', permissions: [] }
const finance: CommercialPrincipalV1 = { userId: 'ops.finance', permissions: ['commerce:finance'] }
const support: CommercialPrincipalV1 = { userId: 'ops.support', permissions: ['commerce:support'] }
const privacy: CommercialPrincipalV1 = { userId: 'ops.privacy', permissions: ['privacy:operate'] }
const incidentOps: CommercialPrincipalV1 = { userId: 'ops.incident', permissions: ['operations:incident'] }

function paidOrder(overrides: Partial<CommercialOrderV1> = {}): CommercialOrderV1 {
  return {
    orderId: 'order.paid.1', listingId: 'listing.1', releaseHash: 'a'.repeat(64),
    buyerId: buyer.userId, creatorId: creator.userId, currency: 'CNY', amountMinor: 2_900,
    creatorShareMinor: 2_320, platformShareMinor: 580, status: 'paid',
    providerReference: 'provider.checkout.secret', createdAt: 1, updatedAt: 2,
    ...overrides,
  }
}

describe('COMMERCIAL-1 · tax, creator settlement, support, privacy and incidents', () => {
  it('冻结地区税务报价，开票后产生创作者余额，结算失败原额释放且不保存支付账户明文', async () => {
    let now = 1_801_000_000_000
    const store = new MemoryOperationsStore()
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: store, now: () => now })
    await authority.upsertTaxRule({
      principal: finance, requestId: 'tax.cn.1', ruleId: 'tax.cn.cny.v1',
      jurisdiction: 'CN', buyerRegion: 'CN', currency: 'CNY', rateBps: 1_000,
      priceIncludesTax: true, effectiveFrom: now - 1,
    })
    const quote = await authority.quoteTax({ buyerRegion: 'CN', currency: 'CNY', listedAmountMinor: 2_900 })
    expect(quote).toMatchObject({ subtotalMinor: 2_636, taxMinor: 264, totalMinor: 2_900 })
    const invoice = await authority.recordPaidOrder({
      principal: finance, requestId: 'invoice.1', order: paidOrder(), quote,
    })
    expect(invoice).toMatchObject({ status: 'issued', taxMinor: 264, totalMinor: 2_900 })
    expect(authority.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(2_320)

    const account = await authority.registerPayoutAccount({
      principal: creator, requestId: 'account.1', providerAccountKey: 'acct.provider.opaque.1',
      countryCode: 'CN', currencies: ['CNY'],
    })
    await expect(authority.requestPayout({
      principal: creator, requestId: 'payout.before-kyc', accountId: account.accountId,
      currency: 'CNY', amountMinor: 2_000,
    })).rejects.toThrow('尚未通过')
    await authority.reviewPayoutAccount({
      principal: finance, requestId: 'account.review', accountId: account.accountId, status: 'verified',
    })
    const payout = await authority.requestPayout({
      principal: creator, requestId: 'payout.1', accountId: account.accountId,
      currency: 'CNY', amountMinor: 2_000,
    })
    expect(authority.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(320)
    now += 1
    await authority.applyPayoutResult({
      principal: finance, requestId: 'payout.failed.1', payoutId: payout.payoutId,
      status: 'failed', providerReference: 'provider.payout.raw-secret', failureCode: 'bank-rejected',
    })
    expect(authority.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(2_320)
    expect(JSON.stringify(store.snapshot)).not.toContain('provider.payout.raw-secret')
    expect(JSON.stringify(authority.auditLog())).not.toContain('acct.provider.opaque.1')
  })

  it('退款冲销发票与创作者余额，重复或篡改请求不会产生双记账', async () => {
    const now = 1_801_100_000_000
    const store = new MemoryOperationsStore()
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: store, now: () => now })
    await authority.upsertTaxRule({
      principal: finance, requestId: 'tax.zero', ruleId: 'tax.zero.cny',
      jurisdiction: 'ZZ', buyerRegion: 'CN', currency: 'CNY', rateBps: 0,
      priceIncludesTax: false, effectiveFrom: now - 1,
    })
    const quote = await authority.quoteTax({ buyerRegion: 'CN', currency: 'CNY', listedAmountMinor: 2_900 })
    await authority.recordPaidOrder({ principal: finance, requestId: 'record.1', order: paidOrder(), quote })
    const refundedOrder = paidOrder({ status: 'refunded' })
    const first = await authority.recordRefundedOrder({ principal: finance, requestId: 'refund.1', order: refundedOrder })
    const duplicate = await authority.recordRefundedOrder({ principal: finance, requestId: 'refund.1', order: refundedOrder })
    expect(duplicate).toEqual(first)
    expect(authority.creatorBalance({ principal: creator, currency: 'CNY' })).toBe(0)
    await expect(authority.recordRefundedOrder({
      principal: finance, requestId: 'refund.1', order: { ...refundedOrder, creatorShareMinor: 1 },
    })).rejects.toThrow('requestId 已被不同命令')
  })

  it('客服内部备注不会泄给请求人；全量删除保留财务审计并产出可验 receipt', async () => {
    const store = new MemoryOperationsStore()
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: store })
    const ticket = await authority.openSupportTicket({
      principal: buyer, requestId: 'support.1', category: 'refund',
      subject: '退款进度', body: '我想确认订单退款状态。', orderId: 'order.paid.1', priority: 'normal',
    })
    await authority.replySupportTicket({
      principal: support, requestId: 'support.internal', ticketId: ticket.ticketId,
      body: '支付提供方审查备注，不可外发。', internal: true,
    })
    await authority.replySupportTicket({
      principal: support, requestId: 'support.public', ticketId: ticket.ticketId,
      body: '退款正在处理中。',
    })
    expect(JSON.stringify(authority.readSupportTicket({ principal: buyer, ticketId: ticket.ticketId })))
      .not.toContain('不可外发')
    expect(JSON.stringify(authority.readSupportTicket({ principal: support, ticketId: ticket.ticketId })))
      .toContain('不可外发')

    const request = await authority.requestDataDeletion({
      principal: buyer, requestId: 'delete.1', scope: 'all-hosted-data', reason: '停止使用服务',
    })
    await authority.reviewDataDeletion({
      principal: privacy, requestId: 'delete.approve', deletionId: request.deletionId, decision: 'approve',
    })
    const completed = await authority.completeDataDeletion({
      principal: privacy, requestId: 'delete.complete', deletionId: request.deletionId,
      deletedCategories: ['profile', 'community-content', 'hosted-saves'], deletedRecordCount: 17,
      preservedCategories: ['financial-ledger', 'fraud-audit'],
    })
    expect(completed).toMatchObject({ status: 'completed', execution: { deletedRecordCount: 17 } })
    expect(completed.execution?.receiptHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('公开状态事件可更新恢复；CAS 失败回滚，篡改快照无法恢复', async () => {
    const store = new MemoryOperationsStore()
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: store })
    const incident = await authority.upsertIncident({
      principal: incidentOps, requestId: 'incident.open', title: '房间连接延迟',
      severity: 'major', status: 'investigating', publicMessage: '正在调查连接延迟。',
      affectedServices: ['online-rooms'],
    })
    store.failNext = true
    await expect(authority.upsertIncident({
      principal: incidentOps, requestId: 'incident.fail-cas', incidentId: incident.incidentId,
      title: '房间连接延迟', severity: 'minor', status: 'resolved',
      publicMessage: '已恢复。', affectedServices: ['online-rooms'],
    })).rejects.toThrow('持久化版本冲突')
    expect(authority.publicIncidents()[0]).toMatchObject({ status: 'investigating', severity: 'major' })
    const restored = await CommercialOperationsAuthorityV1.restore({ persistence: store })
    expect(restored.publicIncidents()[0].incidentId).toBe(incident.incidentId)
    store.snapshot!.incidents[0].status = 'resolved'
    await expect(CommercialOperationsAuthorityV1.restore({ persistence: store })).rejects.toThrow('完整性校验失败')
  })
})
