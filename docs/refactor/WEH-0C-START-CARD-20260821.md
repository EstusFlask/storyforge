# WEH-0C 开工卡：保存屏障与内容修订向量

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 基线：WEH-0B `8913350`

## 1. 当前真实链路与缺口

```text
InlineTextarea 本地 draft
  → blur 才调用 panel.save（调用方通常不 await）
  → Zustand store async save/adopt/update
  → IndexedDB

AI button click
  → submitRequest / generation.prepare
  → assembleContext 直接读取 IndexedDB
  → Run / candidate
```

浏览器事件通常先 blur 后 click，但“先发起 save”不等于“已完成落盘”。正式生成没有统一等待屏障，因此模型可在保存 Promise 尚未完成时读取旧值。切子页、切世界和组件卸载也没有可审计的统一 flush。

`assembleContext()` 已为每个登记来源产生完整原文 `sourceHash`，若干领域也有自己的 target snapshot；但候选没有统一的工作区 content revision vector。于是目标字段手改可能被某个领域阻断，上游字段或其它 Canon 资源手改却可能不触发同样的 stale 规则。

## 2. 本单元裁决

| 关注点 | WEH-0C 方案 |
|---|---|
| 本地草稿 | `InlineTextarea` 在编辑期登记 draft flusher；正式屏障可主动提交，不依赖偶然 blur 顺序 |
| 异步保存 | `PendingEditCoordinatorV1` 按稳定 edit key 串行写入并登记 Promise；flush 循环等待期间新增的保存 |
| 生成入口 | Master Copilot、大纲和本阶段覆盖的正式细纲/正文入口必须先 flush；失败则模型调用为 0 |
| 世界切换 | 世界组切换前先 flush；失败保持原世界并显示错误，不跨 scope 携带未落盘草稿 |
| revision | 从 `PROJECT_TABLES` 中已登记的 editable/world-domain 表派生，不建立第四张表清单；在候选既有 scope/worldGroup 内冻结逐表 hash 和总 hash，向量不重复保存不可移植的本地 ID |
| stale | 新候选保存 revision vector；采纳前重算。任何相关 Canon 漂移先产生 stale/阻断，不允许覆盖 |
| 兼容 | 旧候选没有 revision vector 时继续按原领域 snapshot/CAS 规则读取；不得伪称通过新 revision 证明 |

## 3. 三注册表与数据生命周期

- 读：正式模型仍只经 `CONTEXT_SOURCES + assembleContext()`；revision vector 只读取 `PROJECT_TABLES` 已登记且属于 editable/world-domain 的 Canon 表。
- 写：业务保存继续经现有 `adopt()` / store 治理入口；协调器只排序和等待，不拥有业务写权限。
- 表：不新增 Dexie 表；候选 revision 作为 Agent Event/Run 的版本化证据字段保存，沿现有 Agent 表生命周期导入、导出、删除和恢复。
- 过滤：二进制 blob、Agent ledger、缓存、统计和临时表不会进入 revision vector；世界组过滤从表的 `worldScoped/homeWorldScoped` 元数据派生。

## 4. 必须先失败的反例

1. 输入后不 blur 直接生成，模型必须读到最新文字。
2. 保存 Promise 尚未结束时点击生成，模型调用必须等待。
3. 保存拒绝时模型调用为 0，界面保留草稿和错误。
4. flush 期间又产生同 key/另一 key 保存，全部完成后才能放行。
5. 切世界前保存失败，不得切换 active world group。
6. 候选生成后修改世界观、故事、角色或大纲，采纳必须 stale；正式目标零覆盖。
7. 另一 worldGroup 的修改不得污染当前世界 revision。
8. Agent event/candidate 自身落库不得让自己的 revision 立即失效。

## 5. 非范围与回滚

- 候选文本框的 debounce/Promise queue 属于 WEH-0D；本单元只处理作者正式 Canon 编辑。
- structured output、Prompt override 和动态 Context Gateway 分别属于 WEH-0E、0F、Phase 1A。
- revision vector 当前是保守的工作区级 stale 屏障；Phase 1A 有稳定资源身份后可收窄到精确 resource revisions，但旧向量仍须可读。
- 回滚可移除新入口绑定和可选 revision 字段；不得恢复“保存失败仍调用模型”的路径。
