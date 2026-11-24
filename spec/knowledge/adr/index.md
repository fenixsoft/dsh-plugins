# ADR 索引

| 编号 | 状态 | 摘要 |
| --- | --- | --- |
| [ADR-001](ADR-001-plugin-single-package-dual-half.md) | accepted | dsh 插件采用单包双半结构，Host 半与 Client 半同包交付 |
| [ADR-002](ADR-002-write-side-in-client-half.md) | accepted | 写入权集中在 client 半走官方写入路径，Host 半零写权限 |
| [ADR-003](ADR-003-node-builtin-deps-first.md) | accepted | 插件依赖优先 Node 内置模块，避免新增原生依赖 |
| [ADR-004](ADR-004-client-bundle-prebuilt-dual-entry.md) | superseded | client 半统一 tsdown 双入口构建，产物预构建交付（已被 ADR-007 分型裁定取代） |
| [ADR-005](ADR-005-llm-stream-timeout-hard-decoupling.md) | accepted | LLM 流式调用超时必须 Promise.race 硬解耦，不依赖底层流闭合 |
| [ADR-006](ADR-006-plugin-verify-isolated-profile.md) | accepted | 插件真机验证走隔离 profile，live 实例只读、刷新为文档化人工步骤 |
| [ADR-007](ADR-007-plugin-build-form-typed-by-client-half.md) | accepted | 插件构建形态按 client 半性质分型：展示层注入零构建、含 Host 业务逻辑插件 tsdown 构建 |
| [ADR-008](ADR-008-web-ui-injection-dom-discipline.md) | accepted | dsh web 展示层注入纪律：CSS-modules 键名锚定、display 级重组禁 reparent、失配零注入退出 |
