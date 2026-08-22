import { useEffect, useMemo, useState } from 'react'
import { Download, LoaderCircle, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { type ChatResult, resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { supportsVerifiedJsonObjectResponseV1 } from '../../lib/ai/provider-capabilities'
import { fetchOpenAIModels } from '../../lib/ai/model-list'
import { executeRegisteredAIEntryV1 } from '../../lib/agent/formal-ai-entry'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import {
  buildRacesGatewayBlindGraderMessagesV1,
  RACES_GATEWAY_BLIND_GRADER_PROMPT_VERSION_V9,
  RACES_GATEWAY_GRADER_TIMEOUT_MS_V9,
  RacesGatewayBlindGraderFailureV1,
  RACES_GATEWAY_GRADER_PREFLIGHT_INPUT_V3,
} from '../../lib/evals/races-gateway/protocol'
import { parseRacesGatewayBlindGradeCompletionV2 } from '../../lib/evals/races-gateway/scoring'
import {
  clearRacesGatewayEvalCheckpointV1,
  exportRacesGatewayEvalCheckpointV1,
  loadRacesGatewayEvalCheckpointV1,
  runRacesGatewayEvalV1,
  verifyRacesGatewayEvalCheckpointV1,
} from '../../lib/evals/races-gateway/runner'
import type { RacesGatewayEvalCheckpointV1 } from '../../lib/evals/races-gateway/types'
import { PROVIDER_MODELS } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'

function rate(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function downloadJson(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function RacesGatewayEvalPanel() {
  const config = useAIConfigStore(state => state.config)
  const dialog = useDialog()
  const [checkpoint, setCheckpoint] = useState<RacesGatewayEvalCheckpointV1 | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [graderModel, setGraderModel] = useState('')
  const [liveGraderModels, setLiveGraderModels] = useState<string[]>([])
  const [discoveringModels, setDiscoveringModels] = useState(false)

  const generatorConfig = useMemo(() => resolveRequestConfig(
    config,
    { category: 'agent.world-foundation.worldview-field' },
  ).config, [config])
  const graderRouteConfig = useMemo(() => resolveRequestConfig(
    config,
    { category: 'eval.race6.blind-grader' },
  ).config, [config])
  const graderOptions = useMemo(() => {
    const options = [...(PROVIDER_MODELS[graderRouteConfig.provider] ?? [])]
    const seen = new Set(options.map(option => option.value))
    for (const model of liveGraderModels) {
      if (!seen.has(model)) options.push({ value: model, label: model, desc: '服务实时返回' })
    }
    return options
  }, [graderRouteConfig.provider, liveGraderModels])
  const graderConfig = useMemo(() => ({
    ...graderRouteConfig,
    model: graderModel || graderRouteConfig.model,
  }), [graderModel, graderRouteConfig])

  useEffect(() => {
    if (checkpoint) {
      setGraderModel(checkpoint.graderIdentity.model)
      return
    }
    const preferred = graderRouteConfig.provider === 'agnes'
      ? graderOptions.find(option => option.value === 'agnes-2.5-pro')
        ?? graderOptions.find(option => option.value !== generatorConfig.model)
      : graderOptions.find(option => option.value !== generatorConfig.model)
    setGraderModel(preferred?.value ?? graderRouteConfig.model)
  }, [checkpoint, generatorConfig.model, graderOptions, graderRouteConfig.model, graderRouteConfig.provider])

  useEffect(() => {
    const stored = loadRacesGatewayEvalCheckpointV1()
    if (!stored) return
    void verifyRacesGatewayEvalCheckpointV1(stored).then(valid => {
      if (!valid) {
        setError('RACE-6 checkpoint 验签失败；请先导出浏览器存储后清除。')
        return
      }
      setCheckpoint(stored)
      setProgress(`${stored.nextIndex}/100`)
    })
  }, [])

  const refreshGraderModels = async () => {
    setDiscoveringModels(true)
    setError('')
    try {
      if (!isAIConfigReady(graderRouteConfig)) throw new Error('请先配置可用 API Key')
      const models = await fetchOpenAIModels({
        baseUrl: graderRouteConfig.baseUrl,
        apiKey: graderRouteConfig.apiKey,
        timeoutMs: 30_000,
      })
      if (!models.length) throw new Error('模型服务返回了空目录')
      setLiveGraderModels(models)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setDiscoveringModels(false)
    }
  }

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      if (!isAIConfigReady(generatorConfig) || !isAIConfigReady(graderConfig)) {
        throw new Error('RACE-6 generator 或 grader 缺少可用 API Key、Base URL 或模型')
      }
      if (generatorConfig.provider === graderConfig.provider && generatorConfig.model === graderConfig.model) {
        throw new Error('RACE-6 generator 与盲评 grader 必须使用不同模型身份')
      }
      if (checkpoint?.status === 'completed') {
        throw new Error('当前 RACE-6 冻结运行已经完成；如需新运行，请先导出后清除。')
      }
      const grade = async (input: { title: string; seedText: string; candidateText: string }) => {
          const messages = buildRacesGatewayBlindGraderMessagesV1(input)
          const result: ChatResult = {}
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), RACES_GATEWAY_GRADER_TIMEOUT_MS_V9)
          const startedAt = performance.now()
          try {
            const output = await executeRegisteredAIEntryV1(
              'eval.races-gateway.grader',
              messages,
              { ...graderConfig, temperature: 0, maxTokens: 4_096 },
              { category: 'eval.race6.blind-grader', contextOverflowPolicy: 'reject' },
              controller.signal,
              result,
              supportsVerifiedJsonObjectResponseV1(graderConfig.provider)
                ? { responseFormat: 'json_object' }
                : undefined,
            )
            const evidence = {
                provider: graderConfig.provider,
                model: graderConfig.model,
                promptVersion: RACES_GATEWAY_BLIND_GRADER_PROMPT_VERSION_V9,
                inputHash: await hashCanonicalValue(messages),
                outputHash: await hashCanonicalValue(output),
                inputTokens: result.usage?.inputTokens ?? null,
                outputTokens: result.usage?.outputTokens ?? null,
                finishReason: result.finishReason ?? null,
                durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
            }
            try {
              return { grade: parseRacesGatewayBlindGradeCompletionV2(output, result.finishReason), evidence }
            } catch (value) {
              throw new RacesGatewayBlindGraderFailureV1({
                ...evidence,
                rawOutput: output,
                parseError: value instanceof Error ? value.message : String(value),
              })
            }
          } catch (value) {
            if (controller.signal.aborted) {
              throw new Error(`RACE-6 grader 超过 ${RACES_GATEWAY_GRADER_TIMEOUT_MS_V9 / 1_000} 秒未完成严格 JSON`)
            }
            throw value
          } finally {
            clearTimeout(timeout)
          }
      }
      let graderPreflight = checkpoint?.graderPreflight
      if (!graderPreflight) {
        setProgress('grader schema preflight')
        graderPreflight = (await grade(RACES_GATEWAY_GRADER_PREFLIGHT_INPUT_V3)).evidence
      }
      const next = await runRacesGatewayEvalV1({
        modelIdentity: { provider: generatorConfig.provider, model: generatorConfig.model },
        graderIdentity: {
          provider: graderConfig.provider,
          model: graderConfig.model,
          promptVersion: RACES_GATEWAY_BLIND_GRADER_PROMPT_VERSION_V9,
        },
        graderPreflight,
        resumeFrom: checkpoint,
        grade,
        onProgress: update => {
          setCheckpoint(update.checkpoint)
          setProgress(`${update.completed}/${update.total} · ${update.fixture.id}`)
        },
      })
      setCheckpoint(next)
      setProgress(`${next.nextIndex}/100`)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
      const stored = loadRacesGatewayEvalCheckpointV1()
      if (stored && await verifyRacesGatewayEvalCheckpointV1(stored)) setCheckpoint(stored)
    } finally {
      setRunning(false)
    }
  }

  const clear = async () => {
    const confirmed = await dialog.confirm({
      title: '清除 RACE-6 评测？',
      message: '这会删除本机 checkpoint，并通过 PROJECT_TABLES 生命周期清理所有 RACE-6 隔离项目。请先导出需要保留的证据。',
      confirmText: '清除评测',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    await clearRacesGatewayEvalCheckpointV1()
    setCheckpoint(null)
    setProgress('')
    setError('')
  }

  const score = checkpoint?.score
  return (
    <section data-testid="race6-eval-panel" className="border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-medium text-text-primary">RACE-6 种族与民族金切片</h4>
          <p className="mt-1 text-[10px] text-text-muted">
            1 次 grader schema preflight + 100 例冻结 transcript/outcome；80 次生成、40 次盲评、20 次确定性攻击。每例 durable 保存，可刷新继续。
          </p>
        </div>
        <div className="flex items-center gap-1">
          {checkpoint && (
            <button
              type="button"
              title="导出签名 checkpoint"
              aria-label="导出 RACE-6"
              onClick={() => downloadJson(
                exportRacesGatewayEvalCheckpointV1(checkpoint),
                `race6-${checkpoint.checkpointHash.slice(0, 12)}.json`,
              )}
              className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          {checkpoint && !running && (
            <button
              type="button"
              title="清除 checkpoint 与隔离项目"
              aria-label="清除 RACE-6"
              onClick={() => { void clear() }}
              className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-bg-hover hover:text-error"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => { void run() }}
            disabled={running || checkpoint?.status === 'completed'
              || !isAIConfigReady(generatorConfig) || !isAIConfigReady(graderConfig)}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-400 hover:bg-violet-500/20 disabled:opacity-40"
          >
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? progress || '启动中' : checkpoint ? `继续 ${checkpoint.nextIndex}/100` : '运行冻结矩阵'}
          </button>
        </div>
      </div>
      {checkpoint && (
        <div className="mt-3 text-[11px] text-text-secondary">
          <p>
            generator {checkpoint.modelIdentity.provider}/{checkpoint.modelIdentity.model}
            {' '}· grader {checkpoint.graderIdentity.provider}/{checkpoint.graderIdentity.model}
            {' '}· {checkpoint.status} · {checkpoint.nextIndex}/100
            {' '}· 失败尝试 {checkpoint.attemptFailures.length}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-text-muted">
            checkpoint {checkpoint.checkpointHash}
          </p>
        </div>
      )}
      {!checkpoint && graderOptions.length > 0 && (
        <label className="mt-3 block text-[10px] text-text-muted">
          <span className="flex items-center justify-between gap-2">
            独立盲评模型
            <button
              type="button"
              onClick={() => { void refreshGraderModels() }}
              disabled={running || discoveringModels || !isAIConfigReady(graderRouteConfig)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-violet-400 hover:bg-violet-500/10 disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${discoveringModels ? 'animate-spin' : ''}`} />
              {discoveringModels ? '刷新中' : '刷新服务模型'}
            </button>
          </span>
          <select
            aria-label="RACE-6 独立盲评模型"
            value={graderModel || graderRouteConfig.model}
            onChange={event => setGraderModel(event.target.value)}
            disabled={running}
            className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary"
          >
            {graderOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {liveGraderModels.length > 0 && (
            <span className="mt-1 block text-[10px] text-text-muted">
              服务实时返回 {liveGraderModels.length} 个模型；只选择文本 chat/completions 模型。
            </span>
          )}
        </label>
      )}
      {score && (
        <div data-testid="race6-eval-score" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-3">
          <span>空态占位 {rate(score.emptyPlaceholderRate)}</span>
          <span>标题过锚 {rate(score.emptyTitleOveranchorRate)}</span>
          <span>空态具体 {rate(score.emptyConcreteRate)}</span>
          <span>部分约束 {rate(score.partialConstraintRate)}</span>
          <span>新增信息 {rate(score.partialNewInformationRate)}</span>
          <span>末位送达 {rate(score.lateRecallAt20)}</span>
          <span>末位使用 {rate(score.lateOutcomeUseRate)}</span>
          <span>Mandatory 送达 {rate(score.pinnedDeliveryRate)}</span>
          <span>Mandatory 保留 {rate(score.pinnedOutcomeRetentionRate)}</span>
          <span>scope 泄漏 {rate(score.scopeLeakRate)}</span>
          <span>CAS 阻断 {rate(score.casBlockRate)}</span>
          <span>Provider 失败尝试 {score.providerAttemptFailureCount}</span>
          <span>Grader 失败尝试 {score.graderAttemptFailureCount}</span>
          <span>非 Provider 失败尝试 {score.nonProviderAttemptFailureCount}</span>
          <span className={score.passed ? 'text-success' : 'text-error'}>
            {score.passed ? '门禁 PASS' : `门禁 FAIL · ${score.failures.join('、')}`}
          </span>
        </div>
      )}
      {error && <p data-testid="race6-eval-error" className="mt-2 break-words text-[11px] text-error">{error}</p>}
    </section>
  )
}
