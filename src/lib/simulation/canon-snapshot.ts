import { db } from '../db/schema'
import {
  aggregateInventory,
  EMPTY_SIMULATION_STATE,
  PLAYABLE_WORLD_COMPILER_VERSION,
  SIMULATION_CANON_SOURCE_KINDS,
  type Character,
  type PlayableWorldBundleV1,
  type PlayableWorldDiagnosticV1,
  type RuntimeEntityState,
  type SimulationCanonCandidate,
  type SimulationCanonSnapshotV1,
  type SimulationCanonSource,
  type SimulationRuntimeState,
  type WorkspaceScope,
  type WorldReleaseManifestV2,
} from '../types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScope } from '../world-engine/scope'

const KIND_ORDER = new Map(SIMULATION_CANON_SOURCE_KINDS.map((kind, index) => [kind, index]))

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compact(value: string | null | undefined, max = 240): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function fields(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (value == null) return []
    const text = typeof value === 'string' ? value.trim() : stableJson(value)
    return text ? [[key, text]] : []
  }))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function sourceHashInput(source: SimulationCanonCandidate | SimulationCanonSource) {
  return {
    sourceKey: source.sourceKey,
    kind: source.kind,
    recordId: source.recordId,
    name: source.name,
    summary: source.summary,
    fields: source.fields,
    updatedAt: source.updatedAt,
  }
}

function snapshotHashInput(snapshot: Omit<SimulationCanonSnapshotV1, 'snapshotHash'>) {
  return {
    schema: snapshot.schema,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    worldGroupId: snapshot.worldGroupId,
    worldLabel: snapshot.worldLabel,
    sources: snapshot.sources,
  }
}

function bundleHashInput(bundle: Omit<PlayableWorldBundleV1, 'bundleHash'>) {
  return {
    schema: bundle.schema,
    version: bundle.version,
    compilerVersion: bundle.compilerVersion,
    source: bundle.source,
    createdAt: bundle.createdAt,
    canonSnapshot: bundle.canonSnapshot,
    initialState: bundle.initialState,
    diagnostics: bundle.diagnostics,
  }
}

function visibleCharacter(character: Character, worldGroupId: number | null): boolean {
  return !!character.isCrossWorld
    || (character.homeWorldGroupId ?? null) === worldGroupId
}

function recordKey(prefix: string, row: { id?: number; ragDocumentId?: string }): string {
  const stableId = row.ragDocumentId?.trim() || row.id
  if (stableId == null) throw new Error(`${prefix} Canon 来源缺少稳定标识。`)
  return `${prefix}:${stableId}`
}

function sortCandidates(candidates: SimulationCanonCandidate[]): SimulationCanonCandidate[] {
  return candidates.sort((left, right) => (
    (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
    || left.sourceKey.localeCompare(right.sourceKey)
  ))
}

export async function loadSimulationCanonCandidates(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
}): Promise<{ worldLabel: string; candidates: SimulationCanonCandidate[] }> {
  const scope = input.scope
    ? await resolveScope({ projectId: input.projectId, scope: input.scope })
    : await resolveReadScopeLike(input.projectId)
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('Canon 冻结所属项目不存在。')
  const world = input.worldGroupId == null ? null : await db.worldGroups.get(input.worldGroupId)
  if (input.worldGroupId != null && !await assertRecordInScope(scope, 'worldGroups', world, { owner: 'world' })) {
    throw new Error('Canon 冻结所属世界不存在或不属于当前项目。')
  }
  const worldLabel = world?.name.trim() || project.name.trim() || '默认世界'
  const [worldviews, powerSystems, rules, characters, locations, itemEntries] = await Promise.all([
    readOwnedRows<any>(scope, 'worldviews', { owner: 'world' }),
    readOwnedRows<any>(scope, 'powerSystems', { owner: 'world' }),
    readOwnedRows<any>(scope, 'worldRulesProfiles', { owner: 'world' }),
    readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
    readOwnedRows<any>(scope, 'itemLedger', { owner: 'work' }),
  ])
  const candidates: SimulationCanonCandidate[] = []

  candidates.push({
    sourceKey: world ? `world-group:${world.id}` : `project-world:${project.id}`,
    kind: 'world',
    recordId: world?.id ?? project.id ?? null,
    name: worldLabel,
    summary: compact(world?.description || project.description || '当前项目默认世界'),
    fields: fields(world ? {
      type: world.type,
      entryCondition: world.entryCondition,
      exitCondition: world.exitCondition,
      powerRestriction: world.powerRestriction,
      takeawayRules: world.takeawayRules,
    } : {
      genre: project.genre,
      genres: project.genres,
    }),
    updatedAt: world?.updatedAt ?? project.updatedAt,
  })

  for (const worldview of worldviews) {
    if ((worldview.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: recordKey('worldview', worldview),
      kind: 'world',
      recordId: worldview.id ?? null,
      name: `${worldLabel}世界观`,
      summary: compact(worldview.summary || worldview.worldOrigin || worldview.worldStructure),
      fields: fields({
        summary: worldview.summary,
        worldOrigin: worldview.worldOrigin,
        worldStructure: worldview.worldStructure,
        geography: worldview.geography,
        history: worldview.historyLine || worldview.history,
        society: worldview.society,
        culture: worldview.cultureOverview || worldview.culture,
        rules: worldview.rules,
        factionLayout: worldview.factionLayout,
        itemDesign: worldview.itemDesign,
      }),
      updatedAt: worldview.updatedAt,
    })
  }

  for (const rule of rules) {
    if ((rule.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: `world-rules:${rule.id}`,
      kind: 'rule',
      recordId: rule.id ?? null,
      name: `${worldLabel}世界规则`,
      summary: compact(rule.globalNote || '真实与幻想规则配置'),
      fields: fields({ entries: rule.entries, customNodes: rule.customNodes, globalNote: rule.globalNote }),
      updatedAt: rule.updatedAt,
    })
  }

  for (const power of powerSystems) {
    if ((power.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: `power-system:${power.id}`,
      kind: 'rule',
      recordId: power.id ?? null,
      name: power.name.trim() || '未命名力量体系',
      summary: compact(power.description || power.rules),
      fields: fields({ description: power.description, levels: power.levels, rules: power.rules }),
      updatedAt: power.updatedAt,
    })
  }

  const visibleCharacters = characters.filter(character => visibleCharacter(character, input.worldGroupId))
  for (const character of visibleCharacters) {
    if (!character.name.trim()) continue
    candidates.push({
      sourceKey: recordKey('character', character),
      kind: 'character',
      recordId: character.id ?? null,
      name: character.name.trim(),
      summary: compact(character.shortDescription || character.identity || character.personality),
      fields: fields({
        roleWeight: character.roleWeight,
        identity: character.identity,
        appearance: character.appearance,
        personality: character.personality,
        background: character.background,
        motivation: character.goals || character.motivation,
        abilities: character.abilities,
        powerLevel: character.powerLevel,
        relationships: character.relationships,
        arc: character.arc,
        location: character.location,
      }),
      updatedAt: character.updatedAt,
    })
  }

  for (const location of locations) {
    if (!location.name.trim()) continue
    candidates.push({
      sourceKey: recordKey('location', location),
      kind: 'location',
      recordId: location.id ?? null,
      name: location.name.trim(),
      summary: compact(location.description || location.significance),
      fields: fields({
        tags: location.tags,
        description: location.description,
        significance: location.significance,
        parentId: location.parentId,
      }),
      updatedAt: location.updatedAt,
    })
  }

  const visibleCharacterIds = new Set(visibleCharacters.flatMap(character => (
    character.id == null ? [] : [character.id]
  )))
  const visibleCharacterNames = new Set(visibleCharacters.map(character => character.name.trim()))
  const knownCharacterNames = new Set(characters.map(character => character.name.trim()))
  for (const item of aggregateInventory(itemEntries)) {
    if (item.quantity <= 0 || !item.itemName.trim()) continue
    if (item.characterId != null && !visibleCharacterIds.has(item.characterId)) continue
    if (
      item.characterId == null
      && knownCharacterNames.has(item.heldByName.trim())
      && !visibleCharacterNames.has(item.heldByName.trim())
    ) continue
    const latest = item.entries[item.entries.length - 1]
    if (latest?.id == null) continue
    candidates.push({
      sourceKey: `item:${latest.id}`,
      kind: 'item',
      recordId: latest.id,
      name: item.itemName.trim(),
      summary: `${item.heldByName || '未指定持有人'}持有 ${item.quantity}`,
      fields: fields({
        quantity: item.quantity,
        heldByName: item.heldByName,
        characterId: item.characterId,
        latestChapter: latest.chapterTitle,
        latestNote: latest.note,
      }),
      updatedAt: latest.createdAt,
    })
  }

  return { worldLabel, candidates: sortCandidates(candidates) }
}

function runtimeEntity(
  source: SimulationCanonSource,
  selectedLocations: Map<string, SimulationCanonSource>,
): RuntimeEntityState | null {
  if (source.kind !== 'character' && source.kind !== 'location' && source.kind !== 'item') return null
  const matchedLocation = source.kind === 'character'
    ? selectedLocations.get(source.fields.location?.trim().toLocaleLowerCase() ?? '')
    : null
  const attributes = Object.fromEntries(Object.entries(source.fields).map(([key, value]) => {
    if (source.kind === 'item' && key === 'quantity') return [key, Number(value)]
    return [key, value]
  }))
  return {
    entityKey: source.sourceKey,
    kind: source.kind,
    sourceId: source.recordId,
    name: source.name,
    locationKey: source.kind === 'location' ? source.sourceKey : matchedLocation?.sourceKey ?? null,
    lifecycleStatus: 'active',
    attributes,
  }
}

function releaseRows(
  manifest: WorldReleaseManifestV2,
  table: string,
): Array<Record<string, unknown>> {
  const value = manifest.records[table] ?? []
  if (!Array.isArray(value)) throw new Error(`[playable-world] ${table} 不是冻结记录数组。`)
  return value.map((row, index) => {
    if (!isObject(row)) throw new Error(`[playable-world] ${table}[${index}] 不是有效记录。`)
    return row
  })
}

function portableId(row: Record<string, unknown>, index: number, table: string): number {
  const value = row._exportId ?? index
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`[playable-world] ${table}[${index}] 缺少有效便携标识。`)
  }
  return Number(value)
}

function releaseUpdatedAt(row: Record<string, unknown>, createdAt: number): number {
  if (Number.isFinite(row.updatedAt)) return Number(row.updatedAt)
  if (Number.isFinite(row.createdAt)) return Number(row.createdAt)
  return createdAt
}

function releaseText(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function diagnosticOrder(diagnostic: PlayableWorldDiagnosticV1): string {
  const severity = diagnostic.severity === 'error' ? '0' : diagnostic.severity === 'warning' ? '1' : '2'
  return `${severity}:${diagnostic.code}:${diagnostic.sourceKeys.join(',')}:${diagnostic.message}`
}

function releaseRuntimeEntities(
  sources: SimulationCanonSource[],
  diagnostics: PlayableWorldDiagnosticV1[],
): Record<string, RuntimeEntityState> {
  const locations = new Map<string, SimulationCanonSource[]>()
  for (const source of sources) {
    if (source.kind !== 'location') continue
    const key = source.name.trim().toLocaleLowerCase()
    if (!key) continue
    locations.set(key, [...(locations.get(key) ?? []), source])
  }

  const entities: Record<string, RuntimeEntityState> = {}
  for (const source of sources) {
    if (
      source.kind !== 'character'
      && source.kind !== 'location'
      && source.kind !== 'item'
      && source.kind !== 'faction'
    ) continue
    let locationKey: string | null = source.kind === 'location' ? source.sourceKey : null
    if (source.kind === 'character' && source.fields.location?.trim()) {
      const matches = locations.get(source.fields.location.trim().toLocaleLowerCase()) ?? []
      if (matches.length === 1) {
        locationKey = matches[0].sourceKey
      } else if (matches.length === 0) {
        diagnostics.push({
          code: 'CHARACTER_LOCATION_UNRESOLVED',
          severity: 'warning',
          message: `角色「${source.name}」的地点「${source.fields.location}」未匹配到冻结地点。`,
          sourceKeys: [source.sourceKey],
        })
      } else {
        diagnostics.push({
          code: 'CHARACTER_LOCATION_AMBIGUOUS',
          severity: 'error',
          message: `角色「${source.name}」的地点「${source.fields.location}」匹配到多个同名冻结地点。`,
          sourceKeys: [source.sourceKey, ...matches.map(item => item.sourceKey)],
        })
      }
    }
    entities[source.sourceKey] = {
      entityKey: source.sourceKey,
      kind: source.kind,
      sourceId: null,
      name: source.name,
      locationKey,
      lifecycleStatus: 'active',
      attributes: structuredClone(source.fields),
    }
  }
  return entities
}

export async function buildSimulationCanonSnapshot(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  sourceKeys: readonly string[]
}): Promise<{ snapshot: SimulationCanonSnapshotV1; initialState: SimulationRuntimeState }> {
  const requested = new Set(input.sourceKeys.map(key => key.trim()).filter(Boolean))
  if (requested.size === 0) throw new Error('请至少选择一个 Canon 来源。')
  const catalog = await loadSimulationCanonCandidates(input)
  const selected = catalog.candidates.filter(candidate => requested.has(candidate.sourceKey))
  const missing = [...requested].filter(key => !selected.some(candidate => candidate.sourceKey === key))
  if (missing.length > 0) throw new Error(`Canon 来源不存在或不属于当前世界: ${missing.join(', ')}`)

  const sources: SimulationCanonSource[] = []
  for (const candidate of selected) {
    sources.push({
      ...candidate,
      fields: structuredClone(candidate.fields),
      contentHash: await sha256(sourceHashInput(candidate)),
    })
  }
  const snapshotBase: Omit<SimulationCanonSnapshotV1, 'snapshotHash'> = {
    schema: 'storyforge.simulation-canon',
    version: 1,
    createdAt: Date.now(),
    worldGroupId: input.worldGroupId,
    worldLabel: catalog.worldLabel,
    sources,
  }
  const snapshot: SimulationCanonSnapshotV1 = {
    ...snapshotBase,
    snapshotHash: await sha256(snapshotHashInput(snapshotBase)),
  }
  const selectedLocations = new Map(sources
    .filter(source => source.kind === 'location')
    .map(source => [source.name.toLocaleLowerCase(), source]))
  const entities = Object.fromEntries(sources.flatMap(source => {
    const entity = runtimeEntity(source, selectedLocations)
    return entity ? [[entity.entityKey, entity]] : []
  }))
  return {
    snapshot,
    initialState: { ...structuredClone(EMPTY_SIMULATION_STATE), entities },
  }
}

/**
 * Deterministically compile immutable WORLD-2E portable records into runtime-ready Canon.
 * This layer preserves world semantics only; ruleset-specific statistics belong to RulePack.
 */
export async function buildPlayableWorldBundleFromRelease(input: {
  manifest: WorldReleaseManifestV2
  worldContentHash: string
  createdAt: number
}): Promise<PlayableWorldBundleV1> {
  const { manifest, createdAt, worldContentHash } = input
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2 || !isObject(manifest.records)) {
    throw new Error('[playable-world] 只能编译 WorldReleaseManifestV2。')
  }
  if (!manifest.worldCode?.trim() || !manifest.worldName?.trim()) {
    throw new Error('[playable-world] 发布包缺少世界身份。')
  }
  if (!Number.isFinite(createdAt)) throw new Error('[playable-world] 发布包创建时间无效。')
  if (!/^[0-9a-f]{64}$/.test(worldContentHash)) {
    throw new Error('[playable-world] WorldRelease content hash 无效。')
  }

  const diagnostics: PlayableWorldDiagnosticV1[] = []
  const candidates: SimulationCanonCandidate[] = []
  const sourceKeys = new Set<string>()
  const addCandidate = (candidate: SimulationCanonCandidate) => {
    if (sourceKeys.has(candidate.sourceKey)) {
      diagnostics.push({
        code: 'DUPLICATE_SOURCE_KEY',
        severity: 'error',
        message: `冻结记录生成了重复来源 ${candidate.sourceKey}。`,
        sourceKeys: [candidate.sourceKey],
      })
      return
    }
    sourceKeys.add(candidate.sourceKey)
    candidates.push(candidate)
  }

  addCandidate({
    sourceKey: `release-world:${manifest.worldCode.trim()}`,
    kind: 'world',
    recordId: null,
    name: manifest.worldName.trim(),
    summary: compact(releaseText(manifest.portableProject, 'description') || '不可变世界发布包'),
    fields: fields({
      worldCode: manifest.worldCode.trim(),
      workTitle: manifest.workTitle,
      selectedTables: manifest.selectedTables,
      worldContentHash,
    }),
    updatedAt: createdAt,
  })

  for (const dependency of manifest.dependencies) {
    addCandidate({
      sourceKey: `release-table:${dependency.table}`,
      kind: 'world',
      recordId: null,
      name: dependency.table,
      summary: `${dependency.rowCount} 条冻结记录`,
      fields: {
        table: dependency.table,
        rowCount: String(dependency.rowCount),
        tableHash: dependency.contentHash,
      },
      updatedAt: createdAt,
    })
  }

  const worldviews = releaseRows(manifest, 'worldviews')
  for (const [index, row] of worldviews.entries()) {
    const id = portableId(row, index, 'worldviews')
    addCandidate({
      sourceKey: `release-worldview:${id}`,
      kind: 'world',
      recordId: null,
      name: worldviews.length === 1 ? `${manifest.worldName}世界观` : `${manifest.worldName}世界观 ${id + 1}`,
      summary: compact(releaseText(row, 'summary', 'worldOrigin', 'worldStructure')),
      fields: fields({
        summary: row.summary,
        worldOrigin: row.worldOrigin,
        worldStructure: row.worldStructure,
        worldDimensions: row.worldDimensions,
        continentLayout: row.continentLayout,
        geography: row.geography,
        mountainsRivers: row.mountainsRivers,
        climateByRegion: row.climateByRegion,
        history: row.historyLine ?? row.history,
        worldEvents: row.worldEvents,
        society: row.society,
        races: row.races,
        culture: row.cultureOverview ?? row.culture,
        politics: row.politicsOverview,
        economy: row.economyOverview ?? row.economy,
        rules: row.rules,
        factionLayout: row.factionLayout,
        internalConflicts: row.internalConflicts,
        itemDesign: row.itemDesign,
        powerHierarchy: row.powerHierarchy,
        divineDesign: row.divineDesign,
      }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  for (const [index, row] of releaseRows(manifest, 'worldRulesProfiles').entries()) {
    const id = portableId(row, index, 'worldRulesProfiles')
    addCandidate({
      sourceKey: `release-world-rules:${id}`,
      kind: 'rule',
      recordId: null,
      name: `${manifest.worldName}世界规则`,
      summary: compact(releaseText(row, 'globalNote') || '真实与幻想规则配置'),
      fields: fields({ entries: row.entries, customNodes: row.customNodes, globalNote: row.globalNote }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  for (const [index, row] of releaseRows(manifest, 'powerSystems').entries()) {
    const id = portableId(row, index, 'powerSystems')
    const name = releaseText(row, 'name') || `未命名力量体系 ${id + 1}`
    addCandidate({
      sourceKey: `release-power-system:${id}`,
      kind: 'rule',
      recordId: null,
      name,
      summary: compact(releaseText(row, 'description', 'rules')),
      fields: fields({ description: row.description, levels: row.levels, rules: row.rules }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  const characterRows = releaseRows(manifest, 'characters')
  const characterKeysByIndex = new Map<number, string>()
  const characterRelations = new Map<number, Array<Record<string, unknown>>>()
  for (const [index, row] of characterRows.entries()) {
    const id = portableId(row, index, 'characters')
    characterKeysByIndex.set(index, `release-character:${id}`)
    characterRelations.set(index, [])
  }
  for (const [index, row] of releaseRows(manifest, 'characterRelations').entries()) {
    const sourceKey = `release-character-relation:${portableId(row, index, 'characterRelations')}`
    const fromIndex = Number(row._fromCharacterIndex)
    const toIndex = Number(row._toCharacterIndex)
    const fromKey = Number.isInteger(fromIndex) ? characterKeysByIndex.get(fromIndex) : undefined
    const toKey = Number.isInteger(toIndex) ? characterKeysByIndex.get(toIndex) : undefined
    if (!fromKey || !toKey) {
      diagnostics.push({
        code: 'CHARACTER_RELATION_UNRESOLVED',
        severity: 'error',
        message: `角色关系 ${sourceKey} 包含悬空便携角色引用。`,
        sourceKeys: [sourceKey, ...[fromKey, toKey].filter((key): key is string => !!key)],
      })
      continue
    }
    characterRelations.get(fromIndex)!.push({
      sourceKey,
      otherCharacterKey: toKey,
      direction: row.isBidirectional === true ? 'bidirectional' : 'outgoing',
      relationType: releaseText(row, 'relationType', 'relation') || 'other',
      label: releaseText(row, 'label'),
      description: releaseText(row, 'description'),
    })
    if (row.isBidirectional === true) {
      characterRelations.get(toIndex)!.push({
        sourceKey,
        otherCharacterKey: fromKey,
        direction: 'bidirectional',
        relationType: releaseText(row, 'relationType', 'relation') || 'other',
        label: releaseText(row, 'label'),
        description: releaseText(row, 'description'),
      })
    }
  }

  for (const [index, row] of characterRows.entries()) {
    const sourceKey = characterKeysByIndex.get(index)!
    const name = releaseText(row, 'name')
    if (!name) {
      diagnostics.push({
        code: 'CHARACTER_NAME_MISSING',
        severity: 'warning',
        message: `${sourceKey} 缺少角色名称，已从可运行实体中排除。`,
        sourceKeys: [sourceKey],
      })
      continue
    }
    addCandidate({
      sourceKey,
      kind: 'character',
      recordId: null,
      name,
      summary: compact(releaseText(row, 'shortDescription', 'identity', 'personality')),
      fields: fields({
        role: row.role,
        roleWeight: row.roleWeight,
        moralAxis: row.moralAxis,
        orderAxis: row.orderAxis,
        identity: row.identity,
        profile: row.profile,
        appearance: row.appearance,
        personality: row.personality,
        background: row.background,
        motivation: row.goals ?? row.motivation,
        abilities: row.abilities,
        powerLevel: row.powerLevel,
        relationships: row.relationships,
        relationRefs: characterRelations.get(index),
        arc: row.arc,
        location: row.location,
        speechStyle: row.speechStyle,
        signatureItem: row.signatureItem,
      }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  for (const [index, row] of releaseRows(manifest, 'importantLocations').entries()) {
    const id = portableId(row, index, 'importantLocations')
    const sourceKey = `release-location:${id}`
    const name = releaseText(row, 'name')
    if (!name) {
      diagnostics.push({
        code: 'LOCATION_NAME_MISSING',
        severity: 'warning',
        message: `${sourceKey} 缺少地点名称，已从可运行实体中排除。`,
        sourceKeys: [sourceKey],
      })
      continue
    }
    addCandidate({
      sourceKey,
      kind: 'location',
      recordId: null,
      name,
      summary: compact(releaseText(row, 'description', 'significance')),
      fields: fields({
        tags: row.tags,
        description: row.description,
        significance: row.significance,
        parentExportId: row._parentExportId,
        sortOrder: row.sortOrder,
      }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  const categoryKinds = new Map<number, 'item' | 'faction'>()
  for (const [index, row] of releaseRows(manifest, 'codexCategories').entries()) {
    const id = portableId(row, index, 'codexCategories')
    if (row.builtInKey === 'artifact') categoryKinds.set(id, 'item')
    if (row.builtInKey === 'faction') categoryKinds.set(id, 'faction')
  }
  for (const [index, row] of releaseRows(manifest, 'codexEntries').entries()) {
    const kind = Number.isInteger(row._categoryExportId)
      ? categoryKinds.get(Number(row._categoryExportId))
      : undefined
    if (!kind) continue
    const id = portableId(row, index, 'codexEntries')
    const sourceKey = kind === 'item' ? `release-item:${id}` : `release-faction:${id}`
    const name = releaseText(row, 'name')
    if (!name) {
      diagnostics.push({
        code: kind === 'item' ? 'ITEM_NAME_MISSING' : 'FACTION_NAME_MISSING',
        severity: 'warning',
        message: `${sourceKey} 缺少名称，已从可运行实体中排除。`,
        sourceKeys: [sourceKey],
      })
      continue
    }
    addCandidate({
      sourceKey,
      kind,
      recordId: null,
      name,
      summary: compact(releaseText(row, 'summary', 'description')),
      fields: fields({
        summary: row.summary,
        description: row.description,
        fields: row.fields,
        refs: row.refs,
        tags: row.tags,
        importance: row.importance,
      }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  const narrativeRowsById = new Map(releaseRows(manifest, 'narrativeModules').map((row, index) => (
    [portableId(row, index, 'narrativeModules'), row]
  )))
  for (const selected of manifest.selectedNarrativeModules) {
    const row = narrativeRowsById.get(selected.exportId)
    if (!row) {
      diagnostics.push({
        code: 'NARRATIVE_MODULE_UNRESOLVED',
        severity: 'error',
        message: `发布选择的叙事模块 ${selected.exportId} 缺少冻结记录。`,
        sourceKeys: [`release-narrative:${selected.exportId}`],
      })
      continue
    }
    const nodes = releaseRows(manifest, 'narrativeNodes').filter(node => node._moduleExportId === selected.exportId)
    addCandidate({
      sourceKey: `release-narrative:${selected.exportId}`,
      kind: 'world',
      recordId: null,
      name: selected.title,
      summary: compact(releaseText(row, 'description', 'summary') || `${nodes.length} 个冻结叙事节点`),
      fields: fields({
        moduleKind: selected.kind,
        entryNodeKey: row.entryNodeKey,
        nodeKeys: nodes.map(node => node.key),
      }),
      updatedAt: releaseUpdatedAt(row, createdAt),
    })
  }

  const sortedCandidates = sortCandidates(candidates)
  const sources: SimulationCanonSource[] = []
  for (const candidate of sortedCandidates) {
    sources.push({
      ...candidate,
      fields: structuredClone(candidate.fields),
      contentHash: await sha256(sourceHashInput(candidate)),
    })
  }
  const snapshotBase: Omit<SimulationCanonSnapshotV1, 'snapshotHash'> = {
    schema: 'storyforge.simulation-canon',
    version: 1,
    createdAt,
    worldGroupId: null,
    worldLabel: manifest.worldName.trim(),
    sources,
  }
  const canonSnapshot: SimulationCanonSnapshotV1 = {
    ...snapshotBase,
    snapshotHash: await sha256(snapshotHashInput(snapshotBase)),
  }
  const initialState: SimulationRuntimeState = {
    ...structuredClone(EMPTY_SIMULATION_STATE),
    entities: releaseRuntimeEntities(sources, diagnostics),
  }
  if (Object.keys(initialState.entities).length === 0) {
    diagnostics.push({
      code: 'NO_RUNTIME_ENTITIES',
      severity: 'info',
      message: '发布包未包含角色、地点、人工器物或势力实体。',
      sourceKeys: [`release-world:${manifest.worldCode.trim()}`],
    })
  }
  diagnostics.sort((left, right) => diagnosticOrder(left).localeCompare(diagnosticOrder(right), 'zh-Hans-CN'))
  const bundleBase: Omit<PlayableWorldBundleV1, 'bundleHash'> = {
    schema: 'storyforge.playable-world-bundle',
    version: 1,
    compilerVersion: PLAYABLE_WORLD_COMPILER_VERSION,
    source: {
      worldCode: manifest.worldCode.trim(),
      worldName: manifest.worldName.trim(),
      worldContentHash,
    },
    createdAt,
    canonSnapshot,
    initialState,
    diagnostics,
  }
  return { ...bundleBase, bundleHash: await sha256(bundleHashInput(bundleBase)) }
}

/** Backwards-compatible Canon-only adapter for callers not yet consuming the full bundle. */
export async function buildReleaseSimulationCanonSnapshot(
  manifest: WorldReleaseManifestV2,
  createdAt: number,
  worldContentHash?: string,
): Promise<SimulationCanonSnapshotV1> {
  return (await buildPlayableWorldBundleFromRelease({
    manifest,
    createdAt,
    worldContentHash: worldContentHash ?? await sha256(manifest),
  })).canonSnapshot
}

export async function verifyPlayableWorldBundle(bundle: PlayableWorldBundleV1): Promise<boolean> {
  if (
    bundle.schema !== 'storyforge.playable-world-bundle'
    || bundle.version !== 1
    || bundle.compilerVersion !== PLAYABLE_WORLD_COMPILER_VERSION
    || !/^[0-9a-f]{64}$/.test(bundle.source.worldContentHash)
    || !/^[0-9a-f]{64}$/.test(bundle.bundleHash)
    || !await verifySimulationCanonSnapshot(bundle.canonSnapshot)
  ) return false
  const { bundleHash: _bundleHash, ...base } = bundle
  return await sha256(bundleHashInput(base)) === bundle.bundleHash
}

export function assertPlayableWorldBundleRunnable(bundle: PlayableWorldBundleV1): void {
  const errors = bundle.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (errors.length === 0) return
  throw new Error(`[playable-world] 发布世界不能安全进入运行时: ${errors
    .map(diagnostic => `${diagnostic.code}:${diagnostic.message}`)
    .join('；')}`)
}

export function parseSimulationCanonSnapshot(value: string): SimulationCanonSnapshotV1 | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const snapshot = parsed as unknown as Partial<SimulationCanonSnapshotV1>
  if (
    snapshot.schema !== 'storyforge.simulation-canon'
    || snapshot.version !== 1
    || !Number.isFinite(snapshot.createdAt)
    || (snapshot.worldGroupId != null && !Number.isInteger(snapshot.worldGroupId))
    || typeof snapshot.worldLabel !== 'string'
    || !Array.isArray(snapshot.sources)
    || typeof snapshot.snapshotHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(snapshot.snapshotHash)
  ) return null
  const sourceKeys = new Set<string>()
  for (const source of snapshot.sources) {
    if (
      !isObject(source)
      || typeof source.sourceKey !== 'string'
      || !source.sourceKey
      || sourceKeys.has(source.sourceKey)
      || !SIMULATION_CANON_SOURCE_KINDS.includes(source.kind as never)
      || (source.recordId != null && (!Number.isInteger(source.recordId) || source.recordId <= 0))
      || typeof source.name !== 'string'
      || typeof source.summary !== 'string'
      || !isObject(source.fields)
      || Object.values(source.fields).some(field => typeof field !== 'string')
      || !Number.isFinite(source.updatedAt)
      || typeof source.contentHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(source.contentHash)
    ) return null
    sourceKeys.add(source.sourceKey)
  }
  return snapshot as SimulationCanonSnapshotV1
}

export async function verifySimulationCanonSnapshot(
  snapshot: SimulationCanonSnapshotV1,
): Promise<boolean> {
  for (const source of snapshot.sources) {
    const expected = await sha256(sourceHashInput(source))
    if (expected !== source.contentHash) return false
  }
  return await sha256(snapshotHashInput(snapshot))
    === snapshot.snapshotHash
}
