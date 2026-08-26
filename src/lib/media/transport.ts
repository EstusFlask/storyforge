import type { ImageGenerationBindingV1 } from './capability'

const MAX_BYTES = 25 * 1024 * 1024

function decodeBase64(value: string): ArrayBuffer {
  let binary: string
  try { binary = atob(value) } catch { throw new Error('[media] provider 返回的 base64 非法') }
  if (binary.length > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function download(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('[media] provider 返回了不安全图片 URL')
  const response = await fetch(parsed, { signal, credentials: 'omit', redirect: 'follow' })
  const finalUrl = new URL(response.url || parsed.href)
  if (finalUrl.protocol !== 'https:' && !(finalUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(finalUrl.hostname))) throw new Error('[media] provider 图片重定向到不安全地址')
  if (!response.ok) throw new Error(`[media] 下载 provider 图片失败：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  const data = await response.arrayBuffer()
  if (data.byteLength > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  return data
}

export async function requestOpenAICompatibleImagesV1(input: {
  binding: ImageGenerationBindingV1
  prompt: string
  count: number
  width: number
  height: number
  signal?: AbortSignal
}): Promise<{ requestId: string | null; images: ArrayBuffer[] }> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4 || !input.prompt.trim() || input.prompt.length > 16_000) throw new Error('[media] 图片请求数量或 Prompt 非法')
  const response = await fetch(`${input.binding.baseUrl}/images/generations`, {
    method: 'POST', signal: input.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.binding.apiKey}` },
    body: JSON.stringify({ model: input.binding.model, prompt: input.prompt, n: input.count, size: `${input.width}x${input.height}`, response_format: 'b64_json' }),
  })
  if (!response.ok) throw new Error(`[media] 图片 provider 调用失败：HTTP ${response.status}`)
  const json = await response.json() as { id?: string; data?: Array<{ b64_json?: string; url?: string }> }
  if (!Array.isArray(json.data) || json.data.length !== input.count) throw new Error('[media] 图片 provider 响应数量与请求不一致')
  const images: ArrayBuffer[] = []
  for (const [index, item] of json.data.entries()) {
    if (typeof item.b64_json === 'string') images.push(decodeBase64(item.b64_json))
    else if (typeof item.url === 'string') images.push(await download(item.url, input.signal))
    else throw new Error(`[media] 图片 provider 第 ${index + 1} 个候选缺少内容`)
  }
  return { requestId: typeof json.id === 'string' ? json.id : response.headers.get('x-request-id'), images }
}
