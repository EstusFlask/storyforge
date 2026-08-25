import type { CommercialOrderV1, CommercialPrincipalV1 } from './authority'
import type { CommercialPaymentSettlementV1 } from './gateway'
import type { CommercialTaxQuoteV1 } from './operations-authority'
import { CommercialOperationsAuthorityV1 } from './operations-authority'

export interface CommercialTaxQuoteResolverV1 {
  prepareForOrder(input: { order: CommercialOrderV1; buyer: CommercialPrincipalV1 }): Promise<CommercialTaxQuoteV1>
  quoteForOrder(order: CommercialOrderV1): Promise<CommercialTaxQuoteV1 | null>
}

/**
 * At-least-once bridge from signed payment events into tax invoices and creator
 * balances. Stable event-derived request IDs make retries safe after a partial
 * failure between the two independently durable authorities.
 */
export function createCommercialSettlementCoordinatorV1(input: {
  operations: CommercialOperationsAuthorityV1
  financePrincipal: CommercialPrincipalV1
  taxQuotes: CommercialTaxQuoteResolverV1
}): CommercialPaymentSettlementV1 {
  if (!input.financePrincipal.permissions.includes('commerce:finance')) {
    throw new Error('[commercial-settlement:configuration] financePrincipal 缺少 commerce:finance')
  }
  return {
    async prepare({ order, buyer }) {
      const quote = await input.taxQuotes.prepareForOrder({ order, buyer })
      if (quote.currency !== order.currency || quote.totalMinor !== order.amountMinor) {
        throw new Error('[commercial-settlement:quote_mismatch] 仅允许含税报价且总额必须等于冻结订单金额')
      }
    },
    async record({ event, order }) {
      if (event.type === 'payment.succeeded') {
        const quote = await input.taxQuotes.quoteForOrder(order)
        if (!quote) throw new Error('[commercial-settlement:quote_missing] 已支付订单缺少冻结税务报价')
        await input.operations.recordPaidOrder({
          principal: input.financePrincipal,
          requestId: `settlement.${event.eventId}`,
          order,
          quote,
        })
      } else if (event.type === 'refund.succeeded') {
        await input.operations.recordRefundedOrder({
          principal: input.financePrincipal,
          requestId: `settlement.${event.eventId}`,
          order,
        })
      }
    },
  }
}
