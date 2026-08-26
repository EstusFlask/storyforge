import type { NarrativeModuleKind, NarrativeNodeKind } from './narrative-blueprint'

export const TTRPG_PRODUCTION_SOURCE_VERSION = 1 as const
export const TTRPG_PRODUCTION_SOURCE_ADAPTER_VERSION = 1 as const

export type TtrpgProductionSourceKindV1 = 'development-fixture' | 'world-release'
export type TtrpgProductionSourceDomainV1 = 'characters' | 'locations' | 'artifacts' | 'storyArcs' | 'narrative'
export type TtrpgProductionSourceMissingPolicyV1 = 'block' | 'product-generate' | 'text-fallback'

export interface TtrpgProductionSourceWorldBindingV1 {
  worldReleaseId: number
  sourceWorldCode: string
  sourceWorldExportId: number
  sourceWorkExportId: number
  sourceMappingVersion: number
}

export interface TtrpgProductionSourceIdentityV1 {
  sourceKind: TtrpgProductionSourceKindV1
  sourceKey: string
  sourceContentHash: string
  developmentOnly: boolean
  adapterVersion: 1
  worldBinding: TtrpgProductionSourceWorldBindingV1 | null
}

export interface TtrpgProductionSourceRecordV1 {
  sourceKey: string
  name: string
  description: string
  tags: string[]
}

export interface TtrpgProductionSourceStoryArcV1 extends TtrpgProductionSourceRecordV1 {
  kind: string
}

export interface TtrpgProductionSourceNarrativeNodeV1 {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  successorKeys: string[]
}

export interface TtrpgProductionSourceNarrativeV1 {
  moduleKind: NarrativeModuleKind
  title: string
  entryNodeKey: string
  nodes: TtrpgProductionSourceNarrativeNodeV1[]
}

/**
 * Product-owned, immutable input understood by TTRPG production. It is not a
 * WorldRelease and never contains Dexie ids. A future world adapter may emit
 * the same shape after validating a frozen TtrpgWorldSourceSelection.
 */
export interface TtrpgProductionSourceCatalogV1 {
  schema: 'storyforge.ttrpg-production-source'
  version: 1
  productType: 'ttrpg'
  identity: TtrpgProductionSourceIdentityV1
  title: string
  summary: string
  ruleProfileKey: 'rank-lite' | 'd20-fantasy' | 'd100-investigation' | 'custom'
  missingPolicies: Record<TtrpgProductionSourceDomainV1, TtrpgProductionSourceMissingPolicyV1>
  characters: TtrpgProductionSourceRecordV1[]
  locations: TtrpgProductionSourceRecordV1[]
  artifacts: TtrpgProductionSourceRecordV1[]
  storyArcs: TtrpgProductionSourceStoryArcV1[]
  narrative: TtrpgProductionSourceNarrativeV1
  /** SHA-256 of every preceding field. */
  catalogHash: string
}

export type UnfrozenTtrpgProductionSourceCatalogV1 = Omit<TtrpgProductionSourceCatalogV1, 'catalogHash'>

export interface TtrpgProductionSourceSelectionV1 {
  schema: 'storyforge.ttrpg-production-source-selection'
  version: 1
  productType: 'ttrpg'
  sourceKey: string
  sourceContentHash: string
  sourceCatalogHash: string
  characterKeys: string[]
  locationKeys: string[]
  artifactKeys: string[]
  storyArcKeys: string[]
  narrativeNodeKeys: string[]
  /** SHA-256 of every preceding field. */
  selectionHash: string
}

export type UnfrozenTtrpgProductionSourceSelectionV1 = Omit<TtrpgProductionSourceSelectionV1, 'selectionHash'>

export interface TtrpgProductionSourceValidationV1 {
  valid: boolean
  developmentOnly: boolean
  formalPublicationEligible: boolean
  errors: string[]
  warnings: string[]
  generatedDomains: TtrpgProductionSourceDomainV1[]
  degradedDomains: TtrpgProductionSourceDomainV1[]
}

export type TtrpgDevelopmentSourceFixtureKeyV1 =
  | 'rank-lite-mist-harbor'
  | 'd20-fantasy-floodgate'
  | 'd100-investigation-archive'
  | 'incomplete-text-fallback'
