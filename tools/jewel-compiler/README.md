# PoE2 Jewel Compiler v2

这版把 Unique/特殊珠宝从“纯 seed”推进到可从 PoE2DB HTML 自动识别，并读取 PoB runtime 文件判断特殊规则证据。

## 完整数据运行
1. `node download_poe2_jewel_sources.mjs`
2. `node build-jewel-db.mjs`

## Fixture 验证

```bash
node --check download_poe2_jewel_sources.mjs
node --check build-jewel-db.mjs
node --check verify-fixture.mjs
node verify-fixture.mjs
```

`verify-fixture.mjs` 会在系统临时目录中复制并运行编译器，然后将生成的 JSON 与 `dist/` 中已提交的 fixture 输出比对。比对仅忽略 `compile_report.json` 中每次运行都会变化的 `compiled_at` 时间戳，不会修改当前工作树。

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
