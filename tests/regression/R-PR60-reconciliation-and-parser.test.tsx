import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterMemoryPanel from '../../src/components/editor/ChapterMemoryPanel'
import { parseChapterOutlineOutput, parseChapterOutlineSmart } from '../../src/lib/ai/parse-outline-output'
import type { ChapterPlanReconciliation } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const reconciliation: ChapterPlanReconciliation = {
  chapterId: 1,
  sourceTextHash: 'source',
  planSourceHash: 'plan',
  schemaVersion: 1,
  extractorVersion: 'test',
  textNormalizationVersion: 'v1',
  completedGoals: [{ text: '抵达城门', evidenceQuotes: [{ quote: '城门就在眼前' }] }],
  unfinishedGoals: [{ text: '尚未入城', evidenceQuotes: [] }],
  deviations: [],
  newConstraints: [],
  nextChapterImpacts: [],
  proposedOutlineSummary: '主角抵达城门但尚未入城。',
  reviewStatus: 'pending',
  generatedAt: 1,
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('PR-60 · 逐条计划对账兼容收口', () => {
  it('逐条表格批量接受后仅通过显式保存回传作者动作', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })

    await act(async () => root.render(createElement(ChapterMemoryPanel, {
      summary: '摘要',
      hasText: true,
      memoryBusy: false,
      chapterTitle: '第一章',
      reconciliation,
      reconciliationCurrent: true,
      onGenerateMemory: vi.fn(),
      onSaveReconciliation: onSave,
      onForeshadowReconciliation: vi.fn().mockResolvedValue(undefined),
    })))

    const acceptAll = Array.from(host.querySelectorAll('button'))
      .find(item => item.textContent?.trim() === '全部接受')
    expect(acceptAll).toBeTruthy()
    await act(async () => acceptAll!.click())

    const save = Array.from(host.querySelectorAll('button'))
      .find(item => item.textContent?.trim().startsWith('保存更改'))
    expect(save).toBeTruthy()
    await act(async () => save!.click())

    expect(onSave).toHaveBeenCalledWith({
      'completedGoals:confirm': { action: 'confirm', indices: [0] },
      'unfinishedGoals:confirm': { action: 'confirm', indices: [0] },
    })
  })
})

describe('PR-60 · 旧分块解析入口', () => {
  it('兼容入口与当前确定性解析器等价，不隐藏模型修复调用', () => {
    const output = JSON.stringify([{ title: '第一章', summary: '启程' }])
    expect(parseChapterOutlineSmart(output, { apiKey: '不得使用' }))
      .toEqual(parseChapterOutlineOutput(output))
    expect(parseChapterOutlineSmart('{bad json', { apiKey: '不得使用' })).toEqual([])
  })
})
