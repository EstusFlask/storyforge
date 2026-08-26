import { hashCanonicalValue } from '../agent/run/hash'
import {
  CommercialAuthorityErrorV1,
  type CommercialOrderV1,
  type CommercialPrincipalV1,
} from './authority'

export interface CommercialTaxRuleV1 {
  ruleId: string
  jurisdiction: string
  buyerRegion: string
  currency: string
  rateBps: number
  priceIncludesTax: boolean
  effectiveFrom: number
  effectiveUntil: number | null
  updatedBy: string
  updatedAt: number
}

export interface CommercialTaxQuoteV1 {
  quoteId: string
  ruleId: string
  jurisdiction: string
  buyerRegion: string
  currency: string
  listedAmountMinor: number
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  priceIncludesTax: boolean
  quotedAt: number
  expiresAt: number
  quoteHash: string
}

export interface CommercialInvoiceV1 {
  invoiceId: string
  orderId: string
  buyerId: string
  creatorId: string
  currency: string
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  jurisdiction: string
  quoteHash: string
  status: 'issued' | 'refunded'
  issuedAt: number
  updatedAt: number
}

export interface CommercialCreatorBalanceMovementV1 {
  movementId: string
  creatorId: string
  orderId: string | null
  payoutId: string | null
  currency: string
  direction: 'credit' | 'debit'
  amountMinor: number
  reason: 'sale' | 'refund' | 'payout-reserved' | 'payout-failed-reversal'
  createdAt: number
}

export interface CommercialPayoutAccountV1 {
  accountId: string
  creatorId: string
  providerAccountKey: string
  countryCode: string
  currencies: string[]
  status: 'pending-verification' | 'verified' | 'restricted'
  reviewedBy: string | null
  createdAt: number
  updatedAt: number
}

export interface CommercialPayoutV1 {
  payoutId: string
  creatorId: string
  accountId: string
  currency: string
  amountMinor: number
  status: 'requested' | 'submitted' | 'paid' | 'failed'
  providerReferenceHash: string | null
  failureCode: string | null
  createdAt: number
  updatedAt: number
}

export interface CommercialSupportMessageV1 {
  messageId: string
  authorId: string
  visibility: 'requester' | 'internal'
  body: string
  createdAt: number
}

export interface CommercialSupportTicketV1 {
  ticketId: string
  requesterId: string
  category: 'payment' | 'refund' | 'access' | 'content' | 'safety' | 'privacy' | 'technical'
  subject: string
  orderId: string | null
  status: 'open' | 'waiting-requester' | 'waiting-support' | 'resolved' | 'closed'
  priority: 'normal' | 'urgent'
  assignedTo: string | null
  messages: CommercialSupportMessageV1[]
  createdAt: number
  updatedAt: number
}

export interface CommercialDeletionRequestV1 {
  deletionId: string
  requesterId: string
  scope: 'profile' | 'community-content' | 'all-hosted-data'
  status: 'requested' | 'approved' | 'executing' | 'completed' | 'rejected' | 'legal-hold'
  reason: string
  legalHoldCode: string | null
  reviewedBy: string | null
  execution: null | {
    deletedCategories: string[]
    deletedRecordCount: number
    preservedCategories: string[]
    completedAt: number
    receiptHash: string
  }
  createdAt: number
  updatedAt: number
}

export interface CommercialIncidentV1 {
  incidentId: string
  title: string
  severity: 'minor' | 'major' | 'critical'
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  publicMessage: string
  affectedServices: string[]
  openedAt: number
  updatedAt: number
  resolvedAt: number | null
}

interface StoredReceiptV1 { fingerprint: string; result: unknown }
export interface CommercialOperationsAuditV1 {
  sequence: number
  kind: string
  actorId: string
  subjectId: string
  createdAt: number
}

export interface CommercialOperationsSnapshotV1 {
  schema: 'storyforge.commercial-operations-snapshot'
  version: 1
  revision: number
  taxRules: CommercialTaxRuleV1[]
  invoices: CommercialInvoiceV1[]
  creatorMovements: CommercialCreatorBalanceMovementV1[]
  payoutAccounts: CommercialPayoutAccountV1[]
  payouts: CommercialPayoutV1[]
  supportTickets: CommercialSupportTicketV1[]
  deletionRequests: CommercialDeletionRequestV1[]
  incidents: CommercialIncidentV1[]
  receipts: Array<[string, StoredReceiptV1]>
  audits: CommercialOperationsAuditV1[]
  updatedAt: number
  integrityHash: string
}

export interface CommercialOperationsPersistenceV1 {
  load(): Promise<CommercialOperationsSnapshotV1 | null>
  compareAndSwap(input: {
    expectedRevision: number | null
    snapshot: CommercialOperationsSnapshotV1
  }): Promise<boolean>
}

function fail(code: string, message: string): never {
  throw new CommercialAuthorityErrorV1(code, message)
}

function stableKey(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value || value.length > maximum
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail('protocol', `${label} 无效`)
  return value
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('protocol', `${label} 无效`)
  return value.trim().normalize('NFC')
}

function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) fail('protocol', 'currency 无效')
  return value
}

function country(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) fail('protocol', `${label} 无效`)
  return value
}

function amount(value: unknown, label: string, allowZero = true): number {
  if (!Number.isInteger(value) || Number(value) < (allowZero ? 0 : 1) || Number(value) > 1_000_000_000) {
    fail('protocol', `${label} 无效`)
  }
  return Number(value)
}

function permission(principal: CommercialPrincipalV1, value: CommercialPrincipalV1['permissions'][number]): void {
  if (!principal.permissions.includes(value)) fail('forbidden', `缺少权限:${value}`)
}

function clone<T>(value: T): T { return structuredClone(value) }

function validStringList(value: unknown, label: string, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail('protocol', `${label} 无效`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 300))
  if (new Set(result).size !== result.length) fail('protocol', `${label} 不得重复`)
  return result
}

export async function verifyCommercialOperationsSnapshotV1(snapshot: CommercialOperationsSnapshotV1): Promise<void> {
  if (snapshot.schema !== 'storyforge.commercial-operations-snapshot' || snapshot.version !== 1
    || !Number.isInteger(snapshot.revision) || snapshot.revision < 1
    || !Array.isArray(snapshot.taxRules) || !Array.isArray(snapshot.invoices)
    || !Array.isArray(snapshot.creatorMovements) || !Array.isArray(snapshot.payoutAccounts)
    || !Array.isArray(snapshot.payouts) || !Array.isArray(snapshot.supportTickets)
    || !Array.isArray(snapshot.deletionRequests) || !Array.isArray(snapshot.incidents)
    || !Array.isArray(snapshot.receipts) || !Array.isArray(snapshot.audits)) {
    fail('snapshot_invalid', '商业运营快照结构无效')
  }
  const { integrityHash, ...body } = snapshot
  if (await hashCanonicalValue(body) !== integrityHash) fail('snapshot_corrupt', '商业运营快照完整性校验失败')
}

export class CommercialOperationsAuthorityV1 {
  private revision = 0
  private readonly taxRules = new Map<string, CommercialTaxRuleV1>()
  private readonly invoices = new Map<string, CommercialInvoiceV1>()
  private readonly creatorMovements: CommercialCreatorBalanceMovementV1[] = []
  private readonly payoutAccounts = new Map<string, CommercialPayoutAccountV1>()
  private readonly payouts = new Map<string, CommercialPayoutV1>()
  private readonly supportTickets = new Map<string, CommercialSupportTicketV1>()
  private readonly deletionRequests = new Map<string, CommercialDeletionRequestV1>()
  private readonly incidents = new Map<string, CommercialIncidentV1>()
  private readonly receipts = new Map<string, StoredReceiptV1>()
  private readonly audits: CommercialOperationsAuditV1[] = []
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly persistence: CommercialOperationsPersistenceV1,
    private readonly now: () => number,
  ) {}

  static async create(input: { persistence: CommercialOperationsPersistenceV1; now?: () => number }) {
    const authority = new CommercialOperationsAuthorityV1(input.persistence, input.now ?? (() => Date.now()))
    await authority.persist(null)
    return authority
  }

  static async restore(input: { persistence: CommercialOperationsPersistenceV1; now?: () => number }) {
    const snapshot = await input.persistence.load()
    if (!snapshot) fail('snapshot_missing', '商业运营快照不存在')
    await verifyCommercialOperationsSnapshotV1(snapshot)
    const authority = new CommercialOperationsAuthorityV1(input.persistence, input.now ?? (() => Date.now()))
    authority.restoreLocal(snapshot)
    return authority
  }

  upsertTaxRule(input: {
    principal: CommercialPrincipalV1
    requestId: string
    ruleId: string
    jurisdiction: string
    buyerRegion: string
    currency: string
    rateBps: number
    priceIncludesTax: boolean
    effectiveFrom: number
    effectiveUntil?: number | null
  }): Promise<CommercialTaxRuleV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'commerce:finance')
      if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000
        || typeof input.priceIncludesTax !== 'boolean' || !Number.isInteger(input.effectiveFrom)
        || (input.effectiveUntil != null && (!Number.isInteger(input.effectiveUntil) || input.effectiveUntil <= input.effectiveFrom))) {
        fail('protocol', '税务规则数值无效')
      }
      const rule: CommercialTaxRuleV1 = {
        ruleId: stableKey(input.ruleId, 'ruleId'),
        jurisdiction: text(input.jurisdiction, 'jurisdiction', 120),
        buyerRegion: input.buyerRegion === '*' ? '*' : country(input.buyerRegion, 'buyerRegion'),
        currency: currency(input.currency), rateBps: input.rateBps,
        priceIncludesTax: input.priceIncludesTax,
        effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil ?? null,
        updatedBy: actorId, updatedAt: this.now(),
      }
      this.taxRules.set(rule.ruleId, rule)
      this.audit('tax-rule.upserted', actorId, rule.ruleId)
      return clone(rule)
    })
  }

  async quoteTax(input: {
    buyerRegion: string
    currency: string
    listedAmountMinor: number
    at?: number
    ttlMs?: number
  }): Promise<CommercialTaxQuoteV1> {
    const buyerRegion = country(input.buyerRegion, 'buyerRegion')
    const quoteCurrency = currency(input.currency)
    const listedAmountMinor = amount(input.listedAmountMinor, 'listedAmountMinor')
    const at = input.at ?? this.now()
    const ttlMs = input.ttlMs ?? 15 * 60_000
    if (!Number.isInteger(at) || at < 1 || !Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 86_400_000) {
      fail('protocol', '税务报价时间无效')
    }
    const candidates = [...this.taxRules.values()].filter(rule => (
      rule.currency === quoteCurrency && (rule.buyerRegion === buyerRegion || rule.buyerRegion === '*')
      && rule.effectiveFrom <= at && (rule.effectiveUntil == null || rule.effectiveUntil > at)
    )).sort((left, right) => (
      Number(right.buyerRegion === buyerRegion) - Number(left.buyerRegion === buyerRegion)
      || right.effectiveFrom - left.effectiveFrom
    ))
    const rule = candidates[0]
    if (!rule) fail('tax_rule_missing', '当前地区和币种没有有效税务规则')
    const taxMinor = rule.priceIncludesTax
      ? Math.round(listedAmountMinor * rule.rateBps / (10_000 + rule.rateBps))
      : Math.round(listedAmountMinor * rule.rateBps / 10_000)
    const body = {
      quoteId: `tax-quote.${crypto.randomUUID()}`,
      ruleId: rule.ruleId, jurisdiction: rule.jurisdiction, buyerRegion,
      currency: quoteCurrency, listedAmountMinor,
      subtotalMinor: rule.priceIncludesTax ? listedAmountMinor - taxMinor : listedAmountMinor,
      taxMinor, totalMinor: rule.priceIncludesTax ? listedAmountMinor : listedAmountMinor + taxMinor,
      priceIncludesTax: rule.priceIncludesTax, quotedAt: at, expiresAt: at + ttlMs,
    }
    return { ...body, quoteHash: await hashCanonicalValue(body) }
  }

  recordPaidOrder(input: {
    principal: CommercialPrincipalV1
    requestId: string
    order: CommercialOrderV1
    quote: CommercialTaxQuoteV1
  }): Promise<CommercialInvoiceV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'commerce:finance')
      if (input.order.status !== 'paid' || input.order.currency !== input.quote.currency
        || input.order.amountMinor !== input.quote.totalMinor || input.quote.expiresAt < this.now()) {
        fail('settlement_mismatch', '订单与有效税务报价不一致')
      }
      const { quoteHash, ...quoteBody } = input.quote
      if (await hashCanonicalValue(quoteBody) !== quoteHash) fail('settlement_mismatch', '税务报价完整性校验失败')
      if ([...this.invoices.values()].some(row => row.orderId === input.order.orderId)) {
        fail('already_recorded', '订单已经进入税务与结算账')
      }
      const invoice: CommercialInvoiceV1 = {
        invoiceId: `invoice.${crypto.randomUUID()}`,
        orderId: stableKey(input.order.orderId, 'orderId'),
        buyerId: stableKey(input.order.buyerId, 'buyerId'),
        creatorId: stableKey(input.order.creatorId, 'creatorId'),
        currency: input.order.currency,
        subtotalMinor: input.quote.subtotalMinor, taxMinor: input.quote.taxMinor,
        totalMinor: input.quote.totalMinor, jurisdiction: input.quote.jurisdiction,
        quoteHash, status: 'issued', issuedAt: this.now(), updatedAt: this.now(),
      }
      this.invoices.set(invoice.invoiceId, invoice)
      if (input.order.creatorShareMinor > 0) this.creatorMovements.push({
        movementId: `movement.${crypto.randomUUID()}`,
        creatorId: input.order.creatorId, orderId: input.order.orderId, payoutId: null,
        currency: input.order.currency, direction: 'credit', amountMinor: input.order.creatorShareMinor,
        reason: 'sale', createdAt: this.now(),
      })
      this.audit('order.settled', actorId, input.order.orderId)
      return clone(invoice)
    })
  }

  recordRefundedOrder(input: {
    principal: CommercialPrincipalV1
    requestId: string
    order: CommercialOrderV1
  }): Promise<CommercialInvoiceV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'commerce:finance')
      if (input.order.status !== 'refunded') fail('settlement_mismatch', '只有已退款订单可以冲销结算')
      const invoice = [...this.invoices.values()].find(row => row.orderId === input.order.orderId)
      if (!invoice) fail('invoice_missing', '订单没有已开具发票')
      if (invoice.status === 'refunded') return clone(invoice)
      invoice.status = 'refunded'
      invoice.updatedAt = this.now()
      if (input.order.creatorShareMinor > 0) this.creatorMovements.push({
        movementId: `movement.${crypto.randomUUID()}`,
        creatorId: input.order.creatorId, orderId: input.order.orderId, payoutId: null,
        currency: input.order.currency, direction: 'debit', amountMinor: input.order.creatorShareMinor,
        reason: 'refund', createdAt: this.now(),
      })
      this.audit('order.refund-settled', actorId, input.order.orderId)
      return clone(invoice)
    })
  }

  registerPayoutAccount(input: {
    principal: CommercialPrincipalV1
    requestId: string
    providerAccountKey: string
    countryCode: string
    currencies: string[]
  }): Promise<CommercialPayoutAccountV1> {
    const creatorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(creatorId, input.requestId, input, async () => {
      const currencies = validStringList(input.currencies, 'currencies', 20).map(currency)
      if (!currencies.length) fail('protocol', 'payout currencies 不能为空')
      const account: CommercialPayoutAccountV1 = {
        accountId: `payout-account.${crypto.randomUUID()}`, creatorId,
        providerAccountKey: stableKey(input.providerAccountKey, 'providerAccountKey'),
        countryCode: country(input.countryCode, 'countryCode'), currencies,
        status: 'pending-verification', reviewedBy: null,
        createdAt: this.now(), updatedAt: this.now(),
      }
      this.payoutAccounts.set(account.accountId, account)
      this.audit('payout-account.registered', creatorId, account.accountId)
      return clone(account)
    })
  }

  reviewPayoutAccount(input: {
    principal: CommercialPrincipalV1
    requestId: string
    accountId: string
    status: 'verified' | 'restricted'
  }): Promise<CommercialPayoutAccountV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'commerce:finance')
      const account = this.requirePayoutAccount(input.accountId)
      if (!['verified', 'restricted'].includes(input.status)) fail('protocol', 'payout account status 无效')
      account.status = input.status
      account.reviewedBy = actorId
      account.updatedAt = this.now()
      this.audit('payout-account.reviewed', actorId, account.accountId)
      return clone(account)
    })
  }

  creatorBalance(input: { principal: CommercialPrincipalV1; currency: string }): number {
    const creatorId = stableKey(input.principal.userId, 'principal.userId')
    const targetCurrency = currency(input.currency)
    return this.creatorMovements.filter(row => row.creatorId === creatorId && row.currency === targetCurrency)
      .reduce((total, row) => total + (row.direction === 'credit' ? row.amountMinor : -row.amountMinor), 0)
  }

  payoutAccountsForCreator(input: { principal: CommercialPrincipalV1 }): CommercialPayoutAccountV1[] {
    const creatorId = stableKey(input.principal.userId, 'principal.userId')
    return [...this.payoutAccounts.values()].filter(row => row.creatorId === creatorId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.accountId.localeCompare(right.accountId))
      .map(clone)
  }

  payoutsForCreator(input: { principal: CommercialPrincipalV1 }): CommercialPayoutV1[] {
    const creatorId = stableKey(input.principal.userId, 'principal.userId')
    return [...this.payouts.values()].filter(row => row.creatorId === creatorId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.payoutId.localeCompare(right.payoutId))
      .map(clone)
  }

  requestPayout(input: {
    principal: CommercialPrincipalV1
    requestId: string
    accountId: string
    currency: string
    amountMinor: number
  }): Promise<CommercialPayoutV1> {
    const creatorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(creatorId, input.requestId, input, async () => {
      const account = this.requirePayoutAccount(input.accountId)
      const payoutCurrency = currency(input.currency)
      const payoutAmount = amount(input.amountMinor, 'amountMinor', false)
      if (account.creatorId !== creatorId) fail('forbidden', '不能使用其他创作者的结算账户')
      if (account.status !== 'verified' || !account.currencies.includes(payoutCurrency)) {
        fail('payout_account_unavailable', '结算账户尚未通过当前币种验证')
      }
      if (this.creatorBalance({ principal: input.principal, currency: payoutCurrency }) < payoutAmount) {
        fail('insufficient_balance', '创作者可结算余额不足')
      }
      const payout: CommercialPayoutV1 = {
        payoutId: `payout.${crypto.randomUUID()}`, creatorId, accountId: account.accountId,
        currency: payoutCurrency, amountMinor: payoutAmount, status: 'requested',
        providerReferenceHash: null, failureCode: null,
        createdAt: this.now(), updatedAt: this.now(),
      }
      this.payouts.set(payout.payoutId, payout)
      this.creatorMovements.push({
        movementId: `movement.${crypto.randomUUID()}`, creatorId, orderId: null,
        payoutId: payout.payoutId, currency: payoutCurrency, direction: 'debit', amountMinor: payoutAmount,
        reason: 'payout-reserved', createdAt: this.now(),
      })
      this.audit('payout.requested', creatorId, payout.payoutId)
      return clone(payout)
    })
  }

  applyPayoutResult(input: {
    principal: CommercialPrincipalV1
    requestId: string
    payoutId: string
    status: 'submitted' | 'paid' | 'failed'
    providerReference: string
    failureCode?: string | null
  }): Promise<CommercialPayoutV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'commerce:finance')
      const payout = this.requirePayout(input.payoutId)
      const transitions: Record<CommercialPayoutV1['status'], CommercialPayoutV1['status'][]> = {
        requested: ['submitted', 'paid', 'failed'], submitted: ['paid', 'failed'], paid: [], failed: [],
      }
      if (!transitions[payout.status].includes(input.status)) fail('invalid_transition', '结算状态迁移无效')
      payout.status = input.status
      payout.providerReferenceHash = await hashCanonicalValue(text(input.providerReference, 'providerReference', 500))
      payout.failureCode = input.status === 'failed' ? stableKey(input.failureCode, 'failureCode') : null
      payout.updatedAt = this.now()
      if (input.status === 'failed') this.creatorMovements.push({
        movementId: `movement.${crypto.randomUUID()}`, creatorId: payout.creatorId,
        orderId: null, payoutId: payout.payoutId, currency: payout.currency,
        direction: 'credit', amountMinor: payout.amountMinor,
        reason: 'payout-failed-reversal', createdAt: this.now(),
      })
      this.audit(`payout.${input.status}`, actorId, payout.payoutId)
      return clone(payout)
    })
  }

  openSupportTicket(input: {
    principal: CommercialPrincipalV1
    requestId: string
    category: CommercialSupportTicketV1['category']
    subject: string
    body: string
    orderId?: string | null
    priority?: CommercialSupportTicketV1['priority']
  }): Promise<CommercialSupportTicketV1> {
    const requesterId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(requesterId, input.requestId, input, async () => {
      const categories: CommercialSupportTicketV1['category'][] = ['payment', 'refund', 'access', 'content', 'safety', 'privacy', 'technical']
      if (!categories.includes(input.category) || !['normal', 'urgent'].includes(input.priority ?? 'normal')) fail('protocol', '工单分类无效')
      const createdAt = this.now()
      const ticket: CommercialSupportTicketV1 = {
        ticketId: `ticket.${crypto.randomUUID()}`, requesterId, category: input.category,
        subject: text(input.subject, 'subject', 300),
        orderId: input.orderId == null ? null : stableKey(input.orderId, 'orderId'),
        status: 'waiting-support', priority: input.priority ?? 'normal', assignedTo: null,
        messages: [{
          messageId: `message.${crypto.randomUUID()}`, authorId: requesterId,
          visibility: 'requester', body: text(input.body, 'body', 20_000), createdAt,
        }],
        createdAt, updatedAt: createdAt,
      }
      this.supportTickets.set(ticket.ticketId, ticket)
      this.audit('support.opened', requesterId, ticket.ticketId)
      return clone(ticket)
    })
  }

  replySupportTicket(input: {
    principal: CommercialPrincipalV1
    requestId: string
    ticketId: string
    body: string
    internal?: boolean
    resolve?: boolean
  }): Promise<CommercialSupportTicketV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      if ((input.internal != null && typeof input.internal !== 'boolean')
        || (input.resolve != null && typeof input.resolve !== 'boolean')) {
        fail('protocol', '客服回复控制字段必须是 boolean')
      }
      const ticket = this.requireTicket(input.ticketId)
      const isSupport = input.principal.permissions.includes('commerce:support')
      if (ticket.requesterId !== actorId && !isSupport) fail('forbidden', '无权访问该客服工单')
      if (input.internal && !isSupport) fail('forbidden', '只有客服可以记录内部备注')
      if (ticket.status === 'closed') fail('invalid_transition', '已关闭工单不能回复')
      ticket.messages.push({
        messageId: `message.${crypto.randomUUID()}`, authorId: actorId,
        visibility: input.internal ? 'internal' : 'requester',
        body: text(input.body, 'body', 20_000), createdAt: this.now(),
      })
      if (isSupport) ticket.assignedTo = actorId
      ticket.status = input.resolve ? 'resolved' : isSupport ? 'waiting-requester' : 'waiting-support'
      ticket.updatedAt = this.now()
      this.audit(input.resolve ? 'support.resolved' : 'support.replied', actorId, ticket.ticketId)
      return this.visibleTicket(ticket, actorId, isSupport)
    })
  }

  readSupportTicket(input: { principal: CommercialPrincipalV1; ticketId: string }): CommercialSupportTicketV1 {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    const ticket = this.requireTicket(input.ticketId)
    const isSupport = input.principal.permissions.includes('commerce:support')
    if (ticket.requesterId !== actorId && !isSupport) fail('forbidden', '无权访问该客服工单')
    return this.visibleTicket(ticket, actorId, isSupport)
  }

  supportTicketsForPrincipal(input: { principal: CommercialPrincipalV1 }): CommercialSupportTicketV1[] {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    const isSupport = input.principal.permissions.includes('commerce:support')
    return [...this.supportTickets.values()]
      .filter(ticket => isSupport || ticket.requesterId === actorId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.ticketId.localeCompare(right.ticketId))
      .map(ticket => this.visibleTicket(ticket, actorId, isSupport))
  }

  requestDataDeletion(input: {
    principal: CommercialPrincipalV1
    requestId: string
    scope: CommercialDeletionRequestV1['scope']
    reason: string
  }): Promise<CommercialDeletionRequestV1> {
    const requesterId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(requesterId, input.requestId, input, async () => {
      if (!['profile', 'community-content', 'all-hosted-data'].includes(input.scope)) fail('protocol', '删除范围无效')
      if ([...this.deletionRequests.values()].some(row => row.requesterId === requesterId
        && !['completed', 'rejected'].includes(row.status))) fail('deletion_pending', '已有进行中的数据删除请求')
      const createdAt = this.now()
      const request: CommercialDeletionRequestV1 = {
        deletionId: `deletion.${crypto.randomUUID()}`, requesterId, scope: input.scope,
        status: 'requested', reason: text(input.reason, 'reason', 2_000),
        legalHoldCode: null, reviewedBy: null, execution: null,
        createdAt, updatedAt: createdAt,
      }
      this.deletionRequests.set(request.deletionId, request)
      this.audit('deletion.requested', requesterId, request.deletionId)
      return clone(request)
    })
  }

  deletionRequestsForPrincipal(input: { principal: CommercialPrincipalV1 }): CommercialDeletionRequestV1[] {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    const canOperate = input.principal.permissions.includes('privacy:operate')
    return [...this.deletionRequests.values()]
      .filter(request => canOperate || request.requesterId === actorId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.deletionId.localeCompare(right.deletionId))
      .map(clone)
  }

  reviewDataDeletion(input: {
    principal: CommercialPrincipalV1
    requestId: string
    deletionId: string
    decision: 'approve' | 'reject' | 'legal-hold'
    legalHoldCode?: string | null
  }): Promise<CommercialDeletionRequestV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'privacy:operate')
      const request = this.requireDeletion(input.deletionId)
      if (request.status !== 'requested') fail('invalid_transition', '删除请求当前不能审阅')
      if (!['approve', 'reject', 'legal-hold'].includes(input.decision)) fail('protocol', '删除审阅决定无效')
      request.status = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'legal-hold'
      request.legalHoldCode = input.decision === 'legal-hold'
        ? stableKey(input.legalHoldCode, 'legalHoldCode') : null
      request.reviewedBy = actorId
      request.updatedAt = this.now()
      this.audit(`deletion.${input.decision}`, actorId, request.deletionId)
      return clone(request)
    })
  }

  completeDataDeletion(input: {
    principal: CommercialPrincipalV1
    requestId: string
    deletionId: string
    deletedCategories: string[]
    deletedRecordCount: number
    preservedCategories: string[]
  }): Promise<CommercialDeletionRequestV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'privacy:operate')
      const request = this.requireDeletion(input.deletionId)
      if (request.status !== 'approved' && request.status !== 'executing') fail('invalid_transition', '删除请求尚未获批')
      const deletedCategories = validStringList(input.deletedCategories, 'deletedCategories')
      const preservedCategories = validStringList(input.preservedCategories, 'preservedCategories')
      const deletedRecordCount = amount(input.deletedRecordCount, 'deletedRecordCount')
      if (request.scope === 'all-hosted-data'
        && !preservedCategories.includes('financial-ledger')
        && this.invoices.size > 0) {
        fail('retention_required', '全量删除必须显式报告依法保留的财务账本')
      }
      const receiptBody = {
        deletionId: request.deletionId, requesterId: request.requesterId, scope: request.scope,
        deletedCategories, deletedRecordCount, preservedCategories, completedAt: this.now(),
      }
      request.status = 'completed'
      request.execution = { ...receiptBody, receiptHash: await hashCanonicalValue(receiptBody) }
      request.updatedAt = receiptBody.completedAt
      this.audit('deletion.completed', actorId, request.deletionId)
      return clone(request)
    })
  }

  upsertIncident(input: {
    principal: CommercialPrincipalV1
    requestId: string
    incidentId?: string | null
    title: string
    severity: CommercialIncidentV1['severity']
    status: CommercialIncidentV1['status']
    publicMessage: string
    affectedServices: string[]
  }): Promise<CommercialIncidentV1> {
    const actorId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(actorId, input.requestId, input, async () => {
      permission(input.principal, 'operations:incident')
      if (!['minor', 'major', 'critical'].includes(input.severity)
        || !['investigating', 'identified', 'monitoring', 'resolved'].includes(input.status)) {
        fail('protocol', '事件级别或状态无效')
      }
      const incidentId = input.incidentId == null ? `incident.${crypto.randomUUID()}` : stableKey(input.incidentId, 'incidentId')
      const prior = this.incidents.get(incidentId)
      const incident: CommercialIncidentV1 = {
        incidentId, title: text(input.title, 'title', 300), severity: input.severity,
        status: input.status, publicMessage: text(input.publicMessage, 'publicMessage', 4_000),
        affectedServices: validStringList(input.affectedServices, 'affectedServices', 50),
        openedAt: prior?.openedAt ?? this.now(), updatedAt: this.now(),
        resolvedAt: input.status === 'resolved' ? this.now() : null,
      }
      this.incidents.set(incidentId, incident)
      this.audit('incident.updated', actorId, incidentId)
      return clone(incident)
    })
  }

  publicIncidents(): CommercialIncidentV1[] {
    return [...this.incidents.values()].sort((left, right) => right.updatedAt - left.updatedAt).map(clone)
  }

  auditLog(): CommercialOperationsAuditV1[] { return this.audits.map(clone) }

  private visibleTicket(ticket: CommercialSupportTicketV1, actorId: string, isSupport: boolean) {
    const visible = clone(ticket)
    if (!isSupport || ticket.requesterId === actorId) {
      visible.messages = visible.messages.filter(message => message.visibility === 'requester')
    }
    return visible
  }

  private requirePayoutAccount(accountId: string) {
    const value = this.payoutAccounts.get(stableKey(accountId, 'accountId'))
    if (!value) fail('payout_account_missing', '结算账户不存在')
    return value
  }

  private requirePayout(payoutId: string) {
    const value = this.payouts.get(stableKey(payoutId, 'payoutId'))
    if (!value) fail('payout_missing', '结算请求不存在')
    return value
  }

  private requireTicket(ticketId: string) {
    const value = this.supportTickets.get(stableKey(ticketId, 'ticketId'))
    if (!value) fail('ticket_missing', '客服工单不存在')
    return value
  }

  private requireDeletion(deletionId: string) {
    const value = this.deletionRequests.get(stableKey(deletionId, 'deletionId'))
    if (!value) fail('deletion_missing', '数据删除请求不存在')
    return value
  }

  private audit(kind: string, actorId: string, subjectId: string): void {
    this.audits.push({ sequence: this.audits.length + 1, kind, actorId, subjectId, createdAt: this.now() })
  }

  private command<T>(actorId: string, requestId: string, body: unknown, operation: () => Promise<T>): Promise<T> {
    return this.mutate(async () => {
      const normalizedRequestId = stableKey(requestId, 'requestId')
      const receiptKey = `${actorId}\u0000${normalizedRequestId}`
      const fingerprint = await hashCanonicalValue({ actorId, requestId: normalizedRequestId, body })
      const prior = this.receipts.get(receiptKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('request_conflict', 'requestId 已被不同命令使用')
        return clone(prior.result) as T
      }
      const result = await operation()
      this.receipts.set(receiptKey, { fingerprint, result: clone(result) })
      return result
    })
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.mutationTail
    this.mutationTail = new Promise<void>(resolve => { release = resolve })
    await previous
    const backup = await this.snapshot(this.revision)
    try {
      const result = await operation()
      await this.persist(this.revision)
      return result
    } catch (error) {
      this.restoreLocal(backup)
      throw error
    } finally { release() }
  }

  private async persist(expectedRevision: number | null): Promise<void> {
    const snapshot = await this.snapshot(expectedRevision == null ? 1 : expectedRevision + 1)
    if (!await this.persistence.compareAndSwap({ expectedRevision, snapshot })) fail('persistence_conflict', '商业运营持久化版本冲突')
    this.revision = snapshot.revision
  }

  private async snapshot(revision: number): Promise<CommercialOperationsSnapshotV1> {
    const body: Omit<CommercialOperationsSnapshotV1, 'integrityHash'> = {
      schema: 'storyforge.commercial-operations-snapshot', version: 1, revision,
      taxRules: [...this.taxRules.values()].map(clone), invoices: [...this.invoices.values()].map(clone),
      creatorMovements: this.creatorMovements.map(clone), payoutAccounts: [...this.payoutAccounts.values()].map(clone),
      payouts: [...this.payouts.values()].map(clone), supportTickets: [...this.supportTickets.values()].map(clone),
      deletionRequests: [...this.deletionRequests.values()].map(clone), incidents: [...this.incidents.values()].map(clone),
      receipts: clone([...this.receipts]), audits: this.audits.map(clone), updatedAt: this.now(),
    }
    return { ...body, integrityHash: await hashCanonicalValue(body) }
  }

  private restoreLocal(snapshot: CommercialOperationsSnapshotV1): void {
    this.revision = snapshot.revision
    const replace = <T>(target: Map<string, T>, values: T[], id: (value: T) => string) => {
      target.clear(); for (const value of values) target.set(id(value), clone(value))
    }
    replace(this.taxRules, snapshot.taxRules, row => row.ruleId)
    replace(this.invoices, snapshot.invoices, row => row.invoiceId)
    replace(this.payoutAccounts, snapshot.payoutAccounts, row => row.accountId)
    replace(this.payouts, snapshot.payouts, row => row.payoutId)
    replace(this.supportTickets, snapshot.supportTickets, row => row.ticketId)
    replace(this.deletionRequests, snapshot.deletionRequests, row => row.deletionId)
    replace(this.incidents, snapshot.incidents, row => row.incidentId)
    this.creatorMovements.splice(0, this.creatorMovements.length, ...snapshot.creatorMovements.map(clone))
    this.receipts.clear(); for (const [key, value] of snapshot.receipts) this.receipts.set(key, clone(value))
    this.audits.splice(0, this.audits.length, ...snapshot.audits.map(clone))
  }
}
