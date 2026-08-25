import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import {
  acquireMediaBlobLease,
  putMediaBlobObject,
  readMediaBlobObjectData,
} from '../game-production/media-blob-store'
import {
  detectGameImageDimensionsV1,
  detectGameMediaMimeTypeV1,
  type GameMediaCandidateV1,
  type GameMediaEstimateV1,
  type GameMediaProviderAdapterV1,
  type GameMediaRequestV1,
  type MediaProviderTransportV1,
} from '../game-production/media-adapters'
import {
  configuredMediaRelayUrlV1,
  inspectConfiguredAgnesImageCapabilityV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
} from '../game-production/media-transport'
import type {
  GameMediaResolverV1,
  TtrpgCampaignContentV1,
  TtrpgProductionBuildRecordV1,
  TtrpgProductionMediaAssetRecordV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import { parseTtrpgCampaignContentV1 } from './campaign'
import { parseRulePackV1 } from './rule-pack'
import { avgMediaKindForTtrpgRuntimeV1 } from './media-contract'

const HASH = /^[a-f0-9]{64}$/

function fail(message: string): never {
  throw new Error(`[ttrpg-production-media] ${message}`)
}

async function scopedBuild(
  scope: WorkspaceScope,
  buildId: number,
  expectedBuildHash?: string,
): Promise<TtrpgProductionBuildRecordV1> {
  const build = await db.ttrpgProductionBuilds.get(buildId)
  if (!build || !await assertRecordInScope(scope, 'ttrpgProductionBuilds', build, { owner: 'work' })) {
    fail('Build 不存在或跨 Work')
  }
  if (expectedBuildHash != null && build.buildHash !== expectedBuildHash) fail('Build hash 指针不一致')
  if (!['preview-ready', 'validated', 'release-ready'].includes(build.status)) fail('Build 尚不可消费媒资')
  return build
}

function campaignForBuild(build: TtrpgProductionBuildRecordV1): TtrpgCampaignContentV1 {
  let ruleValue: unknown
  let campaignValue: unknown
  try {
    ruleValue = JSON.parse(build.rulePackJson) as unknown
    campaignValue = JSON.parse(build.campaignJson) as unknown
  } catch {
    return fail('Build RulePack/CampaignPack JSON 已损坏')
  }
  const rulePack = parseRulePackV1(ruleValue)
  return parseTtrpgCampaignContentV1(campaignValue, rulePack)
}

export async function hashTtrpgProductionMediaSlotSpecV1(input: {
  buildHash: string
  slot: NonNullable<TtrpgCampaignContentV1['mediaManifest']>['slots'][number]
  rightsPolicyVersion: string
}): Promise<string> {
  return hashCanonicalValue({
    schema: 'storyforge.ttrpg-production-media-slot',
    version: 1,
    buildHash: input.buildHash,
    slot: input.slot,
    rightsPolicyVersion: input.rightsPolicyVersion,
  })
}

/** Build-time deterministic plan. Callers insert it in the same transaction as the Build commit. */
export async function prepareTtrpgProductionMediaPlanV1(input: {
  scope: WorkspaceScope
  buildId: number
  buildHash: string
  campaign: TtrpgCampaignContentV1
  createdAt: number
}): Promise<TtrpgProductionMediaAssetRecordV1[]> {
  const manifest = input.campaign.mediaManifest
  const visualBible = input.campaign.visualBible
  if (!manifest || !visualBible) return []
  return Promise.all(manifest.slots.map(async slot => ({
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    buildId: input.buildId,
    slotKey: slot.slotKey,
    assetKey: slot.assetKey ?? slot.slotKey,
    version: 1,
    kind: slot.kind,
    targetRef: slot.targetRef,
    audience: slot.audience,
    productionRequired: slot.productionRequired,
    status: 'planned' as const,
    specHash: await hashTtrpgProductionMediaSlotSpecV1({
      buildHash: input.buildHash,
      slot,
      rightsPolicyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
    }),
    prompt: slot.promptTemplate,
    negativePrompt: visualBible.style.prohibitedElements.join('；'),
    fallbackText: slot.fallbackText,
    altText: slot.altText,
    width: slot.width,
    height: slot.height,
    blobObjectId: null,
    mimeType: null,
    byteSize: 0,
    contentHash: null,
    producerRunId: null,
    providerAdapterId: null,
    providerRequestId: null,
    providerModelId: null,
    providerReceiptHash: null,
    rightsPolicyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
    rightsJson: canonicalStringify({ status: 'unresolved' }),
    failureJson: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  } satisfies TtrpgProductionMediaAssetRecordV1)))
}

export async function listTtrpgProductionMediaAssetsV1(input: {
  scope: WorkspaceScope
  buildId: number
  includeSuperseded?: boolean
}): Promise<TtrpgProductionMediaAssetRecordV1[]> {
  const scope = await resolveScope({ scope: input.scope })
  await scopedBuild(scope, input.buildId)
  const rows = await db.ttrpgProductionMediaAssets.where('buildId').equals(input.buildId).toArray()
  return rows
    .filter(row => input.includeSuperseded || row.status !== 'superseded')
    .sort((left, right) => left.slotKey.localeCompare(right.slotKey) || right.version - left.version)
}

export interface AcceptTtrpgProductionMediaInputV1 {
  scope: WorkspaceScope
  buildId: number
  slotKey: string
  expectedSpecHash: string
  data: ArrayBuffer
  declaredMimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  producerRunId?: number | null
  provider?: {
    adapterId: string
    requestId: string
    modelId?: string | null
    receiptHash: string
  } | null
  rights: {
    sourceKind: 'provider-generated' | 'author-owned-import'
    license: string
    attribution?: string
    authorConfirmed: boolean
  }
}

export interface TtrpgProductionMediaCandidateV1 {
  schema: 'storyforge.ttrpg-production-media-candidate'
  version: 1
  buildId: number
  buildHash: string
  slotKey: string
  specHash: string
  request: GameMediaRequestV1
  estimate: GameMediaEstimateV1
  candidate: GameMediaCandidateV1
  providerReceiptHash: string
  generatedAt: number
}

function visualAnchor(
  campaign: TtrpgCampaignContentV1,
  slot: NonNullable<TtrpgCampaignContentV1['mediaManifest']>['slots'][number],
): unknown {
  return campaign.visualBible?.characters.find(row => row.characterKey === slot.targetRef)
    ?? campaign.visualBible?.locations.find(row => row.locationKey === slot.targetRef)
    ?? null
}

async function candidateReceiptHash(value: Omit<TtrpgProductionMediaCandidateV1, 'providerReceiptHash'>): Promise<string> {
  return hashCanonicalValue({
    schema: value.schema,
    version: value.version,
    buildId: value.buildId,
    buildHash: value.buildHash,
    slotKey: value.slotKey,
    specHash: value.specHash,
    request: value.request,
    estimate: value.estimate,
    candidate: {
      schema: value.candidate.schema,
      version: value.candidate.version,
      adapterId: value.candidate.adapterId,
      requestId: value.candidate.requestId,
      candidateIndex: value.candidate.candidateIndex,
      mediaClass: value.candidate.mediaClass,
      mediaKind: value.candidate.mediaKind,
      mimeType: value.candidate.mimeType,
      byteSize: value.candidate.byteSize,
      contentHash: value.candidate.contentHash,
      metadata: value.candidate.metadata,
      rights: value.candidate.rights,
      providerReceipt: value.candidate.providerReceipt,
    },
    generatedAt: value.generatedAt,
  })
}

/** Generate an in-memory candidate through a registered adapter; no formal row is written yet. */
export async function generateTtrpgProductionMediaCandidateV1(input: {
  scope: WorkspaceScope
  buildId: number
  slotKey: string
  expectedSpecHash: string
  adapter: GameMediaProviderAdapterV1
  transport: MediaProviderTransportV1
  signal?: AbortSignal
  qualityProfile?: GameMediaRequestV1['qualityProfile']
  environment?: GameMediaRequestV1['environment']
}): Promise<TtrpgProductionMediaCandidateV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await scopedBuild(scope, input.buildId)
  if (await db.simulationSessions.where('ttrpgBuildId').equals(build.id!).count() > 0) {
    fail('Build 已建立试玩实例，生产媒资已冻结；请创建新 Build 生成素材')
  }
  const campaign = campaignForBuild(build)
  const slot = campaign.mediaManifest?.slots.find(row => row.slotKey === input.slotKey)
  const visualBible = campaign.visualBible
  if (!slot || !visualBible) fail('Build 未声明该媒资槽或视觉圣经')
  const specHash = await hashTtrpgProductionMediaSlotSpecV1({
    buildHash: build.buildHash,
    slot,
    rightsPolicyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
  })
  if (specHash !== input.expectedSpecHash) fail('媒资槽规格已变化')
  if (input.adapter.capability.mediaClasses.includes('image') !== true
    || input.adapter.capability.operations.includes('generate') !== true) fail('Adapter 不支持图片生成')
  const requestId = `ttrpg.production.${build.id}.${crypto.randomUUID()}`.slice(0, 200)
  const prompt = [
    visualBible.style.description,
    `媒介：${visualBible.style.medium}；构图：${visualBible.style.composition}；时代：${visualBible.style.era}。`,
    slot.promptTemplate,
    JSON.stringify(visualAnchor(campaign, slot)),
    '严格保持冻结角色身份、地点锚点与色板；不要添加文字水印。',
  ].filter(Boolean).join('\n')
  const negativePrompt = [...visualBible.style.prohibitedElements, '文字水印'].join('；')
  const inputHash = await hashCanonicalValue({ buildHash: build.buildHash, specHash, prompt, negativePrompt })
  const request: GameMediaRequestV1 = {
    schema: 'storyforge.game-media-request',
    version: 1,
    requestId,
    adapterId: input.adapter.capability.adapterId,
    mediaClass: 'image',
    mediaKind: avgMediaKindForTtrpgRuntimeV1(slot.kind),
    requirementKey: 'ttrpg.production.visual',
    artifactKey: `ttrpg.production.${build.id}.${slot.slotKey}`.slice(0, 200),
    prompt,
    negativePrompt,
    count: 1,
    width: slot.width,
    height: slot.height,
    durationMs: null,
    inputHash,
    qualityProfile: input.qualityProfile ?? 'commercial-candidate',
    environment: input.environment ?? 'production',
    allowedDataClasses: ['ttrpg.production.public'],
    rightsPolicyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
  }
  const estimate = await input.adapter.estimate(request)
  const generated = await input.adapter.generate(
    request,
    input.transport,
    input.signal ?? new AbortController().signal,
  )
  if (generated.length !== 1) fail('生产媒资 Adapter 必须返回一个候选')
  const candidate = await input.adapter.parseAndVerify(generated[0])
  if (candidate.requestId !== request.requestId || candidate.adapterId !== request.adapterId
    || candidate.mediaClass !== 'image' || candidate.mediaKind !== request.mediaKind
    || candidate.rights.rightsPolicyVersion !== request.rightsPolicyVersion) fail('Provider 候选与请求合同不一致')
  if (!candidate.rights.commercialUse) fail('Provider 候选未声明商业使用资格')
  const dimensions = detectGameImageDimensionsV1(candidate.data)
  if (!dimensions || (slot.width != null && dimensions.width !== slot.width)
    || (slot.height != null && dimensions.height !== slot.height)) fail('Provider 候选尺寸与冻结槽位不一致')
  const body: Omit<TtrpgProductionMediaCandidateV1, 'providerReceiptHash'> = {
    schema: 'storyforge.ttrpg-production-media-candidate',
    version: 1,
    buildId: build.id!,
    buildHash: build.buildHash,
    slotKey: slot.slotKey,
    specHash,
    request,
    estimate,
    candidate,
    generatedAt: Date.now(),
  }
  return { ...body, providerReceiptHash: await candidateReceiptHash(body) }
}

/** Resolve the configured governed provider without exposing credentials to the candidate or UI. */
export async function requestConfiguredTtrpgProductionMediaCandidateV1(input: {
  scope: WorkspaceScope
  buildId: number
  slotKey: string
  expectedSpecHash: string
  signal?: AbortSignal
}): Promise<TtrpgProductionMediaCandidateV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await scopedBuild(scope, input.buildId)
  const campaign = campaignForBuild(build)
  const rightsPolicyVersion = campaign.visualBible?.provenancePolicy.rightsPolicyVersion
  if (!rightsPolicyVersion) fail('Build 没有视觉来源策略')
  const requirementBase = {
    requirementKey: 'ttrpg.production.visual',
    mediaClass: 'image' as const,
    operation: 'generate',
    adapterFamily: 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: ['ttrpg.production.public'],
    maximumRequestCost: null,
    maximumTotalCost: null,
    rightsPolicyVersion,
    required: false,
  }
  const requirement = { ...requirementBase, capabilityHash: await hashCanonicalValue(requirementBase) }
  const agnes = inspectConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId })
  const capability = agnes.ready
    ? await resolveConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId, requirement })
    : configuredMediaRelayUrlV1()
      ? await resolveTrustedRelayMediaCapabilityV1({ requirement })
      : fail(agnes.issue || '未配置可用的图片生成能力或可信媒资 Relay')
  return generateTtrpgProductionMediaCandidateV1({
    ...input,
    scope,
    adapter: capability.adapter,
    transport: capability.transport,
  })
}

/** Explicit author adoption of an in-memory provider candidate. */
export async function acceptTtrpgGeneratedMediaCandidateV1(input: {
  scope: WorkspaceScope
  value: TtrpgProductionMediaCandidateV1
  authorConfirmed: boolean
}): Promise<TtrpgProductionMediaAssetRecordV1> {
  const value = input.value
  if (value.schema !== 'storyforge.ttrpg-production-media-candidate' || value.version !== 1
    || !HASH.test(value.specHash) || !HASH.test(value.buildHash) || !HASH.test(value.providerReceiptHash)) {
    fail('生成候选合同无效')
  }
  const { providerReceiptHash: _receipt, ...body } = value
  if (await candidateReceiptHash(body) !== value.providerReceiptHash) fail('生成候选回执已损坏')
  if (!input.authorConfirmed) fail('作者尚未确认采用生成候选')
  const mimeType = value.candidate.mimeType
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) fail('生成候选 MIME 不受支持')
  return acceptTtrpgProductionMediaAssetV1({
    scope: input.scope,
    buildId: value.buildId,
    slotKey: value.slotKey,
    expectedSpecHash: value.specHash,
    data: value.candidate.data,
    declaredMimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
    provider: {
      adapterId: value.candidate.adapterId,
      requestId: value.candidate.requestId,
      modelId: typeof value.candidate.metadata.model === 'string' ? value.candidate.metadata.model : null,
      receiptHash: value.providerReceiptHash,
    },
    rights: {
      sourceKind: 'provider-generated',
      license: `rights-policy:${value.candidate.rights.rightsPolicyVersion}`,
      attribution: value.candidate.rights.adapterId,
      authorConfirmed: true,
    },
  })
}

/**
 * Human adoption boundary for production media. Provider/raw candidates cannot
 * become playable by merely writing a blob; this verifies bytes and appends a
 * new accepted version bound to the immutable slot specification.
 */
export async function acceptTtrpgProductionMediaAssetV1(
  input: AcceptTtrpgProductionMediaInputV1,
): Promise<TtrpgProductionMediaAssetRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await scopedBuild(scope, input.buildId)
  if (await db.simulationSessions.where('ttrpgBuildId').equals(build.id!).count() > 0) {
    fail('Build 已建立试玩实例，生产媒资已冻结；请创建新 Build 追加素材')
  }
  if (!HASH.test(input.expectedSpecHash)) fail('expectedSpecHash 无效')
  if (!input.rights.authorConfirmed || !input.rights.license.trim()) fail('作者必须确认素材权利与许可')
  if (input.rights.sourceKind === 'provider-generated' && (!input.provider || !HASH.test(input.provider.receiptHash))) {
    fail('Provider 生成素材必须携带可校验回执')
  }
  const campaign = campaignForBuild(build)
  const slot = campaign.mediaManifest?.slots.find(row => row.slotKey === input.slotKey)
  const visualBible = campaign.visualBible
  if (!slot || !visualBible) fail('Build 未声明该媒资槽或视觉圣经')
  const specHash = await hashTtrpgProductionMediaSlotSpecV1({
    buildHash: build.buildHash,
    slot,
    rightsPolicyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
  })
  if (specHash !== input.expectedSpecHash) fail('媒资槽规格已变化')
  const detectedMimeType = detectGameMediaMimeTypeV1(input.data)
  if (detectedMimeType !== input.declaredMimeType) fail('候选真实 MIME 与声明不一致')
  const dimensions = detectGameImageDimensionsV1(input.data)
  if (!dimensions) fail('候选图片尺寸无法识别')
  if ((slot.width != null && dimensions.width !== slot.width)
    || (slot.height != null && dimensions.height !== slot.height)) {
    fail(`候选尺寸 ${dimensions.width}x${dimensions.height} 与槽位 ${slot.width ?? '*'}x${slot.height ?? '*'} 不一致`)
  }
  const blob = await putMediaBlobObject({
    scope,
    data: input.data,
    mimeType: detectedMimeType,
  })
  const now = Date.now()
  const rightsJson = canonicalStringify({
    sourceKind: input.rights.sourceKind,
    license: input.rights.license.trim(),
    attribution: input.rights.attribution?.trim() || null,
    authorConfirmed: true,
    policyVersion: visualBible.provenancePolicy.rightsPolicyVersion,
  })
  return db.transaction('rw', scopeTransactionTables(
    db.ttrpgProductionBuilds,
    db.ttrpgProductionMediaAssets,
    db.mediaBlobObjects,
    db.agentRuns,
    db.simulationSessions,
  ), async () => {
    const [currentBuild, currentBlob, rows] = await Promise.all([
      db.ttrpgProductionBuilds.get(build.id!),
      db.mediaBlobObjects.get(blob.id!),
      db.ttrpgProductionMediaAssets.where('[buildId+slotKey]').equals([build.id!, slot.slotKey]).toArray(),
    ])
    if (!currentBuild || currentBuild.buildHash !== build.buildHash || !['preview-ready', 'validated', 'release-ready'].includes(currentBuild.status)) {
      fail('写入前 Build 已变化')
    }
    if (await db.simulationSessions.where('ttrpgBuildId').equals(build.id!).count() > 0) {
      fail('写入前 Build 已建立试玩实例，生产媒资已冻结')
    }
    const current = rows.filter(row => row.status !== 'superseded').sort((a, b) => b.version - a.version)[0]
    if (!current || current.specHash !== specHash) fail('写入前媒资槽计划已变化')
    if (!currentBlob || currentBlob.storageState !== 'ready' || currentBlob.contentHash !== blob.contentHash
      || currentBlob.byteSize !== blob.byteSize || currentBlob.mimeType !== detectedMimeType) fail('共享媒资对象未就绪或元数据损坏')
    if (input.producerRunId != null) {
      const run = await db.agentRuns.get(input.producerRunId)
      if (!run || run.workId !== scope.workId) fail('producerRun 不存在或跨 Work')
    }
    const version = Math.max(0, ...rows.map(row => row.version)) + 1
    for (const row of rows) if (row.status !== 'superseded') {
      await db.ttrpgProductionMediaAssets.update(row.id!, { status: 'superseded', updatedAt: now })
    }
    const accepted: TtrpgProductionMediaAssetRecordV1 = {
      ...current,
      id: undefined,
      version,
      status: 'available',
      blobObjectId: blob.id!,
      mimeType: detectedMimeType,
      byteSize: blob.byteSize,
      contentHash: blob.contentHash,
      producerRunId: input.producerRunId ?? null,
      providerAdapterId: input.provider?.adapterId.trim() || null,
      providerRequestId: input.provider?.requestId.trim() || null,
      providerModelId: input.provider?.modelId?.trim() || null,
      providerReceiptHash: input.provider?.receiptHash ?? null,
      rightsJson,
      failureJson: null,
      createdAt: now,
      updatedAt: now,
    }
    delete accepted.id
    const id = await db.ttrpgProductionMediaAssets.add(accepted) as number
    return { ...accepted, id }
  })
}

export interface TtrpgProductionMediaCoverageV1 {
  buildId: number
  totalSlots: number
  requiredSlots: number
  availableSlots: number
  missingRequiredSlotKeys: string[]
  fallbackSlotKeys: string[]
  manifestHash: string
  assets: Array<{
    slotKey: string
    assetKey: string
    kind: TtrpgProductionMediaAssetRecordV1['kind']
    contentHash: string
    mimeType: string
    byteSize: number
    width: number | null
    height: number | null
    specHash: string
    providerReceiptHash: string | null
    rightsPolicyVersion: string
  }>
}

export async function verifyTtrpgProductionMediaCoverageV1(input: {
  scope: WorkspaceScope
  buildId: number
  expectedBuildHash?: string
  verifyBytes?: boolean
}): Promise<TtrpgProductionMediaCoverageV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await scopedBuild(scope, input.buildId, input.expectedBuildHash)
  const campaign = campaignForBuild(build)
  const slots = campaign.mediaManifest?.slots ?? []
  const rows = await db.ttrpgProductionMediaAssets.where('buildId').equals(build.id!).toArray()
  const currentBySlot = new Map<string, TtrpgProductionMediaAssetRecordV1>()
  for (const row of rows.filter(item => item.status !== 'superseded').sort((a, b) => b.version - a.version)) {
    if (!currentBySlot.has(row.slotKey)) currentBySlot.set(row.slotKey, row)
  }
  const assets: TtrpgProductionMediaCoverageV1['assets'] = []
  const missingRequiredSlotKeys: string[] = []
  const fallbackSlotKeys: string[] = []
  for (const slot of slots) {
    const row = currentBySlot.get(slot.slotKey)
    const expectedSpecHash = campaign.visualBible
      ? await hashTtrpgProductionMediaSlotSpecV1({
        buildHash: build.buildHash,
        slot,
        rightsPolicyVersion: campaign.visualBible.provenancePolicy.rightsPolicyVersion,
      })
      : null
    const available = row?.status === 'available' && row.blobObjectId != null && row.contentHash != null
      && row.mimeType != null && row.byteSize > 0 && row.specHash === expectedSpecHash
    if (!available || !row) {
      fallbackSlotKeys.push(slot.slotKey)
      if (slot.productionRequired) missingRequiredSlotKeys.push(slot.slotKey)
      continue
    }
    if (input.verifyBytes !== false) {
      await readMediaBlobObjectData({
        scope,
        blobObjectId: row.blobObjectId!,
        expected: { contentHash: row.contentHash!, byteSize: row.byteSize, mimeType: row.mimeType! },
      })
    }
    assets.push({
      slotKey: row.slotKey,
      assetKey: row.assetKey,
      kind: row.kind,
      contentHash: row.contentHash!,
      mimeType: row.mimeType!,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      specHash: row.specHash,
      providerReceiptHash: row.providerReceiptHash,
      rightsPolicyVersion: row.rightsPolicyVersion,
    })
  }
  assets.sort((a, b) => a.slotKey.localeCompare(b.slotKey))
  const manifestHash = await hashCanonicalValue({
    schema: 'storyforge.ttrpg-production-media-coverage',
    version: 1,
    buildHash: build.buildHash,
    assets,
    fallbackSlotKeys: [...fallbackSlotKeys].sort(),
  })
  return {
    buildId: build.id!,
    totalSlots: slots.length,
    requiredSlots: slots.filter(slot => slot.productionRequired).length,
    availableSlots: assets.length,
    missingRequiredSlotKeys,
    fallbackSlotKeys,
    manifestHash,
    assets,
  }
}

/** Resolver freezes the latest accepted media versions for this preview lifetime. */
export async function createTtrpgProductionBuildMediaResolverV1(input: {
  scope: WorkspaceScope
  buildId: number
  expectedBuildHash: string
}): Promise<GameMediaResolverV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await scopedBuild(scope, input.buildId, input.expectedBuildHash)
  const campaign = campaignForBuild(build)
  const coverage = await verifyTtrpgProductionMediaCoverageV1({
    scope,
    buildId: build.id!,
    expectedBuildHash: build.buildHash,
    verifyBytes: false,
  })
  const allRows = await db.ttrpgProductionMediaAssets.where('buildId').equals(build.id!).toArray()
  const rowBySlot = new Map<string, TtrpgProductionMediaAssetRecordV1>()
  for (const row of allRows.filter(item => item.status === 'available').sort((a, b) => b.version - a.version)) {
    if (!rowBySlot.has(row.slotKey)) rowBySlot.set(row.slotKey, row)
  }
  const aliases = new Map<string, string>()
  for (const slot of campaign.mediaManifest?.slots ?? []) {
    aliases.set(slot.slotKey, slot.slotKey)
    if (slot.assetKey) aliases.set(slot.assetKey, slot.slotKey)
    const row = rowBySlot.get(slot.slotKey)
    if (row) aliases.set(row.assetKey, slot.slotKey)
  }
  const urls = new Set<string>()
  const leases = new Map<number, { release(): Promise<void> }>()
  const owner = `ttrpg-preview:${build.id}:${crypto.randomUUID()}`
  let disposed = false
  const rowFor = (assetKey: string) => {
    if (disposed) fail('resolver 已释放')
    const slotKey = aliases.get(assetKey)
    const row = slotKey ? rowBySlot.get(slotKey) : undefined
    if (!row || !coverage.assets.some(asset => asset.slotKey === row.slotKey)) fail(`素材未绑定，使用文字 fallback:${assetKey}`)
    return row
  }
  const readAsset = async (assetKey: string): Promise<Blob> => {
    const row = rowFor(assetKey)
    if (!leases.has(row.blobObjectId!)) {
      leases.set(row.blobObjectId!, await acquireMediaBlobLease({
        scope,
        blobObjectId: row.blobObjectId!,
        owner,
      }))
    }
    const data = await readMediaBlobObjectData({
      scope,
      blobObjectId: row.blobObjectId!,
      expected: { contentHash: row.contentHash!, byteSize: row.byteSize, mimeType: row.mimeType! },
    })
    return new Blob([data], { type: row.mimeType! })
  }
  return {
    read: readAsset,
    async preload({ assetKeys, maximumBytes }) {
      if (!Number.isFinite(maximumBytes) || maximumBytes < 0) fail('maximumBytes 无效')
      const result = { urls: {} as Record<string, string>, failures: [] as Array<{ assetKey: string; reason: string }>, usedBytes: 0 }
      for (const assetKey of [...new Set(assetKeys)]) {
        try {
          const row = rowFor(assetKey)
          if (result.usedBytes + row.byteSize > maximumBytes) {
            result.failures.push({ assetKey, reason: '预加载容量预算已满' })
            continue
          }
          const blob = await readAsset(assetKey)
          const url = URL.createObjectURL(blob)
          urls.add(url)
          result.urls[assetKey] = url
          result.usedBytes += row.byteSize
        } catch (cause) {
          result.failures.push({ assetKey, reason: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      return result
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      void Promise.all([...leases.values()].map(lease => lease.release()))
      leases.clear()
    },
  }
}
