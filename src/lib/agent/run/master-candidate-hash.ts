import type { MasterCandidatePayload } from '../orchestrator'
import { resolveAgentSkillV1 } from '../skill-registry'
import { isContextGatewayRequiredForWriteTargetV1 } from '../../context-gateway/skill-policy'
import { hashCanonicalValue } from './hash'

export function masterCandidateWriteTargetV1(payload: MasterCandidatePayload): string | undefined {
  if (payload.skillId === 'world-origin.worldview-field' && payload.worldviewField) {
    return `worldviews.${payload.worldviewField}`
  }
  return undefined
}

export function isMasterCandidateContextGatewayRequiredV1(
  payload: MasterCandidatePayload,
): boolean {
  return isContextGatewayRequiredForWriteTargetV1(
    resolveAgentSkillV1(payload.agentId, payload.skillId),
    masterCandidateWriteTargetV1(payload),
  )
}

/**
 * Required-Gateway candidates cannot include contextManifestHash in their own
 * identity: ContextManifestV3 already binds candidateHash, so including the
 * manifest hash would form an unsatisfiable hash cycle.
 */
export async function computeMasterCandidateHashV1(
  payload: MasterCandidatePayload,
  draft: string,
): Promise<string> {
  const { candidateHash: _candidateHash, ...withoutCandidateHash } = payload
  if (!isMasterCandidateContextGatewayRequiredV1(payload)) {
    return hashCanonicalValue({ draft, payload: withoutCandidateHash })
  }
  const { contextManifestHash: _contextManifestHash, ...gatewayPayload } = withoutCandidateHash
  return hashCanonicalValue({ draft, payload: gatewayPayload })
}
