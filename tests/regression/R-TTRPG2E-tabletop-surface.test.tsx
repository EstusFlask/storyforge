import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgTabletopSurface from '../../src/components/ttrpg/TtrpgTabletopSurface'
import type { TtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Tabletop = NonNullable<TtrpgViewerProjectionV1['tabletop']>

function playerTabletop(): Tabletop {
  return {
    mapKey: 'map.opening', title: '异常出现 · 区域图', width: 20, height: 12,
    backgroundAssetKey: null, fallbackDescription: '图片不可用时继续使用区域和距离文字。',
    grid: { kind: 'square', cellSize: 1, distancePerCell: 2, unit: '米' },
    layers: [{ layerKey: 'terrain', title: '地形', kind: 'terrain', zIndex: 0, opacity: 1, gmOnly: false, visible: true }],
    areas: [{ areaKey: 'entry', title: '入口区', x: 5, y: 55, width: 30, height: 35, gmOnly: false }],
    tokens: [
      { tokenKey: 'token.hero', entityKey: 'hero', x: 10, y: 70, size: 7, controllerKey: 'hero', hidden: false },
      { tokenKey: 'token.guide', entityKey: 'guide', x: 30, y: 70, size: 7, controllerKey: null, hidden: false },
    ],
    fog: [{ fogKey: 'fog.focus', title: null, x: 35, y: 15, width: 40, height: 55, revealed: false }],
  }
}

describe('TABLETOP-PRESENTATION-1 · shared offline/online tabletop surface', () => {
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

  it('玩家只控制自己的 token，并从同一可视桌面获得网格、距离和安全迷雾', async () => {
    const move = vi.fn(async () => undefined)
    await act(async () => root.render(createElement(TtrpgTabletopSurface, {
      tabletop: playerTabletop(), viewerRole: 'player', viewerActorKey: 'hero',
      selectedTokenKey: 'token.hero', disabled: false,
      resolveEntityName: (key: string) => ({ hero: '林舟', guide: '守潮人' })[key] ?? key,
      onSelectToken: vi.fn(), onMoveToken: move,
    })))
    expect(host.textContent).toContain('玩家安全投影')
    expect(host.textContent).toContain('未探索')
    expect(host.textContent).not.toContain('焦点区迷雾')
    expect(host.textContent).toContain('至 守潮人：8 米')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="选择 token：守潮人"]')?.disabled).toBe(true)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="token 向→移动"]')!.click())
    expect(move).toHaveBeenCalledWith({ tokenKey: 'token.hero', x: 15, y: 70, controllerKey: 'hero' })
  })

  it('GM 使用相同桌面管理隐藏 token、迷雾和图层，观战席没有控制权', async () => {
    const tabletop = playerTabletop()
    tabletop.tokens.push({ tokenKey: 'token.secret', entityKey: 'secret', x: 85, y: 20, size: 7, controllerKey: null, hidden: true })
    tabletop.areas.push({ areaKey: 'secret', title: 'GM 隐藏区', x: 80, y: 5, width: 18, height: 35, gmOnly: true })
    tabletop.layers.push({ layerKey: 'clues', title: 'GM 线索标记', kind: 'annotation', zIndex: 10, opacity: 1, gmOnly: true, visible: true })
    tabletop.fog[0].title = '焦点区迷雾'
    const fog = vi.fn(async () => undefined)
    const layer = vi.fn(async () => undefined)
    const names = (key: string) => ({ hero: '林舟', guide: '守潮人', secret: '暗影' })[key] ?? key
    await act(async () => root.render(createElement(TtrpgTabletopSurface, {
      tabletop, viewerRole: 'gm', viewerActorKey: null, selectedTokenKey: 'token.secret', disabled: false,
      resolveEntityName: names, onSelectToken: vi.fn(), onMoveToken: vi.fn(async () => undefined),
      onSetFog: fog, onSetLayer: layer,
    })))
    expect(host.textContent).toContain('GM 完整桌面')
    expect(host.textContent).toContain('GM 隐藏区')
    expect(host.textContent).toContain('焦点区迷雾')
    await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('焦点区迷雾 · 遮蔽'))!.click())
    await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('GM 线索标记'))!.click())
    expect(fog).toHaveBeenCalledWith({ fogKey: 'fog.focus', revealed: true })
    expect(layer).toHaveBeenCalledWith({ layerKey: 'clues', visible: false })

    await act(async () => root.render(createElement(TtrpgTabletopSurface, {
      tabletop: playerTabletop(), viewerRole: 'spectator', viewerActorKey: null,
      selectedTokenKey: '', disabled: false, resolveEntityName: names, onSelectToken: vi.fn(),
    })))
    expect(host.textContent).toContain('观战安全投影')
    expect(host.textContent).toContain('观战席不可控制 token')
    expect([...host.querySelectorAll<HTMLButtonElement>('button')].every(button => button.disabled)).toBe(true)
  })
})
