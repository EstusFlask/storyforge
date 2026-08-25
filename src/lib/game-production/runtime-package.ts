import { parseAdventureContent } from '../adventure/runtime'
import { freezeAvgMediaAsset, parseAvgPresentationContent, validateAvgPresentation } from '../avg/runtime'
import { parseNarrativeSimulationContent, validateNarrativeSimulationContent } from '../narrative-simulation/runtime'
import { parseOpenWorldContent, validateOpenWorldContent } from '../open-world/runtime'
import { validateNarrativeContentGraph } from '../text-game/content'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
import { NARRATIVE_BEAT_KINDS, NARRATIVE_MODULE_KINDS, NARRATIVE_NODE_KINDS } from '../types'
import type {
  AnyGameReleaseManifestV1,
  AvgMediaAsset,
  FrozenGameNarrativeNode,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  GameProductType,
  GameReleaseManifestV2,
  GameRuntimePackageV2,
  ProductSpecificWorldSourceV1,
  WorldGameSourceSelectionV1,
  WorldGameSourceSelectionV2,
} from '../types'
import { canonicalGameProductionJsonV2, hashGameProductionValueV2, isSha256Hash } from './hash'

const PRODUCT_TYPES = new Set<GameProductType>([
  'storygame',
  'character-interaction',
  'text-adventure',
  'avg',
  'narrative-simulation',
  'text-open-world',
  'ttrpg',
])

const CAPABILITIES: Record<GameProductType, string[]> = {
  storygame: ['narrative'],
  'character-interaction': ['narrative', 'interaction'],
  'text-adventure': ['narrative', 'interaction', 'adventure'],
  avg: ['narrative', 'presentation'],
  'narrative-simulation': ['narrative', 'simulation'],
  'text-open-world': ['narrative', 'interaction', 'adventure', 'simulation', 'open-world'],
  ttrpg: ['narrative', 'ttrpg'],
}

const PRODUCT_MODULE_KEYS: Record<GameProductType, string[]> = {
  storygame: [],
  'character-interaction': ['interaction'],
  'text-adventure': ['interaction', 'adventure'],
  avg: ['presentation'],
  'narrative-simulation': ['simulation'],
  'text-open-world': ['interaction', 'adventure', 'simulation', 'openWorld'],
  ttrpg: ['ttrpg'],
}

function fail(message: string): never {
  throw new Error(`[game-runtime-package] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不符合合同: ${actual.join(',')}`)
  }
}

function requiredText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function optionalText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || value.length > maximum) fail(`${label} 无效`)
  return value.normalize('NFC')
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail(`${label} 必须是 >=${minimum} 的整数`)
  return Number(value)
}

function stringArray(value: unknown, label: string, maximum = 2_000): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => requiredText(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function stableKey(value: unknown, label: string): string {
  const result = requiredText(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail(`${label} 不是稳定 key`)
  return result
}

function stableKeyArray(value: unknown, label: string, maximum = 2_000): string[] {
  const values = stringArray(value, label, maximum)
  return values.map((item, index) => stableKey(item, `${label}[${index}]`))
}

function parseFrozenNarrative(value: unknown): GameRuntimePackageV2['narrative'] {
  const narrative = record(value, 'narrative')
  exactKeys(narrative, ['moduleKind', 'moduleTitle', 'entryNodeKey', 'nodes', 'beats', 'choices'], 'narrative')
  if (!NARRATIVE_MODULE_KINDS.includes(narrative.moduleKind as typeof NARRATIVE_MODULE_KINDS[number])) {
    fail('narrative.moduleKind 无效')
  }
  if (!Array.isArray(narrative.nodes) || !Array.isArray(narrative.beats) || !Array.isArray(narrative.choices)
    || narrative.nodes.length > 10_000 || narrative.beats.length > 100_000 || narrative.choices.length > 100_000) {
    fail('narrative 内容无效或超出数量上限')
  }
  const nodes: FrozenGameNarrativeNode[] = narrative.nodes.map((value, index) => {
    const node = record(value, `narrative.nodes[${index}]`)
    exactKeys(node, ['key', 'kind', 'title', 'summary', 'conditionJson', 'effectsJson', 'successorKeys'], `narrative.nodes[${index}]`)
    if (!NARRATIVE_NODE_KINDS.includes(node.kind as typeof NARRATIVE_NODE_KINDS[number])) {
      fail(`narrative.nodes[${index}].kind 无效`)
    }
    return {
      key: stableKey(node.key, `narrative.nodes[${index}].key`),
      kind: node.kind as FrozenGameNarrativeNode['kind'],
      title: requiredText(node.title, `narrative.nodes[${index}].title`, 500),
      summary: optionalText(node.summary, `narrative.nodes[${index}].summary`, 20_000),
      conditionJson: requiredText(node.conditionJson, `narrative.nodes[${index}].conditionJson`, 64_000),
      effectsJson: requiredText(node.effectsJson, `narrative.nodes[${index}].effectsJson`, 64_000),
      successorKeys: stableKeyArray(node.successorKeys, `narrative.nodes[${index}].successorKeys`),
    }
  })
  const beats: FrozenNarrativeBeat[] = narrative.beats.map((value, index) => {
    const beat = record(value, `narrative.beats[${index}]`)
    exactKeys(beat, ['beatKey', 'nodeKey', 'kind', 'speakerKey', 'text', 'order'], `narrative.beats[${index}]`)
    if (!NARRATIVE_BEAT_KINDS.includes(beat.kind as typeof NARRATIVE_BEAT_KINDS[number])) {
      fail(`narrative.beats[${index}].kind 无效`)
    }
    return {
      beatKey: stableKey(beat.beatKey, `narrative.beats[${index}].beatKey`),
      nodeKey: stableKey(beat.nodeKey, `narrative.beats[${index}].nodeKey`),
      kind: beat.kind as FrozenNarrativeBeat['kind'],
      speakerKey: beat.speakerKey == null ? null : stableKey(beat.speakerKey, `narrative.beats[${index}].speakerKey`),
      text: requiredText(beat.text, `narrative.beats[${index}].text`, 20_000),
      order: integer(beat.order, `narrative.beats[${index}].order`),
    }
  })
  const choices: FrozenNarrativeChoice[] = narrative.choices.map((value, index) => {
    const choice = record(value, `narrative.choices[${index}]`)
    exactKeys(choice, [
      'choiceKey', 'sourceNodeKey', 'text', 'description', 'unavailableReason', 'targetNodeKey',
      'displayConditionJson', 'availableConditionJson', 'effectsJson', 'tags', 'order',
    ], `narrative.choices[${index}]`)
    return {
      choiceKey: stableKey(choice.choiceKey, `narrative.choices[${index}].choiceKey`),
      sourceNodeKey: stableKey(choice.sourceNodeKey, `narrative.choices[${index}].sourceNodeKey`),
      text: requiredText(choice.text, `narrative.choices[${index}].text`, 2_000),
      description: optionalText(choice.description, `narrative.choices[${index}].description`, 20_000),
      unavailableReason: optionalText(choice.unavailableReason, `narrative.choices[${index}].unavailableReason`, 20_000),
      targetNodeKey: stableKey(choice.targetNodeKey, `narrative.choices[${index}].targetNodeKey`),
      displayConditionJson: requiredText(choice.displayConditionJson, `narrative.choices[${index}].displayConditionJson`, 64_000),
      availableConditionJson: requiredText(choice.availableConditionJson, `narrative.choices[${index}].availableConditionJson`, 64_000),
      effectsJson: requiredText(choice.effectsJson, `narrative.choices[${index}].effectsJson`, 64_000),
      tags: stringArray(choice.tags, `narrative.choices[${index}].tags`, 100),
      order: integer(choice.order, `narrative.choices[${index}].order`),
    }
  })
  return {
    moduleKind: narrative.moduleKind as GameRuntimePackageV2['narrative']['moduleKind'],
    moduleTitle: requiredText(narrative.moduleTitle, 'narrative.moduleTitle', 2_000),
    entryNodeKey: stableKey(narrative.entryNodeKey, 'narrative.entryNodeKey'),
    nodes,
    beats,
    choices,
  }
}

function portableIdArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length > 10_000) fail(`${label} 必须是有界数组`)
  const ids = value.map((item, index) => integer(item, `${label}[${index}]`))
  if (new Set(ids).size !== ids.length) fail(`${label} 不能重复`)
  return ids.sort((left, right) => left - right)
}

function productType(value: unknown): GameProductType {
  if (typeof value !== 'string' || !PRODUCT_TYPES.has(value as GameProductType)) fail('productType 无效')
  return value as GameProductType
}

function parseProductSource(value: unknown, expectedProduct: GameProductType): ProductSpecificWorldSourceV1 | null {
  if (value == null) return null
  const source = record(value, 'selection.productSource')
  if (source.kind !== expectedProduct) fail('selection.productSource.kind 与 productType 不一致')
  if (expectedProduct === 'storygame') {
    exactKeys(source, ['kind', 'narrativeModuleExportIds'], 'storygame productSource')
    return { kind: 'storygame', narrativeModuleExportIds: portableIdArray(source.narrativeModuleExportIds, 'narrativeModuleExportIds') }
  }
  if (expectedProduct === 'character-interaction') {
    exactKeys(source, ['kind', 'participantCharacterExportIds', 'sceneKeys'], 'character-interaction productSource')
    return {
      kind: 'character-interaction',
      participantCharacterExportIds: portableIdArray(source.participantCharacterExportIds, 'participantCharacterExportIds'),
      sceneKeys: stringArray(source.sceneKeys, 'sceneKeys'),
    }
  }
  if (expectedProduct === 'text-adventure') {
    exactKeys(source, ['kind', 'locationExportIds', 'itemExportIds', 'questStoryArcExportIds'], 'text-adventure productSource')
    return {
      kind: 'text-adventure',
      locationExportIds: portableIdArray(source.locationExportIds, 'locationExportIds'),
      itemExportIds: portableIdArray(source.itemExportIds, 'itemExportIds'),
      questStoryArcExportIds: portableIdArray(source.questStoryArcExportIds, 'questStoryArcExportIds'),
    }
  }
  if (expectedProduct === 'avg') {
    exactKeys(source, ['kind', 'presentationStyle', 'existingMediaAssetExportIds'], 'avg productSource')
    return {
      kind: 'avg',
      presentationStyle: optionalText(source.presentationStyle, 'presentationStyle', 2_000),
      existingMediaAssetExportIds: portableIdArray(source.existingMediaAssetExportIds, 'existingMediaAssetExportIds'),
    }
  }
  if (expectedProduct === 'narrative-simulation') {
    exactKeys(source, ['kind', 'issueStoryArcExportIds', 'factionExportIds'], 'narrative-simulation productSource')
    return {
      kind: 'narrative-simulation',
      issueStoryArcExportIds: portableIdArray(source.issueStoryArcExportIds, 'issueStoryArcExportIds'),
      factionExportIds: portableIdArray(source.factionExportIds, 'factionExportIds'),
    }
  }
  if (expectedProduct === 'ttrpg') {
    exactKeys(source, ['kind', 'participantCharacterExportIds', 'locationExportIds', 'questStoryArcExportIds'], 'ttrpg productSource')
    return {
      kind: 'ttrpg',
      participantCharacterExportIds: portableIdArray(source.participantCharacterExportIds, 'participantCharacterExportIds'),
      locationExportIds: portableIdArray(source.locationExportIds, 'locationExportIds'),
      questStoryArcExportIds: portableIdArray(source.questStoryArcExportIds, 'questStoryArcExportIds'),
    }
  }
  exactKeys(source, ['kind', 'regionLocationExportIds', 'factionExportIds', 'questStoryArcExportIds'], 'text-open-world productSource')
  return {
    kind: 'text-open-world',
    regionLocationExportIds: portableIdArray(source.regionLocationExportIds, 'regionLocationExportIds'),
    factionExportIds: portableIdArray(source.factionExportIds, 'factionExportIds'),
    questStoryArcExportIds: portableIdArray(source.questStoryArcExportIds, 'questStoryArcExportIds'),
  }
}

function requireSubset(values: number[], allowedValues: number[], label: string): void {
  const allowed = new Set(allowedValues)
  const outsideSelection = values.filter(value => !allowed.has(value))
  if (outsideSelection.length) fail(`${label} 超出通用来源选择:${outsideSelection.join(',')}`)
}

function validateProductSourceClosure(
  source: ProductSpecificWorldSourceV1 | null,
  selection: Omit<WorldGameSourceSelectionV2, 'productSource'>,
): void {
  if (!source) return
  if (source.kind === 'storygame') {
    requireSubset(source.narrativeModuleExportIds, selection.narrativeModuleExportIds, 'narrativeModuleExportIds')
  } else if (source.kind === 'character-interaction') {
    requireSubset(source.participantCharacterExportIds, selection.characterExportIds, 'participantCharacterExportIds')
  } else if (source.kind === 'text-adventure') {
    requireSubset(source.locationExportIds, selection.importantLocationExportIds, 'locationExportIds')
    requireSubset(source.itemExportIds, selection.artifactExportIds, 'itemExportIds')
    requireSubset(source.questStoryArcExportIds, selection.storyArcExportIds, 'questStoryArcExportIds')
  } else if (source.kind === 'avg') {
    requireSubset(source.existingMediaAssetExportIds, selection.avgMediaAssetExportIds, 'existingMediaAssetExportIds')
  } else if (source.kind === 'narrative-simulation') {
    requireSubset(source.issueStoryArcExportIds, selection.storyArcExportIds, 'issueStoryArcExportIds')
    requireSubset(source.factionExportIds, selection.codexEntryExportIds, 'factionExportIds')
  } else if (source.kind === 'text-open-world') {
    requireSubset(source.regionLocationExportIds, selection.importantLocationExportIds, 'regionLocationExportIds')
    requireSubset(source.factionExportIds, selection.codexEntryExportIds, 'factionExportIds')
    requireSubset(source.questStoryArcExportIds, selection.storyArcExportIds, 'questStoryArcExportIds')
  } else {
    requireSubset(source.participantCharacterExportIds, selection.characterExportIds, 'participantCharacterExportIds')
    requireSubset(source.locationExportIds, selection.importantLocationExportIds, 'locationExportIds')
    requireSubset(source.questStoryArcExportIds, selection.storyArcExportIds, 'questStoryArcExportIds')
  }
}

function validateTtrpg(value: unknown, sourceWorldHash: string): NonNullable<GameRuntimePackageV2['ttrpg']> {
  const ttrpg = record(value, 'ttrpg')
  exactKeys(ttrpg, ['rulePack', 'campaign', 'compatibility'], 'ttrpg')
  const rulePack = record(ttrpg.rulePack, 'ttrpg.rulePack')
  exactKeys(rulePack, ['content', 'contentHash'], 'ttrpg.rulePack')
  if (!isSha256Hash(rulePack.contentHash)) fail('ttrpg.rulePack.contentHash 无效')
  const ruleContent = parseRulePackV1(rulePack.content)
  const campaign = parseTtrpgCampaignContentV1(ttrpg.campaign, ruleContent)
  if (campaign.sourceWorld.contentHash !== sourceWorldHash || !isSha256Hash(campaign.sourceWorld.bundleHash)) {
    fail('ttrpg campaign 来源与 RuntimePackage 不一致')
  }
  const compatibility = record(ttrpg.compatibility, 'ttrpg.compatibility')
  exactKeys(compatibility, ['runtimeProtocol', 'minimumPlayerVersion'], 'ttrpg.compatibility')
  if (compatibility.runtimeProtocol !== 1 || compatibility.minimumPlayerVersion !== 1) {
    fail('ttrpg runtime compatibility 无效')
  }
  return {
    rulePack: { content: ruleContent, contentHash: rulePack.contentHash },
    campaign,
    compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
  }
}

export function parseWorldGameSourceSelectionV2(value: unknown): WorldGameSourceSelectionV2 {
  const selection = record(value, 'sourceWorld.selection')
  exactKeys(selection, [
    'schema', 'version', 'productType', 'worldContentHash', 'narrativeModuleExportIds',
    'characterExportIds', 'characterRelationExportIds', 'importantLocationExportIds',
    'artifactExportIds', 'codexEntryExportIds', 'storyArcExportIds', 'avgMediaAssetExportIds',
    'productSource',
  ], 'sourceWorld.selection')
  if (selection.schema !== 'storyforge.world-game-source' || selection.version !== 2) fail('source selection 版本无效')
  const selectedProduct = productType(selection.productType)
  if (!isSha256Hash(selection.worldContentHash)) fail('selection.worldContentHash 无效')
  const parsed: WorldGameSourceSelectionV2 = {
    schema: 'storyforge.world-game-source',
    version: 2,
    productType: selectedProduct,
    worldContentHash: selection.worldContentHash,
    narrativeModuleExportIds: portableIdArray(selection.narrativeModuleExportIds, 'narrativeModuleExportIds'),
    characterExportIds: portableIdArray(selection.characterExportIds, 'characterExportIds'),
    characterRelationExportIds: portableIdArray(selection.characterRelationExportIds, 'characterRelationExportIds'),
    importantLocationExportIds: portableIdArray(selection.importantLocationExportIds, 'importantLocationExportIds'),
    artifactExportIds: portableIdArray(selection.artifactExportIds, 'artifactExportIds'),
    codexEntryExportIds: portableIdArray(selection.codexEntryExportIds, 'codexEntryExportIds'),
    storyArcExportIds: portableIdArray(selection.storyArcExportIds, 'storyArcExportIds'),
    avgMediaAssetExportIds: portableIdArray(selection.avgMediaAssetExportIds, 'avgMediaAssetExportIds'),
    productSource: parseProductSource(selection.productSource, selectedProduct),
  }
  validateProductSourceClosure(parsed.productSource, parsed)
  return parsed
}

function validateInteraction(value: unknown): GameRuntimePackageV2['interaction'] {
  const interaction = record(value, 'interaction') as unknown as NonNullable<GameRuntimePackageV2['interaction']>
  if (interaction.playerKey !== 'player' || !Array.isArray(interaction.profiles) || !Array.isArray(interaction.sceneTemplates)) {
    fail('interaction 内容无效')
  }
  const participantKeys = interaction.profiles.map(item => requiredText(item?.participantKey, 'participantKey', 500))
  if (!participantKeys.length || new Set(participantKeys).size !== participantKeys.length || !interaction.sceneTemplates.length) {
    fail('interaction 至少需要唯一角色和场景')
  }
  const participants = new Set(participantKeys)
  for (const scene of interaction.sceneTemplates) {
    requiredText(scene.sceneKey, 'sceneKey', 500)
    if (!Array.isArray(scene.participantKeys) || scene.participantKeys.some(key => !participants.has(key))) {
      fail(`interaction 场景参与者无效:${scene.sceneKey}`)
    }
  }
  return structuredClone(interaction)
}

export function parseGameRuntimePackageV2(value: string | unknown): GameRuntimePackageV2 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const pkg = record(raw, 'package')
  const selectedProduct = productType(pkg.productType)
  const hasTtrpgPresentation = selectedProduct === 'ttrpg'
    && Object.prototype.hasOwnProperty.call(pkg, 'presentation')
  exactKeys(pkg, [
    'schema', 'version', 'productType', 'definition', 'sourceWorld', 'narrative',
    ...PRODUCT_MODULE_KEYS[selectedProduct],
    ...(hasTtrpgPresentation ? ['presentation'] : []),
  ], 'package')
  if (pkg.schema !== 'storyforge.game-runtime-package' || pkg.version !== 2) fail('schema/version 无效')

  const definition = record(pkg.definition, 'definition')
  exactKeys(definition, [
    'gameKey', 'title', 'description', 'enabledCapabilities', 'rulesetVersion', 'initialVariables',
  ], 'definition')
  const enabledCapabilities = stringArray(definition.enabledCapabilities, 'enabledCapabilities', 20)
  const expectedCapabilities = hasTtrpgPresentation
    ? [...CAPABILITIES[selectedProduct], 'presentation'] : CAPABILITIES[selectedProduct]
  if (enabledCapabilities.join(',') !== expectedCapabilities.join(',')) fail('enabledCapabilities 与 productType 不一致')
  const initialVariables = record(definition.initialVariables, 'initialVariables')
  canonicalGameProductionJsonV2(initialVariables)

  const sourceWorld = record(pkg.sourceWorld, 'sourceWorld')
  exactKeys(sourceWorld, ['contentHash', 'selection'], 'sourceWorld')
  if (!isSha256Hash(sourceWorld.contentHash)) fail('sourceWorld.contentHash 无效')
  const selection = parseWorldGameSourceSelectionV2(sourceWorld.selection)
  if (selection.productType !== selectedProduct || selection.worldContentHash !== sourceWorld.contentHash) {
    fail('source selection 与 package 来源不一致')
  }

  const narrative = parseFrozenNarrative(pkg.narrative)
  const knownSpeakerKeys = new Set(selection.characterExportIds.map(id => `character:${id}`))
  const graph = validateNarrativeContentGraph({
    entryNodeKey: narrative.entryNodeKey,
    nodes: narrative.nodes,
    beats: narrative.beats,
    choices: narrative.choices,
    knownSpeakerKeys,
  })
  if (!graph.valid) fail(`narrative 图无效:${graph.errors.join('；')}`)

  const parsed: GameRuntimePackageV2 = {
    schema: 'storyforge.game-runtime-package',
    version: 2,
    productType: selectedProduct,
    definition: {
      gameKey: requiredText(definition.gameKey, 'gameKey', 500),
      title: requiredText(definition.title, 'title', 2_000),
      description: optionalText(definition.description, 'description'),
      enabledCapabilities,
      rulesetVersion: integer(definition.rulesetVersion, 'rulesetVersion', 1),
      initialVariables: structuredClone(initialVariables),
    },
    sourceWorld: { contentHash: sourceWorld.contentHash, selection },
    narrative: structuredClone(narrative),
  }

  if (selectedProduct === 'character-interaction' || selectedProduct === 'text-adventure'
    || selectedProduct === 'text-open-world') parsed.interaction = validateInteraction(pkg.interaction)
  if (selectedProduct === 'text-adventure' || selectedProduct === 'text-open-world') {
    parsed.adventure = parseAdventureContent(pkg.adventure as never)
  }
  if (selectedProduct === 'avg' || hasTtrpgPresentation) {
    const presentation = record(pkg.presentation, 'presentation')
    if (!Array.isArray(presentation.assets)) fail('presentation.assets 无效')
    const content = parseAvgPresentationContent(presentation)
    const assets = presentation.assets.map((asset, index) => {
      const row = record(asset, `presentation.assets[${index}]`)
      if (!isSha256Hash(row.blobContentHash)) fail(`presentation.assets[${index}].blobContentHash 无效`)
      const frozen = freezeAvgMediaAsset(row as unknown as AvgMediaAsset)
      if (frozen.contentHash !== row.blobContentHash) fail(`presentation.assets[${index}] bytes hash 不一致`)
      return { ...frozen, blobContentHash: row.blobContentHash }
    })
    if (new Set(assets.map(asset => asset.assetKey)).size !== assets.length) fail('presentation assetKey 重复')
    const report = validateAvgPresentation({ content, beats: narrative.beats, assets })
    if (!report.valid) fail(`presentation 无效:${report.errors.join('；')}`)
    parsed.presentation = { ...content, assets }
  }
  if (selectedProduct === 'narrative-simulation' || selectedProduct === 'text-open-world') {
    const simulation = parseNarrativeSimulationContent(pkg.simulation)
    const report = validateNarrativeSimulationContent({
      content: simulation,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`simulation 无效:${report.errors.join('；')}`)
    parsed.simulation = simulation
  }
  if (selectedProduct === 'text-open-world') {
    const openWorld = parseOpenWorldContent(pkg.openWorld)
    const report = validateOpenWorldContent({
      content: openWorld,
      adventure: parsed.adventure!,
      interactionProfiles: parsed.interaction!.profiles,
      interactionScenes: parsed.interaction!.sceneTemplates,
      simulation: parsed.simulation!,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`openWorld 无效:${report.errors.join('；')}`)
    parsed.openWorld = openWorld
  }
  if (selectedProduct === 'ttrpg') parsed.ttrpg = validateTtrpg(pkg.ttrpg, sourceWorld.contentHash)
  return parsed
}

export function parseGameReleaseManifestV2(value: string | unknown): GameReleaseManifestV2 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('Release v2 不是合法 JSON') }
  }
  const manifest = record(raw, 'release')
  exactKeys(manifest, [
    'schema', 'version', 'productType', 'sourceWorldRelease', 'runtimePackage', 'packageHash', 'productionProvenance',
  ], 'release')
  if (manifest.schema !== 'storyforge.game-release' || manifest.version !== 2) fail('Release v2 schema/version 无效')
  const selectedProduct = productType(manifest.productType)
  const sourceWorldRelease = record(manifest.sourceWorldRelease, 'sourceWorldRelease')
  exactKeys(sourceWorldRelease, ['contentHash'], 'sourceWorldRelease')
  if (!isSha256Hash(sourceWorldRelease.contentHash)) fail('sourceWorldRelease.contentHash 无效')
  const runtimePackage = parseGameRuntimePackageV2(manifest.runtimePackage)
  if (runtimePackage.productType !== selectedProduct
    || runtimePackage.sourceWorld.contentHash !== sourceWorldRelease.contentHash) fail('Release v2 与 RuntimePackage 来源不一致')
  if (!isSha256Hash(manifest.packageHash)) fail('packageHash 无效')

  let productionProvenance: GameReleaseManifestV2['productionProvenance'] = null
  if (manifest.productionProvenance != null) {
    const provenance = record(manifest.productionProvenance, 'productionProvenance')
    exactKeys(provenance, [
      'productionKey', 'buildNumber', 'buildManifestHash', 'rootTerminalReceiptHash',
    ], 'productionProvenance')
    if (!isSha256Hash(provenance.buildManifestHash) || !isSha256Hash(provenance.rootTerminalReceiptHash)) {
      fail('productionProvenance hash 无效')
    }
    productionProvenance = {
      productionKey: requiredText(provenance.productionKey, 'productionKey', 500),
      buildNumber: integer(provenance.buildNumber, 'buildNumber', 1),
      buildManifestHash: provenance.buildManifestHash,
      rootTerminalReceiptHash: provenance.rootTerminalReceiptHash,
    }
  }
  return {
    schema: 'storyforge.game-release',
    version: 2,
    productType: selectedProduct,
    sourceWorldRelease: { contentHash: sourceWorldRelease.contentHash },
    runtimePackage,
    packageHash: manifest.packageHash,
    productionProvenance,
  }
}

export async function verifyGameReleaseManifestV2(value: string | unknown): Promise<GameReleaseManifestV2> {
  const manifest = parseGameReleaseManifestV2(value)
  if (await hashGameProductionValueV2(manifest.runtimePackage) !== manifest.packageHash) fail('packageHash 校验失败')
  if (manifest.productType === 'ttrpg' && manifest.runtimePackage.ttrpg
    && await hashGameProductionValueV2(manifest.runtimePackage.ttrpg.rulePack.content)
      !== manifest.runtimePackage.ttrpg.rulePack.contentHash) fail('TTRPG RulePack contentHash 校验失败')
  return manifest
}

function v1Selection(selection: WorldGameSourceSelectionV1 | undefined, manifest: AnyGameReleaseManifestV1): WorldGameSourceSelectionV2 {
  const worldContentHash = manifest.worldRelease.contentHash
  const narrativeCharacterExportIds = manifest.narrative.beats.flatMap(beat => {
    const match = /^character:(\d+)$/.exec(beat.speakerKey ?? '')
    return match ? [Number(match[1])] : []
  })
  const characterExportIds = [...new Set([
    ...(selection?.characterExportIds ?? []),
    ...narrativeCharacterExportIds,
  ])].sort((left, right) => left - right)
  const narrativeModuleExportIds = selection
    ? [selection.narrativeModuleExportId]
    : [manifest.worldRelease.narrativeModuleExportId]
  let productSource: ProductSpecificWorldSourceV1
  if (manifest.productType === 'storygame') {
    productSource = { kind: 'storygame', narrativeModuleExportIds }
  } else if (manifest.productType === 'character-interaction') {
    productSource = {
      kind: 'character-interaction',
      participantCharacterExportIds: characterExportIds,
      sceneKeys: manifest.interaction.sceneTemplates.map(scene => scene.sceneKey),
    }
  } else if (manifest.productType === 'text-adventure') {
    productSource = {
      kind: 'text-adventure', locationExportIds: selection?.importantLocationExportIds ?? [],
      itemExportIds: selection?.artifactExportIds ?? [], questStoryArcExportIds: selection?.storyArcExportIds ?? [],
    }
  } else if (manifest.productType === 'avg') {
    productSource = {
      kind: 'avg', presentationStyle: '', existingMediaAssetExportIds: selection?.avgMediaAssetExportIds ?? [],
    }
  } else if (manifest.productType === 'narrative-simulation') {
    productSource = {
      kind: 'narrative-simulation', issueStoryArcExportIds: selection?.storyArcExportIds ?? [], factionExportIds: [],
    }
  } else if (manifest.productType === 'text-open-world') {
    productSource = {
      kind: 'text-open-world', regionLocationExportIds: selection?.importantLocationExportIds ?? [],
      factionExportIds: [], questStoryArcExportIds: selection?.storyArcExportIds ?? [],
    }
  } else {
    // v1 manifests predate the TTRPG product; this branch is unreachable for
    // valid historical manifests but keeps the discriminated union exhaustive.
    productSource = {
      kind: 'ttrpg', participantCharacterExportIds: characterExportIds,
      locationExportIds: selection?.importantLocationExportIds ?? [],
      questStoryArcExportIds: selection?.storyArcExportIds ?? [],
    }
  }
  return {
    schema: 'storyforge.world-game-source',
    version: 2,
    productType: manifest.productType,
    worldContentHash,
    narrativeModuleExportIds,
    characterExportIds,
    characterRelationExportIds: selection?.characterRelationExportIds ?? [],
    importantLocationExportIds: selection?.importantLocationExportIds ?? [],
    artifactExportIds: selection?.artifactExportIds ?? [],
    codexEntryExportIds: selection?.codexEntryExportIds ?? [],
    storyArcExportIds: selection?.storyArcExportIds ?? [],
    avgMediaAssetExportIds: selection?.avgMediaAssetExportIds ?? [],
    productSource,
  }
}

/** Convert a validated historical Release v1 into the common runtime package without mutating it. */
export function gameRuntimePackageFromReleaseV1(manifest: AnyGameReleaseManifestV1): GameRuntimePackageV2 {
  const selectionV1 = manifest.definition.source?.selection
  const runtimePackage: GameRuntimePackageV2 = {
    schema: 'storyforge.game-runtime-package',
    version: 2,
    productType: manifest.productType,
    definition: {
      gameKey: manifest.definition.gameKey,
      title: manifest.definition.title,
      description: manifest.definition.description,
      enabledCapabilities: structuredClone(manifest.definition.enabledCapabilities),
      rulesetVersion: manifest.definition.rulesetVersion,
      initialVariables: structuredClone(manifest.definition.initialVariables),
    },
    sourceWorld: {
      contentHash: manifest.worldRelease.contentHash,
      selection: v1Selection(selectionV1, manifest),
    },
    narrative: structuredClone(manifest.narrative),
  }
  if (manifest.productType === 'character-interaction' || manifest.productType === 'text-adventure'
    || manifest.productType === 'text-open-world') runtimePackage.interaction = structuredClone(manifest.interaction)
  if (manifest.productType === 'text-adventure' || manifest.productType === 'text-open-world') {
    runtimePackage.adventure = structuredClone(manifest.adventure)
  }
  if (manifest.productType === 'avg') {
    runtimePackage.presentation = {
      version: manifest.presentation.version,
      cues: structuredClone(manifest.presentation.cues),
      assets: manifest.presentation.assets.map(asset => ({ ...structuredClone(asset), blobContentHash: asset.contentHash })),
    }
  }
  if (manifest.productType === 'narrative-simulation' || manifest.productType === 'text-open-world') {
    runtimePackage.simulation = structuredClone(manifest.simulation)
  }
  if (manifest.productType === 'text-open-world') runtimePackage.openWorld = structuredClone(manifest.openWorld)
  return parseGameRuntimePackageV2(runtimePackage)
}

export async function createGameReleaseManifestV2(input: {
  runtimePackage: GameRuntimePackageV2
  productionProvenance: GameReleaseManifestV2['productionProvenance']
}): Promise<GameReleaseManifestV2> {
  const runtimePackage = parseGameRuntimePackageV2(input.runtimePackage)
  return parseGameReleaseManifestV2({
    schema: 'storyforge.game-release',
    version: 2,
    productType: runtimePackage.productType,
    sourceWorldRelease: { contentHash: runtimePackage.sourceWorld.contentHash },
    runtimePackage,
    packageHash: await hashGameProductionValueV2(runtimePackage),
    productionProvenance: input.productionProvenance,
  })
}
