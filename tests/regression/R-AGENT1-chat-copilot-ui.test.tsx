import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  adoptCandidate: vi.fn(),
  rejectCandidate: vi.fn(),
  updateCandidate: vi.fn(),
  submit: vi.fn(),
  setAuthorRequest: vi.fn(),
}))

vi.mock('../../src/components/agent/useWorldOriginCopilot', () => ({
  useWorldOriginCopilot: () => ({
    authorRequest: '',
    setAuthorRequest: mocks.setAuthorRequest,
    messages: [
      { id: 1, role: 'assistant', content: '生成阶段严格只读。' },
      { id: 2, role: 'user', content: '补充文明起点' },
    ],
    candidate: {
      node: {},
      draft: '潮汐退去后，第一座盐城从海床升起。',
      contextSources: ['projectStatus', 'worldview'],
      scopeKey: '1:3',
    },
    busy: false,
    submit: mocks.submit,
    updateCandidate: mocks.updateCandidate,
    rejectCandidate: mocks.rejectCandidate,
    adoptCandidate: mocks.adoptCandidate,
  }),
}))

import ChatCopilotPanel from '../../src/components/agent/ChatCopilotPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AGENT-1 · ChatCopilot 确认卡片 UI', () => {
  it('显示作用域、只读边界和可编辑候选，采纳与拒绝是独立显式动作', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    const project = {
      id: 1,
      name: '潮汐纪元',
      genre: 'fantasy',
      genres: ['fantasy'],
    } as Project

    await act(async () => root.render(createElement(ChatCopilotPanel, {
      project,
      worldGroupId: 3,
      worldName: '盐海世界',
      onClose: vi.fn(),
    })))

    expect(host.querySelector('aside')?.getAttribute('aria-label')).toBe('AI 对话副驾')
    expect(host.textContent).toContain('潮汐纪元 · 盐海世界')
    expect(host.textContent).toContain('生成阶段只读')
    expect(host.textContent).toContain('待确认 · 世界来源')
    expect(host.textContent).toContain('2 个上下文源')

    const candidate = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界来源候选"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(candidate, '作者编辑后的候选')
      candidate.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mocks.updateCandidate).toHaveBeenCalledWith('作者编辑后的候选')

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.rejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.adoptCandidate).toHaveBeenCalledTimes(1)
  })
})
