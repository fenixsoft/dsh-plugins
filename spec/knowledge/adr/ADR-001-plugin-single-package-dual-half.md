# ADR-001：dsh 插件采用单包双半结构

date: 2026-10-30
status: accepted

## Context

本仓库是 dsh 第三方插件集合。dsh 插件常需同时具备两端能力：Host 半（cordis 插件，注册 Remote 服务）与 Client 半（web bundle，做 UI 注入与交互驱动）。dsh 的插件装载机制经 `package.json` 的 `dsh.client` 声明天然支持一个插件包同时携带两端。若拆成两个独立插件包，安装面（workspace 注册、loader 条目、版本对齐）会凭空翻倍。

## Decision

需要双端能力的 dsh 插件一律做成单包双半：Host 半与 Client 半同属一个插件包，由 dsh 装载机制同时加载，统一版本、统一安装。

## Consequences

安装面最小：一个包、一条 loader 条目、一次重启。包内两端同版本演进，不会出现 host/client 契约错位。代价是单包内并存两套源码与构建入口（host `lib/index.js` + client `lib/client.js`，见 ADR-004），构建配置略复杂。
