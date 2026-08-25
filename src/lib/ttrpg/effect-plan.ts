import type {
  TtrpgDegreeV2,
  TtrpgEffectAudienceV2,
  TtrpgEffectPlanV2,
  TtrpgEffectPrimitiveV2,
} from '../types'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const DEGREES = new Set<TtrpgDegreeV2>([
  'critical-success', 'extreme-success', 'hard-success', 'success',
  'partial-success', 'failure', 'critical-failure',
])

function fail(message: string): never {
  throw new Error(`[ttrpg-effect-plan] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(row: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(row).sort().join(',')
  if (actual !== [...expected].sort().join(',')) fail(`${label} 字段不精确:${actual}`)
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!KEY.test(result)) fail(`${label} 不是稳定引用`)
  return result
}

function nullableKey(value: unknown, label: string): string | null {
  return value == null ? null : key(value, label)
}

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail(`${label} 为空或过长`)
  return result
}

function finite(value: unknown, label: string, minimum = -1_000_000, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} 数值无效`)
  }
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label} 必须是整数`)
  return result
}

function operation<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 无效`)
  return value as T
}

function parseEffect(value: unknown, index: number): TtrpgEffectPrimitiveV2 {
  const label = `effects[${index}]`
  const row = object(value, label)
  const family = operation(row.family, ['numeric', 'condition', 'item', 'ability', 'advancement', 'social', 'story'] as const, `${label}.family`)
  const effectKey = key(row.effectKey, `${label}.effectKey`)
  const targetRef = key(row.targetRef, `${label}.targetRef`)
  if (family === 'numeric') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'valueKey', 'amount'], label)
    return {
      effectKey, family, targetRef,
      operation: operation(row.operation, ['resource.gain', 'resource.spend', 'resource.set', 'damage', 'healing', 'stress', 'currency'] as const, `${label}.operation`),
      valueKey: key(row.valueKey, `${label}.valueKey`),
      amount: finite(row.amount, `${label}.amount`),
    }
  }
  if (family === 'condition') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'conditionKey', 'stacks', 'duration'], label)
    const parsedOperation = operation(row.operation, ['condition.apply', 'condition.remove'] as const, `${label}.operation`)
    const stacks = integer(row.stacks, `${label}.stacks`, 0, 100)
    if (parsedOperation === 'condition.apply' && stacks < 1) fail(`${label}.stacks 应用条件时必须大于零`)
    return {
      effectKey, family, operation: parsedOperation, targetRef,
      conditionKey: key(row.conditionKey, `${label}.conditionKey`), stacks,
      duration: row.duration == null ? null : integer(row.duration, `${label}.duration`, 1, 10_000),
    }
  }
  if (family === 'item') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'itemDefinitionRef', 'itemInstanceRef', 'destinationRef', 'amount'], label)
    const parsedOperation = operation(row.operation, ['item.grant', 'item.remove', 'item.transfer', 'item.use', 'item.damage', 'item.repair', 'item.equip'] as const, `${label}.operation`)
    const itemDefinitionRef = nullableKey(row.itemDefinitionRef, `${label}.itemDefinitionRef`)
    const itemInstanceRef = nullableKey(row.itemInstanceRef, `${label}.itemInstanceRef`)
    const destinationRef = nullableKey(row.destinationRef, `${label}.destinationRef`)
    if (parsedOperation === 'item.grant' ? itemDefinitionRef == null : itemInstanceRef == null) {
      fail(`${label} 缺少对应物品定义或实例引用`)
    }
    if (parsedOperation === 'item.transfer' && destinationRef == null) fail(`${label} 转移缺少 destinationRef`)
    return {
      effectKey, family, operation: parsedOperation, targetRef,
      itemDefinitionRef, itemInstanceRef, destinationRef,
      amount: integer(row.amount, `${label}.amount`, 1, 100_000),
    }
  }
  if (family === 'ability') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'abilityKey', 'amount', 'clockRef'], label)
    const parsedOperation = operation(row.operation, ['ability.unlock', 'ability.disable', 'usage.consume', 'usage.restore', 'usage.reset', 'cooldown.start', 'cooldown.clear'] as const, `${label}.operation`)
    const amount = row.amount == null ? null : integer(row.amount, `${label}.amount`, 0, 100_000)
    const clockRef = nullableKey(row.clockRef, `${label}.clockRef`)
    if (['usage.consume', 'usage.restore'].includes(parsedOperation) && (amount == null || amount < 1)) {
      fail(`${label} 次数变更缺少正 amount`)
    }
    if (parsedOperation === 'cooldown.start' && clockRef == null) fail(`${label} 冷却启动缺少 clockRef`)
    return { effectKey, family, operation: parsedOperation, targetRef, abilityKey: key(row.abilityKey, `${label}.abilityKey`), amount, clockRef }
  }
  if (family === 'advancement') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'advancementKey', 'amount'], label)
    return {
      effectKey, family, targetRef,
      operation: operation(row.operation, ['xp', 'milestone', 'level', 'rank', 'attribute-points', 'skill-points', 'advancement.choice'] as const, `${label}.operation`),
      advancementKey: key(row.advancementKey, `${label}.advancementKey`),
      amount: finite(row.amount, `${label}.amount`),
    }
  }
  if (family === 'social') {
    exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'socialKey', 'amount'], label)
    return {
      effectKey, family, targetRef,
      operation: operation(row.operation, ['reputation', 'faction', 'relationship', 'wanted', 'debt'] as const, `${label}.operation`),
      socialKey: key(row.socialKey, `${label}.socialKey`), amount: finite(row.amount, `${label}.amount`),
    }
  }
  exact(row, ['effectKey', 'family', 'operation', 'targetRef', 'storyKey', 'value'], label)
  const storyValue = row.value
  if (storyValue != null && !['string', 'number', 'boolean'].includes(typeof storyValue)) fail(`${label}.value 必须是标量`)
  if (typeof storyValue === 'number' && !Number.isFinite(storyValue)) fail(`${label}.value 数值无效`)
  if (typeof storyValue === 'string' && storyValue.length > 10_000) fail(`${label}.value 过长`)
  return {
    effectKey, family, targetRef,
    operation: operation(row.operation, ['clue.discover', 'secret.reveal', 'quest.set', 'clock.advance', 'location.set', 'world-fact.candidate'] as const, `${label}.operation`),
    storyKey: key(row.storyKey, `${label}.storyKey`),
    value: storyValue as string | number | boolean | null,
  }
}

export function parseTtrpgEffectPlanV2(value: string | unknown): TtrpgEffectPlanV2 {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const root = object(raw, 'effectPlan')
  exact(root, ['schema', 'version', 'planKey', 'degree', 'sourceEventId', 'ruleRef', 'reason', 'audience', 'idempotencyKey', 'status', 'effects'], 'effectPlan')
  if (root.schema !== 'storyforge.ttrpg-effect-plan' || root.version !== 2) fail('schema/version 无效')
  if (!DEGREES.has(root.degree as TtrpgDegreeV2)) fail('degree 无效')
  const audience = text(root.audience, 'audience', 220)
  if (!['public', 'party', 'gm'].includes(audience) && !/^actor:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(audience)) {
    fail('audience 无效')
  }
  const status = operation(root.status, ['immediate', 'pending-choice'] as const, 'status')
  if (!Array.isArray(root.effects) || root.effects.length > 100) fail('effects 必须是有界数组')
  const effects = root.effects.map(parseEffect)
  if (new Set(effects.map(effect => effect.effectKey)).size !== effects.length) fail('effectKey 不允许重复')
  if (status === 'immediate' && !effects.length) fail('即时 EffectPlan 不得为空')
  if (status === 'pending-choice' && effects.length < 2) fail('待选择 EffectPlan 至少需要两个互斥选项')
  return {
    schema: 'storyforge.ttrpg-effect-plan', version: 2,
    planKey: key(root.planKey, 'planKey'), degree: root.degree as TtrpgDegreeV2,
    sourceEventId: key(root.sourceEventId, 'sourceEventId'), ruleRef: key(root.ruleRef, 'ruleRef'),
    reason: text(root.reason, 'reason'), audience: audience as TtrpgEffectAudienceV2,
    idempotencyKey: key(root.idempotencyKey, 'idempotencyKey'), status, effects,
  }
}

export function assertDegreeEffectPlansDifferV2(plans: TtrpgEffectPlanV2[]): void {
  const byDegree = new Map<TtrpgDegreeV2, string>()
  for (const raw of plans) {
    const plan = parseTtrpgEffectPlanV2(raw)
    const mechanical = JSON.stringify(plan.effects)
    const prior = byDegree.get(plan.degree)
    if (prior != null && prior !== mechanical) fail(`同一成功等级 ${plan.degree} 存在冲突效果`)
    byDegree.set(plan.degree, mechanical)
  }
  const successful = [...byDegree.entries()].filter(([degree]) => degree !== 'failure' && degree !== 'critical-failure')
  if (new Set(successful.map(([, mechanical]) => mechanical)).size !== successful.length) {
    fail('不同成功等级必须产生不同机械效果，不能只更换叙述')
  }
}
