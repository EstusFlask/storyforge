import { useEffect, useState } from 'react'
import { db } from '../lib/db/schema'
import type { Project, Work } from '../lib/types'

/** Read the real active Work; Project compatibility mirrors never infer media type. */
export function useActiveWork(project?: Project | null): Work | null {
  const [work, setWork] = useState<Work | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (project?.id == null || project.activeWorkId == null) {
        if (!cancelled) setWork(null)
        return
      }
      const row = await db.works.get(project.activeWorkId)
      if (!cancelled) setWork(row?.projectId === project.id ? row : null)
    }
    void load()
    return () => { cancelled = true }
  }, [project?.id, project?.activeWorkId, project?.updatedAt])
  return work
}
