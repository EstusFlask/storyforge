/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import HarnessEvidencePanel from '../../src/components/agent/HarnessEvidencePanel'
import { buildSettledHarnessLifecycleEvidenceV1 } from '../../src/lib/agent/harness-evidence'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('R-WEH0G · 作者可见 Harness 证据面板', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('显示逐来源交付、字符/token、修订/Manifest/候选/采纳和终态回执', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const contextEvidence = {
      profile: 'balanced' as const,
      included: ['worldview', 'characters'],
      omitted: [],
      trimmed: [],
      sourceEvidence: [
        {
          key: 'worldview',
          status: 'included' as const,
          delivery: 'full' as const,
          sourceHash: HASH_A,
          originalCharacters: 1200,
          inputCharacters: 1200,
          originalTokens: 600,
          inputTokens: 600,
        },
        {
          key: 'characters',
          status: 'included' as const,
          delivery: 'truncated' as const,
          sourceHash: HASH_B,
          originalCharacters: 8000,
          inputCharacters: 2000,
          originalTokens: 4000,
          inputTokens: 1000,
        },
      ],
      estimatedInputTokens: 1600,
      inputBudgetTokens: 2000,
    }
    const lifecycle = buildSettledHarnessLifecycleEvidenceV1({
      pending: {
        version: 1,
        runId: 9,
        candidateEventId: 12,
        contentRevisionHash: HASH_A,
        contextManifestHash: HASH_B,
        candidateHash: HASH_A,
        contextEvidence,
        stages: [
          { id: 'author-edits-saved', label: '作者编辑已保存', status: 'passed', detail: '内容修订向量已冻结' },
          { id: 'context-frozen', label: '上下文已冻结', status: 'passed', detail: 'Context Manifest 已绑定' },
          { id: 'candidate-persisted', label: '候选已持久化', status: 'passed', detail: '候选事件 #12' },
          { id: 'adoptable', label: '候选可采纳', status: 'passed', detail: '等待作者确认' },
          { id: 'terminal-verified', label: '终态已验证', status: 'pending', detail: '等待采纳' },
        ],
      },
      adoptionHash: HASH_B,
      terminal: 'passed',
      terminalReceiptHash: HASH_A,
      terminalDetail: '确定性终验已签发回执',
    })

    await act(async () => {
      root.render(<HarnessEvidencePanel contextEvidence={contextEvidence} lifecycle={lifecycle} />)
    })
    const text = host.textContent ?? ''
    expect(text).toContain('查看本次实际输入证据 · 2 个来源 · Harness 运行证据')
    expect(text).toContain('全文')
    expect(text).toContain('确定性截断')
    expect(text).toContain('1,200 → 1,200')
    expect(text).toContain('8,000 → 2,000')
    expect(text).toContain('内容修订')
    expect(text).toContain('Context Manifest')
    expect(text).toContain('采纳')
    expect(text).toContain('终态回执')
    expect(text).toContain('终态已验证')

    await act(async () => root.unmount())
  })
})
