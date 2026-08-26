import { describe, expect, it } from 'vitest'
import {
  computeKnownCostUsd,
  knownModelPrice,
} from '../../src/lib/ai/usage-log'

describe('CREL-2 · 费用证据不得伪造供应商价格', () => {
  it('只为显式登记价格的模型生成费用证据', () => {
    expect(knownModelPrice('deepseek-v4-flash')).toEqual({ input: 0.14, output: 0.28 })
    expect(computeKnownCostUsd('deepseek-v4-flash', 1_000_000, 1_000_000)).toBeCloseTo(0.42)
    expect(knownModelPrice('deepseek-v4-pro')).toEqual({ input: 0.435, output: 0.87 })
    expect(knownModelPrice('gemini-3.5-flash')).toEqual({ input: 1.5, output: 9 })

    expect(knownModelPrice('agnes-2.5-flash')).toBeNull()
    expect(knownModelPrice('deepseek-ai/deepseek-v4-pro')).toBeNull()
    expect(computeKnownCostUsd('agnes-2.5-flash', 2_000, 3_000)).toBeNull()
    expect(knownModelPrice('private-local-model')).toBeNull()
  })
})
