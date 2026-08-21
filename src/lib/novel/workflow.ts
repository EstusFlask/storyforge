import type { NovelWorkflowProfile } from '../types/world-ownership'
import type { SidebarModule } from '../../components/layout/sidebar-tree'

export interface NovelWorkflowStep {
  id: SidebarModule
  profiles: NovelWorkflowProfile[]
  visibility: 'primary' | 'secondary' | 'hidden'
  prerequisites: SidebarModule[]
}

/**
 * Declarative short-profile overrides only. The long workflow remains the
 * existing NAV_TREE verbatim, which protects its labels and ordering.
 */
export const SHORT_NOVEL_WORKFLOW_OVERRIDES: readonly NovelWorkflowStep[] = Object.freeze([
  { id: 'info', profiles: ['short'], visibility: 'primary', prerequisites: [] },
  { id: 'inspiration', profiles: ['short'], visibility: 'primary', prerequisites: ['info'] },
  { id: 'story-design', profiles: ['short'], visibility: 'primary', prerequisites: ['inspiration'] },
  { id: 'characters', profiles: ['short'], visibility: 'primary', prerequisites: ['story-design'] },
  { id: 'rules', profiles: ['short'], visibility: 'primary', prerequisites: ['story-design'] },
  { id: 'outline', profiles: ['short'], visibility: 'primary', prerequisites: ['story-design'] },
  { id: 'chapters-list', profiles: ['short'], visibility: 'primary', prerequisites: ['outline'] },
  { id: 'world-overview', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'world-rules', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'worldview-origin', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'worldview-natural', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'worldview-humanity', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'history', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'world-map', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'characters-minor', profiles: ['short'], visibility: 'secondary', prerequisites: ['characters'] },
  { id: 'characters-npc', profiles: ['short'], visibility: 'secondary', prerequisites: ['characters'] },
  { id: 'characters-extra', profiles: ['short'], visibility: 'secondary', prerequisites: ['characters'] },
  { id: 'character-driven-plot', profiles: ['short'], visibility: 'secondary', prerequisites: ['characters'] },
  { id: 'foreshadow', profiles: ['short'], visibility: 'secondary', prerequisites: ['outline'] },
  { id: 'locations', profiles: ['short'], visibility: 'secondary', prerequisites: [] },
  { id: 'state-table', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
  { id: 'inventory', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
  { id: 'fact-library', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
  { id: 'story-timeline', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
  { id: 'cultivation-progress', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
  { id: 'scene-verify', profiles: ['short'], visibility: 'secondary', prerequisites: ['chapters-list'] },
])

export function secondaryNovelWorkflowModules(profile: NovelWorkflowProfile): Set<SidebarModule> {
  if (profile === 'long') return new Set()
  return new Set(SHORT_NOVEL_WORKFLOW_OVERRIDES
    .filter(step => step.profiles.includes(profile) && step.visibility === 'secondary')
    .map(step => step.id))
}
