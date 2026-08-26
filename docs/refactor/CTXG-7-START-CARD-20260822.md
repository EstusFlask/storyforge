# CTXG-7 开工卡：Gateway 快路径、受限追加读取与正式 Skill/Runner 接缝

## 任务与完成边界

- 任务 ID：`CTXG-7`
- 基线：`e3a8c534 feat(CTXG-6): persist exact context attempt evidence`
- 分支：`refactor/world-engine-harness`
- 目标：把 CTXG-3～6 的 Canon 目录、确定性 selector、四个 Gateway 工具与 V3 attempt evidence 组织成一条可由正式 Skill 冻结授权的执行路径；空/短项目不增加检索规划模型调用，复杂项目只能在充分性报告要求时执行有限追加读取。
- 非范围：本单元不切换任何业务字段的正式生成 UI，不建立缓存/持久化目录，也不宣称 Phase 1A 已通过。`CTXG-8` 负责缓存与百万字目录性能；`RACE-1～6` 才切换“种族与民族”金切片。

## 重新审计结论

1. `runReadOnlyAgent()` 已有 step、tool、token、结果 token、协议错误和重复调用硬门，文本 JSON 与 native tools 共用同一协议；但它默认暴露/接受整个 `AGENT_READ_TOOLS`，不能证明本次 Skill 只授权四个 Gateway 工具。
2. `ContextGatewayToolSessionV1` 已冻结 scope、Policy、provider set、read-call 和 retrieved-token 额度；四工具不会写 Canon，但正式 Skill 尚未冻结 Gateway 权限，也没有统一快慢路径编排器。
3. `selectContextResourcesV1()` 已能区分硬缺失与软缺失。硬缺失/冲突必须在模型前阻断；软缺失仅在 Skill 允许时进入追加读取。工具不可用时应以确定性选择继续，并把软缺失变为明确假设，而不是改变作用域/权威规则。
4. 当前主 Agent durable 路径把 `contextEvidence` 计算出的 V1 摘要哈希写入 `contextManifestHash`；它不是 `ContextManifestV3`，不能供新 Gateway 候选采纳。CTXG-7 必须提供版本化候选门，只对显式启用 Gateway 的新运行生效，保留旧运行只读兼容。
5. CTXG-6 preflight/finalize 已要求 exact selector、packet、source/tool/request/response artifacts。CTXG-7 只能消费这条 API，不另建 transcript、候选或记忆表。

## 三注册表与关联闭包

- 读：Provider 仍只来自 `CONTEXT_SOURCES.resources`；Skill 只冻结允许的 provider source、resource kind、depth、追加读取工具和预算。
- 写：本单元不写 Canon；exact evidence 只写既有 `agentRunArtifacts` / `agentRunEvents`，候选仍由现有 durable 管线持久化。
- 表：不新增表、不改 `PROJECT_TABLES`；缓存属于 `CTXG-8`。
- 调用方：新增 headless Gateway execution API；Runner/client adapter 增加 Skill 工具 allowlist；Phase 1B 再由 `world-origin.worldview-field` 的 races canary 调用。
- 采纳：显式声明 `gateway-required` 的新候选必须拥有 fresh、可还原的 V3；历史/未启用 Gateway 的运行继续按旧合同恢复，不伪造升级。

## 施工顺序

1. 先为 Runner/客户端增加确定性工具闭集，文本目录和 native tool schema 都只暴露本次授权工具；越权调用在执行前停止。
2. 扩展 Skill 合同与 V2 execution binding，冻结 Gateway rollout、provider source、kind/depth、追加读取工具和双预算；不得从 UI 临时拼装权限。
3. 实现统一 execution：纯 metadata 目录 → selector → host 确定性读取 → sufficiency；充分时零追加模型调用。
4. 只有软缺失且 Skill 允许时运行同一个 `AgentRunner`；每次 tool result 后重算充分性，无新增证据、重复调用、call/token/step 耗尽立即停止。
5. 工具/模型不可用时执行确定性 fallback；硬缺失始终阻断，软缺失转为可见假设，不静默伪称已读取。
6. 输出 CTXG-6 preflight 所需 packet、trace、source snapshots 与 tool transcript；新增 V3 required/fresh candidate gate。
7. 增加反例、架构守卫和完成卡，运行定向测试、静态检查、TypeScript、lint、build 与 diff check。

## 验收与停止条件

- 空项目与充分的短项目：additional planning model calls=0、Agent Gateway tool calls=0，只进行确定性 Canon 读取和一次创作模型调用（创作调用在 Phase 1B 接线验证）。
- 复杂样本：仅 `additionalRead='needed'` 且 Skill 允许时进入 Runner；模型只能看见获授权 Gateway 工具，次数、tokens、steps、重复查询均硬停止。
- 文本 JSON 和 native tools 使用同一 allowlist；native tools 关闭不改变确定性快路径。
- hard missing/conflicted 在任何 transport 下模型调用为 0；无新证据的读取循环停止且不得把报告伪造为充分。
- Gateway-required 候选无 V3、V3 不可回读或 freshness stale 时采纳为 0；历史非 Gateway 候选不被错误升级或损坏。
- 不新增 Agent 团队、不新增业务表、不修改 4178 预览数据。
