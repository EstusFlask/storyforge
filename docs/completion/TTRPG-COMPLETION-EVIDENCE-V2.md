# TTRPG 商业完成证据契约 V2

> 状态：`ACTIVE / FAIL-CLOSED`
>
> 本文是 `ttrpg-completion-gate-v2` 的人工取证说明；机器裁决以
> `src/lib/game-platform/ttrpg-completion-evidence.ts` 为准。代码、单元测试、受控浏览器 fixture
> 或一组没有原始报告的哈希，均不能单独证明跑团产品已经商业完成。

## 1. 统一封存要求

十一份证据都必须来自 staging 或 production，使用真实浏览器且不使用 fixture。每份报告必须包含：

- 报告内容 SHA-256、复核人签署回执 SHA-256、ISO 时间和环境；
- 可追溯到原始浏览器旅程、参与者、供应商或部署回执的结构化明细；
- 明确的失败记录和复跑关系。修改报告后必须重新计算哈希并重新复核，不能只改完成布尔值；
- 参与者和外部身份只保存不可逆 subject/receipt hash，不把姓名、账号、密钥或供应商凭据写入仓库。

任何缺项、未知字段、重复参与者回执、无效时间或非 64 位小写十六进制 SHA-256 都会被机器拒绝。

## 2. 十一项必须证据

| 证据键 | 最低门槛 |
|---|---|
| `golden-turn` | 至少 1 个权威 ActionReceipt，并同时封存确定性回放和 viewer projection 回执 |
| `golden-a` | 世界→制作→真人 KP 完整一场；封存浏览器旅程、GameRelease、至少 3 名参与者和真实供应商回执 |
| `golden-b` | 世界→制作→AI KP 完整一场；同样绑定至少 3 名参与者和真实模型/媒资供应商回执 |
| `golden-c` | 长战役连续性场景；同样绑定至少 3 名参与者、真实供应商和冻结 GameRelease |
| `requirements-u01-u21` | U-01～U-21 恰好 21 项全部通过，并绑定逐项检查报告 |
| `non-fixture-browser-path` | 封存完整真实浏览器旅程与 fixture 扫描回执 |
| `human-gm-full-session` | 至少 90 分钟、3 名真人、3 个场景；至少各出现 1 次规则遭遇、私密线索、物品转移、次数耗尽与恢复、奖励/惩罚、分支恢复 |
| `ai-gm-real-model-eval` | 至少 30 个真实模型样本、5 类场景、10 个对抗样本，并绑定真实 provider receipt |
| `commercial-media-set` | 至少 3 场景、3 角色、12 表情、6 物品/线索、1 地图、3 handout、1 个游玩中生成资产；至少 2 类真实媒资供应商回执 |
| `external-identity-multidevice-recovery` | 至少 3 个唯一外部身份和 3 台唯一设备；通过部署 conformance、网络隔离、服务重启恢复 |
| `unassisted-new-users` | 至少 5 名唯一新用户独立完成，开发者协助事件必须为 0，并封存预先确定的研究流程 |

Golden A/B/C 不能共用一个“跑通页面”的总哈希代替各自的产品、参与者和供应商证据。真人 KP 场、AI KP
真实模型评测、完整媒资集、外部身份和无协助用户也不能从 Golden 名称推断，必须分别提交明细。

## 3. 执行和晋级顺序

1. 在隔离 staging 冻结 WorldRelease、创作指令、规则包、参与者和供应商配置，记录测试协议版本。
2. 完成真人 KP 整场、AI KP 评测、商业媒资集、三身份多设备恢复和五名无协助用户场次。
3. 从权威事件、浏览器 trace、部署 conformance、供应商回执和参与者完成回执生成十一份报告。
4. 独立复核人验证原始证据、隐私处理和 fixture 扫描，签署 reviewer receipt。
5. 生成完整 V2 attestation；先调用 `validateTtrpgCompletionEvidenceV2()` 离线验证，再作为受控发布产物替换
   `CURRENT_TTRPG_COMPLETION_ATTESTATION_V2`。不得把未密封草稿或环境变量布尔值接入 production。
6. 重新运行 `npm run ci`、完整 `npm run ci:e2e` 和发布检查。只有所有证据及回归同时通过，TTRPG 才能从
   developer/partial 升为 default/proved。

## 4. 当前裁决

当前 attestation 为 `null`，严格 Golden 为 `0/3`。仓库内核心、受控浏览器、在线组合根和性能证据只能说明
产品链已集成；真实供应商、真人完整场、外部身份/设备和无协助用户证据尚未产生，因此 production 必须保持关闭。
