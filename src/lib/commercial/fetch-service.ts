import type { CommercialGatewayRequestV1, CommercialGatewayResponseV1 } from './gateway'
import type {
  CommercialReleaseDeliveryGatewayRequestV1,
  CommercialReleaseDeliveryGatewayResponseV1,
} from './release-delivery-gateway'

type CommercialHandlerV1 = (request: CommercialGatewayRequestV1) => Promise<CommercialGatewayResponseV1>
type DeliveryHandlerV1 = (
  request: CommercialReleaseDeliveryGatewayRequestV1,
) => Promise<CommercialReleaseDeliveryGatewayResponseV1>

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('[commercial-fetch:configuration] allowedOrigins 必须是纯 http(s) origin')
  }
  return url.origin
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

/** Web-standard deployment boundary for catalog, checkout, webhook and large release delivery. */
export function createCommercialFetchHandlerV1(input: {
  commercialGateway: CommercialHandlerV1
  deliveryGateway: DeliveryHandlerV1
  allowedOrigins: string[]
  serviceVersion?: string
  maximumCommandBytes?: number
  maximumDistributionBytes?: number
}) {
  const allowedOrigins = new Set(input.allowedOrigins.map(normalizeOrigin))
  if (allowedOrigins.size !== input.allowedOrigins.length) {
    throw new Error('[commercial-fetch:configuration] allowedOrigins 不能重复')
  }
  const maximumCommandBytes = input.maximumCommandBytes ?? 96_000
  const maximumDistributionBytes = input.maximumDistributionBytes ?? 360 * 1024 * 1024
  if (!Number.isInteger(maximumCommandBytes) || maximumCommandBytes < 1_024 || maximumCommandBytes > 1_000_000
    || !Number.isInteger(maximumDistributionBytes) || maximumDistributionBytes < 1_000_000
    || maximumDistributionBytes > 400 * 1024 * 1024) {
    throw new Error('[commercial-fetch:configuration] 请求大小限制无效')
  }
  const serviceVersion = input.serviceVersion?.trim() || 'development'
  if (serviceVersion.length > 100 || /[\r\n]/.test(serviceVersion)) {
    throw new Error('[commercial-fetch:configuration] serviceVersion 无效')
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    const normalizedRequestOrigin = origin ? (() => {
      try { return normalizeOrigin(origin) } catch { return null }
    })() : null
    const originAllowed = !origin || (normalizedRequestOrigin != null && allowedOrigins.has(normalizedRequestOrigin))
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'cross-origin', 'x-storyforge-service-version': serviceVersion,
      vary: 'origin',
    }
    if (originAllowed && normalizedRequestOrigin) headers['access-control-allow-origin'] = normalizedRequestOrigin
    if (!originAllowed) return json(403, { code: 'origin_forbidden', message: '请求 Origin 未获市场服务授权' }, headers)
    if (request.method.toUpperCase() === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, accept, x-storyforge-signature',
          'access-control-max-age': '600',
        },
      })
    }
    if (url.search || url.hash) {
      return json(400, { code: 'query_forbidden', message: '市场 API 不接受 query 或 fragment' }, headers)
    }
    if (url.pathname === '/healthz') {
      return request.method.toUpperCase() === 'GET'
        ? json(200, { status: 'ok', protocolVersion: 1, serviceVersion }, headers)
        : json(405, { code: 'method_not_allowed', message: '健康检查只支持 GET' }, headers)
    }
    const isDistributionUpload = url.pathname === '/v1/commercial/releases/register'
    const maximumBytes = isDistributionUpload ? maximumDistributionBytes : maximumCommandBytes
    const contentLength = request.headers.get('content-length')
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
      return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBytes} bytes` }, headers)
    }
    let rawBody: string
    try { rawBody = await request.text() } catch {
      return json(400, { code: 'body_unreadable', message: '无法读取请求体' }, headers)
    }
    if (new TextEncoder().encode(rawBody).byteLength > maximumBytes) {
      return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBytes} bytes` }, headers)
    }
    let body: unknown
    try { body = JSON.parse(rawBody) } catch {
      return json(400, { code: 'invalid_json', message: '请求体不是合法 JSON' }, headers)
    }
    try {
      const requestHeaders = Object.fromEntries(request.headers.entries())
      const gatewayResponse = url.pathname.startsWith('/v1/commercial/releases/')
        ? await input.deliveryGateway({
            method: request.method, path: url.pathname,
            contentType: request.headers.get('content-type') ?? '', headers: requestHeaders, body,
          })
        : await input.commercialGateway({
            method: request.method, path: url.pathname,
            contentType: request.headers.get('content-type') ?? '', headers: requestHeaders, body, rawBody,
          })
      return json(gatewayResponse.status, gatewayResponse.body, { ...headers, ...gatewayResponse.headers })
    } catch {
      return json(500, { code: 'service_unavailable', message: '市场服务暂时不可用' }, headers)
    }
  }
}
