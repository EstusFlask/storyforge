import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  ComicMediaAsset,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  ComicVisualSubjectDesignV1,
  MediaRightsV1,
} from '../../lib/types'

export type ComicPageGroup = { page: ComicPage; panels: ComicPanel[] }

export const EMPTY_COMIC_SUBJECT_DESIGN: ComicVisualSubjectDesignV1 = {
  description: '',
  silhouette: '',
  facialFeatures: '',
  hairAndCostume: '',
  palette: [],
  materials: [],
  distinguishingMarks: [],
  prohibitedChanges: [],
}

export interface ComicSubjectDraft {
  stableKey: string
  kind: ComicVisualSubject['kind']
  characterId: number | null
  locationRefKey: string | null
  label: string
  design: ComicVisualSubjectDesignV1
  sourceUnitIds: number[]
  status: ComicVisualSubject['status']
}

export type ComicStudioAction = (
  action: () => Promise<unknown>,
  success?: string,
) => Promise<void>

export type StateSetter<T> = Dispatch<SetStateAction<T>>
export type ComicRequestAbortRef = MutableRefObject<AbortController | null>

export interface ComicRightsState {
  declaration: string
  setDeclaration: StateSetter<string>
  commercialUse: MediaRightsV1['commercialUse']
  setCommercialUse: StateSetter<MediaRightsV1['commercialUse']>
  redistribution: MediaRightsV1['redistribution']
  setRedistribution: StateSetter<MediaRightsV1['redistribution']>
}

export type SelectComicAsset = (asset: ComicMediaAsset, subject?: boolean) => void
export type RemoveComicAsset = (asset: ComicMediaAsset) => Promise<void>
