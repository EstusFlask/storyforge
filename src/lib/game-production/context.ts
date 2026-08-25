import { db } from '../db/schema'
import type { WorkspaceScope, WorldReleaseManifestV2 } from '../types'
import type { AssembleContextInput } from '../registry/types'
import { assertRecordInScope } from '../world-engine/scope'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { loadWorldGameSourceCatalog } from '../text-game/world-generation'

function requiredScope(input: AssembleContextInput): WorkspaceScope {
  if (!input.scope) throw new Error('[game-production-context] 缺少已解析 WorkspaceScope')
  return input.scope
}

function requiredId(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new Error(`[game-production-context] 缺少 ${label}`)
  return value!
}

function parseWorldManifest(value: string): WorldReleaseManifestV2 {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('[game-production-context] WorldRelease manifest 无法解析') }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).schema !== 'storyforge.world-package'
    || (parsed as any).version !== 2 || !Array.isArray((parsed as any).selectedNarrativeModules)
    || !Array.isArray((parsed as any).dependencies) || !(parsed as any).records) {
    throw new Error('[game-production-context] WorldRelease manifest 合同无效')
  }
  return parsed as WorldReleaseManifestV2
}

export async function readGameProductionConsultationSource(input: AssembleContextInput): Promise<string> {
  const scope = requiredScope(input)
  const releaseId = requiredId(input.gameWorldReleaseId, 'gameWorldReleaseId')
  const release = await db.worldReleases.get(releaseId)
  if (!release || !await assertRecordInScope(scope, 'worldReleases', release, { owner: 'world' })) {
    throw new Error('[game-production-context] WorldRelease 不存在或跨 World')
  }
  await assertReleaseUnchanged(releaseId)
  const manifest = parseWorldManifest(release.manifestJson)
  const gameCatalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: releaseId })
  const compactRows = (table: string) => (manifest.records[table] ?? []).slice(0, 30).map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const exportId = Number.isInteger(row._exportId) ? row._exportId : index
    const label = [row.title, row.name, row.label].find(value => typeof value === 'string')
    const summary = [row.summary, row.description, row.logline].find(value => typeof value === 'string')
    return {
      exportId,
      label: typeof label === 'string' ? label.slice(0, 300) : `${table} ${exportId}`,
      summary: typeof summary === 'string' ? summary.slice(0, 600) : '',
      kind: typeof row.kind === 'string' ? row.kind : typeof row.type === 'string' ? row.type : null,
    }
  })
  return JSON.stringify({
    schema: 'storyforge.game-production.consultation-source', version: 1,
    release: { version: release.version, label: release.label, contentHash: release.contentHash },
    world: { code: manifest.worldCode, name: manifest.worldName, workTitle: manifest.workTitle },
    selectedTables: manifest.selectedTables,
    selectedNarrativeModules: manifest.selectedNarrativeModules,
    dependencies: manifest.dependencies,
    availableRecords: Object.entries(manifest.records).map(([table, rows]) => ({ table, rowCount: rows.length })),
    opportunities: {
      narrativeModules: compactRows('narrativeModules'),
      characters: compactRows('characters'),
      storyArcs: compactRows('storyArcs'),
      historicalTimelineEvents: compactRows('historicalTimelineEvents'),
    },
    selectionOptions: {
      narrativeModules: manifest.selectedNarrativeModules.map(item => ({
        exportId: item.exportId, label: item.title, summary: '', kind: item.kind,
      })),
      characters: gameCatalog.characters.map(item => ({
        exportId: item.exportId, label: item.name, summary: item.description, kind: 'character',
      })),
      importantLocations: gameCatalog.locations.map(item => ({
        exportId: item.exportId, label: item.name, summary: item.description, kind: 'location',
      })),
      artifacts: gameCatalog.artifacts.map(item => ({
        exportId: item.exportId, label: item.name, summary: item.description, kind: 'artifact',
      })),
      codexEntries: gameCatalog.loreEntries.map(item => ({
        exportId: item.exportId, label: item.name, summary: item.description, kind: 'lore',
      })),
      storyArcs: gameCatalog.storyArcs.map(item => ({
        exportId: item.exportId, label: item.name, summary: item.description, kind: item.type || 'story-arc',
      })),
      avgMediaAssets: gameCatalog.mediaAssets.map(item => ({
        exportId: item.exportId, label: item.name, summary: `${item.kind} · ${item.mimeType}`, kind: item.kind,
      })),
    },
    selectionRelations: gameCatalog.relationships.map(item => ({
      exportId: item.exportId,
      fromCharacterExportId: item.fromCharacterExportId,
      toCharacterExportId: item.toCharacterExportId,
    })),
    selectionCatalog: {
      narrativeModuleExportIds: manifest.selectedNarrativeModules.map(item => item.exportId),
      characterExportIds: gameCatalog.characters.map(item => item.exportId),
      characterRelationExportIds: gameCatalog.relationships.map(item => item.exportId),
      importantLocationExportIds: gameCatalog.locations.map(item => item.exportId),
      // Inventory events are not world assets. Only codex entries under the
      // governed built-in artifact category enter a portable game selection.
      artifactExportIds: gameCatalog.artifacts.map(item => item.exportId),
      codexEntryExportIds: gameCatalog.loreEntries.map(item => item.exportId),
      storyArcExportIds: gameCatalog.storyArcs.map(item => item.exportId),
      avgMediaAssetExportIds: gameCatalog.mediaAssets.map(item => item.exportId),
    },
  })
}

async function productionAndBuild(input: AssembleContextInput) {
  const scope = requiredScope(input)
  const productionId = requiredId(input.gameProductionId, 'gameProductionId')
  const production = await db.gameProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'gameProductions', production, { owner: 'work' })) {
    throw new Error('[game-production-context] Production 不存在或跨 Work')
  }
  const buildId = input.gameBuildId
  const build = buildId == null ? null : await db.gameBuilds.get(buildId)
  if (build && (build.productionId !== productionId
    || !await assertRecordInScope(scope, 'gameBuilds', build, { owner: 'work' }))) {
    throw new Error('[game-production-context] Build 不属于当前 Production/Work')
  }
  return { scope, production, build }
}

export async function readGameProductionBriefContext(input: AssembleContextInput): Promise<string> {
  const { production } = await productionAndBuild(input)
  if (production.currentBriefRevision == null) throw new Error('[game-production-context] Production 尚无当前 Brief')
  const brief = await db.gameProductionBriefs
    .where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first()
  if (!brief || brief.status !== 'authorized') throw new Error('[game-production-context] 当前 Brief 未授权')
  return JSON.stringify({
    schema: 'storyforge.game-production.brief-context', version: 1,
    productionKey: production.productionKey, briefRevision: brief.revision, briefHash: brief.briefHash,
    sourceWorldContentHash: brief.sourceWorldContentHash, userIntentSummary: brief.userIntentSummary,
    estimate: JSON.parse(brief.estimateJson), brief: JSON.parse(brief.briefJson),
  })
}

export async function readGameProductionArtifactInputs(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] artifact inputs 需要 gameBuildId')
  const requested = new Set(input.gameArtifactKeys ?? [])
  if (requested.size === 0) throw new Error('[game-production-context] artifact inputs 必须显式选择 artifact keys')
  const artifacts = (await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey) && (row.status === 'accepted' || row.status === 'carried-forward'))
    .map(row => ({
      artifactKey: row.artifactKey, version: row.version, kind: row.kind, contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash, payload: JSON.parse(row.payloadJson),
      metadata: JSON.parse(row.metadataJson),
    }))
  if (artifacts.length !== requested.size) throw new Error('[game-production-context] 选择的 Artifact 缺失或未验收')
  return JSON.stringify({ schema: 'storyforge.game-production.artifact-inputs', version: 1, buildNumber: build.buildNumber, artifacts })
}

export async function readGameProductionQualityFeedback(input: AssembleContextInput): Promise<string> {
  const { build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] quality feedback 需要 gameBuildId')
  const requested = new Set(input.gameArtifactKeys ?? [])
  const artifacts = requested.size === 0 ? [] : (await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => requested.has(row.artifactKey))
    .map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash, quality: JSON.parse(row.qualityJson) }))
  return JSON.stringify({
    schema: 'storyforge.game-production.quality-feedback', version: 1,
    buildNumber: build.buildNumber, qualityReportHash: build.qualityReportHash,
    qualityReport: JSON.parse(build.qualityReportJson), artifacts,
  })
}

export async function readGameProductionEvolutionBase(input: AssembleContextInput): Promise<string> {
  const { production, build } = await productionAndBuild(input)
  if (!build) throw new Error('[game-production-context] evolution base 需要 gameBuildId')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    throw new Error('[game-production-context] evolution base 必须是冻结可玩 Build')
  }
  return JSON.stringify({
    schema: 'storyforge.game-production.evolution-base', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    manifest: JSON.parse(build.manifestJson), compatibility: JSON.parse(build.compatibilityJson),
  })
}
