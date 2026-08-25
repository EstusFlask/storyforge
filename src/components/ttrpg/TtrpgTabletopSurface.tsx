import { MapPinned } from 'lucide-react'
import { measureTtrpgTabletopDistanceV1 } from '../../lib/ttrpg/tabletop'
import type { TtrpgViewerProjectionV1 } from '../../lib/ttrpg/viewer-projection'

type Tabletop = NonNullable<TtrpgViewerProjectionV1['tabletop']>

export default function TtrpgTabletopSurface(props: {
  tabletop: Tabletop
  viewerRole: 'gm' | 'player' | 'spectator'
  viewerActorKey: string | null
  selectedTokenKey: string
  disabled: boolean
  resolveEntityName: (entityKey: string) => string
  onSelectToken: (tokenKey: string) => void
  onMoveToken?: (input: { tokenKey: string; x: number; y: number; controllerKey: string | null }) => Promise<void>
  onSetFog?: (input: { fogKey: string; revealed: boolean }) => Promise<void>
  onSetLayer?: (input: { layerKey: string; visible: boolean }) => Promise<void>
  testId?: string
  label?: string
}) {
  const canControl = (controllerKey: string | null) => props.viewerRole === 'gm'
    || (props.viewerRole === 'player' && !!props.viewerActorKey && controllerKey === props.viewerActorKey)
  const selected = props.tabletop.tokens.find(token => token.tokenKey === props.selectedTokenKey && canControl(token.controllerKey))
    ?? props.tabletop.tokens.find(token => canControl(token.controllerKey))
    ?? null
  const canMove = !!selected && canControl(selected.controllerKey) && !!props.onMoveToken
  const move = async (dx: number, dy: number) => {
    if (!selected || !props.onMoveToken) return
    await props.onMoveToken({
      tokenKey: selected.tokenKey,
      x: Math.max(0, Math.min(100, selected.x + dx)),
      y: Math.max(0, Math.min(100, selected.y + dy)),
      controllerKey: selected.controllerKey,
    })
  }

  return <section className="rounded border border-border bg-bg-base p-3" data-testid={props.testId ?? 'ttrpg-tabletop'} aria-label={props.label ?? '战术桌面'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><MapPinned className="h-4 w-4 text-accent" />{props.tabletop.title}</div><p className="mt-1 text-[10px] text-text-muted">{props.tabletop.grid.kind === 'square' ? '方格' : '区域'} · 每格 {props.tabletop.grid.distancePerCell} {props.tabletop.grid.unit} · {props.tabletop.width}×{props.tabletop.height}</p></div>
      <span className="rounded bg-bg-surface px-2 py-1 text-[10px] text-text-muted">{props.viewerRole === 'gm' ? 'GM 完整桌面' : props.viewerRole === 'player' ? '玩家安全投影' : '观战安全投影'}</span>
    </div>
    <div className="relative mt-3 aspect-[5/3] min-h-[260px] overflow-hidden rounded-lg border border-border bg-[#101820]" style={{
      backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px),radial-gradient(circle at 45% 40%,rgba(120,160,150,.18),transparent 55%)',
      backgroundSize: `${100 / props.tabletop.width}% ${100 / props.tabletop.height}%,${100 / props.tabletop.width}% ${100 / props.tabletop.height}%,auto`,
    }}>
      {props.tabletop.areas.map(area => <div key={area.areaKey} className={`absolute rounded border ${area.gmOnly ? 'border-dashed border-warning/70 bg-warning/5 text-warning' : 'border-accent/35 bg-accent/5 text-text-secondary'}`} style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}><span className="absolute left-1 top-1 rounded bg-bg-base/80 px-1 text-[9px]">{area.title}</span></div>)}
      {props.tabletop.fog.filter(fog => !fog.revealed).map(fog => <div key={fog.fogKey} className="absolute z-20 grid place-items-center border border-white/10 bg-slate-950/90 text-[9px] text-slate-400" style={{ left: `${fog.x}%`, top: `${fog.y}%`, width: `${fog.width}%`, height: `${fog.height}%` }}>{props.viewerRole === 'gm' ? fog.title ?? '迷雾' : '未探索'}</div>)}
      {props.tabletop.tokens.map(token => {
        const selectedToken = selected?.tokenKey === token.tokenKey
        const name = props.resolveEntityName(token.entityKey)
        const selectable = canControl(token.controllerKey)
        return <button key={token.tokenKey} type="button" disabled={!selectable || props.disabled} aria-pressed={selectedToken} aria-label={`选择 token：${name}`} onClick={() => props.onSelectToken(token.tokenKey)} className={`absolute z-30 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[10px] font-semibold shadow-lg ${selectedToken ? 'border-white bg-accent text-white' : token.hidden ? 'border-dashed border-warning bg-slate-900 text-warning' : 'border-accent/70 bg-bg-surface text-text-primary'} disabled:opacity-70`} style={{ left: `${token.x}%`, top: `${token.y}%`, width: `${Math.max(28, token.size * 5)}px`, height: `${Math.max(28, token.size * 5)}px` }} title={`${name}${token.hidden ? '（GM 隐藏）' : ''}`}>{name.slice(0, 1)}</button>
      })}
    </div>
    <p className="mt-2 text-[10px] leading-4 text-text-muted">{props.tabletop.fallbackDescription}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="token 移动控制">
      <span className="text-[10px] text-text-muted">{selected ? `已选：${props.resolveEntityName(selected.entityKey)}` : props.viewerRole === 'spectator' ? '观战席不可控制 token' : '选择可控制 token'}</span>
      {([['↑', 0, -5], ['←', -5, 0], ['↓', 0, 5], ['→', 5, 0]] as const).map(([label, dx, dy]) => <button key={label} type="button" disabled={props.disabled || !canMove} onClick={() => void move(dx, dy)} className="h-7 w-8 rounded border border-border text-xs text-text-secondary disabled:opacity-40" aria-label={`token 向${label}移动`}>{label}</button>)}
    </div>
    {selected && <div className="mt-2 flex flex-wrap gap-1" aria-label="token 距离">{props.tabletop.tokens.filter(token => token.tokenKey !== selected.tokenKey).map(token => {
      const measured = measureTtrpgTabletopDistanceV1({ map: props.tabletop, from: selected, to: token })
      return <span key={token.tokenKey} className="rounded bg-bg-surface px-2 py-1 text-[9px] text-text-muted">至 {props.resolveEntityName(token.entityKey)}：{measured.distance} {measured.unit}</span>
    })}</div>}
    {props.viewerRole === 'gm' && <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div><strong className="text-[10px] text-text-secondary">图层</strong><div className="mt-1 flex flex-wrap gap-1">{props.tabletop.layers.map(layer => <button key={layer.layerKey} type="button" disabled={props.disabled || !props.onSetLayer} aria-pressed={layer.visible} onClick={() => void props.onSetLayer?.({ layerKey: layer.layerKey, visible: !layer.visible })} className={`rounded border px-2 py-1 text-[9px] ${layer.visible ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>{layer.title}{layer.gmOnly ? ' · GM' : ''}</button>)}</div></div>
      <div><strong className="text-[10px] text-text-secondary">迷雾</strong><div className="mt-1 flex flex-wrap gap-1">{props.tabletop.fog.map(fog => <button key={fog.fogKey} type="button" disabled={props.disabled || !props.onSetFog} aria-pressed={fog.revealed} onClick={() => void props.onSetFog?.({ fogKey: fog.fogKey, revealed: !fog.revealed })} className={`rounded border px-2 py-1 text-[9px] ${fog.revealed ? 'border-success text-success' : 'border-border text-text-muted'}`}>{fog.title ?? '迷雾'} · {fog.revealed ? '已揭示' : '遮蔽'}</button>)}</div></div>
    </div>}
  </section>
}
