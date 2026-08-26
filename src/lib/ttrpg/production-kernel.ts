import { hashCanonicalValue } from '../agent/run/hash'
import type {
  GameRuntimePackageV2,
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgProductionBriefV2,
  TtrpgProductionSourceCatalogV1,
  TtrpgProductionSourceSelectionV1,
  TtrpgProductionSourceValidationV1,
  WorkspaceScope,
  WorldGameSourceSelectionV2,
} from '../types'
import type { WorldGameSourceCatalog } from '../text-game/world-generation'
import {
  compileTtrpgProductionBriefV2,
  parseTtrpgProductionBriefV2,
  resolveTtrpgProductionRulePackV2,
  type TtrpgProductionBriefDraftInputV2,
} from './production-brief'
import { compileProductionTtrpgCampaignV2 } from './production-compiler'
import { assertTtrpgProductionSourceReadyV1 } from './production-source'

function fail(message: string): never { throw new Error(`[ttrpg-production-kernel] ${message}`) }

export interface PreparedTtrpgProductionSourceV1 {
  catalog: TtrpgProductionSourceCatalogV1
  selection: TtrpgProductionSourceSelectionV1
  validation: TtrpgProductionSourceValidationV1
  /** Temporary in-memory bridge for the already implemented campaign compiler. Never persist this shape. */
  compilerSelection: WorldGameSourceSelectionV2
  compilerCatalog: Pick<WorldGameSourceCatalog, 'characters' | 'locations' | 'artifacts' | 'storyArcs'>
  narrative: GameRuntimePackageV2['narrative']
  sourceRef: string
  sourceKeyToCompilerId: Record<string, number>
}

export interface TtrpgDevelopmentPreviewV1 {
  schema: 'storyforge.ttrpg-development-preview'
  version: 1
  developmentOnly: boolean
  sourceKey: string
  sourceCatalogHash: string
  sourceSelectionHash: string
  brief: TtrpgProductionBriefV2
  rulePack: RulePackV1
  campaign: TtrpgCampaignContentV1
  validation: TtrpgProductionSourceValidationV1
  previewHash: string
}

function indexRecords<T extends { sourceKey: string; name: string; description: string }>(rows: T[]) {
  return rows.map((row, exportId) => ({ exportId, name: row.name, description: row.description }))
}

function idsFor(keys: string[], idByKey: Map<string, number>, label: string): number[] {
  return keys.map(sourceKey => idByKey.get(sourceKey) ?? fail(`${label} 无法映射:${sourceKey}`))
}

/**
 * Resolve one product-owned source into compiler primitives. The legacy
 * WorldGame shape exists only inside this function so production/runtime code
 * can migrate without coupling development fixtures to WorldRelease.
 */
export async function prepareTtrpgProductionSourceV1(input: {
  catalog: unknown
  selection: unknown
}): Promise<PreparedTtrpgProductionSourceV1> {
  const { catalog, selection, validation } = await assertTtrpgProductionSourceReadyV1(input)
  const characterIds = new Map(catalog.characters.map((row, index) => [row.sourceKey, index]))
  const locationIds = new Map(catalog.locations.map((row, index) => [row.sourceKey, index]))
  const artifactIds = new Map(catalog.artifacts.map((row, index) => [row.sourceKey, index]))
  const storyArcIds = new Map(catalog.storyArcs.map((row, index) => [row.sourceKey, index]))
  const selectedNodeKeys = new Set(selection.narrativeNodeKeys)
  const nodes = catalog.narrative.nodes.filter(node => selectedNodeKeys.has(node.key))
  if (nodes.length < 3) fail('叙事选择不足 3 个节点，无法制作跑团')
  const compilerSelection: WorldGameSourceSelectionV2 = {
    schema: 'storyforge.world-game-source', version: 2, productType: 'ttrpg',
    worldContentHash: catalog.identity.sourceContentHash,
    narrativeModuleExportIds: [0],
    characterExportIds: idsFor(selection.characterKeys, characterIds, 'characters'),
    characterRelationExportIds: [],
    importantLocationExportIds: idsFor(selection.locationKeys, locationIds, 'locations'),
    artifactExportIds: idsFor(selection.artifactKeys, artifactIds, 'artifacts'),
    codexEntryExportIds: [],
    storyArcExportIds: idsFor(selection.storyArcKeys, storyArcIds, 'storyArcs'),
    avgMediaAssetExportIds: [],
    productSource: {
      kind: 'ttrpg',
      participantCharacterExportIds: idsFor(selection.characterKeys, characterIds, 'characters'),
      locationExportIds: idsFor(selection.locationKeys, locationIds, 'locations'),
      questStoryArcExportIds: idsFor(selection.storyArcKeys, storyArcIds, 'storyArcs'),
    },
  }
  return {
    catalog,
    selection,
    validation,
    compilerSelection,
    compilerCatalog: {
      characters: indexRecords(catalog.characters),
      locations: indexRecords(catalog.locations),
      artifacts: indexRecords(catalog.artifacts),
      storyArcs: catalog.storyArcs.map((row, exportId) => ({
        exportId, name: row.name, description: row.description, type: row.kind,
      })),
    },
    narrative: {
      moduleKind: catalog.narrative.moduleKind,
      moduleTitle: catalog.narrative.title,
      entryNodeKey: catalog.narrative.entryNodeKey,
      nodes: nodes.map(node => ({
        key: node.key, kind: node.kind, title: node.title, summary: node.summary,
        conditionJson: '{}', effectsJson: '[]', successorKeys: [...node.successorKeys],
      })),
      beats: [],
      choices: [],
    },
    sourceRef: catalog.identity.sourceKind === 'world-release'
      ? `world:${catalog.identity.sourceContentHash}`
      : `ttrpg-development-source:${catalog.identity.sourceContentHash}`,
    sourceKeyToCompilerId: Object.fromEntries([
      ...characterIds, ...locationIds, ...artifactIds, ...storyArcIds,
    ]),
  }
}

function defaultRuleOrigin(catalog: TtrpgProductionSourceCatalogV1): NonNullable<TtrpgProductionBriefDraftInputV2['rules']>['origin'] {
  if (catalog.ruleProfileKey === 'd20-fantasy') return 'builtin-d20-fantasy'
  if (catalog.ruleProfileKey === 'd100-investigation') return 'builtin-d100-investigation'
  if (catalog.ruleProfileKey === 'rank-lite') return 'builtin-rank-lite'
  return 'builtin-storyforge'
}

function mergeDraftRuleOrigin(
  prepared: PreparedTtrpgProductionSourceV1,
  draft: TtrpgProductionBriefDraftInputV2 | undefined,
): TtrpgProductionBriefDraftInputV2 {
  const selectedCharacters = prepared.selection.characterKeys
    .map(sourceKey => prepared.catalog.characters.find(row => row.sourceKey === sourceKey))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .slice(0, 4)
  const sourceSeats = draft?.seats == null && selectedCharacters.length
    ? selectedCharacters.map((character, index) => ({
        seatKey: `player.${index + 1}`,
        label: character.name,
        controller: index === 0 ? 'human' as const : 'ai' as const,
        role: 'player' as const,
        characterMode: 'world-template' as const,
        sourceCharacterExportId: prepared.sourceKeyToCompilerId[character.sourceKey] ?? null,
        characterName: character.name,
        rankTier: null,
        privateGoal: character.description || `以 ${character.name} 的立场推进战役。`,
      }))
    : undefined
  return {
    ...draft,
    ...(sourceSeats ? {
      playerCount: sourceSeats.length,
      seats: sourceSeats,
      characters: { defaultCreationMode: 'world-template', ...draft?.characters },
    } : {}),
    rules: { origin: defaultRuleOrigin(prepared.catalog), ...draft?.rules },
  }
}

/** Compile a Brief without exposing WorldRelease or generic game selection to the caller. */
export async function compileTtrpgBriefFromProductionSourceV1(input: {
  scope: WorkspaceScope
  catalog: unknown
  selection: unknown
  title: string
  premise: string
  tone: string[]
  scale: { targetPlayMinutes: number; targetEndingCount: number; scope: string }
  contentBoundaries: string[]
  confirmDefaultMappings: boolean
  draft?: TtrpgProductionBriefDraftInputV2
}): Promise<{ prepared: PreparedTtrpgProductionSourceV1; brief: TtrpgProductionBriefV2 }> {
  const prepared = await prepareTtrpgProductionSourceV1(input)
  const brief = await compileTtrpgProductionBriefV2({
    scope: input.scope,
    selection: prepared.compilerSelection,
    sourceDescriptor: {
      kind: prepared.catalog.identity.sourceKind,
      label: prepared.catalog.identity.developmentOnly ? '冻结跑团开发来源' : '冻结世界发布来源',
      rootRef: prepared.sourceRef,
    },
    title: input.title, premise: input.premise, tone: input.tone, scale: input.scale,
    contentBoundaries: input.contentBoundaries,
    confirmDefaultMappings: input.confirmDefaultMappings,
    draft: mergeDraftRuleOrigin(prepared, input.draft),
  })
  return { prepared, brief }
}

/**
 * Build a complete, playable but explicitly non-publishable preview from a
 * development fixture or a formally adapted frozen source.
 */
export async function compileTtrpgDevelopmentPreviewV1(input: {
  scope: WorkspaceScope
  catalog: unknown
  selection: unknown
  title: string
  premise: string
  tone: string[]
  scale: { targetPlayMinutes: number; targetEndingCount: number; scope: string }
  contentBoundaries: string[]
  confirmDefaultMappings: boolean
  draft?: TtrpgProductionBriefDraftInputV2
}): Promise<TtrpgDevelopmentPreviewV1> {
  const { prepared, brief } = await compileTtrpgBriefFromProductionSourceV1(input)
  return compileTtrpgPreviewFromConfirmedBriefV1({
    scope: input.scope,
    catalog: prepared.catalog,
    selection: prepared.selection,
    brief,
  })
}

/** Rebuild from the exact confirmed Brief revision; no consultation defaults are rerun. */
export async function compileTtrpgPreviewFromConfirmedBriefV1(input: {
  scope: WorkspaceScope
  catalog: unknown
  selection: unknown
  brief: unknown
}): Promise<TtrpgDevelopmentPreviewV1> {
  const prepared = await prepareTtrpgProductionSourceV1(input)
  const brief = parseTtrpgProductionBriefV2(input.brief)
  if (brief.campaignDesign?.sourceWorldContentHash !== prepared.catalog.identity.sourceContentHash) {
    fail('确认 Brief 与冻结生产来源不一致')
  }
  const rulePack = await resolveTtrpgProductionRulePackV2({ scope: input.scope, brief })
  const bundleHash = await hashCanonicalValue({
    purpose: 'ttrpg-production-source-preview-v1',
    sourceCatalogHash: prepared.catalog.catalogHash,
    sourceSelectionHash: prepared.selection.selectionHash,
  })
  const campaign = compileProductionTtrpgCampaignV2({
    productionKey: `preview.${prepared.catalog.identity.sourceKey}`,
    brief,
    selection: prepared.compilerSelection,
    narrative: prepared.narrative,
    sourceCatalog: prepared.compilerCatalog,
    rulePack,
    worldContentHash: prepared.catalog.identity.sourceContentHash,
    playableWorldBundleHash: bundleHash,
    sourceRef: prepared.sourceRef,
  })
  const body = {
    schema: 'storyforge.ttrpg-development-preview' as const,
    version: 1 as const,
    developmentOnly: prepared.catalog.identity.developmentOnly,
    sourceKey: prepared.catalog.identity.sourceKey,
    sourceCatalogHash: prepared.catalog.catalogHash,
    sourceSelectionHash: prepared.selection.selectionHash,
    brief,
    rulePack,
    campaign,
    validation: prepared.validation,
  }
  return { ...body, previewHash: await hashCanonicalValue(body) }
}
