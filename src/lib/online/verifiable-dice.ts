import { hashCanonicalValue } from '../agent/run/hash'
import { parseTtrpgDiceExpressionV2, sampleTtrpgDiceWithSha256V2 } from '../ttrpg/dice'
import type { TtrpgDiceExpressionV2, TtrpgDiceRollTraceV2 } from '../types'

export interface OnlineDiceCommitmentSeriesV1 {
  schema: 'storyforge.online-dice-commitments'
  version: 1
  algorithm: 'sha256-sequential-seed-v1'
  roomId: string
  releaseHash: string
  commitments: string[]
  rootHash: string
}

export interface OnlineDiceReceiptV1 {
  schema: 'storyforge.online-dice-receipt'
  version: 1
  algorithm: 'sha256-sequential-seed-v1'
  roomId: string
  releaseHash: string
  rollIndex: number
  expression: string
  dice: number[]
  modifier: number
  total: number
  rollTrace: TtrpgDiceRollTraceV2
  seed: string
  commitment: string
  commitmentRootHash: string
}

export interface OnlineDiceServerCheckpointV1 {
  schema: 'storyforge.online-dice-server-checkpoint'
  version: 1
  roomId: string
  releaseHash: string
  seeds: string[]
  nextRollIndex: number
}

function fail(message: string): never {
  throw new Error(`[online-dice] ${message}`)
}

function secureSeed(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseExpression(expression: string): TtrpgDiceExpressionV2 {
  try {
    return parseTtrpgDiceExpressionV2(expression)
  } catch (cause) {
    fail(cause instanceof Error ? cause.message.replace(/^\[ttrpg-dice\]\s*/, '') : '骰式无效')
  }
}

async function seedCommitment(input: {
  roomId: string
  releaseHash: string
  rollIndex: number
  seed: string
}): Promise<string> {
  return hashCanonicalValue(input)
}

async function deterministicDice(input: {
  seed: string
  roomId: string
  releaseHash: string
  rollIndex: number
  expression: TtrpgDiceExpressionV2
}): Promise<{ dice: number[]; trace: TtrpgDiceRollTraceV2 }> {
  return sampleTtrpgDiceWithSha256V2({
    count: input.expression.count,
    sides: input.expression.sides,
    materialForBlock: counter => `${input.seed}\u0000${input.roomId}\u0000${input.releaseHash}\u0000${input.rollIndex}\u0000${input.expression.normalized}\u0000${counter}`,
  })
}

export class VerifiableOnlineDiceV1 {
  private nextRollIndex: number

  private constructor(
    readonly commitments: OnlineDiceCommitmentSeriesV1,
    private readonly seeds: string[],
    nextRollIndex = 0,
  ) {
    this.nextRollIndex = nextRollIndex
  }

  static async create(input: {
    roomId: string
    releaseHash: string
    maximumRolls?: number
  }): Promise<VerifiableOnlineDiceV1> {
    const maximumRolls = input.maximumRolls ?? 1_024
    if (!Number.isInteger(maximumRolls) || maximumRolls < 1 || maximumRolls > 100_000) {
      fail('承诺数量必须为 1～100000')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.roomId)) fail('roomId 无效')
    if (!/^[0-9a-f]{64}$/.test(input.releaseHash)) fail('releaseHash 无效')
    const seeds = Array.from({ length: maximumRolls }, secureSeed)
    const commitments = await Promise.all(seeds.map((seed, rollIndex) => seedCommitment({
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      rollIndex,
      seed,
    })))
    const rootHash = await hashCanonicalValue({
      algorithm: 'sha256-sequential-seed-v1',
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      commitments,
    })
    return new VerifiableOnlineDiceV1({
      schema: 'storyforge.online-dice-commitments',
      version: 1,
      algorithm: 'sha256-sequential-seed-v1',
      roomId: input.roomId,
      releaseHash: input.releaseHash,
      commitments,
      rootHash,
    }, seeds)
  }

  static async restore(checkpoint: OnlineDiceServerCheckpointV1): Promise<VerifiableOnlineDiceV1> {
    if (checkpoint.schema !== 'storyforge.online-dice-server-checkpoint' || checkpoint.version !== 1
      || !Array.isArray(checkpoint.seeds) || checkpoint.seeds.some(seed => !/^[0-9a-f]{64}$/.test(seed))
      || !Number.isInteger(checkpoint.nextRollIndex) || checkpoint.nextRollIndex < 0
      || checkpoint.nextRollIndex > checkpoint.seeds.length) {
      fail('服务端骰子检查点无效')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(checkpoint.roomId)
      || !/^[0-9a-f]{64}$/.test(checkpoint.releaseHash)) fail('服务端骰子检查点身份无效')
    const commitments = await Promise.all(checkpoint.seeds.map((seed, rollIndex) => seedCommitment({
      roomId: checkpoint.roomId,
      releaseHash: checkpoint.releaseHash,
      rollIndex,
      seed,
    })))
    const rootHash = await hashCanonicalValue({
      algorithm: 'sha256-sequential-seed-v1',
      roomId: checkpoint.roomId,
      releaseHash: checkpoint.releaseHash,
      commitments,
    })
    return new VerifiableOnlineDiceV1({
      schema: 'storyforge.online-dice-commitments',
      version: 1,
      algorithm: 'sha256-sequential-seed-v1',
      roomId: checkpoint.roomId,
      releaseHash: checkpoint.releaseHash,
      commitments,
      rootHash,
    }, structuredClone(checkpoint.seeds), checkpoint.nextRollIndex)
  }

  async roll(expression: string): Promise<OnlineDiceReceiptV1> {
    const parsed = parseExpression(expression)
    const rollIndex = this.nextRollIndex
    const seed = this.seeds[rollIndex]
    if (!seed) fail('房间预承诺骰子已经用完，必须显式续签新的承诺系列')
    const resolved = await deterministicDice({
      seed,
      roomId: this.commitments.roomId,
      releaseHash: this.commitments.releaseHash,
      rollIndex,
      expression: parsed,
    })
    this.nextRollIndex += 1
    return {
      schema: 'storyforge.online-dice-receipt',
      version: 1,
      algorithm: 'sha256-sequential-seed-v1',
      roomId: this.commitments.roomId,
      releaseHash: this.commitments.releaseHash,
      rollIndex,
      expression: parsed.normalized,
      dice: resolved.dice,
      modifier: parsed.modifier,
      total: resolved.dice.reduce((total, value) => total + value, parsed.modifier),
      rollTrace: resolved.trace,
      seed,
      commitment: this.commitments.commitments[rollIndex],
      commitmentRootHash: this.commitments.rootHash,
    }
  }

  exportServerCheckpoint(): OnlineDiceServerCheckpointV1 {
    return {
      schema: 'storyforge.online-dice-server-checkpoint',
      version: 1,
      roomId: this.commitments.roomId,
      releaseHash: this.commitments.releaseHash,
      seeds: structuredClone(this.seeds),
      nextRollIndex: this.nextRollIndex,
    }
  }
}

export async function verifyOnlineDiceReceiptV1(input: {
  commitments: OnlineDiceCommitmentSeriesV1
  receipt: OnlineDiceReceiptV1
}): Promise<boolean> {
  const { commitments, receipt } = input
  if (commitments.schema !== 'storyforge.online-dice-commitments' || commitments.version !== 1
    || receipt.schema !== 'storyforge.online-dice-receipt' || receipt.version !== 1
    || commitments.algorithm !== receipt.algorithm
    || commitments.roomId !== receipt.roomId || commitments.releaseHash !== receipt.releaseHash
    || commitments.rootHash !== receipt.commitmentRootHash
    || commitments.commitments[receipt.rollIndex] !== receipt.commitment) return false
  const rootHash = await hashCanonicalValue({
    algorithm: commitments.algorithm,
    roomId: commitments.roomId,
    releaseHash: commitments.releaseHash,
    commitments: commitments.commitments,
  })
  if (rootHash !== commitments.rootHash) return false
  const commitment = await seedCommitment({
    roomId: receipt.roomId,
    releaseHash: receipt.releaseHash,
    rollIndex: receipt.rollIndex,
    seed: receipt.seed,
  })
  if (commitment !== receipt.commitment) return false
  let parsed: TtrpgDiceExpressionV2
  try {
    parsed = parseExpression(receipt.expression)
  } catch {
    return false
  }
  const resolved = await deterministicDice({
    seed: receipt.seed,
    roomId: receipt.roomId,
    releaseHash: receipt.releaseHash,
    rollIndex: receipt.rollIndex,
    expression: parsed,
  })
  return JSON.stringify(resolved.dice) === JSON.stringify(receipt.dice)
    && receipt.modifier === parsed.modifier
    && receipt.total === resolved.dice.reduce((total, value) => total + value, parsed.modifier)
    && JSON.stringify(receipt.rollTrace) === JSON.stringify(resolved.trace)
}
