# PoE2 Jewel Compiler v2

这版把 Unique/特殊珠宝从“纯 seed”推进到可从 PoE2DB HTML 自动识别，并读取 PoB runtime 文件判断特殊规则证据。

## 完整数据运行
1. `node download_poe2_jewel_sources.mjs`
2. `node build-jewel-db.mjs`

## 输出
- `dist/jewel_mods.json`
- `dist/jewel_sockets.json`
- `dist/jewel_constants.json`
- `dist/unique_jewels.json`
- `dist/jewel_tree_rules.json`
- `dist/compile_report.json`
- `planner-jewel-contract.json`

当前目录 raw 是可运行 fixture。把 downloader 的完整 raw 覆盖后，编译器无需修改。

## 下一步
下一步开始把 `jewel_tree_rules.json` 接入 Planner 的 TreeRuleEngine：先 normal/radius/From Nothing/Controlled Metamorphosis/Voices，再做 Timeless LUT。
