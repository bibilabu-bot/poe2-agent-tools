# P2AT-022B 天赋树中文修复

Status: **REVIEW**  
Baseline: `4006c749a250b72b8c688cf29099760c25b10bb9`（P2AT-023A 布局 REVIEW）  
Research evidence: `1f4cf3aa419e9f89fdeaa2ca8e21bb9ead77b3ad`（P2AT-022A REVIEW）

## 修复结果

旧界面把 PoB2 的 `ChineseTranslation.lua` 标成“国服 WeGame 词典”，并在整句未命中时执行英文术语局部替换。该 fallback 会把原文改成中英拼接，却被覆盖率统计当作中文成功。P2AT-022B 已移除该生产路径：没有完整精确或模板译文时，简中模式保留完整英文并显示“暂无可靠中文”，英文模式仍显示 canonical 原文。

新的优先级为：

1. 固定 URL、bytes、SHA-256 的 WeGame REVIEW 快照；仅在 official numeric ID 与 raw ID 同时一致、整条 stat 的有序数值与 markup 签名能唯一匹配，并且 WeGame/PoB2 中文一致或该 exact ID+英文+中文三元组经过显式复核时启用。名称同样要求 WeGame/PoB2 中文共识。
2. 现有 PoB2 完整精确译文或数值模板译文。
3. 完整 canonical English；不再进行句内词语拼接。

候选资源仅下载到用户缓存，不提交或打包完整上游数据，不执行远程 ESM。解析器只接受 `classes`、`nodes`、`skillOverrides` 的静态字面量；候选条目保持 `REVIEW`，不会跟随新的 moving chunk。现有 canonical lock 未修改。

## 全树生产链报告

报告命令直接调用 `renderer/localization-engine.js`，因此统计与 UI 使用同一生产翻译函数，而不是仅分析资源中是否含汉字。输入均先核对固定 bytes/SHA-256。

分母：5,102 个 runtime node；4,844 个具名节点实例（1,970 个唯一英文名称）；5,874 个 stat 实例（2,504 条唯一 canonical stat）。

| 口径 | WeGame/PoB2 共识或显式复核 | PoB2 精确 | PoB2 模板 | 英文保留 | 旧局部术语 fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| 修复前名称实例 | 0 | 4,795 | 0 | 49 | 0 |
| 修复后名称实例 | 4,635 | 162 | 0 | 47 | 0 |
| 修复前 stat 实例 | 0 | 476 | 5,211 | 48 | 139 |
| 修复后 stat 实例 | 5,159 | 40 | 489 | 186 | 0 |
| 修复后唯一名称 | 1,902 | 48 | 0 | 20 | 0 |
| 修复后唯一 stat | 2,023 | 40 | 274 | 167 | 0 |

“英文保留”不是完整汉化成功。186 个实例/167 条唯一 stat 因证据不足保持英文；主要包括部分新技能授予文本、跨版本冲突和没有语义共识的描述。相较旧版英文数变多，是因为 139 个曾被错误拼接的实例不再冒充中文，同时审查后不再把“数字/markup 相同”误称为语义已验证。

身份与版本阻断统计：238 个 numeric/raw identity 冲突、51 个 WeGame 缺失 official node、447 个 stat 签名无法唯一确认。它们不会按 numeric ID、数组索引或名称猜译；即使签名相同，没有 PoB2 语义共识或显式复核也不会启用。

## 重点样本

- node `52` / `passive_keystone_zealots_oath`：名称“狂热者誓言”；WeGame 整条原文为“再生的溢出生命回复会作用于能量护盾。\n能量护盾无法充能。”，双重身份与两处 `EnergyShield` markup 一致，生产 UI 已验证。
- node `3994`：当前 runtime 是 `6%`，WeGame/official 候选是 `8%`。`8%` override 不匹配 runtime canonical line，UI 使用 PoB2 模板保留 `6%`，不发生数值升级。
- node `46365`：两条 stat 在来源中顺序不同；按逐条签名匹配，不按数组下标覆盖。
- raw ID `infusion13`：WeGame“灌注消耗几率”与 PoB2“灌注法术伤害”存在已知语义冲突，加入显式阻断，继续显示 PoB2 的“灌注法术伤害”。
- 无数字且没有 markup/模板等语义锚点的 WeGame stat 不仅凭同节点或含汉字放行；相同数字/markup 但语义不同的合成反例也必须回退 PoB2/英文。

## 验证与复算

```powershell
cd apps/planner-desktop
npm test
npm run check

node tools/report-localization-runtime.cjs `
  --wegame <verified-cache>/tree-DMrX6mR8.js `
  --official <verified-cache>/official-data.json `
  --tree-pre <verified-cache>/tree-pre.json `
  --translation <verified-cache>/ChineseTranslation.lua `
  --lock ../../data/upstream-sources.lock.json `
  --candidate-config data/localization-candidates.json
```

Electron 实测覆盖节点 52、3994 数值保持、HTML `textContent` 安全、生产资源加载及布局叠加基线。截图见 `docs/assets/screenshots/p2at-022b/node-52-wegame-full-zh.png`。

## 剩余边界

- P2AT-025A 整合复审增加 runtime 英文名称一致性门禁，修复 3091、24060、18793、33639 等数字 ID 跨版本名称错配；生产与报告使用同一 resolver。本文件原有覆盖数属于 P2AT-022B 交付时快照，不应当作门禁修复后的新测量结果；可用上方报告命令重算。

- WeGame 快照及 P2AT-022A/P2AT-022B 都仍是 REVIEW；本任务不把任何依赖标为 ACCEPTED。
- 候选资源长期稳定性、转载/再分发权和与客户端精确 patch 的官方对应关系仍未证实。
- 本任务不升级树数据，不接入装备/技能全库，不调用外部机器翻译，也不承诺证据不足的 167 条唯一 stat 已中文化。
