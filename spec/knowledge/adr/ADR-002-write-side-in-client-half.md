# ADR-002：写入权集中在 client 半，Host 半零写权限

date: 2026-10-30
status: accepted

## Context

插件既要读外部数据源（如 cc-switch.db），又要向 dsh settings 写入 provider 配置与凭据。dsh 的官方写入通道是 `writeSettings` + `storeCredential`，其契约随 dsh 版本演进。若 Host 半自行实现写路径，等于绕开官方通道自担契约风险，且插件获得不受约束的写权限。

## Decision

读外部源放在 Host 半；对 dsh 的全部写入放在 Client 半，且只能走与 dsh 官方 UI 相同的 `writeSettings(pi-ai namespace, …)` + `storeCredential` 路径。Host 半不实现任何写入方法。

## Consequences

最小权限：Host 半即使被滥用也无写通道；dsh 写入契约变化的风险由与官方 UI 完全一致的 client 代码路径承担，升级时可观测、可对齐。代价是写入驱动逻辑位于 client bundle，依赖 client 半被正确装载与触发。
