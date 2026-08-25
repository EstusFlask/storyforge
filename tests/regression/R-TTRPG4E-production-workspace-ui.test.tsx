import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgProductionWorkspace from '../../src/components/ttrpg/TtrpgProductionWorkspace'
import { db } from '../../src/lib/db/schema'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function byTestId<T extends Element>(host: ParentNode, testId: string): T {
  const row = host.querySelector<T>(`[data-testid="${testId}"]`)
  if (!row) throw new Error(`找不到 testId:${testId}`)
  return row
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 8_000) {
    try { await act(async () => { await assertion() }); return }
    catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

describe('R-TTRPG-4E · product production workspace UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })

  it('作者从冻结开发来源完成 Brief、Build 并启动真实试玩桌', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '跑团制作 UI', genre: 'mystery', genres: ['mystery'], status: 'drafting',
      description: '', targetWordCount: 100_000, createdAt: now, updatedAt: now,
    } as never) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const onSessionCreated = vi.fn()
    await act(async () => root.render(createElement(TtrpgProductionWorkspace, {
      scope: owned.scope, worldGroupId: null, onSessionCreated,
    })))

    await waitFor(() => expect(byTestId<HTMLButtonElement>(host, 'ttrpg-freeze-source').disabled).toBe(false))
    await act(async () => byTestId<HTMLButtonElement>(host, 'ttrpg-freeze-source').click())
    await waitFor(() => {
      expect(byTestId(host, 'ttrpg-source-summary').textContent).toContain('d100-investigation')
      expect(host.textContent).toContain('后续修改不会偷读世界引擎活动工作表')
    })

    const reviewStep = host.querySelector<HTMLButtonElement>('[aria-label="步骤 9 审查确认"]')!
    await act(async () => reviewStep.click())
    const confirmation = [...host.querySelectorAll('label')]
      .find(label => label.textContent?.includes('确认世界边界、数值映射'))!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => confirmation.click())
    expect(byTestId<HTMLButtonElement>(host, 'ttrpg-confirm-brief').disabled).toBe(false)

    await act(async () => byTestId<HTMLButtonElement>(host, 'ttrpg-confirm-brief').click())
    await waitFor(() => {
      expect(host.textContent).toContain('Brief 已作为新 revision 冻结')
      expect(byTestId<HTMLButtonElement>(host, 'ttrpg-build-preview').disabled).toBe(false)
    })
    await act(async () => byTestId<HTMLButtonElement>(host, 'ttrpg-build-preview').click())
    await waitFor(() => {
      expect(host.textContent).toContain('可以开桌试玩')
      expect(byTestId<HTMLButtonElement>(host, 'ttrpg-start-preview').disabled).toBe(false)
    })
    expect(await db.ttrpgProductionBuilds.count()).toBe(1)
    expect(byTestId(host, 'ttrpg-production-media-ledger').textContent).toContain('生产媒资账本')
    expect(await db.ttrpgProductionMediaAssets.count()).toBeGreaterThan(0)
    expect(await db.ttrpgProductReleases.count()).toBe(0)

    await act(async () => byTestId<HTMLButtonElement>(host, 'ttrpg-start-preview').click())
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(expect.any(Number)))
    const sessionId = onSessionCreated.mock.calls[0][0] as number
    expect(await db.simulationSessions.get(sessionId)).toMatchObject({
      kind: 'ttrpg', ttrpgBuildId: expect.any(Number), gameBuildId: null,
      gameReleaseId: null, worldReleaseId: null,
    })
  })
})
