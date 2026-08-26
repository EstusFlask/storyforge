import type { AIConfig, MediaProviderReceiptV1 } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'

export interface ImageProviderCapabilityV1 {
  version: 1
  provider: 'openai-compatible'
  images: true
  referenceImage: boolean
  deterministicSeed: boolean
  inpainting: boolean
  formats: Array<'image/png' | 'image/jpeg' | 'image/webp'>
  maximumBytes: number
  maximumCandidates: number
  supportedSizes: Array<'1024x1024' | '1536x1024' | '1024x1536'>
  commercialRightsMustBeDeclared: true
}

export interface ImageGenerationBindingV1 {
  provider: 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
}

export const OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1: ImageProviderCapabilityV1 = {
  version: 1, provider: 'openai-compatible', images: true,
  referenceImage: false, deterministicSeed: false, inpainting: false,
  formats: ['image/png'], maximumBytes: 25 * 1024 * 1024, maximumCandidates: 4,
  supportedSizes: ['1024x1024', '1536x1024', '1024x1536'],
  commercialRightsMustBeDeclared: true,
}

export function resolveOpenAICompatibleImageSizeV1(width: number, height: number): { width: 1024 | 1536; height: 1024 | 1536 } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('[media] 图片目标尺寸非法')
  const ratio = width / height
  if (ratio > 1.2) return { width: 1536, height: 1024 }
  if (ratio < 0.84) return { width: 1024, height: 1536 }
  return { width: 1024, height: 1024 }
}

export function imageBindingFromAIConfigV1(config: AIConfig, imageModel = 'gpt-image-1'): ImageGenerationBindingV1 {
  if (!['openai', 'custom'].includes(config.provider)) throw new Error('[media] 当前 AI provider 未登记图片生成能力；可改用上传图片')
  if (!config.baseUrl.trim() || !imageModel.trim() || !config.apiKey.trim()) throw new Error('[media] 图片 provider 的地址、模型或 API Key 未配置')
  return { provider: 'openai-compatible', baseUrl: config.baseUrl.replace(/\/+$/, ''), apiKey: config.apiKey, model: imageModel.trim() }
}

export async function createMediaProviderReceiptV1(input: { binding: ImageGenerationBindingV1; requestId: string | null }): Promise<MediaProviderReceiptV1> {
  return {
    version: 1, provider: input.binding.provider, model: input.binding.model,
    requestId: input.requestId, createdAt: Date.now(),
    capabilitySnapshotHash: await hashCanonicalValue(OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1),
  }
}
