import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'

function seedDigest(): string {
  return createHash('sha256').update(JSON.stringify(SYSTEM_PROMPT_SEEDS)).digest('hex')
}

describe('AUDIT-6 · 提示词领域拆分完整性', () => {
  it('聚合后的模板数量、顺序和内容保持逐字段一致', () => {
    expect(SYSTEM_PROMPT_SEEDS).toHaveLength(86)
    // WORLD-1 Phase 35-b：世界观抽取契约由合并的政经文化字段拆为政治/经济/文化三字段。
    expect(seedDigest()).toBe('0e48abe9262498a2cc02693a1d827ad91aee1d9bcb2b6476f4ef47024c3e2019')
  })
})
