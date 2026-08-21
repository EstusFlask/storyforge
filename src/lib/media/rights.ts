import type { MediaRightsV1 } from '../types'

export function assertMediaRightsV1(rights: MediaRightsV1): void {
  if (!rights || rights.version !== 1 || !['author-upload', 'provider-generated'].includes(rights.source)) throw new Error('[media] 媒体来源类型非法')
  if (!['allowed', 'restricted', 'unknown'].includes(rights.commercialUse) || !['allowed', 'restricted', 'unknown'].includes(rights.redistribution)) throw new Error('[media] 商用或再分发权利状态非法')
  if (typeof rights.declaration !== 'string' || !rights.declaration.trim() || rights.declaration.length > 4_000 || typeof rights.attribution !== 'string' || rights.attribution.length > 2_000 || !Number.isInteger(rights.declaredAt) || rights.declaredAt <= 0) throw new Error('[media] 必须填写有效的图片来源与权利声明')
}
