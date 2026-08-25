export interface CommercialPaymentEventV1 {
  schema: 'storyforge.payment-event'
  version: 1
  eventId: string
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'dispute.opened'
  orderId: string
  providerReference: string
  currency: string
  amountMinor: number
  occurredAt: number
}

export class CommercialWebhookErrorV1 extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[commercial-webhook:${code}] ${message}`)
    this.name = 'CommercialWebhookErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new CommercialWebhookErrorV1(code, message)
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    fail('protocol', `${label} 字段不符合协议`)
  }
}

function stableKey(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value || value.length > maximum
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail('protocol', `${label} 无效`)
  return value
}

export function parseCommercialPaymentEventV1(input: string | unknown): CommercialPaymentEventV1 {
  let value: unknown = input
  if (typeof input === 'string') {
    try { value = JSON.parse(input) } catch { fail('protocol', '支付事件不是合法 JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', '支付事件必须是对象')
  const event = value as Record<string, unknown>
  exactKeys(event, [
    'schema', 'version', 'eventId', 'type', 'orderId', 'providerReference',
    'currency', 'amountMinor', 'occurredAt',
  ], '支付事件')
  if (event.schema !== 'storyforge.payment-event' || event.version !== 1) fail('protocol', '支付事件版本无效')
  if (!['payment.succeeded', 'payment.failed', 'refund.succeeded', 'dispute.opened'].includes(String(event.type))) {
    fail('protocol', '支付事件类型无效')
  }
  if (typeof event.currency !== 'string' || !/^[A-Z]{3}$/.test(event.currency)) fail('protocol', 'currency 无效')
  if (!Number.isInteger(event.amountMinor) || Number(event.amountMinor) < 0 || Number(event.amountMinor) > 1_000_000_000) {
    fail('protocol', 'amountMinor 无效')
  }
  if (!Number.isInteger(event.occurredAt) || Number(event.occurredAt) < 0) fail('protocol', 'occurredAt 无效')
  return {
    schema: 'storyforge.payment-event',
    version: 1,
    eventId: stableKey(event.eventId, 'eventId'),
    type: event.type as CommercialPaymentEventV1['type'],
    orderId: stableKey(event.orderId, 'orderId'),
    providerReference: stableKey(event.providerReference, 'providerReference', 500),
    currency: event.currency,
    amountMinor: Number(event.amountMinor),
    occurredAt: Number(event.occurredAt),
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

async function hmac(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))
}

function signatureParts(header: string): { timestamp: number; signature: string } {
  if (header.length > 512) fail('signature', '支付签名头无效')
  const rows = header.split(',').map(part => {
    const [key, ...rest] = part.trim().split('=')
    return [key, rest.join('=')] as const
  })
  if (rows.length !== 2 || new Set(rows.map(([key]) => key)).size !== 2
    || !rows.some(([key]) => key === 't') || !rows.some(([key]) => key === 'v1')) {
    fail('signature', '支付签名头无效')
  }
  const parts = new Map(rows)
  const timestamp = Number(parts.get('t'))
  const signature = parts.get('v1') ?? ''
  if (!Number.isInteger(timestamp) || timestamp < 0 || !/^[0-9a-f]{64}$/i.test(signature)) {
    fail('signature', '支付签名头无效')
  }
  return { timestamp, signature: signature.toLowerCase() }
}

/** Test/provider adapter helper; the secret must live in a server secret manager. */
export async function signCommercialWebhookV1(input: {
  rawBody: string
  secret: string
  timestamp: number
}): Promise<string> {
  if (!input.secret || input.secret.length < 16) fail('configuration', 'webhook secret 长度不足')
  const signature = await hmac(input.secret, `${input.timestamp}.${input.rawBody}`)
  return `t=${input.timestamp},v1=${signature}`
}

/** Verifies exact raw bytes before parsing; callers must not re-stringify JSON. */
export async function verifyCommercialWebhookV1(input: {
  rawBody: string
  signatureHeader: string
  secret: string
  now?: number
  toleranceMs?: number
}): Promise<CommercialPaymentEventV1> {
  return verifyCommercialWebhookWithSecretsV1({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    secrets: [input.secret],
    now: input.now,
    toleranceMs: input.toleranceMs,
  })
}

/**
 * Bounded rotation verifier. Deployments may expose the current key and one
 * overlap key; older keys are rejected even if a secret manager accidentally
 * returns a longer history.
 */
export async function verifyCommercialWebhookWithSecretsV1(input: {
  rawBody: string
  signatureHeader: string
  secrets: string[]
  now?: number
  toleranceMs?: number
}): Promise<CommercialPaymentEventV1> {
  if (!Array.isArray(input.secrets) || input.secrets.length < 1 || input.secrets.length > 2
    || input.secrets.some(secret => typeof secret !== 'string' || secret.length < 16)
    || new Set(input.secrets).size !== input.secrets.length) {
    fail('configuration', 'webhook 验证密钥集合无效')
  }
  if (new TextEncoder().encode(input.rawBody).byteLength > 256_000) {
    fail('payload_too_large', '支付 webhook 超过 256KB')
  }
  const { timestamp, signature } = signatureParts(input.signatureHeader)
  const now = input.now ?? Date.now()
  const toleranceMs = input.toleranceMs ?? 5 * 60_000
  if (!Number.isInteger(toleranceMs) || toleranceMs < 1_000 || toleranceMs > 30 * 60_000) {
    fail('configuration', '签名容差必须为 1～30 分钟')
  }
  if (Math.abs(now - timestamp) > toleranceMs) fail('stale', '支付 webhook 超出时间容差')
  const expected = await Promise.all(input.secrets.map(secret => hmac(secret, `${timestamp}.${input.rawBody}`)))
  // Evaluate every bounded candidate so the selected rotation key is not
  // exposed through an early-return timing branch.
  const verified = expected.map(candidate => timingSafeEqualHex(signature, candidate))
    .reduce((matched, candidate) => matched || candidate, false)
  if (!verified) fail('signature', '支付 webhook 签名无效')
  return parseCommercialPaymentEventV1(input.rawBody)
}
