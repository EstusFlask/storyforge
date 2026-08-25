import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  FrozenGameNarrativeNode,
  GameBuildManifestV1,
  GameBuildQualityReportV1,
  GameProductionBriefV3,
  GameRuntimePackageV2,
  WorkspaceScope,
} from '../types'
import { sanitizeSvg } from '../utils/sanitize-svg'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import { acceptGameBuildArtifact, readAcceptedBuildArtifacts } from './artifact-store'
import { createGameBuildCompatibilityReportV1 } from './compatibility'
import { parseGameProductionBriefV3 } from './contracts'
import { canonicalGameProductionJsonV2, hashGameProductionValueV2 } from './hash'
import { putMediaBlobObject } from './media-blob-store'
import { createVerticalSliceGameProductionPlanV3 } from './plan'
import { createGameBuildPreviewManifestV1 } from './preview-manifest'
import { createGameBuildRootTerminalReceiptV1 } from './receipts'
import { parseGameRuntimePackageV2 } from './runtime-package'

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
  })[character]!)
}

function localKeyVisual(input: { title: string; conflict: string; tone: string[] }): ArrayBuffer {
  const title = escapeXml(input.title.slice(0, 40))
  const conflict = escapeXml(input.conflict.slice(0, 86))
  const tone = escapeXml(input.tone.slice(0, 3).join(' · '))
  const svg = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101827"/><stop offset="0.55" stop-color="#24344b"/><stop offset="1" stop-color="#6f4b36"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#f6d28b" stop-opacity=".9"/><stop offset="1" stop-color="#f6d28b" stop-opacity="0"/></radialGradient>
      <filter id="grain"><feTurbulence baseFrequency=".8" numOctaves="3" seed="11"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .08 0"/></filter>
    </defs>
    <rect width="1200" height="675" fill="url(#sky)"/>
    <circle cx="850" cy="215" r="250" fill="url(#glow)"/>
    <path d="M0 510L180 390l110 75 175-210 155 165 170-120 180 150 230-95v320H0z" fill="#0a111d" opacity=".88"/>
    <path d="M0 555c210-75 390-40 580 8s390 38 620-24v136H0z" fill="#080d15"/>
    <rect x="72" y="74" width="7" height="222" rx="3" fill="#dcae62"/>
    <text x="108" y="130" fill="#f7e8ce" font-family="serif" font-size="58" font-weight="700">${title}</text>
    <text x="110" y="187" fill="#d6c4aa" font-family="sans-serif" font-size="24">${conflict}</text>
    <text x="110" y="235" fill="#dcae62" font-family="sans-serif" font-size="17" letter-spacing="4">${tone}</text>
    <text x="108" y="612" fill="#a99a87" font-family="sans-serif" font-size="14" letter-spacing="5">STORYFORGE · LOCAL PROTOTYPE</text>
    <rect width="1200" height="675" filter="url(#grain)" opacity=".45"/>
  </svg>`)
  return new TextEncoder().encode(svg).buffer
}

function narrativeFromBrief(brief: GameProductionBriefV3): {
  nodes: FrozenGameNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
} {
  const opening = brief.intent.openingSituation
  const requiredFact = brief.intent.requiredFacts[0] ?? '世界保持其既定规则。'
  const forbidden = brief.intent.forbiddenChanges[0] ?? '既定事实不会被无理由改写。'
  const nodes: FrozenGameNarrativeNode[] = [
    { key: 'opening', kind: 'entry', title: brief.source.startingPoint.title, summary: opening, conditionJson: '{}', effectsJson: '[]', successorKeys: ['observe', 'act'] },
    { key: 'observe', kind: 'scene', title: '先理解局势', summary: requiredFact, conditionJson: '{}', effectsJson: '[{"op":"set","path":"approach","value":"observe"}]', successorKeys: ['ending.insight'] },
    { key: 'act', kind: 'scene', title: '立即介入', summary: forbidden, conditionJson: '{}', effectsJson: '[{"op":"set","path":"approach","value":"act"}]', successorKeys: ['ending.change'] },
    { key: 'ending.insight', kind: 'ending', title: '看清代价', summary: '你保全了证据，也接受尚未改变的一切。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    { key: 'ending.change', kind: 'ending', title: '承担改变', summary: '你的行动改变了局部结果，却没有抹去世界的历史。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
  ]
  const beatTexts = [
    opening,
    `你停下来核对已知事实：${requiredFact}`,
    `你决定行动，同时守住边界：${forbidden}`,
    '线索终于连成完整的图景。',
    '新的结果出现了，而代价也被诚实地保留下来。',
  ]
  const beats: FrozenNarrativeBeat[] = nodes.map((node, index) => ({
    beatKey: `beat.${node.key}`, nodeKey: node.key, kind: 'narration', speakerKey: null,
    text: beatTexts[index], order: index,
  }))
  const choices: FrozenNarrativeChoice[] = [
    { choiceKey: 'choice.observe', sourceNodeKey: 'opening', text: '先调查再决定', description: '寻找能解释冲突的事实。', unavailableReason: '', targetNodeKey: 'observe', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['approach:observe'], order: 0 },
    { choiceKey: 'choice.act', sourceNodeKey: 'opening', text: '立即承担风险', description: '在局势恶化前介入。', unavailableReason: '', targetNodeKey: 'act', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['approach:act'], order: 1 },
    { choiceKey: 'choice.insight', sourceNodeKey: 'observe', text: '带着证据作结', description: '接受有限但可靠的结果。', unavailableReason: '', targetNodeKey: 'ending.insight', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 0 },
    { choiceKey: 'choice.change', sourceNodeKey: 'act', text: '承担选择的后果', description: '让改变成为新的事实。', unavailableReason: '', targetNodeKey: 'ending.change', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 0 },
  ]
  return { nodes, beats, choices }
}

/**
 * GAME-PROD-1C local vertical slice. It proves the complete production
 * transaction without pretending to be an external AI/media provider: text is
 * a deterministic Brief-grounded prototype and the key visual is labeled
 * local procedural output with explicit CC0 rights.
 */
export async function runLocalGameProductionVerticalSlice(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<{
  buildId: number
  previewHash: string
  packageHash: string
  releaseReady: boolean
}> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.gameProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'gameProductions', production, { owner: 'work' })) {
    throw new Error('[game-production-vertical] Production 不存在或跨 Work')
  }
  if (production.currentBuildNumber == null || production.currentBriefRevision == null) {
    throw new Error('[game-production-vertical] Production 尚未获得制作授权')
  }
  const [build, briefRow] = await Promise.all([
    db.gameBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber]).first(),
    db.gameProductionBriefs.where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first(),
  ])
  if (!build || !briefRow || briefRow.status !== 'authorized' || build.briefHash !== briefRow.briefHash) {
    throw new Error('[game-production-vertical] Build/Brief 授权绑定损坏')
  }
  if (build.status === 'preview-ready' || build.status === 'release-ready' || build.status === 'released') {
    return {
      buildId: build.id!, previewHash: build.previewHash, packageHash: build.packageHash,
      releaseReady: build.status === 'release-ready' || build.status === 'released',
    }
  }
  if (build.status !== 'authorized') throw new Error(`[game-production-vertical] Build 状态 ${build.status} 不可启动本地纵切`)
  const brief = parseGameProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'storygame' && brief.intent.productType !== 'avg') {
    throw new Error('[game-production-vertical] 本地 1C 纵切只支持分支叙事与轻量 AVG')
  }
  const plan = createVerticalSliceGameProductionPlanV3({
    brief, briefHash: briefRow.briefHash, controlEpoch: build.controlEpoch, buildNumber: build.buildNumber,
  })
  const planJson = canonicalGameProductionJsonV2(plan)
  const planHash = await hashGameProductionValueV2(plan)
  const startedAt = Date.now()
  const started = await db.transaction('rw', scopeTransactionTables(db.gameBuilds, db.gameProductions), async () => {
    const current = await db.gameBuilds.get(build.id!)
    const root = await db.gameProductions.get(production.id!)
    if (!current || !root || current.stateRevision !== build.stateRevision
      || current.controlEpoch !== build.controlEpoch || current.status !== 'authorized') return false
    await db.gameBuilds.update(current.id!, {
      status: 'building', planRevision: current.planRevision + 1, planJson, planHash,
      stateRevision: current.stateRevision + 1, startedAt, updatedAt: startedAt,
    })
    await db.gameProductions.update(root.id!, { updatedAt: startedAt })
    return true
  })
  if (!started) throw new Error('[game-production-vertical] Build 启动 CAS 失败')

  const narrative = narrativeFromBrief(brief)
  const keyVisualAssetKey = `${production.productionKey}.build-${build.buildNumber}.background.opening`
  const visualBytes = brief.media.visualLevel === 'none'
    ? null
    : localKeyVisual({ title: production.title, conflict: brief.intent.openingSituation, tone: brief.intent.tone })
  const [narrativeArtifact, visual] = await Promise.all([
    acceptGameBuildArtifact({
      scope, buildId: build.id!, controlEpoch: build.controlEpoch, artifactKey: 'runtime.narrative',
      kind: 'narrative', payload: narrative, inputHash: briefRow.briefHash,
      quality: { graph: '5-nodes-2-endings', sourceAnchors: brief.source.startingPoint.sourceRefs },
      rights: { origin: 'deterministic-local', containsThirdPartyText: false },
    }),
    (async () => {
      if (!visualBytes) return acceptGameBuildArtifact({
        scope, buildId: build.id!, controlEpoch: build.controlEpoch, artifactKey: 'media.key-visual',
        kind: 'visual-bible', payload: { fallback: 'text-only', reason: 'Brief visualLevel=none' },
        inputHash: briefRow.briefHash, rights: { origin: 'none', commercialUse: true },
      })
      const blob = await putMediaBlobObject({
        scope, data: visualBytes, mimeType: 'image/svg+xml', backend: 'indexeddb', sanitizedSvg: true,
      })
      return acceptGameBuildArtifact({
        scope, buildId: build.id!, controlEpoch: build.controlEpoch, artifactKey: 'media.key-visual',
        requirementKey: 'media.visual', kind: 'image', mediaKind: 'background',
        payload: { assetKey: keyVisualAssetKey, generator: 'storyforge-procedural-svg-v1' },
        metadata: { width: 1200, height: 675, altText: `${production.title} 的开场概念图` },
        quality: { dimensionsVerified: true, sanitizer: 'sanitize-svg' },
        rights: { origin: 'storyforge-procedural-svg-v1', license: 'CC0-1.0', commercialUse: true },
        contentHash: blob.contentHash, blobObjectId: blob.id!, mimeType: blob.mimeType,
        byteSize: blob.byteSize, inputHash: briefRow.briefHash,
      })
    })(),
  ])

  const runtimePackage: GameRuntimePackageV2 = {
    schema: 'storyforge.game-runtime-package', version: 2, productType: brief.intent.productType,
    definition: {
      gameKey: production.productionKey, title: production.title,
      description: brief.intent.coreExperience.join('；'),
      enabledCapabilities: brief.intent.productType === 'avg' ? ['narrative', 'presentation'] : ['narrative'],
      rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: { contentHash: brief.source.worldContentHash, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: brief.source.startingPoint.title,
      entryNodeKey: 'opening', ...narrative,
    },
  }
  if (brief.intent.productType === 'avg') {
    const asset = visual.blobObjectId == null ? null : {
      assetKey: keyVisualAssetKey, version: 1, kind: 'background' as const,
      name: `${production.title} · 开场`, mimeType: visual.mimeType!, byteSize: visual.byteSize,
      width: 1200, height: 675, durationMs: null, contentHash: visual.contentHash,
      blobContentHash: visual.contentHash, source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0',
      altText: `${production.title} 的开场概念图`, characterTag: '', sceneTag: 'opening',
    }
    runtimePackage.presentation = {
      version: 1,
      cues: asset ? [{
        cueKey: 'cue.opening.background', beatKey: 'beat.opening', phase: 'before',
        type: 'set-background', assetKey: asset.assetKey, durationMs: 500, easing: 'ease-in-out', order: 0,
      }] : [],
      assets: asset ? [asset] : [],
    }
  }
  const parsedPackage = parseGameRuntimePackageV2(runtimePackage)
  const packageHash = await hashGameProductionValueV2(parsedPackage)
  let previousPackage: Parameters<typeof createGameBuildCompatibilityReportV1>[0]['previous'] = null
  if (build.parentBuildNumber != null) {
    const parentBuild = await db.gameBuilds
      .where('[productionId+buildNumber]').equals([build.productionId, build.parentBuildNumber]).first()
    const parentArtifact = parentBuild?.id == null ? null : await db.gameBuildArtifacts
      .where('[buildId+artifactKey]').equals([parentBuild.id, 'runtime.package']).first()
    if (!parentBuild?.packageHash || !parentArtifact || !['accepted', 'carried-forward'].includes(parentArtifact.status)) {
      throw new Error('[game-production-vertical] compatibility parent package 缺失')
    }
    const parentRuntimePackage = parseGameRuntimePackageV2(parentArtifact.payloadJson)
    if (await hashGameProductionValueV2(parentRuntimePackage) !== parentBuild.packageHash) {
      throw new Error('[game-production-vertical] compatibility parent package hash 不一致')
    }
    previousPackage = {
      buildNumber: parentBuild.buildNumber, packageHash: parentBuild.packageHash,
      runtimePackage: parentRuntimePackage,
    }
  }
  const compatibility = await createGameBuildCompatibilityReportV1({
    previous: previousPackage,
    current: { buildNumber: build.buildNumber, packageHash, runtimePackage: parsedPackage },
  })
  const integrationInputHash = await hashGameProductionValueV2([
    narrativeArtifact.contentHash, visual.contentHash, planHash,
  ])
  await acceptGameBuildArtifact({
    scope, buildId: build.id!, controlEpoch: build.controlEpoch, artifactKey: 'runtime.package',
    kind: 'presentation', payload: parsedPackage, inputHash: integrationInputHash,
    quality: { parser: 'parseGameRuntimePackageV2', packageHash },
    rights: { mediaArtifactKey: visual.artifactKey, mediaRightsHash: await hashGameProductionValueV2(JSON.parse(visual.rightsJson)) },
  })

  const mediaBindings = brief.intent.productType === 'avg' && visual.blobObjectId != null ? [{
    assetKey: keyVisualAssetKey, artifactKey: visual.artifactKey, blobContentHash: visual.contentHash,
  }] : []
  const fallbackSummary = [
    '内容由本地确定性 Brief 编译器生成，未调用或冒充外部模型。',
    ...(visual.blobObjectId == null ? ['未生成视觉，玩家使用纯文字 fallback。'] : []),
    ...(brief.media.audioLevel !== 'none' ? ['本地纵切未生成音频，运行时保持静音可通关。'] : []),
  ].sort()
  const completedGateIds = ['narrative.graph.valid', 'rights.complete', 'runtime.package.valid', 'runtime.playable']
  const mediaCoverage = brief.media.imageCount > 0
    ? Math.min(1, (visual.blobObjectId == null ? 0 : 1) / brief.media.imageCount)
    : 1
  const packageQualityReady = mediaCoverage >= brief.completionContract.minimumMediaCoverage
  const releaseReady = packageQualityReady && brief.qualityProfile !== 'commercial-candidate'
  const quality: GameBuildQualityReportV1 = {
    schema: 'storyforge.game-build-quality-report', version: 1, buildNumber: build.buildNumber,
    packageHash, hardGateResults: completedGateIds.map(gateId => ({
      gateId, passed: true, evidence: [packageHash],
    })),
    softGateResults: [{
      gateId: 'media.coverage', passed: packageQualityReady,
      evidence: [`coverage=${mediaCoverage}`, `required=${brief.completionContract.minimumMediaCoverage}`],
    }],
    mediaCoverage, playable: true, releaseReady: packageQualityReady,
    warnings: fallbackSummary,
  }
  const qualityHash = await hashGameProductionValueV2(quality)
  await acceptGameBuildArtifact({
    scope, buildId: build.id!, controlEpoch: build.controlEpoch, artifactKey: 'quality.report',
    kind: 'quality-report', payload: quality, inputHash: packageHash,
    quality: { hardGatesPassed: true, releaseReady: packageQualityReady }, rights: {},
  })
  const allArtifacts = await readAcceptedBuildArtifacts({ scope, buildId: build.id! })
  const manifest: GameBuildManifestV1 = {
    schema: 'storyforge.game-build-manifest', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    briefRevision: briefRow.revision, briefHash: briefRow.briefHash, planHash,
    controlEpoch: build.controlEpoch, runtimePackageHash: packageHash,
    artifactReceipts: allArtifacts.map(row => ({
      artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    })),
    completedGateIds, fallbackSummary,
  }
  const manifestJson = canonicalGameProductionJsonV2(manifest)
  const manifestHash = await hashGameProductionValueV2(manifest)
  const preview = await createGameBuildPreviewManifestV1({
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    buildManifestHash: manifestHash, runtimePackage: parsedPackage, mediaBindings, fallbackSummary,
  })
  const rootTerminalReceiptHash = await createGameBuildRootTerminalReceiptV1({
    planHash, manifestHash, packageHash, qualityReportHash: qualityHash,
    controlEpoch: build.controlEpoch, budgetLedgerJson: build.budgetLedgerJson,
    artifacts: allArtifacts,
  })
  const completedAt = Date.now()
  const committed = await db.transaction('rw', scopeTransactionTables(
    db.gameBuilds, db.gameProductions, db.gameBuildArtifacts, db.mediaBlobObjects,
  ), async () => {
    const current = await db.gameBuilds.get(build.id!)
    const root = await db.gameProductions.get(production.id!)
    if (!current || !root || current.controlEpoch !== build.controlEpoch || current.status !== 'building') return false
    const currentArtifacts = await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray()
    if (currentArtifacts.filter(row => row.status === 'accepted').length !== allArtifacts.length) return false
    await db.gameBuilds.update(build.id!, {
      status: releaseReady ? 'release-ready' : 'preview-ready',
      stateRevision: current.stateRevision + 1,
      manifestJson, manifestHash, packageHash,
      previewManifestJson: canonicalGameProductionJsonV2(preview), previewHash: preview.previewHash,
      qualityReportJson: canonicalGameProductionJsonV2(quality), qualityReportHash: qualityHash,
      compatibilityJson: canonicalGameProductionJsonV2(compatibility),
      rootTerminalReceiptHash, completedAt, updatedAt: completedAt,
    })
    await db.gameProductions.update(root.id!, {
      status: 'preview-ready', stateRevision: root.stateRevision + 1, updatedAt: completedAt,
    })
    return true
  })
  if (!committed) throw new Error('[game-production-vertical] 终态提交时 Build epoch/status 已变化，产物已保留待恢复')
  // Let any active Dexie transaction finish before the caller immediately
  // opens the preview in a separate resolver/lease transaction.
  if (Dexie.currentTransaction) await Dexie.waitFor(Promise.resolve())
  return { buildId: build.id!, previewHash: preview.previewHash, packageHash, releaseReady }
}
