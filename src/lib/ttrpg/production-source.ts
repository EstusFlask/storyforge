import { hashCanonicalValue } from '../agent/run/hash'
import {
  NARRATIVE_MODULE_KINDS,
  NARRATIVE_NODE_KINDS,
  TTRPG_PRODUCTION_SOURCE_ADAPTER_VERSION,
  TTRPG_PRODUCTION_SOURCE_VERSION,
  type TtrpgDevelopmentSourceFixtureKeyV1,
  type TtrpgProductionSourceCatalogV1,
  type TtrpgProductionSourceDomainV1,
  type TtrpgProductionSourceIdentityV1,
  type TtrpgProductionSourceMissingPolicyV1,
  type TtrpgProductionSourceNarrativeNodeV1,
  type TtrpgProductionSourceRecordV1,
  type TtrpgProductionSourceSelectionV1,
  type TtrpgProductionSourceStoryArcV1,
  type TtrpgProductionSourceValidationV1,
  type UnfrozenTtrpgProductionSourceCatalogV1,
  type UnfrozenTtrpgProductionSourceSelectionV1,
} from '../types'

const SHA256 = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const DOMAINS = ['characters', 'locations', 'artifacts', 'storyArcs', 'narrative'] as const
const MISSING_POLICIES = ['block', 'product-generate', 'text-fallback'] as const

function fail(message: string): never { throw new Error(`[ttrpg-production-source] ${message}`) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}
function text(value: unknown, label: string, maximum = 4_000, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const parsed = value.trim().normalize('NFC')
  if ((!allowEmpty && !parsed) || parsed.length > maximum) fail(`${label} 为空或过长`)
  return parsed
}
function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} 必须是 SHA-256`)
  return value
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail(`${label} 必须是 >=${minimum} 的整数`)
  return Number(value)
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
  return value
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}
function strings(value: unknown, label: string, maximum = 100, keyOnly = false): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const parsed = value.map((item, index) => keyOnly ? key(item, `${label}[${index}]`) : text(item, `${label}[${index}]`, 500))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return keyOnly ? parsed.sort() : parsed
}

function parseRecord(value: unknown, label: string): TtrpgProductionSourceRecordV1 {
  const row = object(value, label)
  exact(row, ['sourceKey', 'name', 'description', 'tags'], label)
  return {
    sourceKey: key(row.sourceKey, `${label}.sourceKey`),
    name: text(row.name, `${label}.name`, 500),
    description: text(row.description, `${label}.description`, 10_000, true),
    tags: strings(row.tags, `${label}.tags`, 50),
  }
}

function parseRecords(value: unknown, label: string): TtrpgProductionSourceRecordV1[] {
  if (!Array.isArray(value) || value.length > 10_000) fail(`${label} 必须是有界数组`)
  const rows = value.map((item, index) => parseRecord(item, `${label}[${index}]`))
  if (new Set(rows.map(row => row.sourceKey)).size !== rows.length) fail(`${label} sourceKey 重复`)
  return rows.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
}

function parseStoryArcs(value: unknown): TtrpgProductionSourceStoryArcV1[] {
  if (!Array.isArray(value) || value.length > 10_000) fail('storyArcs 必须是有界数组')
  const rows = value.map((item, index) => {
    const row = object(item, `storyArcs[${index}]`)
    exact(row, ['sourceKey', 'name', 'description', 'tags', 'kind'], `storyArcs[${index}]`)
    return { ...parseRecord({
      sourceKey: row.sourceKey, name: row.name, description: row.description, tags: row.tags,
    }, `storyArcs[${index}]`), kind: text(row.kind, `storyArcs[${index}].kind`, 100) }
  })
  if (new Set(rows.map(row => row.sourceKey)).size !== rows.length) fail('storyArcs sourceKey 重复')
  return rows.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
}

function parseIdentity(value: unknown): TtrpgProductionSourceIdentityV1 {
  const row = object(value, 'identity')
  exact(row, ['sourceKind', 'sourceKey', 'sourceContentHash', 'developmentOnly', 'adapterVersion', 'worldBinding'], 'identity')
  const sourceKind = oneOf(row.sourceKind, ['development-fixture', 'world-release'] as const, 'identity.sourceKind')
  const developmentOnly = bool(row.developmentOnly, 'identity.developmentOnly')
  if (row.adapterVersion !== TTRPG_PRODUCTION_SOURCE_ADAPTER_VERSION) fail('identity.adapterVersion 无效')
  let worldBinding: TtrpgProductionSourceIdentityV1['worldBinding'] = null
  if (row.worldBinding != null) {
    const binding = object(row.worldBinding, 'identity.worldBinding')
    exact(binding, ['worldReleaseId', 'sourceWorldCode', 'sourceWorldExportId', 'sourceWorkExportId', 'sourceMappingVersion'], 'identity.worldBinding')
    worldBinding = {
      worldReleaseId: integer(binding.worldReleaseId, 'worldReleaseId', 1),
      sourceWorldCode: key(binding.sourceWorldCode, 'sourceWorldCode'),
      sourceWorldExportId: integer(binding.sourceWorldExportId, 'sourceWorldExportId'),
      sourceWorkExportId: integer(binding.sourceWorkExportId, 'sourceWorkExportId'),
      sourceMappingVersion: integer(binding.sourceMappingVersion, 'sourceMappingVersion', 1),
    }
  }
  if (sourceKind === 'development-fixture' && (!developmentOnly || worldBinding != null)) {
    fail('开发测试来源必须 developmentOnly=true 且不能伪装 WorldRelease')
  }
  if (sourceKind === 'world-release' && (developmentOnly || worldBinding == null)) {
    fail('正式世界来源必须绑定 WorldRelease 且 developmentOnly=false')
  }
  return {
    sourceKind,
    sourceKey: key(row.sourceKey, 'identity.sourceKey'),
    sourceContentHash: hash(row.sourceContentHash, 'identity.sourceContentHash'),
    developmentOnly,
    adapterVersion: 1,
    worldBinding,
  }
}

function parseNarrative(value: unknown): TtrpgProductionSourceCatalogV1['narrative'] {
  const row = object(value, 'narrative')
  exact(row, ['moduleKind', 'title', 'entryNodeKey', 'nodes'], 'narrative')
  if (!Array.isArray(row.nodes) || row.nodes.length < 3 || row.nodes.length > 5_000) fail('narrative.nodes 必须包含至少 3 个节点')
  const nodes: TtrpgProductionSourceNarrativeNodeV1[] = row.nodes.map((item, index) => {
    const node = object(item, `narrative.nodes[${index}]`)
    exact(node, ['key', 'kind', 'title', 'summary', 'successorKeys'], `narrative.nodes[${index}]`)
    return {
      key: key(node.key, `narrative.nodes[${index}].key`),
      kind: oneOf(node.kind, NARRATIVE_NODE_KINDS, `narrative.nodes[${index}].kind`),
      title: text(node.title, `narrative.nodes[${index}].title`, 500),
      summary: text(node.summary, `narrative.nodes[${index}].summary`, 10_000),
      successorKeys: strings(node.successorKeys, `narrative.nodes[${index}].successorKeys`, 100, true),
    }
  })
  const nodeKeys = new Set(nodes.map(node => node.key))
  if (nodeKeys.size !== nodes.length) fail('narrative.nodes key 重复')
  const entryNodeKey = key(row.entryNodeKey, 'narrative.entryNodeKey')
  if (!nodeKeys.has(entryNodeKey)) fail('narrative.entryNodeKey 不存在')
  for (const node of nodes) for (const successor of node.successorKeys) {
    if (!nodeKeys.has(successor)) fail(`narrative 节点 ${node.key} 指向不存在节点 ${successor}`)
  }
  return {
    moduleKind: oneOf(row.moduleKind, NARRATIVE_MODULE_KINDS, 'narrative.moduleKind'),
    title: text(row.title, 'narrative.title', 500),
    entryNodeKey,
    nodes,
  }
}

export function parseTtrpgProductionSourceCatalogV1(value: unknown): TtrpgProductionSourceCatalogV1 {
  const row = object(value, 'catalog')
  exact(row, [
    'schema', 'version', 'productType', 'identity', 'title', 'summary', 'ruleProfileKey',
    'missingPolicies', 'characters', 'locations', 'artifacts', 'storyArcs', 'narrative', 'catalogHash',
  ], 'catalog')
  if (row.schema !== 'storyforge.ttrpg-production-source' || row.version !== TTRPG_PRODUCTION_SOURCE_VERSION || row.productType !== 'ttrpg') {
    fail('catalog 协议无效')
  }
  const policies = object(row.missingPolicies, 'missingPolicies')
  exact(policies, DOMAINS, 'missingPolicies')
  const missingPolicies = Object.fromEntries(DOMAINS.map(domain => [
    domain, oneOf(policies[domain], MISSING_POLICIES, `missingPolicies.${domain}`),
  ])) as Record<TtrpgProductionSourceDomainV1, TtrpgProductionSourceMissingPolicyV1>
  return {
    schema: 'storyforge.ttrpg-production-source', version: 1, productType: 'ttrpg',
    identity: parseIdentity(row.identity), title: text(row.title, 'title', 500),
    summary: text(row.summary, 'summary', 10_000),
    ruleProfileKey: oneOf(row.ruleProfileKey, ['rank-lite', 'd20-fantasy', 'd100-investigation', 'custom'] as const, 'ruleProfileKey'),
    missingPolicies,
    characters: parseRecords(row.characters, 'characters'),
    locations: parseRecords(row.locations, 'locations'),
    artifacts: parseRecords(row.artifacts, 'artifacts'),
    storyArcs: parseStoryArcs(row.storyArcs),
    narrative: parseNarrative(row.narrative),
    catalogHash: hash(row.catalogHash, 'catalogHash'),
  }
}

export async function freezeTtrpgProductionSourceCatalogV1(
  value: UnfrozenTtrpgProductionSourceCatalogV1,
): Promise<TtrpgProductionSourceCatalogV1> {
  const body = parseTtrpgProductionSourceCatalogV1({ ...value, catalogHash: '0'.repeat(64) })
  const { catalogHash: _ignored, ...canonical } = body
  return parseTtrpgProductionSourceCatalogV1({ ...canonical, catalogHash: await hashCanonicalValue(canonical) })
}

export async function assertTtrpgProductionSourceCatalogHashV1(value: unknown): Promise<TtrpgProductionSourceCatalogV1> {
  const parsed = parseTtrpgProductionSourceCatalogV1(value)
  const { catalogHash, ...body } = parsed
  if (await hashCanonicalValue(body) !== catalogHash) fail('catalogHash 不匹配')
  return parsed
}

export function parseTtrpgProductionSourceSelectionV1(value: unknown): TtrpgProductionSourceSelectionV1 {
  const row = object(value, 'selection')
  exact(row, [
    'schema', 'version', 'productType', 'sourceKey', 'sourceContentHash', 'sourceCatalogHash',
    'characterKeys', 'locationKeys', 'artifactKeys', 'storyArcKeys', 'narrativeNodeKeys', 'selectionHash',
  ], 'selection')
  if (row.schema !== 'storyforge.ttrpg-production-source-selection' || row.version !== 1 || row.productType !== 'ttrpg') {
    fail('selection 协议无效')
  }
  return {
    schema: 'storyforge.ttrpg-production-source-selection', version: 1, productType: 'ttrpg',
    sourceKey: key(row.sourceKey, 'selection.sourceKey'),
    sourceContentHash: hash(row.sourceContentHash, 'selection.sourceContentHash'),
    sourceCatalogHash: hash(row.sourceCatalogHash, 'selection.sourceCatalogHash'),
    characterKeys: strings(row.characterKeys, 'selection.characterKeys', 10_000, true),
    locationKeys: strings(row.locationKeys, 'selection.locationKeys', 10_000, true),
    artifactKeys: strings(row.artifactKeys, 'selection.artifactKeys', 10_000, true),
    storyArcKeys: strings(row.storyArcKeys, 'selection.storyArcKeys', 10_000, true),
    narrativeNodeKeys: strings(row.narrativeNodeKeys, 'selection.narrativeNodeKeys', 5_000, true),
    selectionHash: hash(row.selectionHash, 'selection.selectionHash'),
  }
}

export async function freezeTtrpgProductionSourceSelectionV1(
  value: UnfrozenTtrpgProductionSourceSelectionV1,
): Promise<TtrpgProductionSourceSelectionV1> {
  const body = parseTtrpgProductionSourceSelectionV1({ ...value, selectionHash: '0'.repeat(64) })
  const { selectionHash: _ignored, ...canonical } = body
  return parseTtrpgProductionSourceSelectionV1({ ...canonical, selectionHash: await hashCanonicalValue(canonical) })
}

export async function selectAllTtrpgProductionSourceV1(
  catalogValue: unknown,
): Promise<TtrpgProductionSourceSelectionV1> {
  const catalog = await assertTtrpgProductionSourceCatalogHashV1(catalogValue)
  return freezeTtrpgProductionSourceSelectionV1({
    schema: 'storyforge.ttrpg-production-source-selection', version: 1, productType: 'ttrpg',
    sourceKey: catalog.identity.sourceKey,
    sourceContentHash: catalog.identity.sourceContentHash,
    sourceCatalogHash: catalog.catalogHash,
    characterKeys: catalog.characters.map(row => row.sourceKey),
    locationKeys: catalog.locations.map(row => row.sourceKey),
    artifactKeys: catalog.artifacts.map(row => row.sourceKey),
    storyArcKeys: catalog.storyArcs.map(row => row.sourceKey),
    narrativeNodeKeys: catalog.narrative.nodes.map(row => row.key),
  })
}

function checkSelectedKeys(input: {
  domain: TtrpgProductionSourceDomainV1
  selected: string[]
  available: string[]
  policy: TtrpgProductionSourceMissingPolicyV1
  errors: string[]
  warnings: string[]
  generated: TtrpgProductionSourceDomainV1[]
  degraded: TtrpgProductionSourceDomainV1[]
}): void {
  const available = new Set(input.available)
  for (const selected of input.selected) if (!available.has(selected)) input.errors.push(`${input.domain} 选择不存在:${selected}`)
  if (input.selected.length) return
  if (input.policy === 'block') input.errors.push(`${input.domain} 缺失且策略为 block`)
  else if (input.policy === 'product-generate') {
    input.generated.push(input.domain); input.warnings.push(`${input.domain} 缺失，将生成 product-only 内容`)
  } else {
    input.degraded.push(input.domain); input.warnings.push(`${input.domain} 缺失，将使用文字降级`)
  }
}

export async function validateTtrpgProductionSourceSelectionV1(input: {
  catalog: unknown
  selection: unknown
}): Promise<TtrpgProductionSourceValidationV1> {
  const errors: string[] = []; const warnings: string[] = []
  const generatedDomains: TtrpgProductionSourceDomainV1[] = []; const degradedDomains: TtrpgProductionSourceDomainV1[] = []
  let catalog: TtrpgProductionSourceCatalogV1
  let selection: TtrpgProductionSourceSelectionV1
  try { catalog = await assertTtrpgProductionSourceCatalogHashV1(input.catalog) }
  catch (error) { return { valid: false, developmentOnly: true, formalPublicationEligible: false, errors: [String(error)], warnings, generatedDomains, degradedDomains } }
  try {
    selection = parseTtrpgProductionSourceSelectionV1(input.selection)
    const { selectionHash, ...body } = selection
    if (await hashCanonicalValue(body) !== selectionHash) errors.push('selectionHash 不匹配')
  } catch (error) {
    return { valid: false, developmentOnly: catalog.identity.developmentOnly, formalPublicationEligible: false, errors: [String(error)], warnings, generatedDomains, degradedDomains }
  }
  if (selection.sourceKey !== catalog.identity.sourceKey) errors.push('selection.sourceKey 与 catalog 不一致')
  if (selection.sourceContentHash !== catalog.identity.sourceContentHash) errors.push('selection.sourceContentHash 与 catalog 不一致')
  if (selection.sourceCatalogHash !== catalog.catalogHash) errors.push('selection.sourceCatalogHash 与 catalog 不一致')
  checkSelectedKeys({ domain: 'characters', selected: selection.characterKeys, available: catalog.characters.map(row => row.sourceKey), policy: catalog.missingPolicies.characters, errors, warnings, generated: generatedDomains, degraded: degradedDomains })
  checkSelectedKeys({ domain: 'locations', selected: selection.locationKeys, available: catalog.locations.map(row => row.sourceKey), policy: catalog.missingPolicies.locations, errors, warnings, generated: generatedDomains, degraded: degradedDomains })
  checkSelectedKeys({ domain: 'artifacts', selected: selection.artifactKeys, available: catalog.artifacts.map(row => row.sourceKey), policy: catalog.missingPolicies.artifacts, errors, warnings, generated: generatedDomains, degraded: degradedDomains })
  checkSelectedKeys({ domain: 'storyArcs', selected: selection.storyArcKeys, available: catalog.storyArcs.map(row => row.sourceKey), policy: catalog.missingPolicies.storyArcs, errors, warnings, generated: generatedDomains, degraded: degradedDomains })
  checkSelectedKeys({ domain: 'narrative', selected: selection.narrativeNodeKeys, available: catalog.narrative.nodes.map(row => row.key), policy: catalog.missingPolicies.narrative, errors, warnings, generated: generatedDomains, degraded: degradedDomains })
  const selectedNodes = new Set(selection.narrativeNodeKeys)
  if (selectedNodes.size && !selectedNodes.has(catalog.narrative.entryNodeKey)) errors.push('叙事选择必须包含入口节点')
  for (const node of catalog.narrative.nodes) if (selectedNodes.has(node.key)) {
    for (const successor of node.successorKeys) if (!selectedNodes.has(successor)) errors.push(`叙事选择未闭合:${node.key}->${successor}`)
  }
  const valid = errors.length === 0
  return {
    valid,
    developmentOnly: catalog.identity.developmentOnly,
    formalPublicationEligible: valid && !catalog.identity.developmentOnly && generatedDomains.length === 0 && degradedDomains.length === 0,
    errors: [...new Set(errors)], warnings: [...new Set(warnings)],
    generatedDomains: [...new Set(generatedDomains)], degradedDomains: [...new Set(degradedDomains)],
  }
}

export async function assertTtrpgProductionSourceReadyV1(input: {
  catalog: unknown
  selection: unknown
}): Promise<{ catalog: TtrpgProductionSourceCatalogV1; selection: TtrpgProductionSourceSelectionV1; validation: TtrpgProductionSourceValidationV1 }> {
  const catalog = await assertTtrpgProductionSourceCatalogHashV1(input.catalog)
  const selection = parseTtrpgProductionSourceSelectionV1(input.selection)
  const validation = await validateTtrpgProductionSourceSelectionV1({ catalog, selection })
  if (!validation.valid) fail(`来源不能进入生产:${validation.errors.join('；')}`)
  return { catalog, selection, validation }
}

export async function assertTtrpgProductionSourceMayPublishV1(input: {
  catalog: unknown
  selection: unknown
}): Promise<void> {
  const { validation } = await assertTtrpgProductionSourceReadyV1(input)
  if (!validation.formalPublicationEligible) {
    fail(validation.developmentOnly ? '开发测试来源只能构建和试玩，不能正式发布' : '来源仍有生成或降级项，不能正式发布')
  }
}

function baseNarrative(title: string, middle: Array<[string, string, string]>): TtrpgProductionSourceCatalogV1['narrative'] {
  const nodes: TtrpgProductionSourceNarrativeNodeV1[] = [
    { key: 'scene.opening', kind: 'entry', title: '开场', summary: `KP 宣布${title}开始，并给出玩家可观察的危机。`, successorKeys: [middle[0][0]] },
    ...middle.map(([nodeKey, nodeTitle, summary], index) => ({
      key: nodeKey, kind: 'scene' as const, title: nodeTitle, summary,
      successorKeys: index === middle.length - 1 ? ['ending.truth', 'ending.cost'] : [middle[index + 1][0]],
    })),
    { key: 'ending.truth', kind: 'ending', title: '揭示真相', summary: '玩家公开关键事实，并承担由此产生的关系与局势后果。', successorKeys: [] },
    { key: 'ending.cost', kind: 'ending', title: '代价延续', summary: '玩家保住眼前目标，但未解决的压力进入下一次会话。', successorKeys: [] },
  ]
  return { moduleKind: 'main', title, entryNodeKey: 'scene.opening', nodes }
}

async function createFixture(input: {
  sourceKey: TtrpgDevelopmentSourceFixtureKeyV1
  title: string
  summary: string
  ruleProfileKey: TtrpgProductionSourceCatalogV1['ruleProfileKey']
  characters: TtrpgProductionSourceRecordV1[]
  locations: TtrpgProductionSourceRecordV1[]
  artifacts: TtrpgProductionSourceRecordV1[]
  storyArcs: TtrpgProductionSourceStoryArcV1[]
  narrative: TtrpgProductionSourceCatalogV1['narrative']
  missingPolicies?: Partial<TtrpgProductionSourceCatalogV1['missingPolicies']>
}): Promise<TtrpgProductionSourceCatalogV1> {
  const sourceContentHash = await hashCanonicalValue({
    fixtureContract: 1, sourceKey: input.sourceKey, title: input.title, summary: input.summary,
    ruleProfileKey: input.ruleProfileKey, characters: input.characters, locations: input.locations,
    artifacts: input.artifacts, storyArcs: input.storyArcs, narrative: input.narrative,
  })
  return freezeTtrpgProductionSourceCatalogV1({
    schema: 'storyforge.ttrpg-production-source', version: 1, productType: 'ttrpg',
    identity: {
      sourceKind: 'development-fixture', sourceKey: input.sourceKey, sourceContentHash,
      developmentOnly: true, adapterVersion: 1, worldBinding: null,
    },
    title: input.title, summary: input.summary, ruleProfileKey: input.ruleProfileKey,
    missingPolicies: {
      characters: 'product-generate', locations: 'text-fallback', artifacts: 'product-generate',
      storyArcs: 'product-generate', narrative: 'block', ...input.missingPolicies,
    },
    characters: input.characters, locations: input.locations, artifacts: input.artifacts,
    storyArcs: input.storyArcs, narrative: input.narrative,
  })
}

export async function createTtrpgDevelopmentSourceFixtureV1(
  fixtureKey: TtrpgDevelopmentSourceFixtureKeyV1,
): Promise<TtrpgProductionSourceCatalogV1> {
  if (fixtureKey === 'rank-lite-mist-harbor') return createFixture({
    sourceKey: fixtureKey, title: 'Rank Lite · 雾港失踪信号', summary: '用于验证阶位、混合席位、线索冗余、动态压力和多结局。',
    ruleProfileKey: 'rank-lite',
    characters: [
      { sourceKey: 'character.lin-zhou', name: '林舟', description: '重视证据的 D 级调查者，导师在雾港失踪。', tags: ['player-candidate', 'investigator'] },
      { sourceKey: 'character.tide-scholar', name: '潮汐学者', description: '掌握旧港潮门结构、隐瞒一次失败试验的学者。', tags: ['npc', 'expert'] },
    ],
    locations: [{ sourceKey: 'location.mist-archive', name: '雾港档案室', description: '退潮后显露的石砌档案室，存在公开区与封锁区。', tags: ['investigation'] }],
    artifacts: [{ sourceKey: 'artifact.replaced-seal', name: '被替换的潮门印章', description: '材质与账册记录不符的关键证物。', tags: ['clue'] }],
    storyArcs: [{ sourceKey: 'arc.missing-signal', name: '失踪信号', description: '调查失踪导师与被替换印章之间的联系。', tags: ['main'], kind: 'main' }],
    narrative: baseNarrative('雾港失踪信号', [
      ['scene.archive', '封锁档案室', '玩家可从封条、潮痕和证词三条路径进入调查。'],
      ['scene.ledger', '矛盾账册', '关键失败仍会给出较弱线索，同时推进潮门压力。'],
      ['scene.confrontation', '守潮人对质', '人物依据自己的目标和已知信息回应玩家证据。'],
    ]),
  })
  if (fixtureKey === 'd20-fantasy-floodgate') return createFixture({
    sourceKey: fixtureKey, title: 'd20 Fantasy · 潮门要塞', summary: '用于验证等级、行动经济、反应、战斗/探索/社交与濒死恢复。',
    ruleProfileKey: 'd20-fantasy',
    characters: [
      { sourceKey: 'character.warden', name: '守潮骑士', description: '3 级守卫，宣誓保护潮门居民。', tags: ['player-candidate', 'martial'] },
      { sourceKey: 'character.clerk', name: '潮门书记员', description: '掌握密库钥匙，可被谈判改变立场。', tags: ['npc', 'social'] },
    ],
    locations: [{ sourceKey: 'location.floodgate-fort', name: '潮门要塞', description: '断桥、机关、外庭和密库组成的多区域据点。', tags: ['combat', 'exploration'] }],
    artifacts: [{ sourceKey: 'artifact.vault-key', name: '密库钥匙', description: '既能开启密库，也能停止一处潮汐机关。', tags: ['quest-item'] }],
    storyArcs: [{ sourceKey: 'arc.floodgate-siege', name: '要塞封锁', description: '在暴潮到来前解除封锁并选择守护对象。', tags: ['main'], kind: 'main' }],
    narrative: baseNarrative('潮门要塞', [
      ['scene.ambush', '外庭伏击', '遭遇验证先攻、行动、附赠行动、反应和资源消耗。'],
      ['scene.bridge', '断桥机关', '探索允许技能检定、物品解法与失败代价。'],
      ['scene.parley', '书记员谈判', '社交行动会改变 NPC 立场和后续遭遇。'],
      ['scene.vault', '密库决战', '规则结果、状态和已消耗资源共同决定最终反馈。'],
    ]),
  })
  if (fixtureKey === 'd100-investigation-archive') return createFixture({
    sourceKey: fixtureKey, title: 'd100 Investigation · 六证词档案', summary: '用于验证百分骰成功等级、盲骰、压力、线索冗余和调查失败前进。',
    ruleProfileKey: 'd100-investigation',
    characters: [
      { sourceKey: 'character.archivist', name: '巡回档案员', description: '调查值较高但压力承受有限的调查者。', tags: ['player-candidate', 'investigator'] },
      { sourceKey: 'character.witness', name: '退潮见证人', description: '只愿在安全条件满足后公开完整证词。', tags: ['npc', 'witness'] },
    ],
    locations: [{ sourceKey: 'location.six-testimony-archive', name: '六证词档案馆', description: '索引间、低语外廊、封印账册与潮痕密库彼此连通。', tags: ['investigation'] }],
    artifacts: [{ sourceKey: 'artifact.sixth-testimony', name: '第六份证词', description: '需要与其它两条线索交叉验证才能确认为真。', tags: ['clue', 'handout'] }],
    storyArcs: [{ sourceKey: 'arc.six-testimonies', name: '互相矛盾的六证词', description: '在压力失控前确认谁改写了档案。', tags: ['main'], kind: 'main' }],
    narrative: baseNarrative('六证词档案', [
      ['scene.index', '索引间', '普通成功提供方向，困难或极难成功提供额外关系。'],
      ['scene.corridor', '低语外廊', '盲骰结果只向 KP 展示，但玩家仍得到可行动的叙事反馈。'],
      ['scene.ledger', '封印账册', '每条关键结论至少有两条发现路径。'],
      ['scene.vault', '潮痕密库', '失败增加压力或时间代价，不永久封死调查。'],
      ['scene.witness', '见证人对质', '证据、关系和压力状态共同影响最终回应。'],
    ]),
  })
  return createFixture({
    sourceKey: fixtureKey, title: '不完整来源 · 文字降级', summary: '故意缺少角色、地点、道具和故事线，验证产品生成与文字 fallback。',
    ruleProfileKey: 'rank-lite', characters: [], locations: [], artifacts: [], storyArcs: [],
    narrative: baseNarrative('无锚点测试团', [
      ['scene.question', '未知入口', '产品必须明确标记生成内容，不能冒充冻结世界事实。'],
      ['scene.choice', '有限选择', '媒资失败时仍能以文字描述继续规则结算。'],
    ]),
    missingPolicies: { characters: 'product-generate', locations: 'text-fallback', artifacts: 'product-generate', storyArcs: 'product-generate' },
  })
}
