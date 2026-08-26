import { db } from '../db/schema'
import type {
  CharacterInteractionWorldRecordSelectionV1,
  CharacterInteractionWorldSourceCatalogRecordV1,
  CharacterInteractionWorldSourceCatalogV1,
  CharacterInteractionWorldSourceSelectionV1,
  CharacterInteractionWorldSourceTableV1,
  WorkspaceScope,
  WorldRelease,
  WorldReleaseManifestV2,
} from '../types'
import { CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1 } from '../types'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { resolveScope } from '../world-engine/scope'

const HASH = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const SOURCE_TABLES = new Set<string>(CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1)
const NARRATIVE_DEPENDENCY_TABLES = new Set(['narrativeNodes', 'narrativeBeats', 'narrativeChoices'])
const SELECTION_KEYS = new Set([
  'schema', 'version', 'productType', 'contractVersion', 'worldReleaseId', 'sourceWorldCode',
  'worldContentHash', 'sourceWorldExportId', 'sourceWorkExportId', 'sourceMappingVersion',
  'participantCharacterExportIds', 'recordSelections', 'guestCharacterKeys', 'selectionHash',
])
const RECORD_SELECTION_KEYS = new Set(['table', 'granularity', 'exportIds'])
const GRANULARITIES = new Set([
  'single-record', 'record-set', 'tree-subgraph', 'narrative-module', 'dependency-closure',
])

interface VerifiedCharacterInteractionWorldReleaseV1 {
  scope: WorkspaceScope
  release: WorldRelease & { id: number }
  manifest: WorldReleaseManifestV2
  sourceWorldExportId: number
  sourceWorkExportId: number
  rowsByTable: Map<CharacterInteractionWorldSourceTableV1, Record<string, unknown>[]>
  recordsByTable: Map<CharacterInteractionWorldSourceTableV1, CharacterInteractionWorldSourceCatalogRecordV1[]>
}

function fail(message: string): never {
  throw new Error(`[chatgame-source] ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.entries(value)
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function portableId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail(`${label} 必须是非负便携 ID`)
  return Number(value)
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label} 无效`)
  return value.trim()
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) fail(`${label} 含未知字段:${unknown.join(',')}`)
}

function uniquePortableIds(value: unknown, label: string, allowEmpty = true): number[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组`)
  const ids = value.map((item, index) => portableId(item, `${label}[${index}]`))
  if (!allowEmpty && !ids.length) fail(`${label} 不能为空`)
  if (new Set(ids).size !== ids.length) fail(`${label} 不能重复`)
  return ids
}

function portableRecordId(row: Record<string, unknown>, index: number, table: string): number {
  return row._exportId == null ? index : portableId(row._exportId, `${table}._exportId`)
}

function optionalPortableRef(
  row: Record<string, unknown>,
  field: string,
  table: CharacterInteractionWorldSourceTableV1,
): CharacterInteractionWorldSourceCatalogRecordV1['referencedExportIds'] {
  if (row[field] == null) return []
  return [{ table, exportId: portableId(row[field], `${field}`) }]
}

function portableArrayRefs(
  row: Record<string, unknown>,
  field: string,
  table: CharacterInteractionWorldSourceTableV1,
): CharacterInteractionWorldSourceCatalogRecordV1['referencedExportIds'] {
  const values: unknown[] = []
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect)
    else if (Number.isInteger(value)) values.push(value)
    else if (isRecord(value)) Object.values(value).forEach(collect)
  }
  collect(row[field])
  return [...new Set(values.map(value => portableId(value, field)))]
    .map(exportId => ({ table, exportId }))
}

function recordReferences(
  table: CharacterInteractionWorldSourceTableV1,
  row: Record<string, unknown>,
): CharacterInteractionWorldSourceCatalogRecordV1['referencedExportIds'] {
  switch (table) {
    case 'characters':
      return [
        ...optionalPortableRef(row, '_homeWorldGroupExportId', 'worldGroups'),
        ...optionalPortableRef(row, '_raceEntryExportId', 'codexEntries'),
        ...optionalPortableRef(row, '_cultivationSystemExportId', 'cultivationSystems'),
      ]
    case 'workCharacterBindings':
      return optionalPortableRef(row, '_characterExportId', 'characters')
    case 'characterRelations':
      return [
        ...optionalPortableRef(row, '_fromCharacterIndex', 'characters'),
        ...optionalPortableRef(row, '_toCharacterIndex', 'characters'),
      ]
    case 'worldGroupLinks':
      return [
        ...optionalPortableRef(row, '_fromGroupExportId', 'worldGroups'),
        ...optionalPortableRef(row, '_toGroupExportId', 'worldGroups'),
      ]
    case 'worldNodes':
      return [
        ...optionalPortableRef(row, '_parentExportId', 'worldNodes'),
        ...optionalPortableRef(row, '_worldGroupExportId', 'worldGroups'),
      ]
    case 'worldviews':
    case 'worldRulesProfiles':
    case 'cultivationSystems':
    case 'powerSystems':
    case 'geographies':
    case 'histories':
    case 'historicalTimelineEvents':
    case 'historicalKeywords':
      return optionalPortableRef(row, '_worldGroupExportId', 'worldGroups')
    case 'importantLocations':
      return optionalPortableRef(row, '_parentExportId', 'importantLocations')
    case 'codexCategories':
      return [
        ...optionalPortableRef(row, '_parentExportId', 'codexCategories'),
        ...optionalPortableRef(row, '_worldGroupExportId', 'worldGroups'),
      ]
    case 'codexEntries':
      return [
        ...optionalPortableRef(row, '_categoryExportId', 'codexCategories'),
        ...optionalPortableRef(row, '_worldGroupExportId', 'worldGroups'),
        ...optionalPortableRef(row, '_cultivationSystemExportId', 'cultivationSystems'),
        ...optionalPortableRef(row, '_importantLocationExportId', 'importantLocations'),
      ]
    case 'outlineNodes':
      return [
        ...optionalPortableRef(row, '_parentExportId', 'outlineNodes'),
        ...optionalPortableRef(row, '_worldGroupExportId', 'worldGroups'),
      ]
    case 'detailedOutlines':
      return [
        ...optionalPortableRef(row, '_outlineExportId', 'outlineNodes'),
        ...portableArrayRefs(row, '_appearingCharacterIndexes', 'characters'),
        ...portableArrayRefs(row, '_sceneCharacterIndexes', 'characters'),
      ]
    default:
      return []
  }
}

function recordLabel(table: CharacterInteractionWorldSourceTableV1, row: Record<string, unknown>): string {
  const candidates = table === 'worldRulesProfiles'
    ? [row.globalNote, row.name]
    : [row.name, row.title, row.label, row.theme, row.summary, row.role]
  const found = candidates.find(value => typeof value === 'string' && value.trim())
  return typeof found === 'string' ? found.trim().slice(0, 240) : `${table} 记录`
}

function recordSummary(row: Record<string, unknown>): string {
  const candidates = [
    row.shortDescription, row.description, row.summary, row.outcome, row.arc,
    row.significance, row.centralConflict, row.globalNote,
  ]
  const found = candidates.find(value => typeof value === 'string' && value.trim())
  return typeof found === 'string' ? found.trim().slice(0, 1_000) : ''
}

function catalogRecords(
  table: CharacterInteractionWorldSourceTableV1,
  rows: Record<string, unknown>[],
): CharacterInteractionWorldSourceCatalogRecordV1[] {
  const ids = new Set<number>()
  return rows.map((row, index) => {
    const exportId = portableRecordId(row, index, table)
    if (ids.has(exportId)) fail(`${table} 便携 ID 重复:${exportId}`)
    ids.add(exportId)
    const parentField = table === 'importantLocations' || table === 'codexCategories'
      || table === 'outlineNodes' || table === 'worldNodes'
      ? '_parentExportId'
      : null
    return {
      table,
      exportId,
      label: recordLabel(table, row),
      summary: recordSummary(row),
      parentExportId: parentField && row[parentField] != null
        ? portableId(row[parentField], `${table}.${parentField}`)
        : null,
      referencedExportIds: recordReferences(table, row),
    }
  })
}

function parseManifest(value: string): WorldReleaseManifestV2 {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { fail('WorldRelease Manifest 不是合法 JSON') }
  if (!isRecord(parsed) || parsed.schema !== 'storyforge.world-package' || parsed.version !== 2) {
    fail('只能消费 WorldReleaseManifestV2')
  }
  if (typeof parsed.worldCode !== 'string' || !parsed.worldCode.trim()
    || typeof parsed.worldName !== 'string' || typeof parsed.workTitle !== 'string'
    || !Array.isArray(parsed.selectedTables) || new Set(parsed.selectedTables).size !== parsed.selectedTables.length
    || parsed.selectedTables.some(table => typeof table !== 'string' || !table.trim())
    || !Array.isArray(parsed.dependencies) || !isRecord(parsed.records) || !isRecord(parsed.portableProject)) {
    fail('WorldRelease Manifest 根结构无效')
  }
  return parsed as unknown as WorldReleaseManifestV2
}

async function verifyDependencies(manifest: WorldReleaseManifestV2): Promise<void> {
  const dependencyByTable = new Map<string, { rowCount: number; contentHash: string }>()
  for (const raw of manifest.dependencies) {
    if (!raw || typeof raw.table !== 'string' || !Number.isInteger(raw.rowCount) || raw.rowCount < 0
      || !HASH.test(raw.contentHash) || dependencyByTable.has(raw.table)) {
      fail('WorldRelease dependencies 无效或重复')
    }
    dependencyByTable.set(raw.table, { rowCount: raw.rowCount, contentHash: raw.contentHash })
  }
  for (const table of manifest.selectedTables) {
    const rows = manifest.records[table]
    const dependency = dependencyByTable.get(table)
    if (!Array.isArray(rows) || !dependency || dependency.rowCount !== rows.length
      || await sha256(rows) !== dependency.contentHash) {
      fail(`WorldRelease 分表哈希或行数不一致:${table}`)
    }
  }
}

async function loadVerified(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<VerifiedCharacterInteractionWorldReleaseV1> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.worldReleases.get(positiveId(input.worldReleaseId, 'worldReleaseId'))
  if (!release?.id || release.projectId !== scope.projectId || release.worldId !== scope.worldId) {
    fail('WorldRelease 不属于当前 WorkspaceScope')
  }
  await assertReleaseUnchanged(release.id)
  if (!HASH.test(release.contentHash)) fail('WorldRelease contentHash 无效')
  const manifest = parseManifest(release.manifestJson)
  if (manifest.worldCode !== release.sourceWorldCode) fail('Manifest worldCode 与 Release 身份不一致')
  await verifyDependencies(manifest)

  const portable = manifest.portableProject
  if (typeof portable.version !== 'number' || !Number.isInteger(portable.version) || portable.version < 4 || !isRecord(portable.ownership)
    || portable.ownership.contractVersion !== 1) {
    fail('portableProject 必须是严格 v4 ownership v1')
  }
  const sourceWorldExportId = portableId(portable.ownership.worldExportId, 'sourceWorldExportId')
  const sourceWorkExportId = portableId(portable.ownership.workExportId, 'sourceWorkExportId')
  if (!Array.isArray(portable.worlds) || !Array.isArray(portable.works)) fail('portableProject 缺少 World/Work 根')
  const worldRoot = portable.worlds.find(raw => isRecord(raw) && raw._exportId === sourceWorldExportId)
  const workRoot = portable.works.find(raw => isRecord(raw) && raw._exportId === sourceWorkExportId)
  if (!isRecord(worldRoot) || worldRoot.code !== release.sourceWorldCode
    || !isRecord(workRoot) || workRoot._worldExportId !== sourceWorldExportId) {
    fail('portable World/Work 根身份或作用域无效')
  }

  const rowsByTable = new Map<CharacterInteractionWorldSourceTableV1, Record<string, unknown>[]>()
  const recordsByTable = new Map<CharacterInteractionWorldSourceTableV1, CharacterInteractionWorldSourceCatalogRecordV1[]>()
  for (const table of CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1) {
    const rawRows = manifest.records[table]
    if (rawRows == null) continue
    if (!Array.isArray(rawRows) || rawRows.some(row => !isRecord(row))) fail(`${table} 包含非对象记录`)
    const rows = rawRows as Record<string, unknown>[]
    rowsByTable.set(table, rows)
    recordsByTable.set(table, catalogRecords(table, rows))
  }
  return {
    scope,
    release: release as WorldRelease & { id: number },
    manifest,
    sourceWorldExportId,
    sourceWorkExportId,
    rowsByTable,
    recordsByTable,
  }
}

function toCatalog(verified: VerifiedCharacterInteractionWorldReleaseV1): CharacterInteractionWorldSourceCatalogV1 {
  const records: CharacterInteractionWorldSourceCatalogV1['records'] = {}
  for (const table of CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1) {
    const items = verified.recordsByTable.get(table)
    if (items) records[table] = structuredClone(items)
  }
  return {
    schema: 'storyforge.character-interaction-world-source-catalog',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    worldReleaseId: verified.release.id,
    worldReleaseVersion: verified.release.version,
    worldReleaseLabel: verified.release.label,
    sourceWorldCode: verified.release.sourceWorldCode,
    sourceWorldName: verified.manifest.worldName,
    sourceWorkTitle: verified.manifest.workTitle,
    worldContentHash: verified.release.contentHash,
    sourceWorldExportId: verified.sourceWorldExportId,
    sourceWorkExportId: verified.sourceWorkExportId,
    sourceMappingVersion: 1,
    records,
    unavailableTables: CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1
      .filter(table => !verified.rowsByTable.has(table)),
    excludedReleaseTables: verified.manifest.selectedTables.filter(table => (
      !SOURCE_TABLES.has(table) && !NARRATIVE_DEPENDENCY_TABLES.has(table)
    )).sort(),
  }
}

export async function loadCharacterInteractionWorldSourceCatalogV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<CharacterInteractionWorldSourceCatalogV1> {
  return toCatalog(await loadVerified(input))
}

function parseRecordSelection(value: unknown, index: number): CharacterInteractionWorldRecordSelectionV1 {
  if (!isRecord(value)) fail(`recordSelections[${index}] 必须是对象`)
  exactKeys(value, RECORD_SELECTION_KEYS, `recordSelections[${index}]`)
  if (typeof value.table !== 'string' || !SOURCE_TABLES.has(value.table)) {
    fail(`recordSelections[${index}].table 不受角色互动支持`)
  }
  if (typeof value.granularity !== 'string' || !GRANULARITIES.has(value.granularity)) {
    fail(`recordSelections[${index}].granularity 无效`)
  }
  const exportIds = uniquePortableIds(value.exportIds, `recordSelections[${index}].exportIds`, false)
  if (value.granularity === 'single-record' && exportIds.length !== 1) {
    fail(`recordSelections[${index}] single-record 必须只有一个 ID`)
  }
  return {
    table: value.table as CharacterInteractionWorldSourceTableV1,
    granularity: value.granularity as CharacterInteractionWorldRecordSelectionV1['granularity'],
    exportIds,
  }
}

export function parseCharacterInteractionWorldSourceSelectionV1(
  value: unknown,
): CharacterInteractionWorldSourceSelectionV1 {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { fail('SourceSelection 不是合法 JSON') }
  }
  if (!isRecord(parsed)) fail('SourceSelection 必须是对象')
  exactKeys(parsed, SELECTION_KEYS, 'SourceSelection')
  if (parsed.schema !== 'storyforge.character-interaction-world-source-selection'
    || parsed.version !== 1 || parsed.productType !== 'character-interaction'
    || parsed.contractVersion !== 1 || parsed.sourceMappingVersion !== 1) {
    fail('SourceSelection 协议身份无效')
  }
  const participantCharacterExportIds = uniquePortableIds(
    parsed.participantCharacterExportIds,
    'participantCharacterExportIds',
    false,
  )
  if (participantCharacterExportIds.length > 8) fail('角色互动只允许选择 1..8 个世界角色')
  if (!Array.isArray(parsed.recordSelections)) fail('recordSelections 必须是数组')
  const recordSelections = parsed.recordSelections.map(parseRecordSelection)
  if (new Set(recordSelections.map(item => item.table)).size !== recordSelections.length) {
    fail('recordSelections 不能重复选择同一表')
  }
  if (!Array.isArray(parsed.guestCharacterKeys)
    || parsed.guestCharacterKeys.some(key => typeof key !== 'string' || !STABLE_KEY.test(key) || key.length > 160)
    || new Set(parsed.guestCharacterKeys).size !== parsed.guestCharacterKeys.length) {
    fail('guestCharacterKeys 无效或重复')
  }
  const selectionHash = text(parsed.selectionHash, 'selectionHash', 64)
  if (!HASH.test(selectionHash)) fail('selectionHash 无效')
  return {
    schema: 'storyforge.character-interaction-world-source-selection',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    worldReleaseId: positiveId(parsed.worldReleaseId, 'worldReleaseId'),
    sourceWorldCode: text(parsed.sourceWorldCode, 'sourceWorldCode', 200),
    worldContentHash: HASH.test(String(parsed.worldContentHash))
      ? String(parsed.worldContentHash)
      : fail('worldContentHash 无效'),
    sourceWorldExportId: portableId(parsed.sourceWorldExportId, 'sourceWorldExportId'),
    sourceWorkExportId: portableId(parsed.sourceWorkExportId, 'sourceWorkExportId'),
    sourceMappingVersion: 1,
    participantCharacterExportIds,
    recordSelections,
    guestCharacterKeys: [...parsed.guestCharacterKeys] as string[],
    selectionHash,
  }
}

function selectionHashPayload(selection: CharacterInteractionWorldSourceSelectionV1): unknown {
  // worldReleaseId is a local row reference and is rebound on portable import.
  // Frozen product identity is carried by content hash + portable roots/records.
  const { selectionHash: _selectionHash, worldReleaseId: _worldReleaseId, ...payload } = selection
  return payload
}

function selectionMap(selection: CharacterInteractionWorldSourceSelectionV1): Map<CharacterInteractionWorldSourceTableV1, Set<number>> {
  return new Map(selection.recordSelections.map(item => [item.table, new Set(item.exportIds)]))
}

function rawRecord(
  verified: VerifiedCharacterInteractionWorldReleaseV1,
  table: CharacterInteractionWorldSourceTableV1,
  exportId: number,
): Record<string, unknown> | null {
  const options = verified.recordsByTable.get(table) ?? []
  const index = options.findIndex(item => item.exportId === exportId)
  return index < 0 ? null : verified.rowsByTable.get(table)?.[index] ?? null
}

function addSelectionId(
  selected: Map<CharacterInteractionWorldSourceTableV1, Set<number>>,
  table: CharacterInteractionWorldSourceTableV1,
  exportId: number,
): boolean {
  const ids = selected.get(table) ?? new Set<number>()
  const before = ids.size
  ids.add(exportId)
  selected.set(table, ids)
  return ids.size !== before
}

function addPortableDependencies(
  verified: VerifiedCharacterInteractionWorldReleaseV1,
  selected: Map<CharacterInteractionWorldSourceTableV1, Set<number>>,
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const [table, ids] of selected) {
      const records = verified.recordsByTable.get(table) ?? []
      for (const exportId of ids) {
        const record = records.find(item => item.exportId === exportId)
        if (!record) fail(`${table} 选择了不存在的便携 ID:${exportId}`)
        for (const ref of record.referencedExportIds) {
          if (!(verified.recordsByTable.get(ref.table) ?? []).some(item => item.exportId === ref.exportId)) {
            fail(`${table}:${exportId} 存在悬空便携引用 ${ref.table}:${ref.exportId}`)
          }
          changed = addSelectionId(selected, ref.table, ref.exportId) || changed
        }
      }
    }
  }
}

function addParticipantClosure(
  verified: VerifiedCharacterInteractionWorldReleaseV1,
  selected: Map<CharacterInteractionWorldSourceTableV1, Set<number>>,
  participantIds: Set<number>,
): void {
  const bindings = verified.recordsByTable.get('workCharacterBindings') ?? []
  for (const binding of bindings) {
    const raw = rawRecord(verified, 'workCharacterBindings', binding.exportId)
    if (raw?._workExportId !== verified.sourceWorkExportId) continue
    const characterExportId = raw._characterExportId
    if (Number.isInteger(characterExportId) && participantIds.has(Number(characterExportId))) {
      addSelectionId(selected, 'workCharacterBindings', binding.exportId)
    }
  }
  const relations = verified.recordsByTable.get('characterRelations') ?? []
  for (const relation of relations) {
    const raw = rawRecord(verified, 'characterRelations', relation.exportId)
    const from = raw?._fromCharacterIndex
    const to = raw?._toCharacterIndex
    if (Number.isInteger(from) && Number.isInteger(to)
      && participantIds.has(Number(from)) && participantIds.has(Number(to))) {
      addSelectionId(selected, 'characterRelations', relation.exportId)
    }
  }
}

function granularityFor(table: CharacterInteractionWorldSourceTableV1, count: number): CharacterInteractionWorldRecordSelectionV1['granularity'] {
  if (table === 'importantLocations' || table === 'outlineNodes'
    || table === 'codexCategories' || table === 'worldNodes') return 'tree-subgraph'
  if (table === 'narrativeModules') return 'narrative-module'
  if (table === 'workCharacterBindings' || table === 'characterRelations'
    || table === 'worldGroups' || table === 'worldGroupLinks') return 'dependency-closure'
  return count === 1 ? 'single-record' : 'record-set'
}

export async function freezeCharacterInteractionWorldSourceSelectionV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  participantCharacterExportIds: number[]
  optionalRecordSelections?: Array<{
    table: Exclude<CharacterInteractionWorldSourceTableV1, 'characters' | 'workCharacterBindings' | 'characterRelations'>
    exportIds: number[]
  }>
  guestCharacterKeys?: string[]
}): Promise<CharacterInteractionWorldSourceSelectionV1> {
  const verified = await loadVerified(input)
  const participantCharacterExportIds = uniquePortableIds(
    input.participantCharacterExportIds,
    'participantCharacterExportIds',
    false,
  ).sort((left, right) => left - right)
  if (participantCharacterExportIds.length > 8) fail('角色互动只允许选择 1..8 个世界角色')
  const characterCatalog = verified.recordsByTable.get('characters') ?? []
  for (const exportId of participantCharacterExportIds) {
    if (!characterCatalog.some(item => item.exportId === exportId)) fail(`世界角色不存在:${exportId}`)
  }
  const guestCharacterKeys = [...new Set((input.guestCharacterKeys ?? []).map(key => key.trim()))].sort()
  if (guestCharacterKeys.some(key => !STABLE_KEY.test(key) || key.length > 160)) fail('guestCharacterKeys 无效')

  const selected = new Map<CharacterInteractionWorldSourceTableV1, Set<number>>()
  selected.set('characters', new Set(participantCharacterExportIds))
  for (const optional of input.optionalRecordSelections ?? []) {
    if (!SOURCE_TABLES.has(optional.table)) fail(`不支持的可选来源表:${optional.table}`)
    for (const exportId of uniquePortableIds(optional.exportIds, `${optional.table}.exportIds`)) {
      addSelectionId(selected, optional.table, exportId)
    }
  }
  addParticipantClosure(verified, selected, new Set(participantCharacterExportIds))
  addPortableDependencies(verified, selected)

  const recordSelections = CHARACTER_INTERACTION_WORLD_SOURCE_TABLES_V1.flatMap(table => {
    const exportIds = [...(selected.get(table) ?? [])].sort((left, right) => left - right)
    return exportIds.length ? [{ table, granularity: granularityFor(table, exportIds.length), exportIds }] : []
  })
  const base: CharacterInteractionWorldSourceSelectionV1 = {
    schema: 'storyforge.character-interaction-world-source-selection',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    worldReleaseId: verified.release.id,
    sourceWorldCode: verified.release.sourceWorldCode,
    worldContentHash: verified.release.contentHash,
    sourceWorldExportId: verified.sourceWorldExportId,
    sourceWorkExportId: verified.sourceWorkExportId,
    sourceMappingVersion: 1,
    participantCharacterExportIds,
    recordSelections,
    guestCharacterKeys,
    selectionHash: '0'.repeat(64),
  }
  const selection = { ...base, selectionHash: await sha256(selectionHashPayload(base)) }
  await validateCharacterInteractionWorldSourceSelectionV1({ scope: verified.scope, selection })
  return deepFreeze(selection)
}

function validateSelectedRecords(
  verified: VerifiedCharacterInteractionWorldReleaseV1,
  selection: CharacterInteractionWorldSourceSelectionV1,
): void {
  const selected = selectionMap(selection)
  const characterIds = selected.get('characters') ?? new Set()
  if (characterIds.size !== selection.participantCharacterExportIds.length
    || selection.participantCharacterExportIds.some(id => !characterIds.has(id))) {
    fail('characters 选择必须与 participantCharacterExportIds 精确一致')
  }
  for (const [table, ids] of selected) {
    const records = verified.recordsByTable.get(table) ?? []
    for (const exportId of ids) {
      const record = records.find(item => item.exportId === exportId)
      if (!record) fail(`${table} 选择了不存在的便携 ID:${exportId}`)
      for (const ref of record.referencedExportIds) {
        if (!selected.get(ref.table)?.has(ref.exportId)) {
          fail(`${table}:${exportId} 缺少依赖 ${ref.table}:${ref.exportId}`)
        }
      }
    }
  }
  const expected = new Map<CharacterInteractionWorldSourceTableV1, Set<number>>()
  expected.set('characters', new Set(selection.participantCharacterExportIds))
  addParticipantClosure(verified, expected, new Set(selection.participantCharacterExportIds))
  for (const table of ['workCharacterBindings', 'characterRelations'] as const) {
    const expectedIds = expected.get(table) ?? new Set()
    const actualIds = selected.get(table) ?? new Set()
    if (expectedIds.size !== actualIds.size || [...expectedIds].some(id => !actualIds.has(id))) {
      fail(`${table} 没有形成所选角色的完整依赖闭包`)
    }
  }
}

export async function validateCharacterInteractionWorldSourceSelectionV1(input: {
  scope: WorkspaceScope
  selection: unknown
}): Promise<CharacterInteractionWorldSourceSelectionV1> {
  const selection = parseCharacterInteractionWorldSourceSelectionV1(input.selection)
  const expectedHash = await sha256(selectionHashPayload(selection))
  if (selection.selectionHash !== expectedHash) fail('selectionHash 校验失败')
  const verified = await loadVerified({ scope: input.scope, worldReleaseId: selection.worldReleaseId })
  if (selection.sourceWorldCode !== verified.release.sourceWorldCode
    || selection.worldContentHash !== verified.release.contentHash
    || selection.sourceWorldExportId !== verified.sourceWorldExportId
    || selection.sourceWorkExportId !== verified.sourceWorkExportId
    || selection.sourceMappingVersion !== 1) {
    fail('SourceSelection 身份与冻结 WorldRelease 不一致')
  }
  validateSelectedRecords(verified, selection)
  await assertReleaseUnchanged(verified.release.id)
  return selection
}

export async function readCharacterInteractionSelectedWorldRowsV1(input: {
  scope: WorkspaceScope
  selection: unknown
}): Promise<{
  catalog: CharacterInteractionWorldSourceCatalogV1
  selection: CharacterInteractionWorldSourceSelectionV1
  records: Partial<Record<CharacterInteractionWorldSourceTableV1, Record<string, unknown>[]>>
}> {
  const selection = await validateCharacterInteractionWorldSourceSelectionV1(input)
  const verified = await loadVerified({ scope: input.scope, worldReleaseId: selection.worldReleaseId })
  const records: Partial<Record<CharacterInteractionWorldSourceTableV1, Record<string, unknown>[]>> = {}
  for (const item of selection.recordSelections) {
    records[item.table] = item.exportIds.map(exportId => {
      const row = rawRecord(verified, item.table, exportId)
      if (!row) fail(`${item.table} 来源记录在读取时消失:${exportId}`)
      return structuredClone(row)
    })
  }
  return { catalog: toCatalog(verified), selection, records }
}
