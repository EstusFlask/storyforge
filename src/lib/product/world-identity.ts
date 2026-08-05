import type { Project } from '../types'

export function generateWorldCode(now = Date.now(), entropy = Math.random()): string {
  const timePart = now.toString(36).toUpperCase().slice(-5).padStart(5, '0')
  const randomPart = entropy.toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')
  return `W-${timePart}-${randomPart}`
}

export function hasShareableWorldIdentity(project: Project): boolean {
  return Boolean(project.worldCode && project.worldVersion && !/^W-[A-Z0-9]{5}$/.test(project.worldCode))
}

export function withWorldIdentity(project: Project): Project {
  if (hasShareableWorldIdentity(project)) return project
  const worldCode = project.worldCode && !/^W-[A-Z0-9]{5}$/.test(project.worldCode)
    ? project.worldCode
    : generateWorldCode()
  return { ...project, worldCode, worldVersion: project.worldVersion ?? 1 }
}
