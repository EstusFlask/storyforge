export type ScreenplayCharacterExtension = 'V.O.' | 'O.S.' | 'O.C.' | "CONT'D"

export type ScreenplayBlock =
  | { id: string; type: 'action'; text: string }
  | { id: string; type: 'character'; characterId?: number | null; name: string; extension?: ScreenplayCharacterExtension; dualDialogue?: boolean }
  | { id: string; type: 'parenthetical'; text: string }
  | { id: string; type: 'dialogue'; text: string }
  | { id: string; type: 'transition'; text: string }
  | { id: string; type: 'shot'; text: string }
  | { id: string; type: 'note'; text: string }

export type ScreenplaySceneStatus = 'card' | 'draft' | 'reviewed' | 'locked'

export interface ScreenplayScene {
  id?: number
  projectId: number
  workId: number
  adaptationProjectId: number
  stableKey: string
  planSectionKey: string
  episodeNumber: number
  sceneNumber: number
  order: number
  intExt: 'INT' | 'EXT' | 'INT_EXT'
  location: string
  timeOfDay: string
  summary: string
  estimatedSeconds: number
  sourceUnitIds: number[]
  sourceReviewManifestVersion: number
  blocks: ScreenplayBlock[]
  status: ScreenplaySceneStatus
  revision: number
  createdAt: number
  updatedAt: number
}
