# 迁移记录

## 2026-09-08：ChatGPT 会话导出整理

本次以用户提供的导出目录为准覆盖 `main` 的项目内容，同时保留原 Git 历史。

完成内容：

- 将桌面版 `v0.2` 压缩包解包到 `apps/planner-desktop/`，作为主开发版本。
- 将浏览器版 `v13` 快照放入 `apps/planner-web/src/`。
- 将珠宝编译器 `v2` 解包到 `tools/jewel-compiler/`。
- 将匿名图片改为可识别名称，分别归档到截图和概念设计目录。
- 移除旧的占位说明，重写 README、架构说明和路线图。
- 增加适合 Node/Electron 与本地游戏数据缓存的忽略规则。

未迁入内容：

- 桌面版 `v0.1` 压缩包：已被 `v0.2` 完整取代。
- 原始 zip 文件：源码已经解包，避免 Git 中同时维护两份不可审查内容。
- `NEXT_STEPS.md`：内容已合并到 README 与 Roadmap。
