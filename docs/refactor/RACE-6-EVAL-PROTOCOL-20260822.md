# RACE-6 评测协议：种族与民族 Gateway 金切片

日期：2026-08-22  
施工单元：RACE-6  
状态：V11 已运行至 4/100；grader 因 Agnes 额度不足可恢复暂停，GATE-P1B 未通过

> V1 首次真实运行在 `empty-02` 暴露 Agnes grader 的通用
> `finish_reason=length` 与严格结构完成性判断冲突。V1 证据保留为失败运行；V2 不降低任何质量阈值，
> 将 grader 输出预算提升到 4096 tokens，要求 200 字内紧凑理由，并以严格闭集 JSON 是否完整作为最终
> 截断判据，同时把 provider finish reason 写入证据。

> V2 在 `empty-01` 的 4096-token grader 请求中仍得到截断的非法 JSON，证明 `Agnes 2.0 Flash`
> 无法稳定履行本协议，而非 V1 误判。V2 失败 checkpoint 保持只读。V3 将 provider 级 Agnes
> `json_object` 能力从“已支持”降为“未验证”，冻结独立 grader 为既有真实评测使用过的
> `Agnes 1.5 Flash`，并在创建任何 fixture 前执行一次严格 schema preflight。preflight 不参与质量计分，
> 但其模型身份、输入/输出 hash、usage、finish reason 与耗时进入签名 checkpoint。

> V3 schema preflight 在创建 fixture 前收到 `model_not_found`：Agnes 网关已无
> `agnes-1.5-flash` 渠道。随后通过受治理的 `/v1/models` 实时发现确认目录包含
> `agnes-2.5-pro` 与 `agnes-2.5-pro-alpha`。V4 冻结稳定版 `Agnes 2.5 Pro` 为 grader，
> 不使用 alpha；设置页移除失效的 1.5 可选项，但保留历史导入的上下文预算兼容。

> V4 的 schema preflight 与前 2 个空态样本成功，但 `empty-03` 的 generator 被路由到要求
> system message 唯一且位于首位的严格上游，暴露冻结作者模板 system 与 Harness hard system
> 被作为两条消息发送的跨渠道兼容缺陷。V4 checkpoint 只读归档；V5 在统一 Prompt 执行层将全部
> 模板 system 内容与不可覆盖硬约束合并为唯一首条 system envelope，实际合并结果继续进入
> `renderedPromptHash` 与 Context Gateway transcript。fixture、模型身份和质量阈值均未改变。

> V5 的 grader preflight 在 27.666 秒完成且严格 JSON 通过；`empty-01` 在 190.451 秒失败，错误为
> `signal is aborted without reason`。结合每次 blind grade 唯一的 180 秒 AbortController，证据将故障
> 定位为首例 blind grade 超时，而不是 generator 或 system envelope 再次失败。V5 checkpoint 已导出归档。
> V6 把独立 grader 的单次冻结等待预算提升为 600 秒，并在超时时返回明确错误；这只改变等待预算，
> 不改变模型、样本、Prompt 判据或质量阈值。V6 同时在进入 blind grade 前归档 generator 候选、manifest
> 与 transcript，使以后即使 grader 失败也不会抹掉已经成功的生成证据。

> V6 完成 2/100 后，`empty-03` 收到 Agnes 上游 HTTP 500 `do_request_failed`。这是外部传输故障，
> 不能算作候选质量失败；但既有显式“继续”会从主 results 删除失败项，令最终 checkpoint 看不到重试史。
> V7 增加签名 `attemptFailures` ledger：任何失败尝试都连同错误、耗时及已有的候选/transcript 永久保留；
> 恢复只重跑未完成 fixture，不覆盖历史。重试仍必须由可见的“继续”触发，不新增隐藏自动重试。

> V7 完成 3/100 后，`empty-04` 的首次结构化输出与唯一一次定向修复均未通过。V7 正确保留了
> 失败尝试条目，却暴露更深的证据漏洞：候选形成前的 raw response 只存在于内存 Error，隔离项目清理后
> checkpoint 无法说明字段/JSON 究竟错在哪里。V8 将结构化失败的 `model.responded` 与 exact
> `raw-response` 在 durable pause 前写入运行证据，并把 preflight artifacts 与原始输出压缩进 version 2
> failure transcript 后再清理项目。失败同时携带统一 Harness failure class；任何非 Provider 失败尝试的
> 门槛冻结为 0，不能靠后续重试从 sealed score 中洗掉。Provider 瞬时故障保留并单独计数。

> V8 完成 26/100 后，`partial-07` 的 generator、候选和 Context transcript 均已成功，但独立 grader
> 返回 `finish_reason=length` 与不完整 JSON。既有分类无法区分“产品生成失败”和“评测器失败”，也只保存
> grader 输出 hash。V9 冻结失败阶段 `generation / grader / attack`，grader 解析失败额外保存原始输出、
> parse error、finish reason、tokens、耗时与 hash。grader 显式重跑次数单独进入 score，不污染产品侧
> “非 Provider 失败尝试=0”硬门；但 40 个质量样本仍必须最终各有一份合法独立盲评才可完成。

> V9 完成 2/100 后，`empty-03` 首次输出只因正文中的引号未转义而不是合法 JSON；唯一修复调用却把
> 内容包装进 `worldviews[]`，违反目标根 schema。失败证据证明统一修复器只披露了 schemaId、target 和
> 问题文本，没有披露根类型、允许根字段和必填根字段，迫使模型猜测合同。V10 在每次结构化尝试证据中
> 保存由实际合同派生的最小 `contractShape`，并只向修复调用披露该结构，不重放整份项目上下文、不增加
> 第三次调用。V9 checkpoint 只读归档，fixture、模型和质量阈值不变。

> V10 在 `empty-01` 即停止。`contractShape` 已正确送达，修复调用也不再臆造 wrapper，却原样复述了
> 未转义的正文引号，证明用第二次模型调用完成纯机械转义仍不稳定。V11 在严格 `JSON.parse` 失败后使用
> 确定性语法修复器生成提案，但只接受“仅在已有双引号前插入反斜杠”这一无损子集；任何补闭括号、删除
> 逗号、改字段、改正文或截断补全都拒绝，仍进入原有一次模型修复与 fail-closed 流程。原始文本、修复后
> 文本和 normalization step 全部留证；未增加模型调用或放宽 schema。

> V11 已完成并签名 `empty-01`～`empty-04`，包括 V7/V9 的两个历史结构失败样本；`empty-05` 的
> generator 成功后，blind grader 收到 Agnes `insufficient_user_quota`。该失败按 `grader/provider`
> 留入 attempt ledger，可在同一模型与协议下显式续跑，不属于产品质量失败。checkpoint
> `d973641b2fa333378a67a22c4cb280c16f88523ca7190cb5c6cad79e7219da5f` 已通过 UI 导出；在账户额度
> 足以完成 4096-token 预扣前不伪造完成、不降低预算、不切换有利模型。

## 评测目标

RACE-6 同时回答两个不同问题：

1. Harness 是否把正确、最新、同一 scope 的证据送达模型，并在保存、刷新、并发和采纳阶段保持 fail-closed。
2. 冻结生成模型在实际收到证据后，是否产生满足空态、部分态和作者约束的可用种族设定。

两类失败不得混在一起。`ContextManifestV3`、selected resource keys 和攻击结果用于判断检索/机械链路；独立盲评模型只判断候选内容。确定性模型替身只证明 100 例编排、恢复、证据归档和清理能运行，不作为创作质量结论。

## 冻结矩阵

| 类别 | 数量 | 执行方式 | 核心断言 |
|---|---:|---|---|
| 空项目 | 20 | 正式 durable races Harness + 独立盲评 | 非占位、非字段解释、标题不过锚、存在具体新设定 |
| 部分世界观 | 20 | 正式 Harness + 独立盲评 | 保留给定规则且新增可用信息，不只改写原句 |
| 末位召回 | 20 | 每项目 24 个角色，目标位于末位 | 精确目标进入 selected resources，自动选择总数不超过 20，候选实际使用目标 |
| Pinned/Mandatory | 10 | races 旧事实作为 expand 基线 | Mandatory 送达与精确事实保留均为 100% |
| expand/polish 对比 | 10 | 正式 Harness | operation 正确、原文 baseline 冻结、产生双版本候选 |
| 跨 scope 攻击 | 10 | 对真实源候选使用另一 Work 采纳 | 100% fail-closed，Canon 零写入 |
| 并发 CAS 攻击 | 10 | 候选后修改被读取的 worldview SourceRef | 100% stale 阻断，旧候选不可覆盖新 Canon |

固定矩阵总数为 100：80 次正式生成、40 次独立盲评、20 次确定性攻击。V3～V11 在矩阵之外固定增加
1 次 grader schema preflight，因此完整成功运行最多发起 121 次模型调用；preflight 失败时不会创建
或生成任何 fixture。

## 冻结阈值

| 指标 | 阈值 |
|---|---:|
| 空态占位率 | ≤ 5% |
| 空态标题过锚率 | ≤ 10% |
| 空态具体设定率 | 100% |
| 部分态约束遵守率 | ≥ 90% |
| 部分态新增有效信息率 | ≥ 90% |
| 末位证据 recall@20 | ≥ 95% |
| 末位证据送达后实际使用率 | ≥ 90% |
| Mandatory 送达率 | 100% |
| Mandatory 事实保留率 | 100% |
| 跨 scope 泄漏率 | 0% |
| 双版本候选交付率 | 100% |
| CAS stale 阻断率 | 100% |
| 非 Provider 失败尝试 | 0 |

阈值在真实运行前冻结。真实运行失败时只能修复原因并建立新版本评测，不能在看到结果后降低当前阈值。

## 模型与盲评约束

- checkpoint 冻结 generator provider/model、grader provider/model 和 grader prompt version。
- V3 checkpoint 还冻结 grader schema preflight 证据；缺失、hash 非法或模型身份不一致均验签失败。
- UI 与底层 runner 都拒绝 generator 和 grader 使用同一模型身份，防止模型自评。
- grader 只看标题、给定种子和候选，不读取检索 trace、期望阈值或生成模型身份。
- grader 必须返回严格闭集 JSON；非法 JSON、额外字段和截断都令当前样本失败，不做隐藏多次重试。
- grader 失败由可见“继续”显式重跑；原始 grader 失败证据和次数永久保留，并与产品生成失败分栏统计。
- provider 返回 `length/max_tokens` 但响应仍是完整严格闭集 JSON 时允许验收；若严格解析失败，按截断失败。两种情况都记录原始 finish reason。
- 每个盲评保存输入/输出 hash、token、耗时和模型身份，不保存 API Key、认证头或隐藏推理。

## 证据、恢复与生命周期

- 每个模型样本保存 `ContextManifestV3`、selector result、context packet、实际 request、raw response，以及实际被选中的 source snapshot。
- transcript 先形成自包含 JSON，再 gzip/base64；保存未压缩/压缩字节数和 transcript hash。读取时校验长度与 hash。
- checkpoint 本身使用 canonical hash 签名。fixture、模型身份、grader 身份或内容被篡改后不可继续。
- 每完成一例先签名并落盘，再通过 `PROJECT_TABLES` 派生的 `cascadeDeleteProject()` 清理不再需要的隔离项目。跨 scope/CAS 源项目只保留到对应攻击完成。
- 页面刷新可以从同一 checkpoint 继续；完成后必须先导出，才能显式清理并开始新 run。

## 实现中发现并修复的架构问题

初始末位样本虽然命中了目标，但 selector 会继续把 240 个 character-field 资源全部装入请求。问题不是模型窗口太小，而是“分类配额”缺少 task policy 的自动资源总量硬门，造成形式上的 recall 掩盖了渐进式披露失效。

修复后各 task policy 具有 `maxAutomaticResources`：world-origin 20、character 28、inspiration 20、outline 36、prose 48。Mandatory/Pinned 不受自动上限挤出；非硬资源到达上限后必须通过受治理的追加读取获取。selector policy id 升级为 V2，使旧证据不会伪装成新策略结果。

末位确定性样本修复后只选择 20 个资源，自包含 checkpoint 由约 910 KiB 降至约 24 KiB；100 例确定性矩阵约 52 秒完成，结束后隔离项目数为 0。

## GATE-P1B 尚需真实证据

1. 在独立浏览器 origin 中使用已配置 API，生成模型与独立 grader 各自冻结身份。
2. 跑完 100 例 sealed matrix，导出签名 checkpoint，并验证所有冻结阈值。
3. 在同一隔离 origin 完成 races 的生成、刷新、编辑、拒绝、采纳、切世界和错误恢复 E2E。
4. 运行完整 CI、E2E、build 和架构门；全部通过后才能将 RACE-6 与 GATE-P1B 标为完成。
