import type { RuleItemDefinitionV1, TtrpgInventoryStateV2, TtrpgItemDefinitionV2, TtrpgItemInstanceV2 } from '../types'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

export type TtrpgItemCommandV2 =
  | { commandId: string; kind: 'grant'; instanceId: string; definitionRef: string; ownerRef: string | null; locationRef: string | null; quantity: number; eventId: string }
  | { commandId: string; kind: 'remove'; instanceId: string; expectedOwnerRef: string | null; quantity: number }
  | { commandId: string; kind: 'transfer'; instanceId: string; expectedOwnerRef: string | null; destinationOwnerRef: string | null }
  | { commandId: string; kind: 'use'; instanceId: string; expectedOwnerRef: string | null; amount: number }
  | { commandId: string; kind: 'equip'; instanceId: string; expectedOwnerRef: string; slots: string[] }
  | { commandId: string; kind: 'unequip'; instanceId: string; expectedOwnerRef: string }
  | { commandId: string; kind: 'attune'; instanceId: string; expectedOwnerRef: string }
  | { commandId: string; kind: 'damage'; instanceId: string; amount: number }
  | { commandId: string; kind: 'repair'; instanceId: string; amount: number }

function fail(message: string): never {
  throw new Error(`[ttrpg-item] ${message}`)
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim()
  if (!KEY.test(result)) fail(`${label} 无效`)
  return result
}

function nullableKey(value: unknown, label: string): string | null {
  return value == null ? null : key(value, label)
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

export function parseTtrpgItemCommandV2(value: unknown): TtrpgItemCommandV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('物品命令必须是对象')
  const row = value as Record<string, unknown>
  const commandId = key(row.commandId, 'commandId')
  const instanceId = key(row.instanceId, 'instanceId')
  const kind = String(row.kind) as TtrpgItemCommandV2['kind']
  const exact = (fields: string[]) => {
    if (Object.keys(row).sort().join(',') !== fields.sort().join(',')) fail(`${kind} 命令字段不精确`)
  }
  if (kind === 'grant') {
    exact(['commandId', 'kind', 'instanceId', 'definitionRef', 'ownerRef', 'locationRef', 'quantity', 'eventId'])
    return { commandId, kind, instanceId, definitionRef: key(row.definitionRef, 'definitionRef'), ownerRef: nullableKey(row.ownerRef, 'ownerRef'), locationRef: nullableKey(row.locationRef, 'locationRef'), quantity: integer(row.quantity, 'quantity', 1, 100_000), eventId: key(row.eventId, 'eventId') }
  }
  if (kind === 'remove') {
    exact(['commandId', 'kind', 'instanceId', 'expectedOwnerRef', 'quantity'])
    return { commandId, kind, instanceId, expectedOwnerRef: nullableKey(row.expectedOwnerRef, 'expectedOwnerRef'), quantity: integer(row.quantity, 'quantity', 1, 100_000) }
  }
  if (kind === 'transfer') {
    exact(['commandId', 'kind', 'instanceId', 'expectedOwnerRef', 'destinationOwnerRef'])
    return { commandId, kind, instanceId, expectedOwnerRef: nullableKey(row.expectedOwnerRef, 'expectedOwnerRef'), destinationOwnerRef: nullableKey(row.destinationOwnerRef, 'destinationOwnerRef') }
  }
  if (kind === 'use') {
    exact(['commandId', 'kind', 'instanceId', 'expectedOwnerRef', 'amount'])
    return { commandId, kind, instanceId, expectedOwnerRef: nullableKey(row.expectedOwnerRef, 'expectedOwnerRef'), amount: integer(row.amount, 'amount', 1, 100_000) }
  }
  if (kind === 'equip') {
    exact(['commandId', 'kind', 'instanceId', 'expectedOwnerRef', 'slots'])
    if (!Array.isArray(row.slots) || !row.slots.length || row.slots.length > 20) fail('slots 无效')
    return { commandId, kind, instanceId, expectedOwnerRef: key(row.expectedOwnerRef, 'expectedOwnerRef'), slots: row.slots.map((slot, index) => key(slot, `slots[${index}]`)) }
  }
  if (kind === 'unequip' || kind === 'attune') {
    exact(['commandId', 'kind', 'instanceId', 'expectedOwnerRef'])
    return { commandId, kind, instanceId, expectedOwnerRef: key(row.expectedOwnerRef, 'expectedOwnerRef') }
  }
  if (kind === 'damage' || kind === 'repair') {
    exact(['commandId', 'kind', 'instanceId', 'amount'])
    return { commandId, kind, instanceId, amount: integer(row.amount, 'amount', 1, 100_000) }
  }
  fail('物品命令 kind 无效')
}

export function parseTtrpgItemDefinitionV2(value: unknown): TtrpgItemDefinitionV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('物品定义必须是对象')
  const row = value as Record<string, unknown>
  const expected = ['itemKey', 'title', 'category', 'tags', 'stackPolicy', 'maxStack', 'weight', 'equipSlots', 'requiresAttunement', 'maximumCharges', 'maximumDurability', 'useActions', 'publicDescription', 'secretPropertyKeys']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) fail('物品定义字段不精确')
  const text = (raw: unknown, label: string, maximum: number) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > maximum) fail(`${label} 无效`)
    return raw.trim().normalize('NFC')
  }
  const keys = (raw: unknown, label: string, maximum: number) => {
    if (!Array.isArray(raw) || raw.length > maximum) fail(`${label} 无效`)
    const result = raw.map((item, index) => key(item, `${label}[${index}]`))
    if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
    return result
  }
  const tags = Array.isArray(row.tags) ? row.tags.map((item, index) => text(item, `tags[${index}]`, 100)) : fail('tags 无效')
  if (new Set(tags).size !== tags.length || tags.length > 100) fail('tags 无效或重复')
  const stackPolicy = String(row.stackPolicy) as TtrpgItemDefinitionV2['stackPolicy']
  if (!['unique', 'stackable'].includes(stackPolicy)) fail('stackPolicy 无效')
  const maxStack = row.maxStack == null ? null : integer(row.maxStack, 'maxStack', 1, 100_000)
  if (stackPolicy === 'unique' && maxStack != null && maxStack !== 1) fail('unique 物品 maxStack 只能为 null 或 1')
  if (stackPolicy === 'stackable' && maxStack == null) fail('stackable 物品必须声明 maxStack')
  const weight = row.weight == null ? null : Number(row.weight)
  if (weight != null && (!Number.isFinite(weight) || weight < 0 || weight > 1_000_000)) fail('weight 无效')
  if (typeof row.requiresAttunement !== 'boolean') fail('requiresAttunement 无效')
  return {
    itemKey: key(row.itemKey, 'itemKey'), title: text(row.title, 'title', 300), category: key(row.category, 'category'),
    tags, stackPolicy, maxStack, weight,
    equipSlots: keys(row.equipSlots, 'equipSlots', 20), requiresAttunement: row.requiresAttunement,
    maximumCharges: row.maximumCharges == null ? null : integer(row.maximumCharges, 'maximumCharges', 0, 100_000),
    maximumDurability: row.maximumDurability == null ? null : integer(row.maximumDurability, 'maximumDurability', 1, 100_000),
    useActions: keys(row.useActions, 'useActions', 100), publicDescription: text(row.publicDescription, 'publicDescription', 10_000),
    secretPropertyKeys: keys(row.secretPropertyKeys, 'secretPropertyKeys', 100),
  }
}

export function createEmptyTtrpgInventoryV2(): TtrpgInventoryStateV2 {
  return { schema: 'storyforge.ttrpg-inventory', version: 2, items: {}, appliedCommandIds: [] }
}

export function ttrpgItemDefinitionFromRuleV1(item: RuleItemDefinitionV1): TtrpgItemDefinitionV2 {
  const mechanics = item.mechanics
  return parseTtrpgItemDefinitionV2({
    itemKey: item.key, title: item.name, category: mechanics?.category ?? 'item', tags: item.tags,
    stackPolicy: mechanics?.stackPolicy ?? 'unique', maxStack: mechanics?.maxStack ?? 1,
    weight: mechanics?.weight ?? null, equipSlots: mechanics?.equipSlots ?? [],
    requiresAttunement: mechanics?.requiresAttunement ?? false,
    maximumCharges: mechanics?.maximumCharges ?? null,
    maximumDurability: mechanics?.maximumDurability ?? null, useActions: item.grantedActionKeys,
    publicDescription: item.description, secretPropertyKeys: [],
  })
}

export function parseTtrpgInventoryStateV2(value: unknown): TtrpgInventoryStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('库存状态必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'appliedCommandIds,items,schema,version'
    || row.schema !== 'storyforge.ttrpg-inventory' || row.version !== 2
    || !row.items || typeof row.items !== 'object' || Array.isArray(row.items)
    || !Array.isArray(row.appliedCommandIds) || row.appliedCommandIds.length > 100_000) fail('库存状态无效')
  const appliedCommandIds = row.appliedCommandIds.map((item, index) => key(item, `appliedCommandIds[${index}]`))
  if (new Set(appliedCommandIds).size !== appliedCommandIds.length) fail('库存命令记录重复')
  const items: Record<string, TtrpgItemInstanceV2> = {}
  const rawItems = row.items as Record<string, unknown>
  if (Object.keys(rawItems).length > 100_000) fail('物品实例过多')
  for (const [instanceKey, raw] of Object.entries(rawItems)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`物品实例 ${instanceKey} 无效`)
    const item = raw as Record<string, unknown>
    const expected = ['itemInstanceId', 'definitionRef', 'ownerRef', 'containerRef', 'locationRef', 'quantity', 'charges', 'durability', 'equippedSlots', 'attunedToActorRef', 'identification', 'acquiredByEventId', 'customName', 'stateTags']
    if (Object.keys(item).sort().join(',') !== expected.sort().join(',')) fail(`物品实例 ${instanceKey} 字段不精确`)
    const itemInstanceId = key(item.itemInstanceId, 'itemInstanceId')
    if (itemInstanceId !== instanceKey) fail(`物品实例索引不一致:${instanceKey}`)
    const stringArray = (input: unknown, label: string) => {
      if (!Array.isArray(input) || input.length > 100) fail(`${label} 无效`)
      const result = input.map((value, index) => key(value, `${label}[${index}]`))
      if (new Set(result).size !== result.length) fail(`${label} 重复`)
      return result
    }
    const identification = String(item.identification) as TtrpgItemInstanceV2['identification']
    if (!['unknown', 'partly-known', 'identified'].includes(identification)) fail('identification 无效')
    items[instanceKey] = {
      itemInstanceId, definitionRef: key(item.definitionRef, 'definitionRef'),
      ownerRef: nullableKey(item.ownerRef, 'ownerRef'), containerRef: nullableKey(item.containerRef, 'containerRef'),
      locationRef: nullableKey(item.locationRef, 'locationRef'), quantity: integer(item.quantity, 'quantity', 1, 100_000),
      charges: item.charges == null ? null : integer(item.charges, 'charges', 0, 100_000),
      durability: item.durability == null ? null : integer(item.durability, 'durability', 0, 100_000),
      equippedSlots: stringArray(item.equippedSlots, 'equippedSlots'),
      attunedToActorRef: nullableKey(item.attunedToActorRef, 'attunedToActorRef'), identification,
      acquiredByEventId: key(item.acquiredByEventId, 'acquiredByEventId'),
      customName: item.customName == null ? null : String(item.customName).trim().normalize('NFC'),
      stateTags: stringArray(item.stateTags, 'stateTags'),
    }
    if ((items[instanceKey].customName?.length ?? 0) > 300) fail('customName 过长')
  }
  return { schema: 'storyforge.ttrpg-inventory', version: 2, items, appliedCommandIds }
}

function assertInventory(value: TtrpgInventoryStateV2): void {
  parseTtrpgInventoryStateV2(value)
}

export function applyTtrpgItemCommandV2(input: {
  state: TtrpgInventoryStateV2
  definitions: Record<string, TtrpgItemDefinitionV2>
  command: TtrpgItemCommandV2
}): { state: TtrpgInventoryStateV2; changedItemIds: string[]; replayed: boolean } {
  assertInventory(input.state)
  const command = parseTtrpgItemCommandV2(input.command)
  const commandId = command.commandId
  if (input.state.appliedCommandIds.includes(commandId)) {
    return { state: structuredClone(input.state), changedItemIds: [], replayed: true }
  }
  const definitions = Object.fromEntries(Object.entries(input.definitions).map(([definitionKey, definition]) => {
    const parsed = parseTtrpgItemDefinitionV2(definition)
    if (definitionKey !== parsed.itemKey) fail(`物品定义索引不一致:${definitionKey}`)
    return [definitionKey, parsed]
  }))
  const state = structuredClone(input.state)
  const instanceId = command.instanceId
  if (command.kind === 'grant') {
    if (state.items[instanceId]) fail('物品实例已经存在')
    const definitionRef = command.definitionRef
    const definition = definitions[definitionRef]
    if (!definition) fail('物品定义不存在')
    const quantity = integer(command.quantity, 'quantity', 1, definition.maxStack ?? 1)
    state.items[instanceId] = {
      itemInstanceId: instanceId, definitionRef,
      ownerRef: command.ownerRef, containerRef: null,
      locationRef: command.locationRef, quantity,
      charges: definition.maximumCharges, durability: definition.maximumDurability,
      equippedSlots: [], attunedToActorRef: null, identification: 'identified',
      acquiredByEventId: command.eventId, customName: null, stateTags: [],
    }
  } else {
    const item = state.items[instanceId]
    if (!item) fail('物品实例不存在')
    const definition = definitions[item.definitionRef]
    if (!definition) fail('物品实例引用未知定义')
    if ('expectedOwnerRef' in command
      && item.ownerRef !== command.expectedOwnerRef) fail('物品所有者已变化，拒绝并发或过期命令')
    if (command.kind === 'remove') {
      const quantity = integer(command.quantity, 'quantity', 1, item.quantity)
      if (quantity === item.quantity) delete state.items[instanceId]
      else item.quantity -= quantity
    } else if (command.kind === 'transfer') {
      item.ownerRef = command.destinationOwnerRef
      item.containerRef = null; item.locationRef = null; item.equippedSlots = []; item.attunedToActorRef = null
    } else if (command.kind === 'use') {
      const amount = command.amount
      if (item.charges != null) {
        if (item.charges < amount) fail('物品充能不足')
        item.charges -= amount
      } else {
        if (item.quantity < amount) fail('物品数量不足')
        item.quantity -= amount
        if (item.quantity === 0) delete state.items[instanceId]
      }
    } else if (command.kind === 'equip') {
      const slots = command.slots
      if (!slots.length || new Set(slots).size !== slots.length || slots.some(slot => !definition.equipSlots.includes(slot))) {
        fail('装备槽位无效')
      }
      const occupied = Object.values(state.items).some(other => other.itemInstanceId !== instanceId
        && other.ownerRef === item.ownerRef && other.equippedSlots.some(slot => slots.includes(slot)))
      if (occupied) fail('装备槽位已被占用')
      if (definition.requiresAttunement && item.attunedToActorRef !== item.ownerRef) fail('物品尚未与所有者绑定')
      item.equippedSlots = slots
    } else if (command.kind === 'unequip') {
      item.equippedSlots = []
    } else if (command.kind === 'attune') {
      if (!definition.requiresAttunement) fail('物品不需要绑定')
      item.attunedToActorRef = item.ownerRef
    } else if (command.kind === 'damage') {
      if (item.durability == null) fail('物品没有耐久规则')
      item.durability = Math.max(0, item.durability - command.amount)
      if (item.durability === 0 && !item.stateTags.includes('broken')) item.stateTags.push('broken')
    } else if (command.kind === 'repair') {
      if (item.durability == null || definition.maximumDurability == null) fail('物品没有耐久规则')
      item.durability = Math.min(definition.maximumDurability, item.durability + command.amount)
      if (item.durability > 0) item.stateTags = item.stateTags.filter(tag => tag !== 'broken')
    }
  }
  state.appliedCommandIds.push(commandId)
  if (state.appliedCommandIds.length > 100_000) fail('物品幂等记录达到上限，需要压缩检查点')
  return { state, changedItemIds: [instanceId], replayed: false }
}

export function inventoryItemsForOwnerV2(state: TtrpgInventoryStateV2, ownerRef: string): TtrpgItemInstanceV2[] {
  const owner = key(ownerRef, 'ownerRef')
  return Object.values(state.items).filter(item => item.ownerRef === owner).map(item => structuredClone(item))
}
