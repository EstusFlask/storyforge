import type {
  OnlineRoomGatewayRequestV1,
  OnlineRoomGatewayResponseV1,
} from './room-gateway'

export type OnlineRoomGatewayHandlerV1 = (
  request: OnlineRoomGatewayRequestV1,
) => Promise<OnlineRoomGatewayResponseV1>

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('[online-fetch:configuration] allowedOrigins 必须是纯 http(s) origin')
  }
  return url.origin
}

/**
 * Web-standard deployment adapter for Workers, Deno, Bun, Node-compatible
 * runtimes and edge functions. It performs byte-bounded JSON parsing and an
 * exact Origin allow-list before any room/release/identity lookup occurs.
 */
export function createOnlineRoomFetchHandlerV1(input: {
  gateway: OnlineRoomGatewayHandlerV1
  allowedOrigins: string[]
  serviceVersion?: string
  maximumBodyBytes?: number
}) {
  const allowedOrigins = new Set(input.allowedOrigins.map(normalizeOrigin))
  if (allowedOrigins.size !== input.allowedOrigins.length) {
    throw new Error('[online-fetch:configuration] allowedOrigins 不能重复')
  }
  const maximumBodyBytes = input.maximumBodyBytes ?? 96_000
  if (!Number.isInteger(maximumBodyBytes) || maximumBodyBytes < 1_024 || maximumBodyBytes > 1_000_000) {
    throw new Error('[online-fetch:configuration] maximumBodyBytes 无效')
  }
  const serviceVersion = input.serviceVersion?.trim() || 'development'
  if (serviceVersion.length > 100 || /[\r\n]/.test(serviceVersion)) {
    throw new Error('[online-fetch:configuration] serviceVersion 无效')
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    const normalizedRequestOrigin = origin ? (() => {
      try { return normalizeOrigin(origin) } catch { return null }
    })() : null
    const originAllowed = !origin || (normalizedRequestOrigin != null && allowedOrigins.has(normalizedRequestOrigin))
    const commonHeaders: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'cross-origin',
      'x-storyforge-service-version': serviceVersion,
      vary: 'origin',
    }
    if (originAllowed && normalizedRequestOrigin) {
      commonHeaders['access-control-allow-origin'] = normalizedRequestOrigin
    }
    if (!originAllowed) {
      return jsonResponse(403, { code: 'origin_forbidden', message: '请求 Origin 未获在线服务授权' }, commonHeaders)
    }
    if (request.method.toUpperCase() === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...commonHeaders,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type, accept',
          'access-control-max-age': '600',
        },
      })
    }
    if (url.search || url.hash) {
      return jsonResponse(400, { code: 'query_forbidden', message: '在线房间 API 不接受 query 或 fragment' }, commonHeaders)
    }
    if (url.pathname === '/healthz') {
      if (request.method.toUpperCase() !== 'GET') {
        return jsonResponse(405, { code: 'method_not_allowed', message: '健康检查只支持 GET' }, commonHeaders)
      }
      return jsonResponse(200, { status: 'ok', protocolVersion: 1, serviceVersion }, commonHeaders)
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBodyBytes)) {
      return jsonResponse(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBodyBytes} bytes` }, commonHeaders)
    }
    let raw: string
    try {
      raw = await request.text()
    } catch {
      return jsonResponse(400, { code: 'body_unreadable', message: '无法读取请求体' }, commonHeaders)
    }
    if (new TextEncoder().encode(raw).byteLength > maximumBodyBytes) {
      return jsonResponse(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBodyBytes} bytes` }, commonHeaders)
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return jsonResponse(400, { code: 'invalid_json', message: '请求体不是合法 JSON' }, commonHeaders)
    }
    let gatewayResponse: OnlineRoomGatewayResponseV1
    try {
      gatewayResponse = await input.gateway({
        method: request.method,
        path: url.pathname,
        contentType: request.headers.get('content-type') ?? '',
        body,
        signal: request.signal,
      })
    } catch {
      return jsonResponse(500, {
        code: 'service_unavailable',
        message: '在线房间服务暂时不可用',
      }, commonHeaders)
    }
    return jsonResponse(gatewayResponse.status, gatewayResponse.body, {
      ...commonHeaders,
      ...gatewayResponse.headers,
    })
  }
}
