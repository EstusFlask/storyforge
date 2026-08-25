import type {
  NarrativeCondition,
  NarrativeEffect,
  NarrativeModuleKind,
  NarrativeNodeKind,
} from './narrative-blueprint'
import type {
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
} from './character-interaction'
import type { AdventureContentV1 } from './adventure'
import type { AvgPresentationContentV1, FrozenAvgMediaAsset } from './avg'
import type { NarrativeSimulationContentV1 } from './narrative-simulation'
import type { OpenWorldContentV1 } from './open-world'
import type { TtrpgRuntimeContentV1 } from './ttrpg-product'

export const GAME_PRODUCT_TYPES = [
  'storygame',
  'character-interaction',
  'text-adventure',
  'avg',
  'narrative-simulation',
  'text-open-world',
  'ttrpg',
] as const
export type GameProductType = typeof GAME_PRODUCT_TYPES[number]

export interface WorldGameSourceSelectionV1 {
  schema: 'storyforge.world-game-source'
  version: 1
  productType: Extract<GameProductType, 'storygame' | 'text-adventure' | 'avg'>
  worldContentHash: string
  narrativeModuleExportId: number
  characterExportIds: number[]
  characterRelationExportIds: number[]
  importantLocationExportIds: number[]
  artifactExportIds: number[]
  codexEntryExportIds: number[]
  storyArcExportIds: number[]
  avgMediaAssetExportIds: number[]
}

export type ProductSpecificWorldSourceV1 =
  | {
      kind: 'storygame'
      narrativeModuleExportIds: number[]
    }
  | {
      kind: 'character-interaction'
      participantCharacterExportIds: number[]
      sceneKeys: string[]
    }
  | {
      kind: 'text-adventure'
      locationExportIds: number[]
      itemExportIds: number[]
      questStoryArcExportIds: number[]
    }
  | {
      kind: 'avg'
      presentationStyle: string
      existingMediaAssetExportIds: number[]
    }
  | {
      kind: 'narrative-simulation'
      issueStoryArcExportIds: number[]
      factionExportIds: number[]
    }
  | {
      kind: 'text-open-world'
      regionLocationExportIds: number[]
      factionExportIds: number[]
      questStoryArcExportIds: number[]
    }
  | {
      kind: 'ttrpg'
      participantCharacterExportIds: number[]
      locationExportIds: number[]
      questStoryArcExportIds: number[]
    }

/** Portable selection shared by six text-game products and TTRPG Builds/Releases. */
export interface WorldGameSourceSelectionV2 {
  schema: 'storyforge.world-game-source'
  version: 2
  productType: GameProductType
  worldContentHash: string
  narrativeModuleExportIds: number[]
  characterExportIds: number[]
  characterRelationExportIds: number[]
  importantLocationExportIds: number[]
  artifactExportIds: number[]
  codexEntryExportIds: number[]
  storyArcExportIds: number[]
  avgMediaAssetExportIds: number[]
  productSource: ProductSpecificWorldSourceV1 | null
}

export interface GameDefinition {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameKey: string
  productType: GameProductType
  title: string
  description: string
  status: 'draft' | 'archived'
  narrativeModuleId: number
  enabledCapabilitiesJson: string
  initialVariablesJson: string
  rulesetVersion: number
  /** Immutable WorldRelease content hash used to derive this authored draft. */
  sourceWorldContentHash?: string
  /** Portable export-id selection; never stores source Dexie numeric ids. */
  sourceSelectionJson?: string
  /** Deterministic world-to-game mapping contract version. */
  sourceMappingVersion?: number
  createdAt: number
  updatedAt: number
}

export const NARRATIVE_BEAT_KINDS = ['narration', 'dialogue', 'action', 'system'] as const
export type NarrativeBeatKind = typeof NARRATIVE_BEAT_KINDS[number]

export interface NarrativeBeat {
  id?: number
  projectId: number
  moduleId: number
  nodeKey: string
  beatKey: string
  kind: NarrativeBeatKind
  speakerCharacterId?: number | null
  text: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface NarrativeChoice {
  id?: number
  projectId: number
  moduleId: number
  sourceNodeKey: string
  choiceKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tagsJson: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface FrozenNarrativeBeat {
  beatKey: string
  nodeKey: string
  kind: NarrativeBeatKind
  speakerKey: string | null
  text: string
  order: number
}

export interface FrozenNarrativeChoice {
  choiceKey: string
  sourceNodeKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tags: string[]
  order: number
}

export interface FrozenGameNarrativeNode {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeys: string[]
}

export interface NarrativeContentGraphReport {
  valid: boolean
  entryKey: string | null
  reachableNodeKeys: string[]
  unreachableNodeKeys: string[]
  endingNodeKeys: string[]
  reachableEndingKeys: string[]
  deadEndNodeKeys: string[]
  danglingSuccessors: Array<{ nodeKey: string; successorKey: string }>
  invalidChoiceTargets: Array<{ choiceKey: string; targetNodeKey: string }>
  orphanBeatKeys: string[]
  orphanChoiceKeys: string[]
  cycleRisks: string[][]
  blockingCycleKeys: string[][]
  errors: string[]
}

export interface GameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'storygame'
  definition: {
    gameKey: string
    title: string
    description: string
    enabledCapabilities: string[]
    rulesetVersion: number
    initialVariables: Record<string, unknown>
    source?: {
      worldContentHash: string
      mappingVersion: number
      selection: WorldGameSourceSelectionV1
    } | null
  }
  worldRelease: {
    contentHash: string
    narrativeModuleExportId: number
  }
  narrative: {
    moduleKind: NarrativeModuleKind
    moduleTitle: string
    entryNodeKey: string
    nodes: FrozenGameNarrativeNode[]
    beats: FrozenNarrativeBeat[]
    choices: FrozenNarrativeChoice[]
  }
}

export interface InteractionGameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'character-interaction'
  definition: GameReleaseManifestV1['definition']
  worldRelease: GameReleaseManifestV1['worldRelease']
  narrative: GameReleaseManifestV1['narrative']
  interaction: {
    playerKey: 'player'
    profiles: FrozenInteractionCharacterProfile[]
    sceneTemplates: FrozenInteractionSceneTemplate[]
  }
}

export interface AdventureGameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'text-adventure'
  definition: GameReleaseManifestV1['definition']
  worldRelease: GameReleaseManifestV1['worldRelease']
  narrative: GameReleaseManifestV1['narrative']
  interaction: InteractionGameReleaseManifestV1['interaction']
  adventure: AdventureContentV1
}

export interface AvgGameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'avg'
  definition: GameReleaseManifestV1['definition']
  worldRelease: GameReleaseManifestV1['worldRelease']
  narrative: GameReleaseManifestV1['narrative']
  presentation: AvgPresentationContentV1 & {
    assets: FrozenAvgMediaAsset[]
  }
}

export interface NarrativeSimulationGameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'narrative-simulation'
  definition: GameReleaseManifestV1['definition']
  worldRelease: GameReleaseManifestV1['worldRelease']
  narrative: GameReleaseManifestV1['narrative']
  simulation: NarrativeSimulationContentV1
}

export interface TextOpenWorldGameReleaseManifestV1 {
  schema: 'storyforge.game-release'
  version: 1
  productType: 'text-open-world'
  definition: GameReleaseManifestV1['definition']
  worldRelease: GameReleaseManifestV1['worldRelease']
  narrative: GameReleaseManifestV1['narrative']
  interaction: InteractionGameReleaseManifestV1['interaction']
  adventure: AdventureContentV1
  simulation: NarrativeSimulationContentV1
  openWorld: OpenWorldContentV1
}

export type AnyGameReleaseManifestV1 = GameReleaseManifestV1 | InteractionGameReleaseManifestV1 | AdventureGameReleaseManifestV1 | AvgGameReleaseManifestV1 | NarrativeSimulationGameReleaseManifestV1 | TextOpenWorldGameReleaseManifestV1

export interface FrozenRuntimeMediaAssetV2 extends FrozenAvgMediaAsset {
  /** Content-addressed physical object identity; never a local row id or object URL. */
  blobContentHash: string
}

/**
 * Product-neutral immutable package shared by Build Preview and GameRelease v2.
 * It contains no Dexie ids, provider credentials, binary bytes, Build ids, or Release ids.
 */
export interface GameRuntimePackageV2 {
  schema: 'storyforge.game-runtime-package'
  version: 2
  productType: GameProductType
  definition: {
    gameKey: string
    title: string
    description: string
    enabledCapabilities: string[]
    rulesetVersion: number
    initialVariables: Record<string, unknown>
  }
  sourceWorld: {
    contentHash: string
    selection: WorldGameSourceSelectionV2
  }
  narrative: GameReleaseManifestV1['narrative']
  interaction?: InteractionGameReleaseManifestV1['interaction']
  adventure?: AdventureContentV1
  presentation?: AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
  simulation?: NarrativeSimulationContentV1
  openWorld?: OpenWorldContentV1
  ttrpg?: TtrpgRuntimeContentV1
}

export interface GameReleaseManifestV2 {
  schema: 'storyforge.game-release'
  version: 2
  productType: GameProductType
  sourceWorldRelease: {
    contentHash: string
  }
  runtimePackage: GameRuntimePackageV2
  packageHash: string
  productionProvenance: {
    productionKey: string
    buildNumber: number
    buildManifestHash: string
    rootTerminalReceiptHash: string
  } | null
}

export type AnyGameReleaseManifest = AnyGameReleaseManifestV1 | GameReleaseManifestV2

export interface GameRelease {
  id?: number
  projectId: number
  worldId: number
  workId: number
  gameDefinitionId?: number | null
  worldReleaseId: number
  version: number
  label: string
  manifestJson: string
  contentHash: string
  createdAt: number
  /** Optional marketplace receipt; contains no access/payment credential. */
  distributionProvenance?: {
    source: 'marketplace'
    listingId: string
    orderId: string | null
    entitlementId: string | null
    license: {
      licenseId: string
      licenseVersion: string
      allowOfflineExport: boolean
      allowRemix: boolean
      commercialReuse: boolean
      requiresAttribution: boolean
      termsUrl: string
    }
    attribution: string[]
    localCopyPreserved: boolean
    acquiredAt: number
    importedAt: number
  }
}

export interface NarrativeChoiceEvaluation {
  choiceKey: string
  visible: boolean
  available: boolean
  unavailableReason: string
  targetNodeKey: string
}

export interface NarrativeChoiceCommittedPayload {
  commandId: string
  baseSequence: number
  baseStateHash: string
  fromNodeKey: string
  choiceKey: string
  toNodeKey: string
}

export interface NarrativeChoiceHistoryEntry {
  eventSequence: number
  choiceKey: string
  fromNodeKey: string
  toNodeKey: string
}

export type ParsedNarrativeCondition = NarrativeCondition
export type ParsedNarrativeEffect = NarrativeEffect
