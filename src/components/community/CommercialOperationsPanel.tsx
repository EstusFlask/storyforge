import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleDollarSign, Headphones, Loader2, RefreshCw, ServerCog, ShieldCheck } from 'lucide-react'
import { CommercialOperationsHttpClientV1 } from '../../lib/commercial/operations-http-client'
import type {
  CommercialDeletionRequestV1,
  CommercialIncidentV1,
  CommercialPayoutAccountV1,
  CommercialPayoutV1,
  CommercialSupportTicketV1,
} from '../../lib/commercial/operations-authority'

type OperationsClientV1 = Pick<CommercialOperationsHttpClientV1,
  'status' | 'myTickets' | 'openTicket' | 'replyTicket' | 'myPayoutAccounts' | 'registerPayoutAccount'
  | 'balance' | 'myPayouts' | 'requestPayout' | 'myDeletions' | 'requestDeletion'>

export default function CommercialOperationsPanel(props: { client: OperationsClientV1 | null; accessToken: string }) {
  const [mode, setMode] = useState<'status' | 'support' | 'settlement' | 'privacy'>('status')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [incidents, setIncidents] = useState<CommercialIncidentV1[]>([])
  const [tickets, setTickets] = useState<CommercialSupportTicketV1[]>([])
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketBody, setTicketBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<CommercialPayoutAccountV1[]>([])
  const [payouts, setPayouts] = useState<CommercialPayoutV1[]>([])
  const [balance, setBalance] = useState(0)
  const [providerAccountKey, setProviderAccountKey] = useState('')
  const [payoutAmount, setPayoutAmount] = useState(0)
  const [deletions, setDeletions] = useState<CommercialDeletionRequestV1[]>([])
  const [deletionScope, setDeletionScope] = useState<CommercialDeletionRequestV1['scope']>('profile')
  const [deletionReason, setDeletionReason] = useState('')
  const requestIds = useRef(new Map<string, string>())
  const requestId = (key: string) => {
    const prior = requestIds.current.get(key)
    if (prior) return prior
    const next = `operations.${crypto.randomUUID()}`
    requestIds.current.set(key, next)
    return next
  }
  const run = useCallback(async (key: string, operation: () => Promise<void>) => {
    setBusy(key); setError(''); setMessage('')
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(null) }
  }, [])
  const token = props.accessToken.trim()
  const requireAccount = () => {
    if (!props.client) throw new Error('请先配置平台服务地址。')
    if (!token) throw new Error('请输入账号访问凭据。')
    return props.client
  }
  const loadStatus = useCallback(() => run('status', async () => {
    if (!props.client) throw new Error('请先配置平台服务地址。')
    setIncidents(await props.client.status())
  }), [props.client, run])
  useEffect(() => { if (props.client) void loadStatus() }, [loadStatus, props.client])
  const loadTickets = () => run('tickets', async () => setTickets(await requireAccount().myTickets(token)))
  const openTicket = () => run('ticket-open', async () => {
    const ticket = await requireAccount().openTicket({ accessToken: token, requestId: requestId(`ticket:${ticketSubject}:${ticketBody}`), category: 'technical', subject: ticketSubject.trim(), body: ticketBody.trim(), orderId: null, priority: 'normal' })
    setTickets(current => [ticket, ...current]); setSelectedTicketId(ticket.ticketId); setMessage('工单已提交，正文只对你和客服可见。')
  })
  const reply = () => run('ticket-reply', async () => {
    if (!selectedTicketId) throw new Error('请先选择工单。')
    const ticket = await requireAccount().replyTicket({ accessToken: token, requestId: requestId(`reply:${selectedTicketId}:${replyBody}`), ticketId: selectedTicketId, body: replyBody.trim() })
    setTickets(current => current.map(row => row.ticketId === ticket.ticketId ? ticket : row)); setReplyBody('')
  })
  const loadSettlement = () => run('settlement', async () => {
    const client = requireAccount()
    const [nextAccounts, nextPayouts, nextBalance] = await Promise.all([client.myPayoutAccounts(token), client.myPayouts(token), client.balance(token, 'CNY')])
    setAccounts(nextAccounts); setPayouts(nextPayouts); setBalance(nextBalance)
  })
  const registerAccount = () => run('account-register', async () => {
    const account = await requireAccount().registerPayoutAccount({ accessToken: token, requestId: requestId(`account:${providerAccountKey}`), providerAccountKey: providerAccountKey.trim(), countryCode: 'CN', currencies: ['CNY'] })
    setAccounts(current => [account, ...current]); setMessage('结算账户令牌已登记，须经财务验证后才能提现。')
  })
  const requestPayout = () => run('payout', async () => {
    const account = accounts.find(row => row.status === 'verified')
    if (!account) throw new Error('没有已验证的 CNY 结算账户。')
    const payout = await requireAccount().requestPayout({ accessToken: token, requestId: requestId(`payout:${account.accountId}:${payoutAmount}`), accountId: account.accountId, currency: 'CNY', amountMinor: payoutAmount })
    setPayouts(current => [payout, ...current]); setBalance(current => current - payout.amountMinor); setMessage('提现申请已创建，金额已从可用余额预留。')
  })
  const loadPrivacy = () => run('privacy', async () => setDeletions(await requireAccount().myDeletions(token)))
  const requestDeletion = () => run('deletion', async () => {
    const deletion = await requireAccount().requestDeletion({ accessToken: token, requestId: requestId(`deletion:${deletionScope}:${deletionReason}`), scope: deletionScope, reason: deletionReason.trim() })
    setDeletions(current => [deletion, ...current]); setMessage('数据删除请求已登记；依法保留的数据会在完成回执中单列。')
  })
  const selectedTicket = tickets.find(row => row.ticketId === selectedTicketId) ?? null

  return <section className="space-y-4 rounded-lg border border-border bg-bg-elevated p-5" data-testid="commercial-operations">
    <div className="flex flex-wrap items-center gap-2"><ServerCog className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">服务、支持、结算与隐私</h3>{busy && <Loader2 className="ml-auto h-4 w-4 animate-spin text-accent" />}</div>
    <div className="flex flex-wrap gap-2">{([['status', '服务状态'], ['support', '客户支持'], ['settlement', '创作者结算'], ['privacy', '数据与隐私']] as const).map(([value, label]) => <button key={value} onClick={() => setMode(value)} className={`rounded border px-3 py-2 text-xs ${mode === value ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>{label}</button>)}</div>
    {mode === 'status' ? <div><button disabled={busy != null || !props.client} onClick={() => void loadStatus()} className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs text-text-primary"><RefreshCw className="h-3.5 w-3.5" />刷新状态</button><div className="mt-3 space-y-2">{incidents.map(row => <article key={row.incidentId} className="rounded border border-border bg-bg-base p-3"><strong className="text-xs text-text-primary">{row.title} · {row.status}</strong><p className="mt-1 text-xs text-text-muted">{row.publicMessage}</p></article>)}{!incidents.length && <p className="text-xs text-success">当前没有已公布的服务事件。</p>}</div></div>
      : mode === 'support' ? <div className="grid gap-4 lg:grid-cols-2"><div><div className="flex gap-2"><Headphones className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">我的工单</strong><button onClick={() => void loadTickets()} disabled={busy != null} className="ml-auto text-[10px] text-accent">同步</button></div><div className="mt-2 space-y-2">{tickets.map(row => <button key={row.ticketId} onClick={() => setSelectedTicketId(row.ticketId)} className="block w-full rounded border border-border bg-bg-base p-3 text-left"><span className="text-xs text-text-primary">{row.subject}</span><span className="float-right text-[10px] text-text-muted">{row.status}</span></button>)}</div><div className="mt-3 grid gap-2"><input aria-label="工单主题" value={ticketSubject} onChange={event => setTicketSubject(event.target.value)} placeholder="问题主题" className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><textarea aria-label="工单正文" value={ticketBody} onChange={event => setTicketBody(event.target.value)} placeholder="请描述可复现步骤；不要粘贴密码或支付凭据" className="min-h-24 rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={!ticketSubject.trim() || !ticketBody.trim() || busy != null} onClick={() => void openTicket()} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">提交工单</button></div></div><div>{selectedTicket ? <><strong className="text-xs text-text-primary">{selectedTicket.subject}</strong><div className="mt-2 max-h-64 space-y-2 overflow-auto">{selectedTicket.messages.map(row => <p key={row.messageId} className="rounded bg-bg-base p-2 text-xs text-text-muted">{row.body}</p>)}</div><textarea aria-label="工单回复" value={replyBody} onChange={event => setReplyBody(event.target.value)} className="mt-2 min-h-20 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={!replyBody.trim() || busy != null} onClick={() => void reply()} className="mt-2 rounded border border-accent px-3 py-2 text-xs text-accent">回复</button></> : <p className="text-xs text-text-muted">选择一张工单查看面向请求者的消息；内部客服备注不会返回。</p>}</div></div>
      : mode === 'settlement' ? <div><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">可结算余额 ¥{(balance / 100).toFixed(2)}</strong><button onClick={() => void loadSettlement()} disabled={busy != null} className="ml-auto text-[10px] text-accent">同步</button></div><div className="mt-3 grid gap-2 md:grid-cols-2"><input aria-label="结算提供方账户令牌" value={providerAccountKey} onChange={event => setProviderAccountKey(event.target.value)} placeholder="支付提供方返回的账户令牌，不是银行卡号" className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={!providerAccountKey.trim() || busy != null} onClick={() => void registerAccount()} className="rounded border border-border px-3 py-2 text-xs text-text-primary">登记结算账户</button><input aria-label="提现金额" type="number" min={1} value={payoutAmount} onChange={event => setPayoutAmount(Math.max(0, Number(event.target.value) || 0))} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={payoutAmount < 1 || payoutAmount > balance || busy != null} onClick={() => void requestPayout()} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">申请提现（分）</button></div><div className="mt-3 text-[10px] text-text-muted">账户：{accounts.map(row => `${row.accountId} ${row.status}`).join('；') || '暂无'}<br />提现：{payouts.map(row => `${row.payoutId} ${row.status}`).join('；') || '暂无'}</div></div>
      : <div><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">托管数据删除</strong><button onClick={() => void loadPrivacy()} disabled={busy != null} className="ml-auto text-[10px] text-accent">同步</button></div><p className="mt-2 text-xs leading-5 text-text-muted">仅影响平台托管数据；浏览器内作品和已合法导出的离线副本不受远程删除命令控制。财务与合规留存会明确写入完成回执。</p><div className="mt-3 grid gap-2 md:grid-cols-2"><select aria-label="删除范围" value={deletionScope} onChange={event => setDeletionScope(event.target.value as CommercialDeletionRequestV1['scope'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="profile">个人资料</option><option value="community-content">社区内容</option><option value="all-hosted-data">全部托管数据</option></select><input aria-label="删除原因" value={deletionReason} onChange={event => setDeletionReason(event.target.value)} placeholder="说明请求原因" className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></div><button disabled={!deletionReason.trim() || busy != null} onClick={() => void requestDeletion()} className="mt-2 rounded border border-danger/50 px-3 py-2 text-xs text-danger disabled:opacity-40">提交删除请求</button><div className="mt-3 space-y-1">{deletions.map(row => <p key={row.deletionId} className="text-[10px] text-text-muted">{row.deletionId} · {row.scope} · {row.status}{row.execution ? ` · receipt ${row.execution.receiptHash}` : ''}</p>)}</div></div>}
    {message && <p className="rounded border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
    {error && <p className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
  </section>
}
