import { describe, expect, it } from 'vitest'
import { detectTestEnv } from '../../src/lib/safety/require-backup-before'

describe('CF-20260803 · 浏览器构建与高危操作测试环境判定', () => {
  it('只对明确的 Vitest 或 Node 测试信号放行', () => {
    expect(detectTestEnv({ vitestFlag: true })).toBe(true)
    expect(detectTestEnv({ processEnv: { VITEST: 'true' } })).toBe(true)
    expect(detectTestEnv({ processEnv: { NODE_ENV: 'test' } })).toBe(true)
  })

  it('生产浏览器和仅使用 Vite test mode 时不会误跳过安全门', () => {
    expect(detectTestEnv({})).toBe(false)
    expect(detectTestEnv({ processEnv: { NODE_ENV: 'production' } })).toBe(false)
  })
})
