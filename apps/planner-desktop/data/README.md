# Bundled game data

短期可继续使用远程 CDN 数据。

迁移到桌面后建议逐步把以下内容固化为本地资源：
- passive tree json
- sprite atlases
- translations
- jewel db
- timeless LUT

程序运行时可从这里读取内置版本，也可把更新版写入 Electron userData。
