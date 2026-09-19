# WeGame 中文资源调查

**结论：部分可用。** WeGame 公共分享页会匿名加载一份覆盖整棵天赋树的简体中文
ES 模块，且它与当前锁定 `tree-pre.json` 的 5,102 个 numeric node ID 全部对齐；但它不是
“全量已证实”的游戏翻译库，也还不能称为“天赋范围完整”。当前快照有 45/4,844 个具名
节点没有汉字、40/5,904 条 WeGame stat 没有汉字，并且与锁定官方 `data.json` 存在 51 个
缺失节点、238 个 numeric ID 对应不同 raw ID 的明确版本冲突。该模块没有 stat key 或数值
占位符模板，技能/物品也只观察到当前角色响应和按 ID 查询接口，没有完整目录证据。

Status: P2AT-022A research evidence, **ACCEPTED** (controller, 2026-09-19; evidence acceptance does not grant upstream redistribution rights).
访问日期：2026-09-18（Asia/Shanghai）

本调查只沿用户提供的一个公开分享页实际加载的 HTML、版本化 chunks 和其代码明确引用的
资源前进。分享标识仅留在控制器任务和忽略的本地研究缓存中；本文、工具、提交和命令均不
包含它。未登录、未发送 Cookie/Authorization、未遇到验证码，也没有枚举其他分享或猜测路径。

## 实际资源链

HTML 明确引用入口 chunk；入口 chunk 的 Vite 依赖表明确引用分享页、天赋页和天赋树组件；
天赋树组件中的 `ft()` 再明确动态导入 `tree-DMrX6mR8.js` 与 `sprite-C3UUEZAI.js`。树组件
直接使用导出的 `classes`、`nodes`、`skillOverrides`，不是从当前角色响应拼出这些中文数据。

| 资源 | 明确引用证据 | 解压后 bytes | SHA-256 | 格式、语言与缓存 |
| --- | --- | ---: | --- | --- |
| `https://www.wegame.com.cn/helper/poe2/` | 用户分享页同一路径的 HTML shell | 1,313 | `a7ea2dc4269d980736a84cfd1b9c46b2a3b111f77a841e1d5d906010c8041653` | HTML；页面文案为简中；响应未给 ETag/Cache-Control |
| `https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/index-DhVLk-Xd.js` | HTML `script type=module` | 90,529 | `ef7bda29d70af1a103e3fa89ad7a47d0a9bfd284a657f53607703c34cec1b766` | ESM；`Cache-Control: max-age=2592000`、ETag、Last-Modified；匿名 GET |
| `https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/index.vue_vue_type_style_index_0_lang-CbQMvVLt.js` | 入口依赖表和天赋组件 import | 41,009 | `16f2f8bce728a8fb2ffff050aa7d46323166587672b36d1a162a3146e5e7ed3c` | 天赋树 renderer；明确动态 import 下两项；匿名 GET |
| `https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/tree-DMrX6mR8.js` | renderer 的 `import("./tree-DMrX6mR8.js")` | 2,027,563 | `eb7f434e4061b27ba09ae5c8f4d0a753ff44a3ac2c746763d224916afaa385ab` | ESM 数据模块；简体中文；`Cache-Control: max-age=2592000`、ETag `"6a701959-1ef02b"`、Last-Modified `2026-08-03 04:30:17 GMT`；匿名 GET |
| `https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/sprite-C3UUEZAI.js` | renderer 同一 `Promise.all` | 136,119 | `70271a70653be64b4ea393e5104ae2bcdc9046134ab737875c9ad304c4d2cd8f` | ESM sprite metadata；不是翻译源；匿名 GET |

资源路径中的构建标识是 `g.2002052-r.4de9d`。renderer 同时硬编码 sprite 子目录
`sprite/0.5/`，入口配置引用 `season_0_5_0`；这能证明该站点把当前前端资产标作 0.5，不能
单独证明它与锁定 GGG commit 完全同版。资源没有内嵌游戏 patch、树 revision 或 schema
version，因此必须靠逐 ID 比对，而不能靠 “0.5” 字样放行。

## 资源范围判定

| 范围 | 判定 | 证据边界 |
| --- | --- | --- |
| 页面 UI 文案 | 有 | chunks 内有固定简中文案；不等同游戏数据 |
| 当前分享角色 | 有 | P2AT-021A 已证实装备、技能、面板和天赋响应含中文；只代表一个角色 |
| 完整天赋树中文数据 | 部分 | `tree` 模块导出 5,103 nodes、12 classes、25 个当前 official 列出的 ascendancies 和 80 skill overrides；仍有英文残留且版本不一致 |
| 全游戏翻译库 | 未证实 | 未发现可枚举的全物品、全技能或通用 stat-template 目录 |

技能页还会按已知 ID 调用
`POST /api/v1/wegame.pallas.poe2.Poe2BaseInfo/BtGetBase`，ID 形如
`ActiveSkills.<slug>`，响应能给中文名/描述/图片；这是稳定-looking 的点查能力，不是目录。
装备和技能 Profile 响应保留当前角色中文文本及部分实例 ID，但没有证明 BaseItemTypes/技能
全集、版本覆盖或一一映射。因此不得把它扩大成装备/技能接入任务。

## 可复算覆盖结果

以下数字由 `apps/planner-desktop/tools/report-wegame-localization-coverage.cjs` 直接计算。
匹配优先级为 raw ID + numeric ID；仅 `tree-pre` 缺 raw ID 时才退到 numeric ID，并明确保留
风险。名称从不作为身份主键。

### 对当前运行时 `tree-pre.json`

| 项目 | 总数 | 匹配/中文 | 缺失/冲突 |
| --- | ---: | ---: | ---: |
| numeric nodes | 5,102 | 5,102 | 0（WeGame 另有 1 个 root） |
| 具名节点 | 4,844 | 4,799 中文 | 45 英文或空翻译 |
| WeGame stat 实例 | 5,904 | 5,864 含汉字 | 40 不含汉字 |
| 与 tree-pre stat 数量 | 5,874 | 5,874 只能按位置做诊断性对照 | 22 个节点由 WeGame 额外带 1–2 条 stat，说明两源内容并非完全同版 |
| markup | — | — | 19 个节点的 markup 总量不同；5 个位置差异受 stat 重排影响 |
| 数值 | — | 77 条仅数值顺序因中文语序改变 | 34 条数值 multiset 不同，需逐项版本审查 |

代表性风险：numeric node `3994` 在 `tree-pre` 是 `6%`，WeGame 中文为 `8%`；这不是翻译
措辞差异。`46365` 的两条 stat 顺序互换，说明 stat index 也不是稳定 key。WeGame 资源共
6,024 条 node/override stat，全部是已渲染字符串，未发现 `{0}` 一类数值占位符；因此它不能
直接替代现用的 stat-template 词典。

### 对锁定 official `data.json`

| 项目 | official 总数 | 匹配 | 缺失/冲突 |
| --- | ---: | ---: | ---: |
| numeric nodes | 5,153 | 5,102 | WeGame 缺 51、额外 1 |
| numeric + raw ID 同时一致 | 5,153 | 4,864 | 238 个相同 numeric ID 指向不同 raw ID |
| raw ID | 5,153 | 4,864 | 0 个已匹配 raw ID 改 numeric；其余 289 无安全对应 |
| 可比节点名称 | 4,864 | 4,818 中文 | 46 英文/空；另 289 版本不符 |
| stat 实例 | 5,963 | 身份可比节点有 5,904 条 WeGame stat，其中 5,864 条含汉字 | 40 条不含汉字；比 official 少 59 条 |
| classes | 12 | 12 中文 | 0 |
| ascendancies | 25 | 25 中文 | 0 |
| skill overrides | 80 | 80 raw+numeric 一致 | 0 |

这里的 238 个身份冲突是采用阻断条件：不能用 numeric ID 静默套译，更不能用名称猜测。
例如重复中文名映射到多个英文语义的 key 有 26 个，重复英文名对应多个中文文本的 key 有
17 个；名称只能做人工差异提示。

### 与现用 PoB2 中文层对照

在 4,864 个 official/WeGame 身份可比节点中，现用 PoB2 词典按英文名覆盖 4,813，缺 51；
WeGame 与 PoB2 的中文文本有 159 个节点实例不同。锁定 official 的 5,963 个 stat 实例中，
PoB2 精确命中 487、模板命中 5,291、缺 185。两源互补，但二者都不能被无声覆盖：例如
`deflect63` 的 WeGame 名为“闪避”，PoB2 为“闪避和能量护盾”；`infusion13` 的 WeGame
名为“灌注消耗几率”，PoB2 为“灌注法术伤害”。这些差异必须在 ID 对齐后进入回归样本。

## 采用建议

建议把 WeGame 设为**天赋范围的候选主翻译源**，但当前快照不得直接晋升为生产主源：

1. 以每次获准下载的 WeGame 资源 hash 建候选 lock；先要求目标 official raw ID 与 numeric ID
   双重一致。identity 冲突、缺失或数值 multiset 不同都阻止该条激活。
2. 对通过 identity gate 的 node name、class、ascendancy 和 skill override，WeGame 优先；空值、
   原样英文或被 gate 拒绝时回退当前 PoB2；仍缺失时显示 canonical English。
3. stat 不按数组位置覆盖。最小接入必须先定义 node raw ID + 可审核 stat signature；在 WeGame
   没有 stat key/template 的情况下，PoB2 stat template 保持主源，WeGame 只做已验证逐节点
   rendered override。
4. 更新时重新计算完整覆盖，任何资源 URL/hash、node identity、数值或 markup 漂移都进入
   REVIEW，不能自动跟随 moving chunk。
5. 中文回归至少固定：普通/核心/关键/珠宝/升华/可变属性节点、45 个无汉字名称、40 条无汉字
   stat、34 条数值差异、19 个 markup 总量差异、159 个 PoB/WeGame 文案冲突，以及
   `3994`、`46365`、`infusion13` 等代表性样本。

建议的下一个最小任务不是修改 renderer，而是实现一个纯离线候选转换器：输入已锁定
WeGame ESM、official data 和 tree-pre，输出不含上游全文的 ID-keyed overlay 报告与回归
fixture；只有 controller 审核 source lock promotion 和差异清单后，才另开生产加载器任务。

## 可复现方法

完整下载内容放在 `.research-cache/wegame-localization/`，该目录被 Git 忽略。以下命令中的
URL 全都来自实际 HTML/chunk 引用；未使用分享标识。

```powershell
$cache = ".research-cache/wegame-localization"
New-Item -ItemType Directory -Force $cache | Out-Null
curl.exe -L --compressed -o "$cache/page.html" "https://www.wegame.com.cn/helper/poe2/"
curl.exe -L --compressed -o "$cache/index-DhVLk-Xd.js" "https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/index-DhVLk-Xd.js"
curl.exe -L --compressed -o "$cache/index.vue_vue_type_style_index_0_lang-CbQMvVLt.js" "https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/index.vue_vue_type_style_index_0_lang-CbQMvVLt.js"
curl.exe -L --compressed -o "$cache/tree-DMrX6mR8.js" "https://wegame.gtimg.com/g.2002052-r.4de9d/helper/poe2/assets/tree-DMrX6mR8.js"

node apps/planner-desktop/tools/report-wegame-localization-coverage.cjs `
  --wegame "$cache/tree-DMrX6mR8.js" `
  --wegame-sha256 eb7f434e4061b27ba09ae5c8f4d0a753ff44a3ac2c746763d224916afaa385ab `
  --official "$cache/official-data.json" `
  --tree-pre "$cache/tree-pre.json" `
  --translation "$cache/ChineseTranslation.lua" `
  --lock data/upstream-sources.lock.json
```

工具在分析前按 canonical lock 校验后三个输入，并按显式 WeGame SHA-256 校验公网 chunk；
不一致即非零退出，报告也记录四项 path-independent bytes/SHA-256。WeGame JS 由受限字面量
解析器静态读取，不会作为代码执行。此次实测
分别为 official `5,140,821 / b52be9…44642`、tree-pre
`1,580,743 / bbb3b5…92796`、PoB2 translation `3,408,471 / 8621d0…f98a0`。

## 已验证与未验证边界

已验证：匿名可取、实际引用链、资源 hash/bytes/cache headers、简中树模块结构、当前锁定三源
覆盖、重复/一对多、markup/数值位置风险、classes/ascendancies/skill overrides 范围。

未验证：WeGame 资源的长期 URL 稳定性、资源更新/回滚政策、与客户端精确 patch 的官方声明、
全物品/全技能目录、stat key/template、繁体中文、转载/再分发权、以及把资源接入生产 renderer
后的显示行为。来源声明仅到此为止：资源由 WeGame/Tencent 公开页面匿名提供；未发现随该数据
模块附带的再分发许可，所以完整模块只保留在本地缓存，不提交 Git、不打包。
