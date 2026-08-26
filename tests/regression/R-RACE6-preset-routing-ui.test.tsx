import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RacesGatewayEvalPanel from '../../src/components/settings/RacesGatewayEvalPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import type { AIConfigPreset } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const presets: AIConfigPreset[] = [
  {
    id: 'agnes-generator',
    name: 'agnes',
    config: {
      provider: 'agnes', apiKey: 'agnes-test', baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0,
    },
  },
  {
    id: 'nvidia-grader',
    name: '英伟达',
    config: {
      provider: 'nvidia', apiKey: 'nvidia-test', baseUrl: '/nvidia-proxy/v1',
      model: 'mistralai/mistral-nemotron', temperature: 0.7, maxTokens: 0,
    },
  },
  {
    id: 'deepseek-grader',
    name: 'd\'s',
    config: {
      provider: 'deepseek', apiKey: 'deepseek-test', baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 0,
    },
  },
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  useAIConfigStore.setState({ config: presets[0].config, presets, activePresetId: 'agnes-generator' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(DialogProvider, null, createElement(RacesGatewayEvalPanel)))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('RACE-6 V21 · 跨提供商预设路由', () => {
  it('默认冻结 Agnes generator 与 DeepSeek V4 grader，而不是从当前配置手拼同提供商模型', () => {
    const generator = host.querySelector<HTMLSelectElement>('[data-testid="race6-generator-preset"]')!
    const grader = host.querySelector<HTMLSelectElement>('[data-testid="race6-grader-preset"]')!
    const graderModel = host.querySelector<HTMLSelectElement>('[aria-label="RACE-6 独立盲评模型"]')!
    const run = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('运行冻结矩阵'))!

    expect(generator.value).toBe('agnes-generator')
    expect(grader.value).toBe('deepseek-grader')
    expect(graderModel.value).toBe('deepseek-v4-flash')
    expect(run.disabled).toBe(false)
    expect(host.textContent).toContain('agnes · agnes-2.5-flash')
    expect(host.textContent).toContain("d's · deepseek-v4-flash")
  })
})
