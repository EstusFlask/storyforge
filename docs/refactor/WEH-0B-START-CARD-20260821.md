# WEH-0B 开工卡：正式 durable 链路 fail-closed

> 日期：2026-08-21
> 前置提交：`616ad49`（WEH-0A）

## 1. 当前真实链路

```text
OutlinePanel / useOutlineBatchGeneration
  → useOutlineGenerationController.execute
  → createOutlineGenerationTraceV1
  → runGenerationNode
  → persistOutlineGenerationCandidateV1
  → UI beginOutlineGenerationAdoptionV1
  → UI adoptGeneratedOutlineSummary/Items
  → UI commitOutlineGenerationAdoptionV1
  → verifyOutlineGenerationAdoptionV1
  → terminal receipt + memory settlement
```

现有候选生命周期已经具备冻结 intent、幂等业务补写和终态验证基础，但正式 UI 把采纳拆成三个调用，并在 trace 初始化、candidate persistence、adoption begin/commit 失败时 catch-and-warn 后继续。因此“已有 durable 代码”不等于“正式入口 durable”。

## 2. 关联闭包与漂移

| 层 | 当前所有者 | WEH-0B 裁决 |
|---|---|---|
| 入口边界 | 未显式区分 formal/eval | 保留既有 V2 不变，以 V3 Run 增加 `formal/evaluation/simulation/experimental`；边界属于每次入口，不属于 Skill |
| trace | `createOutlineGenerationTraceV1` 初始化失败降级 shadow | formal 直接失败，模型调用为 0；非 formal 可明确使用不可采纳 shadow |
| trace 通知 | `runGenerationNode` 无条件吞 trace 异常 | formal 使用 strict trace failure mode |
| candidate | persistence 失败仍保留 UI 输出 | formal 不产生可采纳预览并终止运行 |
| adoption | UI 分步 begin → write → commit | 收口成单一 durable adoption API，UI 不再直接写业务表 |
| recovery | 已支持 intent 后、部分写后恢复 | 扩展到统一 API、CAS 和 terminal 各边界；恢复不重复模型或业务写入 |
| 非正式模式 | shadow 与 formal 类型混合 | write permission 为空、`adoptable=false`、不得生成 durable candidate |

## 3. 数据与权限

- 读：继续使用 WEH-0A 的 Skill-derived source binding。
- 写：formal outline binding 才拥有 `author-confirmed` outline 权限；非正式 binding 写集合必须为空。
- 表：不新增业务表；复用 `outlineNodes`、Agent Run/Event/Conversation/Event 以及既有 Memory Settlement 生命周期。
- UI：移除 `OutlinePanel` 和批量 controller 对 `adoptGeneratedOutline*` 的直接调用。

## 4. 故障矩阵

必须覆盖：trace 初始化、before-model evidence、candidate DB、确认前、intent 后、CAS 前、业务写入中、业务写入后、adoption event 后、verification 中、receipt 后。提交前失败不得写正式大纲；提交后中断必须由同一 Run 基于冻结 intent 验证/补齐，且不重新调用模型。

## 5. 非范围

- 不处理 blur 保存竞态与 content revision vector（WEH-0C）。
- 不重建候选文本编辑队列（WEH-0D）。
- 不统一所有领域的结构化输出（WEH-0E）。
- 不在本单元增加 Gateway、动态检索或新创作功能。

## 6. 回滚

回滚只能恢复到 WEH-0A 的 V2 Skill-derived Run；不得恢复 formal catch-and-warn。若需要临时关闭 durable，只能把入口明确标为 experimental/evaluation，并保持不可采纳。
