import type {
  Character,
  CharacterRelation,
  InteractionKnowledgeSeed,
  KnowledgeLedgerEntry,
  WorkCharacterBinding,
} from '../types'

const MAX_KNOWLEDGE_CONTENT = 8_000

export interface WorldGroundedInteractionProfile {
  roleLabel: string
  voiceRules: string
  initialKnowledge: InteractionKnowledgeSeed[]
  includedCharacterFields: string[]
  relationCount: number
  cognitionCount: number
}

interface CharacterFieldSpec {
  key: keyof Character
  label: string
  importance: number
}

const PRIVATE_CHARACTER_FIELDS: CharacterFieldSpec[] = [
  { key: 'identity', label: '身份与归属', importance: 75 },
  { key: 'profile', label: '基本资料', importance: 45 },
  { key: 'personality', label: '性格', importance: 80 },
  { key: 'values', label: '价值观与信念', importance: 85 },
  { key: 'strengths', label: '优势', importance: 55 },
  { key: 'weaknesses', label: '弱点', importance: 70 },
  { key: 'fears', label: '恐惧与软肋', importance: 85 },
  { key: 'background', label: '背景经历', importance: 85 },
  { key: 'keyEvents', label: '关键经历', importance: 90 },
  { key: 'motivation', label: '核心动机', importance: 90 },
  { key: 'goals', label: '当前目标', importance: 90 },
  { key: 'innerConflict', label: '内心冲突', importance: 90 },
  { key: 'abilities', label: '能力', importance: 60 },
  { key: 'powerLevel', label: '实力定位', importance: 55 },
  { key: 'habits', label: '习惯', importance: 50 },
  { key: 'signatureItem', label: '标志性物品', importance: 55 },
  { key: 'relationships', label: '关系自述', importance: 75 },
  { key: 'arc', label: '角色成长线', importance: 90 },
  { key: 'location', label: '终局所在', importance: 75 },
  { key: 'firstAppearance', label: '首次出场', importance: 40 },
  { key: 'activeChapterRange', label: '活跃时期', importance: 45 },
  { key: 'storyRole', label: '故事作用', importance: 65 },
  { key: 'ending', label: '既有故事结局', importance: 100 },
]

function trimmed(value: unknown): string {
  if (typeof value !== 'string') return ''
  const result = value.trim()
  return result === '[]' || result === '{}' || result === 'null' ? '' : result
}

function bounded(value: string): string {
  if (value.length <= MAX_KNOWLEDGE_CONTENT) return value
  return `${value.slice(0, MAX_KNOWLEDGE_CONTENT - 20).trimEnd()}\n[内容已按角色互动上限截断]`
}

function relationContent(
  character: Character,
  relation: CharacterRelation,
  names: ReadonlyMap<number, string>,
): string | null {
  const isSource = relation.fromCharacterId === character.id
  const isTarget = relation.toCharacterId === character.id
  if (!isSource && !isTarget) return null
  const otherId = isSource ? relation.toCharacterId : relation.fromCharacterId
  const otherName = names.get(otherId) ?? `角色#${otherId}`
  const direction = isSource
    ? `${character.name}对${otherName}的关系`
    : `${otherName}对${character.name}的关系`
  const bidirectional = relation.isBidirectional ? '（双向）' : '（有方向）'
  const description = relation.description.trim()
  return `${direction}：${relation.label.trim()}${bidirectional}${description ? `。${description}` : ''}`
}

function cognitionProjection(
  entries: readonly KnowledgeLedgerEntry[],
  chapterOrder?: ReadonlyMap<number, number>,
): KnowledgeLedgerEntry[] {
  const ordered = [...entries]
    .filter(entry => entry.status === 'confirmed')
    .sort((left, right) => {
      const leftOrder = left.sourceChapterId == null ? -1 : chapterOrder?.get(left.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.sourceChapterId == null ? -1 : chapterOrder?.get(right.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.createdAt - right.createdAt || (left.id ?? 0) - (right.id ?? 0)
    })
  const current = new Map<string, KnowledgeLedgerEntry>()
  for (const entry of ordered) {
    const key = entry.knowledgeKey.trim()
    if (!key) continue
    if (entry.action === 'forget') current.delete(key)
    else current.set(key, entry)
  }
  return [...current.values()]
}

/**
 * Compile live World authoring records into the existing frozen interaction-profile
 * contract. This is deterministic authoring compilation, not an AI write. Private
 * character facts stay visible only to their owning participant at runtime.
 */
export function buildWorldGroundedInteractionProfile(input: {
  character: Character
  allCharacters: readonly Character[]
  relations: readonly CharacterRelation[]
  knowledgeEvents: readonly KnowledgeLedgerEntry[]
  workBinding?: WorkCharacterBinding | null
  chapterOrder?: ReadonlyMap<number, number>
}): WorldGroundedInteractionProfile {
  const { character } = input
  if (character.id == null) throw new Error('[chatgame] 世界角色缺少持久化 ID')
  const participantKey = `character-${character.id}`
  const names = new Map(input.allCharacters.flatMap(item => item.id == null ? [] : [[item.id, item.name] as const]))
  const initialKnowledge: InteractionKnowledgeSeed[] = []
  const includedCharacterFields: string[] = []
  const push = (seed: InteractionKnowledgeSeed) => {
    if (!seed.content.trim() || initialKnowledge.some(item => item.key === seed.key)) return
    initialKnowledge.push({ ...seed, content: bounded(seed.content.trim()) })
  }

  const shortDescription = trimmed(character.shortDescription)
  push({
    key: `profile.${participantKey}`,
    content: shortDescription || `${character.name}参与当前场景。`,
    visibility: 'public',
    importance: 50,
  })

  const visibleDescription = [
    trimmed(character.appearance) ? `外貌：${trimmed(character.appearance)}` : '',
    trimmed(character.roleWeight) ? `戏份定位：${trimmed(character.roleWeight)}` : '',
    trimmed(character.moralAxis) || trimmed(character.orderAxis)
      ? `立场：${trimmed(character.orderAxis)} / ${trimmed(character.moralAxis)}`
      : '',
  ].filter(Boolean).join('\n')
  if (visibleDescription) {
    push({
      key: `world.character.${character.id}.visible`,
      content: visibleDescription,
      visibility: 'private',
      importance: 45,
    })
    includedCharacterFields.push('appearance', 'roleWeight', 'orderAxis', 'moralAxis')
  }

  for (const spec of PRIVATE_CHARACTER_FIELDS) {
    const value = trimmed(character[spec.key])
    if (!value) continue
    push({
      key: `world.character.${character.id}.${String(spec.key)}`,
      content: `${spec.label}：${value}`,
      visibility: 'private',
      importance: spec.importance,
    })
    includedCharacterFields.push(String(spec.key))
  }

  const workProjection = [
    ['role', '本部作品中的角色作用', input.workBinding?.role, 75],
    ['arc', '本部作品中的成长线', input.workBinding?.arc, 90],
    ['outcome', '本部作品中的终局结果', input.workBinding?.outcome, 100],
  ] as const
  for (const [key, label, source, importance] of workProjection) {
    const value = trimmed(source)
    if (!value) continue
    push({
      key: `world.work-character.${input.workBinding?.workId ?? 0}.${character.id}.${key}`,
      content: `${label}：${value}`,
      visibility: 'private',
      importance,
    })
    includedCharacterFields.push(`workBinding.${key}`)
  }

  let relationCount = 0
  for (const [index, relation] of input.relations.entries()) {
    const content = relationContent(character, relation, names)
    if (!content) continue
    push({
      key: `world.relation.${relation.id ?? index}.${character.id}`,
      content,
      visibility: 'private',
      importance: 80,
    })
    relationCount += 1
  }

  const projectedKnowledge = cognitionProjection(
    input.knowledgeEvents.filter(entry => entry.characterId === character.id),
    input.chapterOrder,
  )
  for (const [index, entry] of projectedKnowledge.entries()) {
    const mistaken = entry.action === 'mislearn'
    const content = mistaken
      ? `角色对“${entry.knowledgeKey}”的当前认知是错误信念：${entry.belief?.trim() || entry.statement.trim()}。这不是世界真相。`
      : `角色已经确认知道“${entry.knowledgeKey}”：${entry.statement.trim()}`
    push({
      key: `world.cognition.${entry.id ?? index}.${character.id}`,
      content,
      visibility: 'private',
      importance: mistaken ? 75 : 85,
    })
  }

  const roleLabel = trimmed(input.workBinding?.role)
    || shortDescription
    || trimmed(character.storyRole)
    || trimmed(character.identity)
    || `${character.name}在既有故事终局后的生活角色`
  const speechStyle = trimmed(character.speechStyle)
  const voiceRules = [
    speechStyle || '保持角色既有语气、价值观和行为边界。',
    '只根据自己的私有认知、场景公开信息和亲历互动回应；不要把其他角色的秘密或世界真相自动当成自己知道的事。',
    '既有故事资料是聊天起点；新说法不能直接改写世界事实，行动结果以运行事件为准。',
  ].join('\n')

  return {
    roleLabel: bounded(roleLabel).slice(0, 500),
    voiceRules: bounded(voiceRules),
    initialKnowledge,
    includedCharacterFields: [...new Set(includedCharacterFields)],
    relationCount,
    cognitionCount: projectedKnowledge.length,
  }
}
