# ADR-007：插件构建形态按 client 半性质分型

date: 2026-11-24
status: accepted

## Context

ADR-004 裁定本仓库全部插件统一 tsdown 双入口构建。仓内插件实际已分化为两类：含 Host 业务逻辑的插件（cc-import、session-advanced-search、dashboard-bridge——有路由/LLM 调用/数据写入）与纯浏览器侧展示层注入插件（settings-dock、chat-polish、sidebar-tabs——client.js 直接操作官方 DOM，Host 半仅空 `apply()` 满足 loader 可加载性）。后者没有可构建的源差异：无 TS 类型链、无依赖、无测试构建面，走 tsdown 只增加无产出的构建环节。

## Decision

插件交付形态按 client 半性质分型：纯浏览器侧展示层注入插件零构建——源码即产物，`exports` 三入口直接指向包根 `index.js`/`client.js`，无 `scripts.build`、无新增依赖；含 Host 业务逻辑的插件维持 tsdown 双入口构建（`lib/index.js`/`lib/client.js`）。两条形态共同的不变量不变：装载机制要求 exports 指向处的 client 半产物已存在——零构建形态由源文件本身满足，构建形态由构建步骤满足；交付与验收门槛 = 对应形态产物齐备，安装方零构建步骤。

## Consequences

展示层插件免构建链维护，源码与浏览器执行体一致，签名字证可直接锚定源文件；代价是零构建半没有类型检查与打包校验，靠 `node --check` 与真机走查兜底。ADR-004「全部插件统一 tsdown」的裁定随之废止，仅在含 Host 业务逻辑插件范围内成立。
