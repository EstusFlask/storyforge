import type {
  TtrpgMediaManifestV1,
  TtrpgRuntimeMediaAudienceV1,
  TtrpgRuntimeMediaKindV1,
  TtrpgVisualBibleV1,
} from '../types'
import { TTRPG_RUNTIME_MEDIA_KINDS_V1 } from '../types'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[ttrpg-media] ${message}`) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}
function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail(`${label} 为空或过长`)
  return result
}
function key(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!KEY.test(result)) fail(`${label} 不是稳定 key`)
  return result
}
function strings(value: unknown, label: string, maximum = 256): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}
function keys(value: unknown, label: string, maximum = 256): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 整数无效`)
  return Number(value)
}
function optionalDimension(value: unknown, label: string): number | null {
  return value == null ? null : integer(value, label, 64, 8_192)
}

export function parseTtrpgVisualBibleV1(input: unknown, expected?: {
  characterKeys?: ReadonlySet<string>
  locationKeys?: ReadonlySet<string>
}): TtrpgVisualBibleV1 {
  const root = object(input, 'visualBible')
  exact(root, ['schema', 'version', 'style', 'characters', 'locations', 'provenancePolicy'], 'visualBible')
  if (root.schema !== 'storyforge.ttrpg-visual-bible' || root.version !== 1) fail('visualBible schema/version 无效')
  const style = object(root.style, 'visualBible.style')
  exact(style, ['description', 'medium', 'composition', 'colorPalette', 'era', 'prohibitedElements', 'referenceLicense'], 'visualBible.style')
  text(style.description, 'visualBible.style.description')
  text(style.medium, 'visualBible.style.medium', 500)
  text(style.composition, 'visualBible.style.composition', 1_000)
  strings(style.colorPalette, 'visualBible.style.colorPalette', 32)
  text(style.era, 'visualBible.style.era', 500)
  strings(style.prohibitedElements, 'visualBible.style.prohibitedElements', 100)
  text(style.referenceLicense, 'visualBible.style.referenceLicense', 500)
  if (!Array.isArray(root.characters) || root.characters.length > 256) fail('visualBible.characters 无效')
  const characterKeys = root.characters.map((raw, index) => {
    const row = object(raw, `visualBible.characters[${index}]`)
    exact(row, ['characterKey', 'identityPrompt', 'silhouette', 'attire', 'markers', 'colorPalette', 'expressionBaselines', 'referenceAssetKeys'], `visualBible.characters[${index}]`)
    const characterKey = key(row.characterKey, 'visualBible.character.characterKey')
    if (expected?.characterKeys && !expected.characterKeys.has(characterKey)) fail(`视觉角色不属于 CampaignPack:${characterKey}`)
    text(row.identityPrompt, 'visualBible.character.identityPrompt')
    text(row.silhouette, 'visualBible.character.silhouette', 2_000)
    text(row.attire, 'visualBible.character.attire', 2_000)
    strings(row.markers, 'visualBible.character.markers', 64)
    strings(row.colorPalette, 'visualBible.character.colorPalette', 32)
    keys(row.referenceAssetKeys, 'visualBible.character.referenceAssetKeys', 100)
    if (!Array.isArray(row.expressionBaselines) || row.expressionBaselines.length < 1 || row.expressionBaselines.length > 32) {
      fail(`视觉角色必须有表情基线:${characterKey}`)
    }
    const expressions = row.expressionBaselines.map((rawExpression, expressionIndex) => {
      const expression = object(rawExpression, `visualBible.character.expression[${expressionIndex}]`)
      exact(expression, ['expressionKey', 'prompt'], 'visualBible.character.expression')
      text(expression.prompt, 'visualBible.character.expression.prompt', 2_000)
      return key(expression.expressionKey, 'visualBible.character.expression.expressionKey')
    })
    if (new Set(expressions).size !== expressions.length) fail(`视觉角色表情 key 重复:${characterKey}`)
    return characterKey
  })
  if (new Set(characterKeys).size !== characterKeys.length) fail('visualBible.characters key 重复')
  if (!Array.isArray(root.locations) || root.locations.length > 512) fail('visualBible.locations 无效')
  const locationKeys = root.locations.map((raw, index) => {
    const row = object(raw, `visualBible.locations[${index}]`)
    exact(row, ['locationKey', 'identityPrompt', 'architecture', 'weather', 'timeOfDay', 'lighting', 'anchors', 'referenceAssetKeys'], `visualBible.locations[${index}]`)
    const locationKey = key(row.locationKey, 'visualBible.location.locationKey')
    if (expected?.locationKeys && !expected.locationKeys.has(locationKey)) fail(`视觉地点不属于 CampaignPack:${locationKey}`)
    text(row.identityPrompt, 'visualBible.location.identityPrompt')
    text(row.architecture, 'visualBible.location.architecture', 2_000)
    text(row.weather, 'visualBible.location.weather', 500)
    text(row.timeOfDay, 'visualBible.location.timeOfDay', 500)
    text(row.lighting, 'visualBible.location.lighting', 1_000)
    strings(row.anchors, 'visualBible.location.anchors', 64)
    keys(row.referenceAssetKeys, 'visualBible.location.referenceAssetKeys', 100)
    return locationKey
  })
  if (new Set(locationKeys).size !== locationKeys.length) fail('visualBible.locations key 重复')
  const provenance = object(root.provenancePolicy, 'visualBible.provenancePolicy')
  exact(provenance, ['rightsPolicyVersion', 'allowedSources', 'requirePromptReceipt', 'requireHumanAdoptionForRelease'], 'visualBible.provenancePolicy')
  key(provenance.rightsPolicyVersion, 'visualBible.provenancePolicy.rightsPolicyVersion')
  strings(provenance.allowedSources, 'visualBible.provenancePolicy.allowedSources', 32)
  if (typeof provenance.requirePromptReceipt !== 'boolean' || typeof provenance.requireHumanAdoptionForRelease !== 'boolean') {
    fail('visualBible provenance boolean 无效')
  }
  return structuredClone(root) as unknown as TtrpgVisualBibleV1
}

export function parseTtrpgMediaManifestV1(input: unknown, expected?: {
  targetRefs?: ReadonlySet<string>
}): TtrpgMediaManifestV1 {
  const root = object(input, 'mediaManifest')
  exact(root, ['schema', 'version', 'slots', 'runtimePolicy'], 'mediaManifest')
  if (root.schema !== 'storyforge.ttrpg-media-manifest' || root.version !== 1) fail('mediaManifest schema/version 无效')
  if (!Array.isArray(root.slots) || root.slots.length > 4_096) fail('mediaManifest.slots 无效')
  const slotKeys = root.slots.map((raw, index) => {
    const row = object(raw, `mediaManifest.slots[${index}]`)
    exact(row, ['slotKey', 'kind', 'targetRef', 'audience', 'productionRequired', 'assetKey', 'fallbackText', 'altText', 'promptTemplate', 'width', 'height'], `mediaManifest.slots[${index}]`)
    const slotKey = key(row.slotKey, 'mediaManifest.slot.slotKey')
    if (!TTRPG_RUNTIME_MEDIA_KINDS_V1.includes(row.kind as TtrpgRuntimeMediaKindV1)) fail(`媒资槽 kind 无效:${slotKey}`)
    const targetRef = key(row.targetRef, 'mediaManifest.slot.targetRef')
    if (expected?.targetRefs && !expected.targetRefs.has(targetRef)) fail(`媒资槽目标不属于 CampaignPack:${targetRef}`)
    if (!['public', 'party', 'private', 'gm-only'].includes(String(row.audience) as TtrpgRuntimeMediaAudienceV1)) fail(`媒资槽 audience 无效:${slotKey}`)
    if (typeof row.productionRequired !== 'boolean') fail(`媒资槽 productionRequired 无效:${slotKey}`)
    if (row.assetKey != null) key(row.assetKey, 'mediaManifest.slot.assetKey')
    text(row.fallbackText, 'mediaManifest.slot.fallbackText')
    text(row.altText, 'mediaManifest.slot.altText', 2_000)
    text(row.promptTemplate, 'mediaManifest.slot.promptTemplate')
    optionalDimension(row.width, 'mediaManifest.slot.width')
    optionalDimension(row.height, 'mediaManifest.slot.height')
    return slotKey
  })
  if (new Set(slotKeys).size !== slotKeys.length) fail('mediaManifest slotKey 重复')
  const policy = object(root.runtimePolicy, 'mediaManifest.runtimePolicy')
  exact(policy, ['enabled', 'networkPolicy', 'maximumSessionCostUsd', 'maximumConcurrentRequests', 'maximumAttempts', 'maximumGeneratedAssets', 'allowProviderFallback'], 'mediaManifest.runtimePolicy')
  if (typeof policy.enabled !== 'boolean' || !['any', 'wifi-only', 'disabled'].includes(String(policy.networkPolicy))
    || typeof policy.maximumSessionCostUsd !== 'number' || !Number.isFinite(policy.maximumSessionCostUsd)
    || policy.maximumSessionCostUsd < 0 || policy.maximumSessionCostUsd > 10_000
    || typeof policy.allowProviderFallback !== 'boolean') fail('mediaManifest.runtimePolicy 无效')
  integer(policy.maximumConcurrentRequests, 'runtimePolicy.maximumConcurrentRequests', 1, 16)
  integer(policy.maximumAttempts, 'runtimePolicy.maximumAttempts', 1, 10)
  integer(policy.maximumGeneratedAssets, 'runtimePolicy.maximumGeneratedAssets', 0, 4_096)
  if (!policy.enabled && policy.maximumGeneratedAssets !== 0) fail('禁用运行时媒资时 maximumGeneratedAssets 必须为 0')
  return structuredClone(root) as unknown as TtrpgMediaManifestV1
}

export function avgMediaKindForTtrpgRuntimeV1(kind: TtrpgRuntimeMediaKindV1) {
  if (kind === 'scene') return 'background' as const
  if (kind === 'character-portrait') return 'character-pose' as const
  if (kind === 'character-expression') return 'character-expression' as const
  return 'ui' as const
}
