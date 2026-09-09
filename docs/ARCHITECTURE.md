# 项目结构

## 桌面规划器

`apps/planner-desktop` 是当前主应用。

- `electron/main.cjs`：Electron 主进程、本地资源协议和窗口生命周期；运行时来源由 canonical lock 解析。
- `electron/runtime-resource-store.cjs`：纯 Node 的 runtime lock 映射、SHA-256/大小验证、缓存选择和安全替换。
- `electron/preload.cjs`：受控的 Renderer API 边界。
- `renderer/index.html`：界面、样式与页面结构。
- `renderer/planner.js`：天赋树数据加载、绘制、路径、分配、翻译与交互逻辑。
- `data/cache/manifest.json`：需要缓存的核心远程资源清单。
- `src/jewels/`、`src/rules/`：后续珠宝系统和规则引擎的模块边界。

安全基线：`contextIsolation` 开启，`nodeIntegration` 关闭；文件系统能力只通过 preload 暴露的窄接口提供。

## 浏览器原型

`apps/planner-web/src` 是迁移基准快照。`index.html` 可独立运行，并内嵌了当时的脚本；`planner.js` 是同一阶段保留的独立脚本副本。新功能优先进入桌面版，除非明确需要维持 Web 版。

## 珠宝编译器

`tools/jewel-compiler` 将多个上游来源规范化为 Planner 可消费的 JSON：

1. `download_poe2_jewel_sources.mjs` 下载数据到 `raw/`。
2. `build-jewel-db.mjs` 解析并生成 `dist/` 数据。
3. `planner-jewel-contract.json` 描述 Planner 集成所需的数据契约。

当前 `raw/` 是小型可运行 fixture，`dist/` 是对应的示例结果。

## 外部依赖

项目运行时依赖 GGG 数据导出、社区天赋树资源和 PoB2 中文翻译。Planner 运行时从仓库级 `data/upstream-sources.lock.json` 取得不可变 URL 和完整性信息；`data/cache/manifest.json` 只把本地核心文件名映射到 lock ID。上游更新必须先通过人工批准的 lock promotion，不能直接跟随移动分支。珠宝编译器迁移到该 lock 属于后续任务。
