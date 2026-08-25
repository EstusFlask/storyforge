import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgCampaignProposalSelector from '../../src/components/ttrpg/TtrpgCampaignProposalSelector'
import { createAuthorGuidedTtrpgCampaignDesignV2 } from '../../src/lib/ttrpg/campaign-proposal'
import type { TtrpgCampaignDesignV2 } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const WORLD_HASH = 'a'.repeat(64)

function design(): TtrpgCampaignDesignV2 {
  return createAuthorGuidedTtrpgCampaignDesignV2({
    sourceWorldContentHash: WORLD_HASH,
    title: '雾港信号',
    background: '暴潮前雾港封锁。',
    coreConflict: '公开真相还是先保护居民',
    opening: '失踪船队发来求救信号。',
    structure: 'sandbox',
    sourceRefs: [`world:${WORLD_HASH}`, 'location:mist-harbor'],
  })
}

describe('TTRPG-3N · campaign proposal compare/mix/lock UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('比较三种真实结构，锁定分区不会被切换基底覆盖，修改后必须重新确认', async () => {
    let latest = design()
    const generate = vi.fn()
    function Harness() {
      const [value, setValue] = useState(latest)
      return createElement(TtrpgCampaignProposalSelector, {
        value,
        onChange: next => { latest = next; setValue(next) },
        onGenerateAi: generate,
        aiReady: true,
      })
    }
    await act(async () => root.render(createElement(Harness)))

    expect(host.textContent).toContain('证据网')
    expect(host.textContent).toContain('阵营压力')
    expect(host.textContent).toContain('升级危机')
    expect(host.textContent).toContain(`world:${WORLD_HASH}`)
    expect([...host.querySelectorAll('article')]).toHaveLength(3)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '生成 AI 提案')?.hasAttribute('disabled')).toBe(false)
    const regenerateSecrets = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '只重生成秘密')!
    expect(regenerateSecrets.disabled).toBe(false)
    await act(async () => regenerateSecrets.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(generate).toHaveBeenCalledWith(['secrets'])

    const fronts = host.querySelector<HTMLSelectElement>('[aria-label="Front / 压力来源提案"]')!
    await act(async () => {
      fronts.value = 'proposal.faction-pressure'
      fronts.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const frontSection = fronts.closest('[data-proposal-section="fronts"]')!
    await act(async () => frontSection.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(latest.selection.sectionSources.fronts).toBe('proposal.faction-pressure')
    expect(latest.selection.lockedSections).toContain('fronts')
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Front / 压力来源提案"]')!.disabled).toBe(true)

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.textContent === '设为基底')[2].click())
    expect(latest.selection.baseProposalKey).toBe('proposal.escalating-crisis')
    expect(latest.selection.sectionSources.background).toBe('proposal.escalating-crisis')
    expect(latest.selection.sectionSources.fronts).toBe('proposal.faction-pressure')

    const confirm = [...host.querySelectorAll('label')]
      .find(label => label.textContent?.includes('确认采用当前提案混合'))!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => confirm.click())
    expect(latest.selection.confirmed).toBe(true)
    const notes = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        notes,
        '保留阵营 Front，但把危机作为基底。',
      )
      notes.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(latest.selection.authorNotes).toContain('保留阵营')
    expect(latest.selection.confirmed).toBe(false)
  })
})
