# ADR-004：client 半统一 tsdown 双入口构建，产物预构建交付

date: 2026-10-30
status: superseded
Superseded by: ADR-007(插件构建形态按 client 半性质分型)

## Context

dsh client-modules 装载机制要求插件包内 client 半构建产物 `lib/client.js` 已存在，缺失则插件激活即报错；Host 半入口 `lib/index.js` 走同一构建链。这是 dsh 的官方构建要求，非可选优化。

## Decision

本仓库全部插件统一用 tsdown 做双入口构建：`lib/index.js`（Host 半）与 `lib/client.js`（Client 半）。交付与验收以「pnpm build 产出双入口产物齐备」为门槛；本地构建产物经 .gitignore 忽略，不入库。

## Consequences

安装方无需构建步骤，插件安装即可激活；测试与验收把双入口产物齐备当作交付门槛，漏构建会在激活期立刻暴露。代价是仓库需统一维护 tsdown 双入口配置，且部署 profile（pnpm workspace 安装）必须保证构建步骤被执行。
