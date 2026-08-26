# CTXG-7 完成卡：Gateway 快路径、受限追加读取与正式 Skill/Runner 接缝

## 结论

- 任务：`CTXG-7`
- 状态：完成，允许进入 `CTXG-8`；本卡不宣称 Phase 1A 总门已通过，也不宣称任何业务字段已正式切换。
- 基线：`e3a8c534 feat(CTXG-6): persist exact context attempt evidence`
- 实现边界：`world-origin.worldview-field` 已以 `shadow` 冻结首份 Gateway Skill policy；正式业务 cutover 仍留给 Phase 1B 的 races canary。

## 已完成的合同与执行路径

1. `AgentSkillContextGatewayPolicyV1` 冻结 rollout、provider source、resource kinds、depths、read/token/step/planning budgets、original 权限和追加读取工具闭集；V2 execution binding 将其纳入规范 JSON 与 hash，并保持旧 snapshot 无该字段时可读。
2. Runner 新增逐运行 `allowedToolNames`：文本 JSON 系统目录只展示获授权工具，native tool schema 也只发送同一闭集；模型请求其它已登记工具仍在执行前按 protocol error 阻断。
3. Runner 新增 awaited `stopAfterToolBatch` 确定性门，供 Gateway 在每批读取后重算充分性；充分、重复/无新增证据、协议错误、step/call/token/result-token 预算耗尽均可终止，不增加新 Agent 团队。
4. `executeContextGatewayV1()` 形成统一 headless 主链：冻结 Skill Policy/session → metadata-only 全量分页目录 → selector → Mandatory Core/自动选择的 host 确定性读取 → sufficiency → 可选同 Runner 追加读取 → Trace/Packet/精确证据输入。
5. 空项目和充分的短项目走 `deterministic-fast`，追加规划模型调用和 Agent tool call 均为 0；工具或 planning model 关闭时继续确定性路径，软缺失明确进入 assumption/fallback，硬缺失始终在模型前阻断。
6. 复杂路径只在初始 `additionalRead='needed'` 且 Skill 允许时启动；Agent 只能使用四个 Gateway 工具，并共享 session 的 read-call/retrieved-token 与 Runner 的 step/model/tool/result-token/loop 预算。
7. CTXG-7 输出可直接供 CTXG-6 `recordContextGatewayPreflightEvidenceV1()` / `finalizeContextGatewayAttemptEvidenceV1()` 使用，不新增 transcript、candidate、receipt 或记忆表。
8. `assertContextGatewayCandidateAdoptableV1()` 只对显式 `rollout='required'` 的新 Skill 运行强制 V3：缺 Manifest、exact evidence 不可回读、Manifest/candidate 不匹配或 Canon/policy/source ref stale 均不可采纳；shadow/历史运行保持兼容，不伪造升级。
9. 修正充分性状态机：没有缺失义务时，无论是否允许追加工具都应为 `not-needed`；`forbidden` 仅表示硬失败或存在软缺失但不允许继续读。V3 finalize 另行检查 mandatory/conflicted，不能被 `forbidden` 掩盖。

## 关键反例

- 空项目：0 Canon resource、0 deterministic body read、0 planning model call、0 Agent tool call，得到稳定空 Context Packet。
- 短项目：启用/关闭追加工具得到相同 packet hash，不会为了“Agent 化”增加规划调用。
- 复杂项目：只有 soft-only deficit 进入 Runner；一次定点资源读取进入 `agentReads`、tool transcript 与 packet，所有计数不超过 Skill 上限。
- 越权工具：Skill 只授权 `list_context_catalog` 时，模型请求 `read_project_status` 得到 protocol error，实际工具调用为 0；系统 Prompt 也不泄露未授权工具目录。
- 强制缺失 resource key：在 planning model 前以 `hard-sufficiency` 阻断，模型调用为 0。
- Skill V2 policy JSON 被改写：binding hash 校验失败。
- `shadow` 候选不被错误要求 V3；相同 Skill 切为 `required` 后，无 V3 立即阻断。
- 真实 V3 链：CTXG-7 output 经 preflight/model/finalize/candidate 顺序后可采纳；随后修改 `worldviews.races`，同一候选以 `candidate-context-stale` 阻断。

## 回归与门禁证据

- `R-CTXG1～7`、MEMINT、Memory Settlement、项目生命周期、通用 Runner、native transport：12 files / 81 tests 通过。
- `npm run check:architecture`：通过，新增架构守卫 `㉘`，覆盖 Skill policy、双 transport allowlist、快慢路径、无平行状态与 V3 采纳门。
- required tables、AI Manual、AI entry registry、source reachability、roadmap、agent context、agent freshness、Canon coverage 已通过；AI Manual 已按新源码重新生成。
- `npx tsc --noEmit`、`npm run lint`、`npm run build`、`npm run check:bundle-size`、`git diff --check` 已通过。
- production build：3966 modules；entry 669.3 KiB / 199.4 KiB gzip，未超过 700 / 230 KiB 预算；最大 async/vendor 490.8 / 128.1 KiB gzip。
- 本单元未调用真实创作 API、未修改业务 UI，也未触碰作者当前 4178 预览数据。

## 后续边界

- `CTXG-8` 实现按 scope/provider/content/policy hash 的缓存与失效，并建立大目录、晚位资源和百万字 metadata/body 性能门。
- `GATE-P1A` 在 CTXG-8 后运行完整 CI/E2E 和 shadow read 对照；通过后才允许 Phase 1B races canary 把 `shadow` 提升为按字段 `required`。
- Phase 1B 才接入一次正式创作模型调用、真实 API、UI 候选/刷新/采纳/拒绝/stale 和标题弱权重质量评测。
