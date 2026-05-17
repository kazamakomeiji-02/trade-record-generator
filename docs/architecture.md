# 模块化边界

当前拆分是第一阶段，目标是把原本难维护的单文件页面拆成可继续解耦的项目结构。

## 当前边界

- `index.html` 只负责页面结构和资源入口。
- `src/styles/app.css` 承载原页面完整样式，后续可以继续拆成基础样式、布局和组件样式。
- `src/js/config.js` 放置稳定业务配置，例如标签行、逻辑列、持仓批次字段和本地存储键。
- `src/js/app.js` 保留主业务流程，已经从 HTML 中移出，并通过配置模块读取业务常量。
- `src/js/pwa.js` 只负责注册 Service Worker。
- `sw.js` 只负责 PWA 离线缓存清单和 fetch 策略。

## 下一步建议

1. 把 `app.js` 继续拆成 `storage`、`records`、`calculator`、`archive`、`trial`、`ui` 几个模块。
2. 把所有 DOM id 查询集中到一个视图层，业务计算函数只接收普通数据并返回普通数据。
3. 给导入导出、盈亏计算、交易日计算这些纯函数补单元测试。
4. 将样式按 `base`、`layout`、`components`、`pages` 分层，减少后续 UI 改动互相影响。
