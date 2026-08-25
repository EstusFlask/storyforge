import type { NarrativeModuleKind } from './narrative-blueprint'

export const TTRPG_WORLD_SOURCE_CONTRACT_VERSION = 1 as const
export const TTRPG_WORLD_SOURCE_MAPPING_VERSION = 1 as const

/**
 * TTRPG may consume these WorldRelease tables. This is deliberately a
 * product-owned allow-list, not a renamed copy of the text-game source model.
 */
export const TTRPG_WORLD_SOURCE_RECORD_TABLES = [
  'worldviews',
  'worldRulesProfiles',
  'powerSystems',
  'cultivationSystems',
  'geographies',
  'histories',
  'historicalTimelineEvents',
  'historicalKeywords',
  'worldGroups',
  'worldGroupLinks',
  'worldNodes',
  'importantLocations',
  'codexCategories',
  'codexEntries',
  'characters',
  'characterRelations',
  'workCharacterBindings',
  'storyCores',
  'storyArcs',
  'outlineNodes',
  'detailedOutlines',
] as const

export type TtrpgWorldSourceRecordTableV1 = typeof TTRPG_WORLD_SOURCE_RECORD_TABLES[number]

export const TTRPG_WORLD_SOURCE_TREE_TABLES = [
  'worldNodes',
  'importantLocations',
  'codexCategories',
  'outlineNodes',
] as const satisfies readonly TtrpgWorldSourceRecordTableV1[]

export type TtrpgWorldSourceGranularityV1 =
  | 'whole-table'
  | 'record-set'
  | 'tree-subgraph'
  | 'dependency-closure'

export interface TtrpgWorldSourceRecordSelectionV1 {
  table: TtrpgWorldSourceRecordTableV1
  granularity: TtrpgWorldSourceGranularityV1
  exportIds: number[]
}

export interface TtrpgWorldSourceNarrativeSubgraphV1 {
  moduleExportId: number
  /** Stable NarrativeNode.key values. Successor closure is verified. */
  nodeKeys: string[]
}

export interface TtrpgWorldSourceSelectionV1 {
  schema: 'storyforge.ttrpg-world-source-selection'
  version: 1
  productType: 'ttrpg'
  contractVersion: 1
  worldReleaseId: number
  sourceWorldCode: string
  worldContentHash: string
  sourceWorldExportId: number
  sourceWorkExportId: number
  sourceMappingVersion: 1
  recordSelections: TtrpgWorldSourceRecordSelectionV1[]
  narrativeSubgraphs: TtrpgWorldSourceNarrativeSubgraphV1[]
  /** SHA-256 of every preceding field after canonical ordering. */
  selectionHash: string
}

export type UnfrozenTtrpgWorldSourceSelectionV1 = Omit<TtrpgWorldSourceSelectionV1, 'selectionHash'>

export interface TtrpgWorldSourceCatalogDependencyV1 {
  table: TtrpgWorldSourceRecordTableV1
  exportId: number
}

export interface TtrpgWorldSourceCatalogRecordV1 {
  exportId: number
  stableKey: string | null
  label: string
  summary: string
  parentExportId: number | null
  dependencies: TtrpgWorldSourceCatalogDependencyV1[]
}

export interface TtrpgWorldSourceCatalogTableV1 {
  table: TtrpgWorldSourceRecordTableV1
  records: TtrpgWorldSourceCatalogRecordV1[]
}

export interface TtrpgWorldSourceCatalogNarrativeModuleV1 {
  exportId: number
  kind: NarrativeModuleKind
  title: string
  entryNodeKey: string
  nodeKeys: string[]
}

export interface TtrpgWorldSourceUnselectableTableV1 {
  table: TtrpgWorldSourceRecordTableV1
  reason: 'unresolvable-release-coordinate'
  recordCount: number
}

/** Read-only, product-specific projection of one verified immutable release. */
export interface TtrpgWorldSourceCatalogV1 {
  schema: 'storyforge.ttrpg-world-source-catalog'
  version: 1
  productType: 'ttrpg'
  contractVersion: 1
  worldReleaseId: number
  sourceWorldCode: string
  worldContentHash: string
  sourceWorldExportId: number
  sourceWorkExportId: number
  sourceMappingVersion: 1
  tables: TtrpgWorldSourceCatalogTableV1[]
  narrativeModules: TtrpgWorldSourceCatalogNarrativeModuleV1[]
  /** Semantically useful tables whose frozen package cannot be addressed at all. */
  unselectableReleaseTables: TtrpgWorldSourceUnselectableTableV1[]
  /** Present in the release but intentionally unavailable to TTRPG selection. */
  excludedReleaseTables: string[]
}
