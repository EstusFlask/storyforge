import { describe, expect, it } from 'vitest'
import type { CommercialPrincipalV1 } from '../../src/lib/commercial/authority'
import { CommercialOperationsAuthorityV1, type CommercialOperationsPersistenceV1, type CommercialOperationsSnapshotV1 } from '../../src/lib/commercial/operations-authority'
import { createCommercialOperationsGatewayV1 } from '../../src/lib/commercial/operations-gateway'
import { CommercialOperationsHttpClientV1 } from '../../src/lib/commercial/operations-http-client'

class Store implements CommercialOperationsPersistenceV1 {
  snapshot: CommercialOperationsSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialOperationsSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot); return true
  }
}

describe('COMMERCIAL-1 · operations browser HTTP adapter', () => {
  it('通过真实 Request/Response 形状读取状态、工单、结算账户与删除请求', async () => {
    const token = 'creator-browser-token-12345'
    const principal: CommercialPrincipalV1 = { userId: 'user.creator', permissions: [] }
    const authority = await CommercialOperationsAuthorityV1.create({ persistence: new Store(), now: () => 1_802_000_000_000 })
    const gateway = createCommercialOperationsGatewayV1({ authority, identity: { authenticate: async value => value === token ? principal : null } })
    const client = new CommercialOperationsHttpClientV1({
      baseUrl: 'http://127.0.0.1:3300',
      fetch: async (url, init) => {
        const parsed = new URL(url)
        const result = await gateway({ method: init.method, path: parsed.pathname, contentType: init.headers['content-type'], headers: init.headers, body: JSON.parse(init.body) })
        return { ok: result.status >= 200 && result.status < 300, status: result.status, text: async () => JSON.stringify(result.body) }
      },
    })
    await expect(client.status()).resolves.toEqual([])
    const ticket = await client.openTicket({ accessToken: token, requestId: 'ticket.open.browser', category: 'technical', subject: '房间连接失败', body: '已重试两次。', orderId: null, priority: 'normal' })
    await expect(client.myTickets(token)).resolves.toMatchObject([{ ticketId: ticket.ticketId, messages: [{ body: '已重试两次。' }] }])
    const account = await client.registerPayoutAccount({ accessToken: token, requestId: 'account.browser', providerAccountKey: 'provider.tokenized.123', countryCode: 'CN', currencies: ['CNY'] })
    await expect(client.myPayoutAccounts(token)).resolves.toMatchObject([{ accountId: account.accountId, status: 'pending-verification' }])
    await expect(client.balance(token, 'CNY')).resolves.toBe(0)
    await expect(client.myPayouts(token)).resolves.toEqual([])
    const deletion = await client.requestDeletion({ accessToken: token, requestId: 'deletion.browser', scope: 'profile', reason: '不再使用托管资料。' })
    await expect(client.myDeletions(token)).resolves.toMatchObject([{ deletionId: deletion.deletionId, status: 'requested' }])
  })

  it('服务端响应扩张与非 JSON 均 fail-closed', async () => {
    const expanded = new CommercialOperationsHttpClientV1({
      baseUrl: 'https://platform.storyforge.test',
      fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ incidents: [], secret: true }) }),
    })
    await expect(expanded.status()).rejects.toThrow('字段不符合协议')
    const nonJson = new CommercialOperationsHttpClientV1({
      baseUrl: 'https://platform.storyforge.test',
      fetch: async () => ({ ok: true, status: 200, text: async () => '<html>proxy error</html>' }),
    })
    await expect(nonJson.status()).rejects.toThrow('非 JSON')
  })
})
