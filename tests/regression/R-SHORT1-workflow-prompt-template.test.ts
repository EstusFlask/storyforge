import { describe, expect, it } from 'vitest'
import {
  promptTemplateMatchesProject,
  resolveNovelPromptMode,
} from '../../src/lib/ai/prompt-variable-bindings'
import { buildOfficialAuthoringTemplate } from '../../src/lib/node-authoring/templates'
import { secondaryNovelWorkflowModules } from '../../src/lib/novel/workflow'
import type { Project, PromptTemplate, Work } from '../../src/lib/types'

const project = {
  id: 1,
  name: 'Profile Prompt',
  genres: ['other'],
  status: 'drafting',
  targetWordCount: 100_000,
} as Project

describe('SHORT-1 · 声明式工作流、Prompt 与节点模板', () => {
  it('长篇保持完整导航，短篇仅默认折叠可恢复的进阶模块', () => {
    expect(secondaryNovelWorkflowModules('long').size).toBe(0)
    const short = secondaryNovelWorkflowModules('short')
    expect(short.has('world-overview')).toBe(true)
    expect(short.has('state-table')).toBe(true)
    expect(short.has('info')).toBe(false)
    expect(short.has('outline')).toBe(false)
    expect(short.has('chapters-list')).toBe(false)
  })

  it('显式 Work Profile 优先，旧 Work 才回退历史字数启发式', () => {
    expect(resolveNovelPromptMode({ kind: 'novel', novelProfile: 'short' }, project)).toBe('short')
    expect(resolveNovelPromptMode({ kind: 'novel', novelProfile: 'long' }, { targetWordCount: 10_000 })).toBe('long')
    expect(resolveNovelPromptMode({} as Work, project)).toBe('medium')
    expect(() => resolveNovelPromptMode({ kind: 'comic', novelProfile: null }, project)).toThrow('非小说')
  })

  it('非小说 Work 无法匹配小说模板', () => {
    const template = {
      name: '短篇模板',
      applicability: { lengthModes: ['short'] },
    } as PromptTemplate
    expect(promptTemplateMatchesProject(template, project, { kind: 'novel', novelProfile: 'short' } as Work)).toBe(true)
    expect(promptTemplateMatchesProject(template, project, { kind: 'screenplay', novelProfile: null } as Work)).toBe(false)
  })

  it('短篇节点模板按目标字数和作者章数参数化，不再固定 3×1,800', () => {
    const lower = buildOfficialAuthoringTemplate('short-novel', { targetWordCount: 5_000 })
    const custom = buildOfficialAuthoringTemplate('short-novel', { targetWordCount: 25_000, preferredChapterCount: 10 })
    const value = (graph: typeof lower, templateId: string) => graph.nodes.find(node => node.templateId === templateId)?.config.value
    expect(value(lower, 'control.volume-count')).toBe(1)
    expect(value(lower, 'control.chapter-count')).toBe(2)
    expect(value(lower, 'control.word-count')).toBe(2_500)
    expect(value(custom, 'control.chapter-count')).toBe(10)
    expect(value(custom, 'control.word-count')).toBe(2_500)
  })
})
