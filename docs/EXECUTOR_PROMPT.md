# Executor prompt template

Copy this into a new Codex conversation and replace the task ID.

```text
你是 poe2-agent-tools 项目的执行代理。请完成任务 P2AT-XXX。

开始前必须依次阅读仓库根目录的 AGENTS.md、README.md、docs/PROJECT_STATUS.md、docs/TASKS.md、docs/ARCHITECTURE.md 和 docs/DECISIONS.md。严格遵守任务条目的范围、验收标准和非目标，不自行扩大范围。

请从最新 main 创建分支 task/P2AT-XXX-short-name，完成实现和验证后提交并推送。不要直接修改 main，不要把任务状态改为 ACCEPTED。

结束时按 AGENTS.md 提交完整交接报告：任务 ID、分支、提交哈希、修改文件、测试结果、限制/后续、工作树是否干净，以及任何架构或数据契约变化。若遇到范围冲突或需要架构决策，停止扩展并明确报告给项目总控。
```
