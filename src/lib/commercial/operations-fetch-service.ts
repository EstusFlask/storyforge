import type { CommercialOperationsGatewayRequestV1, CommercialOperationsGatewayResponseV1 } from './operations-gateway'

type HandlerV1 = (request: CommercialOperationsGatewayRequestV1) => Promise<CommercialOperationsGatewayResponseV1>

function origin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('[commercial-operations-fetch:configuration] allowedOrigins 必须是纯 http(s) origin')
  }
  return url.origin
}
function json(status: number, body: unknown, headers: Record<string, string>): Response { return new Response(JSON.stringify(body), { status, headers }) }

export function createCommercialOperationsFetchHandlerV1(input: {
  gateway: HandlerV1
  allowedOrigins: string[]
  serviceVersion?: string
  maximumBodyBytes?: number
}) {
  const origins = new Set(input.allowedOrigins.map(origin))
  if (origins.size !== input.allowedOrigins.length) throw new Error('[commercial-operations-fetch:configuration] allowedOrigins 不能重复')
  const maximumBodyBytes = input.maximumBodyBytes ?? 96_000
  if (!Number.isInteger(maximumBodyBytes) || maximumBodyBytes < 1_024 || maximumBodyBytes > 1_000_000) throw new Error('[commercial-operations-fetch:configuration] maximumBodyBytes 无效')
  const serviceVersion = input.serviceVersion?.trim() || 'development'
  if (serviceVersion.length > 100 || /[\r\n]/.test(serviceVersion)) throw new Error('[commercial-operations-fetch:configuration] serviceVersion 无效')
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const requestOrigin = request.headers.get('origin')
    const normalized = requestOrigin ? (() => { try { return origin(requestOrigin) } catch { return null } })() : null
    const allowed = !requestOrigin || (normalized != null && origins.has(normalized))
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'cross-origin', 'x-storyforge-service-version': serviceVersion, vary: 'origin',
    }
    if (allowed && normalized) headers['access-control-allow-origin'] = normalized
    if (!allowed) return json(403, { code: 'origin_forbidden', message: '请求 Origin 未获运营服务授权' }, headers)
    if (request.method.toUpperCase() === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, accept', 'access-control-max-age': '600' } })
    if (url.search || url.hash) return json(400, { code: 'query_forbidden', message: '运营 API 不接受 query 或 fragment' }, headers)
    if (url.pathname === '/healthz/operations') return request.method.toUpperCase() === 'GET' ? json(200, { status: 'ok', protocolVersion: 1, serviceVersion }, headers) : json(405, { code: 'method_not_allowed', message: '健康检查只支持 GET' }, headers)
    const declared = request.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBodyBytes)) return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBodyBytes} bytes` }, headers)
    let raw: string
    try { raw = await request.text() } catch { return json(400, { code: 'body_unreadable', message: '无法读取请求体' }, headers) }
    if (new TextEncoder().encode(raw).byteLength > maximumBodyBytes) return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBodyBytes} bytes` }, headers)
    let body: unknown
    try { body = JSON.parse(raw) } catch { return json(400, { code: 'invalid_json', message: '请求体不是合法 JSON' }, headers) }
    try {
      const response = await input.gateway({ method: request.method, path: url.pathname, contentType: request.headers.get('content-type') ?? '', headers: Object.fromEntries(request.headers.entries()), body })
      return json(response.status, response.body, { ...headers, ...response.headers })
    } catch { return json(500, { code: 'service_unavailable', message: '商业运营服务暂时不可用' }, headers) }
  }
}
