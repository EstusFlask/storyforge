# RACE-6 评测协议：种族与民族 Gateway 金切片

日期：2026-08-22  
施工单元：RACE-6  
状态：V3 实现完成，等待真实模型 sealed run 与 GATE-P1B

> V1 首次真实运行在 `empty-02` 暴露 Agnes grader 的通用
> `finish_reason=length` 与严格结构完成性判断冲突。V1 证据保留为失败运行；V2 不降低任何质量阈值，
> 将 grader 输出预算提升到 4096 tokens，要求 200 字内紧凑理由，并以严格闭集 JSON 是否完整作为最终
> 截断判据，同时把 provider finish reason 写入证据。

> V2 在 `empty-01` 的 4096-token grader 请求中仍得到截断的非法 JSON，证明 `Agnes 2.0 Flash`
> 无法稳定履行本协议，而非 V1 误判。V2 失败 checkpoint 保持只读。V3 将 provider 级 Agnes
> `json_object` 能力从“已支持”降为“未验证”，冻结独立 grader 为既有真实评测使用过的
> `Agnes 1.5 Flash`，并在创建任何 fixture 前执行一次严格 schema preflight。preflight 不参与质量计分，
> 但其模型身份、输入/输出 hash、usage、finish reason 与耗时进入签名 checkpoint。

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

固定矩阵总数为 100：80 次正式生成、40 次独立盲评、20 次确定性攻击。V3 在矩阵之外固定增加
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

阈值在真实运行前冻结。真实运行失败时只能修复原因并建立新版本评测，不能在看到结果后降低当前阈值。

## 模型与盲评约束

- checkpoint 冻结 generator provider/model、grader provider/model 和 grader prompt version。
- V3 checkpoint 还冻结 grader schema preflight 证据；缺失、hash 非法或模型身份不一致均验签失败。
- UI 与底层 runner 都拒绝 generator 和 grader 使用同一模型身份，防止模型自评。
- grader 只看标题、给定种子和候选，不读取检索 trace、期望阈值或生成模型身份。
- grader 必须返回严格闭集 JSON；非法 JSON、额外字段和截断都令当前样本失败，不做隐藏多次重试。
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
