# ADR-003：插件依赖优先 Node 内置模块，避免原生依赖

date: 2026-10-30
status: accepted

## Context

dsh 插件的原生依赖需要 allowlist，原生依赖会放大安装面与跨平台负担。cc-import 需要读取 SQLite 数据库（cc-switch.db），传统做法是引入 better-sqlite3 之类原生包。

## Decision

插件依赖策略为 Node 内置模块优先：能用内置模块（如 `node:sqlite`）实现的能力不引入 npm 原生依赖；确需原生依赖时按 dsh allowlist 流程单独评估。

## Consequences

零新增原生依赖，安装与跨平台风险最小。代价是绑定较新的 Node 运行时（`node:sqlite` 需 Node 24 一档）；Node 版本约束由宿主 dsh 运行时统一兜住。
