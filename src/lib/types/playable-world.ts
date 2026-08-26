import type { SimulationCanonSnapshotV1, SimulationRuntimeState } from './simulation-runtime'

export const PLAYABLE_WORLD_COMPILER_VERSION = 1 as const

export const PLAYABLE_WORLD_DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'info'] as const
export type PlayableWorldDiagnosticSeverity = typeof PLAYABLE_WORLD_DIAGNOSTIC_SEVERITIES[number]

export interface PlayableWorldDiagnosticV1 {
  code: string
  severity: PlayableWorldDiagnosticSeverity
  message: string
  sourceKeys: string[]
}
export interface PlayableWorldBundleV1 {
  schema: 'storyforge.playable-world-bundle'
  version: 1
  compilerVersion: typeof PLAYABLE_WORLD_COMPILER_VERSION
  source: {
    worldCode: string
    worldName: string
    worldContentHash: string
  }
  createdAt: number
  canonSnapshot: SimulationCanonSnapshotV1
  initialState: SimulationRuntimeState
  diagnostics: PlayableWorldDiagnosticV1[]
  bundleHash: string
}
