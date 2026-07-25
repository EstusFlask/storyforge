import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'

function seedDigest(): string {
  return createHash('sha256').update(JSON.stringify(SYSTEM_PROMPT_SEEDS)).digest('hex')
}

describe('AUDIT-6 · 提示词领域拆分完整性', () => {
  it('聚合后的模板数量、顺序和内容保持逐字段一致', () => {
    expect(SYSTEM_PROMPT_SEEDS).toHaveLength(86)
    // WORLD-1 Phase 35-c：带证据候选、稳定分类目录及可缓存的固定提示词前缀契约。
    expect(seedDigest()).toBe('027bf067dd838a8203a3f8a696b25b95e5988a8794dbce9e9000017cac326cb4')
  })

  it('分块导入把固定分类目录放在变化的块序号和滚动上下文之前，保留可缓存前缀', () => {
    const template = SYSTEM_PROMPT_SEEDS.find(seed => seed.moduleKey === 'import.parse-chunk')!
    const catalogAt = template.systemPrompt.indexOf('{{codexCategoryCatalog}}')
    const chunkAt = template.systemPrompt.indexOf('{{chunkIndex}}')
    const contextAt = template.systemPrompt.indexOf('{{knownContext}}')
    expect(catalogAt).toBeGreaterThan(0)
    expect(catalogAt).toBeLessThan(chunkAt)
    expect(catalogAt).toBeLessThan(contextAt)
  })
})
