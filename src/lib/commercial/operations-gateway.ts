import {
  CommercialAuthorityErrorV1,
  type CommercialOrderV1,
  type CommercialPrincipalV1,
} from './authority'
import type { CommercialIdentityV1 } from './gateway'
import {
  CommercialOperationsAuthorityV1,
  type CommercialDeletionRequestV1,
  type CommercialIncidentV1,
  type CommercialSupportTicketV1,
  type CommercialTaxQuoteV1,
} from './operations-authority'

export interface CommercialOperationsGatewayRequestV1 {
  method: string
  path: string
  contentType: string
  headers: Record<string, string | undefined>
  body: unknown
}

export interface CommercialOperationsGatewayResponseV1 {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface CommercialOperationsGatewayAuditV1 {
  path: string
  userId: string | null
  requestId: string | null
  subjectId: string | null
  outcome: 'accepted' | 'rejected'
  code: string
  status: number
  latencyMs: number
}

function fail(code: string, message: string): never { throw new CommercialAuthorityErrorV1(code, message) }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', '请求体必须是对象')
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.has(key))) {
    fail('protocol', '请求字段不符合协议')
  }
}

function header(headers: Record<string, string | undefined>, name: string): string | null {
  return Object.entries(headers).find(([candidate]) => candidate.toLocaleLowerCase() === name)?.[1] ?? null
}

async function authenticate(identity: CommercialIdentityV1, request: CommercialOperationsGatewayRequestV1): Promise<CommercialPrincipalV1> {
  const match = header(request.headers, 'authorization')?.match(/^Bearer ([^\s]{16,2000})$/)
  if (!match) fail('unauthorized', '缺少有效 Bearer 凭据')
  const principal = await identity.authenticate(match[1])
  if (!principal) fail('unauthorized', '身份凭据无效或已过期')
  return principal
}

function response(status: number, body: unknown): CommercialOperationsGatewayResponseV1 {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    body,
  }
}

function statusFor(code: string): number {
  if (code === 'unauthorized') return 401
  if (code === 'forbidden') return 403
  if (['payout_account_missing', 'payout_missing', 'ticket_missing', 'deletion_missing', 'invoice_missing'].includes(code)) return 404
  if (['request_conflict', 'invalid_transition', 'already_recorded', 'deletion_pending', 'persistence_conflict'].includes(code)) return 409
  if (code === 'payload_too_large') return 413
  if (['tax_rule_missing', 'payout_account_unavailable'].includes(code)) return 422
  if (code === 'protocol') return 422
  return 400
}

function idFrom(value: Record<string, unknown>): string | null {
  for (const key of ['incidentId', 'deletionId', 'ticketId', 'payoutId', 'accountId', 'orderId', 'ruleId']) {
    if (typeof value[key] === 'string') return value[key] as string
  }
  return null
}

/**
 * Framework-neutral boundary for finance, support, privacy and status
 * operations. Bearer credentials, ticket bodies and payout provider refs are
 * intentionally absent from the audit contract.
 */
export function createCommercialOperationsGatewayV1(input: {
  authority: CommercialOperationsAuthorityV1
  identity: CommercialIdentityV1
  audit?: (entry: CommercialOperationsGatewayAuditV1) => void | Promise<void>
  now?: () => number
}) {
  const now = input.now ?? (() => Date.now())
  return async (request: CommercialOperationsGatewayRequestV1): Promise<CommercialOperationsGatewayResponseV1> => {
    const startedAt = now()
    let userId: string | null = null
    let requestId: string | null = null
    let subjectId: string | null = null
    let code = 'ok'
    let result = response(500, { code: 'internal_error', message: '商业运营服务未产生响应' })
    try {
      if (request.method.toUpperCase() !== 'POST') {
        code = 'method_not_allowed'; result = response(405, { code, message: '只支持 POST' })
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        code = 'unsupported_media_type'; result = response(415, { code, message: '请求必须使用 application/json' })
      } else {
        const encoded = JSON.stringify(request.body)
        if (encoded === undefined || encoded.length > 96_000) fail('payload_too_large', '请求体超过 96KB')
        const body = record(request.body)
        requestId = typeof body.requestId === 'string' ? body.requestId : null
        subjectId = idFrom(body)
        if (request.path === '/v1/operations/status') {
          fields(body, [])
          result = response(200, { incidents: input.authority.publicIncidents() })
        } else if (request.path === '/v1/operations/tax/quote') {
          fields(body, ['buyerRegion', 'currency', 'listedAmountMinor'], ['at', 'ttlMs'])
          result = response(200, await input.authority.quoteTax({
            buyerRegion: body.buyerRegion as string, currency: body.currency as string,
            listedAmountMinor: body.listedAmountMinor as number,
            at: body.at as number | undefined, ttlMs: body.ttlMs as number | undefined,
          }))
        } else {
          const principal = await authenticate(input.identity, request)
          userId = principal.userId
          if (request.path === '/v1/operations/tax/rules') {
            fields(body, ['requestId', 'ruleId', 'jurisdiction', 'buyerRegion', 'currency', 'rateBps', 'priceIncludesTax', 'effectiveFrom', 'effectiveUntil'])
            result = response(200, await input.authority.upsertTaxRule({
              principal, requestId: body.requestId as string, ruleId: body.ruleId as string,
              jurisdiction: body.jurisdiction as string, buyerRegion: body.buyerRegion as string,
              currency: body.currency as string, rateBps: body.rateBps as number,
              priceIncludesTax: body.priceIncludesTax as boolean, effectiveFrom: body.effectiveFrom as number,
              effectiveUntil: body.effectiveUntil as number | null,
            }))
          } else if (request.path === '/v1/operations/orders/paid') {
            fields(body, ['requestId', 'order', 'quote'])
            result = response(201, await input.authority.recordPaidOrder({
              principal, requestId: body.requestId as string,
              order: body.order as CommercialOrderV1, quote: body.quote as CommercialTaxQuoteV1,
            }))
          } else if (request.path === '/v1/operations/orders/refunded') {
            fields(body, ['requestId', 'order'])
            result = response(200, await input.authority.recordRefundedOrder({
              principal, requestId: body.requestId as string, order: body.order as CommercialOrderV1,
            }))
          } else if (request.path === '/v1/operations/payout-accounts') {
            fields(body, ['requestId', 'providerAccountKey', 'countryCode', 'currencies'])
            result = response(201, await input.authority.registerPayoutAccount({
              principal, requestId: body.requestId as string,
              providerAccountKey: body.providerAccountKey as string, countryCode: body.countryCode as string,
              currencies: body.currencies as string[],
            }))
          } else if (request.path === '/v1/operations/payout-accounts/review') {
            fields(body, ['requestId', 'accountId', 'status'])
            result = response(200, await input.authority.reviewPayoutAccount({
              principal, requestId: body.requestId as string, accountId: body.accountId as string,
              status: body.status as 'verified' | 'restricted',
            }))
          } else if (request.path === '/v1/operations/payout-accounts/mine') {
            fields(body, [])
            result = response(200, input.authority.payoutAccountsForCreator({ principal }))
          } else if (request.path === '/v1/operations/payouts') {
            fields(body, ['requestId', 'accountId', 'currency', 'amountMinor'])
            result = response(201, await input.authority.requestPayout({
              principal, requestId: body.requestId as string, accountId: body.accountId as string,
              currency: body.currency as string, amountMinor: body.amountMinor as number,
            }))
          } else if (request.path === '/v1/operations/payouts/result') {
            fields(body, ['requestId', 'payoutId', 'status', 'providerReference', 'failureCode'])
            result = response(200, await input.authority.applyPayoutResult({
              principal, requestId: body.requestId as string, payoutId: body.payoutId as string,
              status: body.status as 'submitted' | 'paid' | 'failed',
              providerReference: body.providerReference as string, failureCode: body.failureCode as string | null,
            }))
          } else if (request.path === '/v1/operations/payouts/mine') {
            fields(body, [])
            result = response(200, input.authority.payoutsForCreator({ principal }))
          } else if (request.path === '/v1/operations/payouts/balance') {
            fields(body, ['currency'])
            result = response(200, { currency: body.currency, amountMinor: input.authority.creatorBalance({ principal, currency: body.currency as string }) })
          } else if (request.path === '/v1/operations/support/open') {
            fields(body, ['requestId', 'category', 'subject', 'body', 'orderId', 'priority'])
            result = response(201, await input.authority.openSupportTicket({
              principal, requestId: body.requestId as string,
              category: body.category as CommercialSupportTicketV1['category'], subject: body.subject as string,
              body: body.body as string, orderId: body.orderId as string | null,
              priority: body.priority as CommercialSupportTicketV1['priority'],
            }))
          } else if (request.path === '/v1/operations/support/reply') {
            fields(body, ['requestId', 'ticketId', 'body', 'internal', 'resolve'])
            result = response(200, await input.authority.replySupportTicket({
              principal, requestId: body.requestId as string, ticketId: body.ticketId as string,
              body: body.body as string, internal: body.internal as boolean, resolve: body.resolve as boolean,
            }))
          } else if (request.path === '/v1/operations/support/get') {
            fields(body, ['ticketId'])
            result = response(200, input.authority.readSupportTicket({ principal, ticketId: body.ticketId as string }))
          } else if (request.path === '/v1/operations/support/mine') {
            fields(body, [])
            result = response(200, input.authority.supportTicketsForPrincipal({ principal }))
          } else if (request.path === '/v1/operations/privacy/deletions') {
            fields(body, ['requestId', 'scope', 'reason'])
            result = response(201, await input.authority.requestDataDeletion({
              principal, requestId: body.requestId as string,
              scope: body.scope as CommercialDeletionRequestV1['scope'], reason: body.reason as string,
            }))
          } else if (request.path === '/v1/operations/privacy/deletions/review') {
            fields(body, ['requestId', 'deletionId', 'decision', 'legalHoldCode'])
            result = response(200, await input.authority.reviewDataDeletion({
              principal, requestId: body.requestId as string, deletionId: body.deletionId as string,
              decision: body.decision as 'approve' | 'reject' | 'legal-hold',
              legalHoldCode: body.legalHoldCode as string | null,
            }))
          } else if (request.path === '/v1/operations/privacy/deletions/mine') {
            fields(body, [])
            result = response(200, input.authority.deletionRequestsForPrincipal({ principal }))
          } else if (request.path === '/v1/operations/privacy/deletions/complete') {
            fields(body, ['requestId', 'deletionId', 'deletedCategories', 'deletedRecordCount', 'preservedCategories'])
            result = response(200, await input.authority.completeDataDeletion({
              principal, requestId: body.requestId as string, deletionId: body.deletionId as string,
              deletedCategories: body.deletedCategories as string[], deletedRecordCount: body.deletedRecordCount as number,
              preservedCategories: body.preservedCategories as string[],
            }))
          } else if (request.path === '/v1/operations/incidents') {
            fields(body, ['requestId', 'incidentId', 'title', 'severity', 'status', 'publicMessage', 'affectedServices'])
            result = response(200, await input.authority.upsertIncident({
              principal, requestId: body.requestId as string, incidentId: body.incidentId as string | null,
              title: body.title as string, severity: body.severity as CommercialIncidentV1['severity'],
              status: body.status as CommercialIncidentV1['status'], publicMessage: body.publicMessage as string,
              affectedServices: body.affectedServices as string[],
            }))
          } else {
            code = 'endpoint_not_found'; result = response(404, { code, message: '商业运营端点不存在' })
          }
        }
      }
    } catch (error) {
      if (error instanceof CommercialAuthorityErrorV1) {
        code = error.code
        result = response(statusFor(code), { code, message: error.message.replace(/^\[commercial-authority:[^\]]+\]\s*/, '') })
      } else {
        code = 'internal_error'; result = response(500, { code, message: '商业运营服务发生内部错误' })
      }
    }
    await input.audit?.({
      path: request.path, userId, requestId, subjectId,
      outcome: result.status < 400 ? 'accepted' : 'rejected', code, status: result.status,
      latencyMs: Math.max(0, now() - startedAt),
    })
    return result
  }
}
