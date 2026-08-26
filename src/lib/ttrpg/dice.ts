import type { TtrpgDiceExpressionV2, TtrpgDiceRollTraceV2 } from '../types'

export const TTRPG_DIE_SIDES_MIN_V2 = 2
export const TTRPG_DIE_SIDES_MAX_V2 = 100
export const TTRPG_DICE_COUNT_MAX_V2 = 100
export const TTRPG_DICE_MODIFIER_ABS_MAX_V2 = 10_000

function fail(message: string): never {
  throw new Error(`[ttrpg-dice] ${message}`)
}

export function assertTtrpgDieSidesV2(value: unknown, label = '骰面'): number {
  if (!Number.isInteger(value) || Number(value) < TTRPG_DIE_SIDES_MIN_V2 || Number(value) > TTRPG_DIE_SIDES_MAX_V2) {
    fail(`${label}必须为 d${TTRPG_DIE_SIDES_MIN_V2}～d${TTRPG_DIE_SIDES_MAX_V2}`)
  }
  return Number(value)
}

/**
 * Closed dice-expression grammar shared by authoring import, runtime and online UI.
 * Whitespace/case are presentation-only; the persisted form is always `NdM±K`.
 */
export function parseTtrpgDiceExpressionV2(value: unknown): TtrpgDiceExpressionV2 {
  if (typeof value !== 'string') fail('骰式必须是字符串')
  const compact = value.trim().toLowerCase().replace(/\s+/g, '')
  const match = /^(\d{1,3})d(\d{1,3})(?:([+-])(\d{1,5}))?$/.exec(compact)
  if (!match) fail('只支持 NdM、NdM+K 或 NdM-K，例如 1d20+3')
  const count = Number(match[1])
  if (!Number.isInteger(count) || count < 1 || count > TTRPG_DICE_COUNT_MAX_V2) {
    fail(`单次骰子数量必须为 1～${TTRPG_DICE_COUNT_MAX_V2}`)
  }
  const sides = assertTtrpgDieSidesV2(Number(match[2]))
  const magnitude = match[4] ? Number(match[4]) : 0
  const modifier = match[3] === '-' ? -magnitude : magnitude
  if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > TTRPG_DICE_MODIFIER_ABS_MAX_V2) {
    fail(`修正值必须在 -${TTRPG_DICE_MODIFIER_ABS_MAX_V2}～${TTRPG_DICE_MODIFIER_ABS_MAX_V2}`)
  }
  return {
    schema: 'storyforge.ttrpg-dice-expression',
    version: 2,
    count,
    sides,
    modifier,
    normalized: `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`,
  }
}

/** Returns null when a uint32 sample must be rejected to avoid modulo bias. */
export function mapUint32ToTtrpgDieV2(sample: number, sidesInput: number): number | null {
  const sides = assertTtrpgDieSidesV2(sidesInput)
  if (!Number.isInteger(sample) || sample < 0 || sample > 0xffff_ffff) fail('随机样本必须是 uint32')
  const acceptedRange = Math.floor(0x1_0000_0000 / sides) * sides
  return sample < acceptedRange ? (sample % sides) + 1 : null
}

export function sampleTtrpgDiceFromUint32V2(input: {
  count: number
  sides: number
  nextUint32: (sampleIndex: number) => number
}): { dice: number[]; trace: TtrpgDiceRollTraceV2 } {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > TTRPG_DICE_COUNT_MAX_V2) {
    fail(`单次骰子数量必须为 1～${TTRPG_DICE_COUNT_MAX_V2}`)
  }
  const sides = assertTtrpgDieSidesV2(input.sides)
  const dice: number[] = []
  let consumedSamples = 0
  let rejectedSamples = 0
  while (dice.length < input.count) {
    const mapped = mapUint32ToTtrpgDieV2(input.nextUint32(consumedSamples), sides)
    consumedSamples += 1
    if (mapped == null) rejectedSamples += 1
    else dice.push(mapped)
  }
  return {
    dice,
    trace: {
      algorithm: 'uint32-rejection-v2',
      sides,
      requestedDice: input.count,
      consumedSamples,
      rejectedSamples,
    },
  }
}

export function assertTtrpgDiceRollTraceV2(value: unknown): TtrpgDiceRollTraceV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('roll trace 必须是对象')
  const row = value as Record<string, unknown>
  const expected = ['algorithm', 'consumedSamples', 'rejectedSamples', 'requestedDice', 'sides']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) fail('roll trace 字段不精确')
  if (row.algorithm !== 'uint32-rejection-v2') fail('roll trace 算法无效')
  const sides = assertTtrpgDieSidesV2(row.sides, 'roll trace 骰面')
  const requestedDice = Number(row.requestedDice)
  const consumedSamples = Number(row.consumedSamples)
  const rejectedSamples = Number(row.rejectedSamples)
  if (!Number.isInteger(requestedDice) || requestedDice < 1 || requestedDice > TTRPG_DICE_COUNT_MAX_V2
    || !Number.isInteger(consumedSamples) || consumedSamples < requestedDice
    || !Number.isInteger(rejectedSamples) || rejectedSamples < 0
    || consumedSamples !== requestedDice + rejectedSamples) {
    fail('roll trace 计数无效')
  }
  return { algorithm: 'uint32-rejection-v2', sides, requestedDice, consumedSamples, rejectedSamples }
}

export async function sampleTtrpgDiceWithSha256V2(input: {
  count: number
  sides: number
  materialForBlock: (blockIndex: number) => string
}): Promise<{ dice: number[]; trace: TtrpgDiceRollTraceV2 }> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > TTRPG_DICE_COUNT_MAX_V2) {
    fail(`单次骰子数量必须为 1～${TTRPG_DICE_COUNT_MAX_V2}`)
  }
  const sides = assertTtrpgDieSidesV2(input.sides)
  const dice: number[] = []
  let consumedSamples = 0
  let rejectedSamples = 0
  let blockIndex = 0
  const encoder = new TextEncoder()
  while (dice.length < input.count) {
    const digest = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(input.materialForBlock(blockIndex)),
    ))
    const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
    for (let offset = 0; offset <= digest.byteLength - 4 && dice.length < input.count; offset += 4) {
      const mapped = mapUint32ToTtrpgDieV2(view.getUint32(offset, false), sides)
      consumedSamples += 1
      if (mapped == null) rejectedSamples += 1
      else dice.push(mapped)
    }
    blockIndex += 1
  }
  return {
    dice,
    trace: {
      algorithm: 'uint32-rejection-v2',
      sides,
      requestedDice: input.count,
      consumedSamples,
      rejectedSamples,
    },
  }
}
