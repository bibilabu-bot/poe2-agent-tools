# PoE2 Planner Desktop v0.2 — 本地数据缓存版

这一版把 Planner 的资源地址全部从公网 URL 改成 `poe2://` 本地资源协议。

## 运行
```bash
npm install
npm start
```

## 测试
```bash
npm test
```

该命令使用 Node.js 内置测试运行器，只验证纯逻辑：不启动 Electron，也不访问网络。

## Build 文件 IPC

Preload 仅暴露两个 Build 专用操作：

- `desktopAPI.saveBuildJson({ text, suggestedName? })`：接收最多 5 MiB 的序列化 Build UTF-8 文本，保存时确保末尾换行。
- `desktopAPI.openBuildJson()`：返回最多 5 MiB 的 UTF-8 `text`，由 Renderer codec 负责语义验证。

成功结果形如 `{ ok: true, canceled: false, filePath, text? }`。取消或失败结果形如 `{ ok: false, canceled, error: { code, message } }`，其中稳定错误码为 `CANCELED`、`INVALID_REQUEST`、`FILE_TOO_LARGE`、`READ_FAILED`、`WRITE_FAILED` 和 `REPLACE_FAILED`。文件路径始终由 Electron 系统对话框选择，Preload 不提供通用路径或文件读写能力。

## 保存与打开 Build

天赋树数据加载完成后，桌面版顶部会启用“打开 Build”和“保存 Build”。保存内容由 `renderer/build-state-adapter.js` 提取，再交给 `renderer/build-codec.js` 规范化序列化；打开时先用当前节点、职业、升华和灌注目录完成验证并构造完整候选状态，成功后才事务式替换 Planner 状态。取消、IPC 错误、致命诊断或应用失败都不会部分覆盖当前 Build。

兼容性警告会在 BUILD PLANNER 区域集中显示一次，总数不受详情上限影响，展开内容最多 100 条。已打开文件的未知字段和未解析 ID 保存在当前文档 sidecar 中，正常编辑后再次保存仍会保留；选择新职业或点击“重置 Build”会明确丢弃该 sidecar。

如果应用候选状态后连回滚也失败，界面会明确提示当前状态可能不一致并禁用保存；成功重新打开 Build 或重启应用后才能继续保存。

桌面页面只加载 `renderer/planner.js` 作为 Planner 运行入口。`renderer/index.html` 不再维护第二份内嵌 Planner 脚本。

本地复现检查：

```bash
cd apps/planner-desktop
npm test
npm run check
```

## 本地化逻辑
资源读取顺序：
1. `data/cache/` 内置资源（未来打进发布包）
2. Electron `userData/game-data/` 本机持久缓存
3. 两处都没有时，才从 GGG / GitHub CDN 下载一次并写入缓存

因此：第一次在线成功加载过以后，后续断网仍可完整使用已经缓存的核心树数据、图集、翻译与使用过的职业画像。

右下角 `Desktop ... · 本地数据 x/8` 可点击，主动重新同步 8 个核心数据文件。

## 为什么现在 data/cache/ 是空的
本次构建环境 DNS 出网不可用，无法可靠把几个 MB 的二进制 WebP 图集下载进 artifact。程序本身的本地化机制已经完成；在 Windows 本机首次运行会用 Electron 网络栈写入持久缓存。后续也可以直接把这些文件预放进 `data/cache/core/`，代码无需修改。
