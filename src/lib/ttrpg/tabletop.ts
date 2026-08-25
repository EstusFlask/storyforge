import type { TtrpgTabletopMapV1 } from '../types'

export interface TtrpgTabletopPointV1 {
  x: number
  y: number
}

export interface TtrpgTabletopDistanceV1 {
  cells: number
  distance: number
  unit: string
  rule: 'square-chebyshev' | 'zone-direct'
}

function coordinate(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`[ttrpg-tabletop] ${label} 必须在 0..100`)
  }
  return value
}

/**
 * Measures normalized tabletop coordinates against the frozen map grid.
 * Square maps use one-cell diagonals (Chebyshev); zone maps use a direct
 * Euclidean estimate. The rule and unit are returned for UI/audit clarity.
 */
export function measureTtrpgTabletopDistanceV1(input: {
  map: Pick<TtrpgTabletopMapV1, 'width' | 'height' | 'grid'>
  from: TtrpgTabletopPointV1
  to: TtrpgTabletopPointV1
}): TtrpgTabletopDistanceV1 {
  const fromX = coordinate(input.from.x, 'from.x')
  const fromY = coordinate(input.from.y, 'from.y')
  const toX = coordinate(input.to.x, 'to.x')
  const toY = coordinate(input.to.y, 'to.y')
  const dx = Math.abs(toX - fromX) / 100 * input.map.width
  const dy = Math.abs(toY - fromY) / 100 * input.map.height
  const rawCells = input.map.grid.kind === 'square'
    ? Math.max(dx, dy)
    : Math.sqrt(dx * dx + dy * dy)
  const cells = Math.ceil(rawCells - Number.EPSILON)
  return {
    cells,
    distance: cells * input.map.grid.distancePerCell,
    unit: input.map.grid.unit,
    rule: input.map.grid.kind === 'square' ? 'square-chebyshev' : 'zone-direct',
  }
}
