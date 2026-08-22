export const RACES_GATEWAY_EVAL_VERSION_V5 = 'races-gateway-eval-v5' as const
export const RACES_GATEWAY_EVAL_STORAGE_KEY_V5 = 'storyforge-races-gateway-eval-v5' as const

export type RacesGatewayEvalKindV1 =
  | 'empty'
  | 'partial-world'
  | 'late-target'
  | 'pinned-mandatory'
  | 'expand'
  | 'polish'
  | 'cross-scope-attack'
  | 'concurrent-cas'

export interface RacesGatewayEvalFixtureV1 {
  id: string
  kind: RacesGatewayEvalKindV1
  title: string
  authorRequest: string
  seedText: string
  expectedAnchor: string | null
  sourceCaseId: string | null
}

export interface RacesGatewayBlindGradeV1 {
  placeholder: boolean
  titleOveranchored: boolean
  concrete: boolean
  constraintsRespected: boolean
  addsUsefulInformation: boolean
  irrelevantMaterial: boolean
  reason: string
}

export interface RacesGatewayBlindGradeEvidenceV1 {
  provider: string
  model: string
  promptVersion: string
  inputHash: string
  outputHash: string
  inputTokens: number | null
  outputTokens: number | null
  finishReason: string | null
  durationMs: number
}

export interface RacesGatewayTranscriptArchiveV1 {
  version: 1
  encoding: 'gzip-base64'
  transcriptHash: string
  uncompressedBytes: number
  compressedBytes: number
  body: string
}

export interface RacesGatewayEvalResultV1 {
  fixtureId: string
  kind: RacesGatewayEvalKindV1
  status: 'passed' | 'failed'
  projectId: number | null
  runId: number | null
  candidateEventId: number | null
  candidateText: string
  contextManifestHash: string | null
  transcriptArchive: RacesGatewayTranscriptArchiveV1 | null
  selectedResourceKeys: string[]
  mandatoryDelivered: boolean | null
  expectedAnchorDelivered: boolean | null
  expectedAnchorInOutcome: boolean | null
  staleBlocked: boolean | null
  crossScopeBlocked: boolean | null
  grade: RacesGatewayBlindGradeV1 | null
  gradeEvidence: RacesGatewayBlindGradeEvidenceV1 | null
  error: string | null
  durationMs: number
}

export interface RacesGatewayEvalThresholdsV1 {
  emptyPlaceholderMax: number
  emptyTitleOveranchorMax: number
  emptyConcreteMin: number
  partialConstraintMin: number
  partialNewInformationMin: number
  lateRecallAt20Min: number
  lateOutcomeUseMin: number
  pinnedDeliveryMin: number
  pinnedOutcomeRetentionMin: number
  scopeLeakMax: number
  comparisonDeliveryMin: number
  casBlockMin: number
}

export interface RacesGatewayEvalScoreV1 {
  sampleCount: number
  completedCount: number
  emptyPlaceholderRate: number
  emptyTitleOveranchorRate: number
  emptyConcreteRate: number
  partialConstraintRate: number
  partialNewInformationRate: number
  lateRecallAt20: number
  lateOutcomeUseRate: number
  pinnedDeliveryRate: number
  pinnedOutcomeRetentionRate: number
  scopeLeakRate: number
  comparisonDeliveryRate: number
  casBlockRate: number
  passed: boolean
  failures: string[]
}

export interface RacesGatewayEvalCheckpointV1 {
  version: typeof RACES_GATEWAY_EVAL_VERSION_V5
  fixtureHash: string
  modelIdentity: { provider: string; model: string }
  graderIdentity: { provider: string; model: string; promptVersion: string }
  graderPreflight: RacesGatewayBlindGradeEvidenceV1
  thresholds: RacesGatewayEvalThresholdsV1
  nextIndex: number
  status: 'running' | 'completed' | 'failed'
  results: RacesGatewayEvalResultV1[]
  score: RacesGatewayEvalScoreV1 | null
  startedAt: number
  updatedAt: number
  checkpointHash: string
}

export interface RacesGatewayEvalProgressV1 {
  fixture: RacesGatewayEvalFixtureV1
  completed: number
  total: number
  checkpoint: RacesGatewayEvalCheckpointV1
}
