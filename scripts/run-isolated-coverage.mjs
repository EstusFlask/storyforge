import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Vitest cleans <reportsDirectory> before a coverage run. A shared
// `coverage/.tmp` lets concurrent CI/tasks delete files that another run is
// still writing. A unique child under coverage/ is insufficient because an
// older or direct Vitest invocation can clean the whole coverage root. Keep
// each run in an OS-owned private directory outside that shared cleanup tree.
const reportsDirectory = mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-'))
const executable = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
)

const result = spawnSync(executable, [
  'run',
  '--coverage',
  // Fake IndexedDB and Dexie lifecycle tests need process isolation. Threads
  // can share enough runtime state to leave an open connection blocking the
  // next test until its timeout even though the same case takes <1s alone.
  '--pool=forks',
  // Keep two isolated fork processes. A single reused worker lets one timed-out
  // Dexie suite retain the fixed-name database lock and poison every later
  // file; fork isolation keeps those lifecycle domains independent while the
  // private coverage directory prevents reporter collisions.
  '--maxWorkers=2',
  '--minWorkers=2',
  `--coverage.reportsDirectory=${reportsDirectory}`,
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`[coverage] failed to start Vitest: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
