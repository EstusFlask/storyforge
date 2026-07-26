import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  worldAdoptCandidate: vi.fn(),
  worldRejectCandidate: vi.fn(),
  worldUpdateCandidate: vi.fn(),
  worldSubmit: vi.fn(),
  worldSetAuthorRequest: vi.fn(),
  worldCandidate: null as null | Record<string, unknown>,
  inspirationAdoptCandidate: vi.fn(),
  inspirationRejectCandidate: vi.fn(),
  inspirationUpdateCandidate: vi.fn(),
  inspirationSubmit: vi.fn(),
  inspirationSetAuthorRequest: vi.fn(),
  inspirationToggleFragment: vi.fn(),
  inspirationCandidate: null as null | Record<string, unknown>,
  characterAdoptCandidate: vi.fn(),
  characterRejectCandidate: vi.fn(),
  characterUpdateCandidate: vi.fn(),
  characterSubmit: vi.fn(),
  characterSetAuthorRequest: vi.fn(),
  characterCandidate: null as null | Record<string, unknown>,
}))

vi.mock('../../src/components/agent/useWorldOriginCopilot', () => ({
  useWorldOriginCopilot: () => ({
    authorRequest: '',
    setAuthorRequest: mocks.worldSetAuthorRequest,
    messages: [
      { id: 1, role: 'assistant', content: '生成阶段严格只读。' },
      { id: 2, role: 'user', content: '补充文明起点' },
    ],
    candidate: mocks.worldCandidate,
    busy: false,
    submit: mocks.worldSubmit,
    updateCandidate: mocks.worldUpdateCandidate,
    rejectCandidate: mocks.worldRejectCandidate,
    adoptCandidate: mocks.worldAdoptCandidate,
  }),
}))

vi.mock('../../src/components/agent/useInspirationCopilot', () => ({
  useInspirationCopilot: () => ({
    authorRequest: '',
    setAuthorRequest: mocks.inspirationSetAuthorRequest,
    selectedFragmentIds: new Set(['idea-1']),
    messages: [{ id: 1, role: 'assistant', content: '请选择已有灵感碎片。' }],
    candidate: mocks.inspirationCandidate,
    busy: false,
    loading: false,
    fragments: [{
      id: 'idea-1',
      label: '潮汐城',
      sourceKind: 'author',
      text: '退潮后城市从海床升起。',
      createdAt: 1,
    }],
    versions: [],
    mode: 'single',
    toggleFragment: mocks.inspirationToggleFragment,
    submit: mocks.inspirationSubmit,
    updateCandidate: mocks.inspirationUpdateCandidate,
    rejectCandidate: mocks.inspirationRejectCandidate,
    adoptCandidate: mocks.inspirationAdoptCandidate,
  }),
}))

vi.mock('../../src/components/agent/useCharacterCopilot', () => ({
  useCharacterCopilot: () => ({
    authorRequest: '',
    setAuthorRequest: mocks.characterSetAuthorRequest,
    messages: [{ id: 1, role: 'assistant', content: '请描述一个新角色。' }],
    candidate: mocks.characterCandidate,
    busy: false,
    submit: mocks.characterSubmit,
    updateCandidate: mocks.characterUpdateCandidate,
    rejectCandidate: mocks.characterRejectCandidate,
    adoptCandidate: mocks.characterAdoptCandidate,
  }),
}))

import ChatCopilotPanel from '../../src/components/agent/ChatCopilotPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  vi.clearAllMocks()
  mocks.worldCandidate = null
  mocks.inspirationCandidate = null
  mocks.characterCandidate = null
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AGENT-1 · ChatCopilot 确认卡片 UI', () => {
  it('显示作用域、只读边界和可编辑候选，采纳与拒绝是独立显式动作', async () => {
    mocks.worldCandidate = {
      node: {},
      draft: '潮汐退去后，第一座盐城从海床升起。',
      contextSources: ['projectStatus', 'worldview'],
      scopeKey: '1:3',
    }
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
    expect(mocks.worldUpdateCandidate).toHaveBeenCalledWith('作者编辑后的候选')

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.worldRejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.worldAdoptCandidate).toHaveBeenCalledTimes(1)
  })

  it('灵感反推只展示已保存来源，并把可见 JSON 的拒绝与保存分成显式动作', async () => {
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
    const props = {
      project,
      worldGroupId: 3,
      worldName: '盐海世界',
      onClose: vi.fn(),
    }

    await act(async () => root.render(createElement(ChatCopilotPanel, props)))
    const inspirationTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent === '灵感反推')!
    await act(async () => inspirationTab.click())

    expect(host.textContent).toContain('只读取你勾选的已保存碎片')
    expect(host.textContent).toContain('潮汐城')
    expect(host.textContent).toContain('退潮后城市从海床升起。')
    expect(host.textContent).toContain('已选 1/1')

    mocks.inspirationCandidate = {
      node: {},
      draft: '{\n  "worldOrigin": "盐海退潮"\n}',
      mode: 'single',
      diff: [{
        path: 'worldOrigin',
        before: '',
        after: '盐海退潮',
      }],
      contextSources: ['inspirationWorkspace'],
      selectedFragmentIds: ['idea-1'],
      scopeKey: '1',
      previousResult: null,
    }
    await act(async () => root.render(createElement(ChatCopilotPanel, props)))

    expect(host.textContent).toContain('待确认 · 灵感反推版本')
    expect(host.textContent).toContain('1 条来源')
    expect(host.textContent).toContain('1 项差异（最多展示 24）')
    const candidate = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="灵感反推候选 JSON"]',
    )!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(candidate, '{\n  "worldOrigin": "作者修订"\n}')
      candidate.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mocks.inspirationUpdateCandidate).toHaveBeenCalledWith(
      '{\n  "worldOrigin": "作者修订"\n}',
    )

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('保存版本'))!.click())
    expect(mocks.inspirationRejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.inspirationAdoptCandidate).toHaveBeenCalledTimes(1)
  })

  it('角色域展示当前作用域边界，并把可见 JSON 的拒绝与新增分成显式动作', async () => {
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
    const props = {
      project,
      worldGroupId: 3,
      worldName: '盐海世界',
      onClose: vi.fn(),
    }

    await act(async () => root.render(createElement(ChatCopilotPanel, props)))
    const characterTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent === '角色生成')!
    await act(async () => characterTab.click())

    expect(host.textContent).toContain('只读取当前世界观与可见角色')
    expect(host.querySelector('textarea[placeholder*="守灯人"]')).not.toBeNull()

    mocks.characterCandidate = {
      node: {},
      draft: '{\n  "name": "沈灯"\n}',
      contextSources: ['worldview', 'characters'],
      scopeKey: '1:3',
    }
    await act(async () => root.render(createElement(ChatCopilotPanel, props)))

    expect(host.textContent).toContain('待确认 · 新角色')
    expect(host.textContent).toContain('2 个上下文源')
    const candidate = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="角色候选 JSON"]',
    )!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(candidate, '{\n  "name": "作者修订角色"\n}')
      candidate.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mocks.characterUpdateCandidate).toHaveBeenCalledWith(
      '{\n  "name": "作者修订角色"\n}',
    )

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('新增角色'))!.click())
    expect(mocks.characterRejectCandidate).toHaveBeenCalledTimes(1)
    expect(mocks.characterAdoptCandidate).toHaveBeenCalledTimes(1)
  })
})
