# 交易记录页面 - 模块化版

这是从单文件版本拆出来的新项目。原单文件版本已在旧仓库用 `v2.0-singlefile` 标签封存。

## 目录

- `index.html`：页面结构，只保留 HTML 壳和资源入口。
- `src/styles/app.css`：从原页面抽离出的完整样式。
- `src/js/config.js`：业务配置，包括逻辑行、列、批次字段和存储键。
- `src/js/app.js`：当前应用主逻辑，已从 HTML 中解耦出来。
- `src/js/pwa.js`：Service Worker 注册逻辑。
- `sw.js`：PWA 离线缓存配置。
- `docs/architecture.md`：当前模块边界和后续解耦路线。

## 本地运行

在本目录启动静态服务器，例如：

```powershell
python -m http.server 3000
```

然后访问 `http://localhost:3000/`。
