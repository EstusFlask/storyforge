import type {
  CommercialDeletionRequestV1,
  CommercialIncidentV1,
  CommercialPayoutAccountV1,
  CommercialPayoutV1,
  CommercialSupportMessageV1,
  CommercialSupportTicketV1,
} from './operations-authority'

interface FetchResponseV1 { ok: boolean; status: number; text(): Promise<string> }
type FetchV1 = (input: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal
}) => Promise<FetchResponseV1>

export class CommercialOperationsHttpErrorV1 extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly status: number | null = null) {
    super(`[commercial-operations-http:${code}] ${message}`)
    this.name = 'CommercialOperationsHttpErrorV1'
  }
}

function fail(code: string, message: string, retryable = false, status: number | null = null): never {
  throw new CommercialOperationsHttpErrorV1(code, message, retryable, status)
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', `${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(row: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) fail('protocol', `${label} 字段不符合协议`)
}
function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('protocol', `${label} 无效`)
  return value
}
function nullableText(value: unknown, label: string, maximum = 500): string | null { return value == null ? null : text(value, label, maximum) }
function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail('protocol', `${label} 无效`)
  return Number(value)
}
function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000 || value.some(item => typeof item !== 'string')) fail('protocol', `${label} 无效`)
  return [...value]
}

function parseMessage(value: unknown): CommercialSupportMessageV1 {
  const row = record(value, 'message'); exact(row, ['messageId', 'authorId', 'visibility', 'body', 'createdAt'], 'message')
  if (!['requester', 'internal'].includes(String(row.visibility))) fail('protocol', 'message.visibility 无效')
  return { messageId: text(row.messageId, 'messageId', 200), authorId: text(row.authorId, 'authorId', 200), visibility: row.visibility as CommercialSupportMessageV1['visibility'], body: text(row.body, 'body'), createdAt: integer(row.createdAt, 'createdAt') }
}
function parseTicket(value: unknown): CommercialSupportTicketV1 {
  const row = record(value, 'ticket'); exact(row, ['ticketId', 'requesterId', 'category', 'subject', 'orderId', 'status', 'priority', 'assignedTo', 'messages', 'createdAt', 'updatedAt'], 'ticket')
  const categories = ['payment', 'refund', 'access', 'content', 'safety', 'privacy', 'technical']
  const statuses = ['open', 'waiting-requester', 'waiting-support', 'resolved', 'closed']
  if (!categories.includes(String(row.category)) || !statuses.includes(String(row.status)) || !['normal', 'urgent'].includes(String(row.priority)) || !Array.isArray(row.messages)) fail('protocol', 'ticket 枚举无效')
  return { ticketId: text(row.ticketId, 'ticketId', 200), requesterId: text(row.requesterId, 'requesterId', 200), category: row.category as CommercialSupportTicketV1['category'], subject: text(row.subject, 'subject', 300), orderId: nullableText(row.orderId, 'orderId', 200), status: row.status as CommercialSupportTicketV1['status'], priority: row.priority as CommercialSupportTicketV1['priority'], assignedTo: nullableText(row.assignedTo, 'assignedTo', 200), messages: row.messages.map(parseMessage), createdAt: integer(row.createdAt, 'createdAt'), updatedAt: integer(row.updatedAt, 'updatedAt') }
}
function parsePayoutAccount(value: unknown): CommercialPayoutAccountV1 {
  const row = record(value, 'payout account'); exact(row, ['accountId', 'creatorId', 'providerAccountKey', 'countryCode', 'currencies', 'status', 'reviewedBy', 'createdAt', 'updatedAt'], 'payout account')
  if (!['pending-verification', 'verified', 'restricted'].includes(String(row.status))) fail('protocol', 'payout account status 无效')
  return { accountId: text(row.accountId, 'accountId', 200), creatorId: text(row.creatorId, 'creatorId', 200), providerAccountKey: text(row.providerAccountKey, 'providerAccountKey', 200), countryCode: text(row.countryCode, 'countryCode', 2), currencies: stringList(row.currencies, 'currencies'), status: row.status as CommercialPayoutAccountV1['status'], reviewedBy: nullableText(row.reviewedBy, 'reviewedBy', 200), createdAt: integer(row.createdAt, 'createdAt'), updatedAt: integer(row.updatedAt, 'updatedAt') }
}
function parsePayout(value: unknown): CommercialPayoutV1 {
  const row = record(value, 'payout'); exact(row, ['payoutId', 'creatorId', 'accountId', 'currency', 'amountMinor', 'status', 'providerReferenceHash', 'failureCode', 'createdAt', 'updatedAt'], 'payout')
  if (!['requested', 'submitted', 'paid', 'failed'].includes(String(row.status))) fail('protocol', 'payout status 无效')
  return { payoutId: text(row.payoutId, 'payoutId', 200), creatorId: text(row.creatorId, 'creatorId', 200), accountId: text(row.accountId, 'accountId', 200), currency: text(row.currency, 'currency', 3), amountMinor: integer(row.amountMinor, 'amountMinor'), status: row.status as CommercialPayoutV1['status'], providerReferenceHash: nullableText(row.providerReferenceHash, 'providerReferenceHash', 64), failureCode: nullableText(row.failureCode, 'failureCode', 200), createdAt: integer(row.createdAt, 'createdAt'), updatedAt: integer(row.updatedAt, 'updatedAt') }
}
function parseDeletion(value: unknown): CommercialDeletionRequestV1 {
  const row = record(value, 'deletion'); exact(row, ['deletionId', 'requesterId', 'scope', 'status', 'reason', 'legalHoldCode', 'reviewedBy', 'execution', 'createdAt', 'updatedAt'], 'deletion')
  if (!['profile', 'community-content', 'all-hosted-data'].includes(String(row.scope)) || !['requested', 'approved', 'executing', 'completed', 'rejected', 'legal-hold'].includes(String(row.status))) fail('protocol', 'deletion enum 无效')
  let execution: CommercialDeletionRequestV1['execution'] = null
  if (row.execution != null) {
    const value = record(row.execution, 'deletion.execution'); exact(value, ['deletedCategories', 'deletedRecordCount', 'preservedCategories', 'completedAt', 'receiptHash'], 'deletion.execution')
    execution = { deletedCategories: stringList(value.deletedCategories, 'deletedCategories'), deletedRecordCount: integer(value.deletedRecordCount, 'deletedRecordCount'), preservedCategories: stringList(value.preservedCategories, 'preservedCategories'), completedAt: integer(value.completedAt, 'completedAt'), receiptHash: text(value.receiptHash, 'receiptHash', 64) }
  }
  return { deletionId: text(row.deletionId, 'deletionId', 200), requesterId: text(row.requesterId, 'requesterId', 200), scope: row.scope as CommercialDeletionRequestV1['scope'], status: row.status as CommercialDeletionRequestV1['status'], reason: text(row.reason, 'reason', 2_000), legalHoldCode: nullableText(row.legalHoldCode, 'legalHoldCode', 200), reviewedBy: nullableText(row.reviewedBy, 'reviewedBy', 200), execution, createdAt: integer(row.createdAt, 'createdAt'), updatedAt: integer(row.updatedAt, 'updatedAt') }
}
function parseIncident(value: unknown): CommercialIncidentV1 {
  const row = record(value, 'incident'); exact(row, ['incidentId', 'title', 'severity', 'status', 'publicMessage', 'affectedServices', 'openedAt', 'updatedAt', 'resolvedAt'], 'incident')
  if (!['minor', 'major', 'critical'].includes(String(row.severity)) || !['investigating', 'identified', 'monitoring', 'resolved'].includes(String(row.status))) fail('protocol', 'incident enum 无效')
  return { incidentId: text(row.incidentId, 'incidentId', 200), title: text(row.title, 'title', 300), severity: row.severity as CommercialIncidentV1['severity'], status: row.status as CommercialIncidentV1['status'], publicMessage: text(row.publicMessage, 'publicMessage', 4_000), affectedServices: stringList(row.affectedServices, 'affectedServices'), openedAt: integer(row.openedAt, 'openedAt'), updatedAt: integer(row.updatedAt, 'updatedAt'), resolvedAt: row.resolvedAt == null ? null : integer(row.resolvedAt, 'resolvedAt') }
}

function baseUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, ''); let url: URL
  try { url = new URL(raw) } catch { fail('configuration', '运营服务地址无效') }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('configuration', '运营服务必须使用 HTTPS（本机除外）')
  return raw
}

export class CommercialOperationsHttpClientV1 {
  private readonly url: string; private readonly fetchImpl: FetchV1; private readonly timeoutMs: number
  constructor(input: { baseUrl: string; fetch?: FetchV1; timeoutMs?: number }) {
    this.url = baseUrl(input.baseUrl); this.fetchImpl = input.fetch ?? (globalThis.fetch as unknown as FetchV1); this.timeoutMs = input.timeoutMs ?? 30_000
    if (typeof this.fetchImpl !== 'function' || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 300_000) fail('configuration', '运营 HTTP 配置无效')
  }
  async status(): Promise<CommercialIncidentV1[]> { const row = record(await this.post('/v1/operations/status', {}, null), 'status'); exact(row, ['incidents'], 'status'); return Array.isArray(row.incidents) ? row.incidents.map(parseIncident) : fail('protocol', 'incidents 无效') }
  async myTickets(accessToken: string) { return this.array('/v1/operations/support/mine', accessToken, parseTicket) }
  async openTicket(input: { accessToken: string; requestId: string; category: CommercialSupportTicketV1['category']; subject: string; body: string; orderId: string | null; priority: CommercialSupportTicketV1['priority'] }) { const { accessToken, ...body } = input; return parseTicket(await this.post('/v1/operations/support/open', body, accessToken)) }
  async replyTicket(input: { accessToken: string; requestId: string; ticketId: string; body: string }) { const { accessToken, ...body } = input; return parseTicket(await this.post('/v1/operations/support/reply', { ...body, internal: false, resolve: false }, accessToken)) }
  async myPayoutAccounts(accessToken: string) { return this.array('/v1/operations/payout-accounts/mine', accessToken, parsePayoutAccount) }
  async registerPayoutAccount(input: { accessToken: string; requestId: string; providerAccountKey: string; countryCode: string; currencies: string[] }) { const { accessToken, ...body } = input; return parsePayoutAccount(await this.post('/v1/operations/payout-accounts', body, accessToken)) }
  async balance(accessToken: string, currency: string): Promise<number> { const row = record(await this.post('/v1/operations/payouts/balance', { currency }, accessToken), 'balance'); exact(row, ['currency', 'amountMinor'], 'balance'); if (row.currency !== currency) fail('protocol', 'balance currency 不一致'); return integer(row.amountMinor, 'amountMinor') }
  async myPayouts(accessToken: string) { return this.array('/v1/operations/payouts/mine', accessToken, parsePayout) }
  async requestPayout(input: { accessToken: string; requestId: string; accountId: string; currency: string; amountMinor: number }) { const { accessToken, ...body } = input; return parsePayout(await this.post('/v1/operations/payouts', body, accessToken)) }
  async myDeletions(accessToken: string) { return this.array('/v1/operations/privacy/deletions/mine', accessToken, parseDeletion) }
  async requestDeletion(input: { accessToken: string; requestId: string; scope: CommercialDeletionRequestV1['scope']; reason: string }) { const { accessToken, ...body } = input; return parseDeletion(await this.post('/v1/operations/privacy/deletions', body, accessToken)) }
  private async array<T>(path: string, token: string, parser: (value: unknown) => T): Promise<T[]> { const value = await this.post(path, {}, token); if (!Array.isArray(value) || value.length > 100_000) fail('protocol', `${path} 响应无效`); return value.map(parser) }
  private async post(path: string, body: unknown, token: string | null): Promise<unknown> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: controller.signal })
      const raw = await response.text(); let value: unknown
      try { value = raw ? JSON.parse(raw) : null } catch { fail('protocol', '运营服务返回了非 JSON') }
      if (!response.ok) { const row = record(value, 'error'); const code = typeof row.code === 'string' ? row.code : 'http_error'; const message = typeof row.message === 'string' ? row.message : `HTTP ${response.status}`; fail(code, message, response.status >= 500 || response.status === 429, response.status) }
      return value
    } catch (error) {
      if (error instanceof CommercialOperationsHttpErrorV1) throw error
      if (controller.signal.aborted) fail('timeout', '运营服务请求超时', true)
      fail('network', '无法连接运营服务', true)
    } finally { clearTimeout(timeout) }
  }
}
