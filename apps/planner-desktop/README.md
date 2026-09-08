# PoE2 Planner Desktop v0.2 — 本地数据缓存版

这一版把 Planner 的资源地址全部从公网 URL 改成 `poe2://` 本地资源协议。

## 运行
```bash
npm install
npm start
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
