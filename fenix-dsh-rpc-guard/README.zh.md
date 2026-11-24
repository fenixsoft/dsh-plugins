# fenix-dsh-rpc-guard

dsh web 的 RPC 韧性护栏（client-only 插件，零构建）：给同源 `/api/*` 的 POST 请求加**响应头超时**，超时/断连时对**幂等端点自动重试**。

## 它解决什么问题

官方浏览器 RPC 通道 `createWebConnectionRpc`（`@deepseek-ai/dsh-client-connection` `lib/client.browser.js:1209-1232`）对响应**没有任何超时保护**：

```js
await send(url, { method: "POST", ...signal === void 0 ? {} : { signal } })
```

`signal` 仅当调用方传入时才存在。onboarding「保存并继续」的调用链（gateway invoke 层）**实际上会给每个 RPC 注入一个生命周期 AbortSignal**（2026-11-24 fetch 日志实测：所有 RPC 的 `init.signal` 均为 `AbortSignal` 且从不因超时 abort）——所以官方通道对响应丢失没有任何自身保护。一旦响应在链路上丢失——典型场景是经 frp 公网隧道（home.icyfenix.cn:3080，纯 HTTP）访问时连接断流/代理轮换/半开 TCP——这个 `await` 永不 settle：

- `ProviderEditor.apply()` 的 `finally { setBusy(false) }` 永不执行；
- busy 永久 true，「保存并继续」与「稍后配置」双双 `disabled`（`EditorFooter`，`lib/client.js:216`）；
- 界面冻死，只能强刷页面逃生；而**服务端写入其实早已成功**（凭据文件里已有值）。

2026-11-24 用户在 dsh 0.2.2-rc.1 现场复现的「输入 DeepSeek key 后界面卡住，只能点稍后配置」即此机制。

护栏把「永久冻死」变成「有界失败 + 自动恢复」：20 秒无响应头即断开本次尝试，幂等端点自动重试；重试耗尽则抛出明确错误，应用自身的 `finally` 释放 busy，按钮恢复可点、已输入的 key 保留在输入框。

## 行为细则

| 规则 | 值 |
| --- | --- |
| 接管范围 | 同源 `/api/*` 且 `method === POST` |
| signal 合并 | `init.signal` **已 aborted** → 原样放行（调用方已取消）；未 abort 的 signal（gateway 注入的生命周期信号）→ 合并进护栏超时（`addEventListener('abort')` 手动传导，兼容无 `AbortSignal.any` 环境）；应用主动 abort → 原样上抛其错误、绝不重试 |
| 其余原样放行 | 非 POST、跨源、非 `/api/` 路径、`init.keepalive`、body 为流/FormData/Blob 等不可重放形态 |
| 超时 | 响应头 20s（`localStorage.fenixRpcGuardTimeoutMs` 可调 1000–120000，每次调用即时读取）；响应头到达即撤表，**不干涉 body 流** |
| 自动重试端点 | `POST /api/credentials/set`、`POST /api/credentials/unset`（单 ref 整值覆写，天然幂等）；末段含 list/describe/catalog/get/query 词根的 camelCase 端点（如 `listProviders`、`modelCatalog`、`describe`，只读） |
| 重试预算 | 至多 2 次，退避 500ms / 1500ms |
| 其余 `/api` POST | 只超时不重试（避免副作用端点重复执行），超时抛 `[fenix-rpc-guard] …` 错误 |
| 装载幂等 | `window.__fenixRpcGuardInstalled` 防重入；与先于它安装的 fetch 包装自然链接 |

## 文件

- `client.js` — 浏览器半：fetch 护栏（零依赖，仅标准 Web API）。
- `index.js` — 宿主半占位（装载器要求入口存在；本插件不注册宿主扩展点）。
- `package.json` — `exports ./client`；`dsh.client.inject` 锚点 `@deepseek-ai/dsh-client-ui-settings-general`（仅为让 dsh 加载本 bundle）。

## 安装（写入某个 dsh profile）

```bash
# 1. profile 的 package.json：dependencies 加
#      "fenix-dsh-rpc-guard": "link:/root/dsh-plugins/fenix-dsh-rpc-guard"
#    dsh.profile.bundles 数组加 "fenix-dsh-rpc-guard"
# 2. 在 profile 目录执行包管理器 install（生成 node_modules 符号链接）
# 3. 重启该 dsh web 实例
```

## 验证（隔离实例 E2E，playwright，2026-11-24 全部通过）

场景 A——第一次 set 挂起（模拟隧道断流）：
1. 隔离实例：`DSH_HOME=/tmp/dsh-repro-home node /usr/bin/dsh --profile web --no-open --port 35555`。
2. playwright 拦截 `**/api/credentials/set` 的第一次请求使其 hang，其余透传；`fenixRpcGuardTimeoutMs = 3000`。
3. 预期（实测）：3s 控制台出现 `[fenix-rpc-guard] POST /api/credentials/set 超时(3000ms)，500ms 后第 1 次重试` → 重试透传，busy 释放，流程继续完成。无护栏时同一场景按钮永久 busy（已复现对照）。

场景 B——全部尝试挂起（彻底断流）：
- `set` 全部 hang。预期（实测）：`第 1 次重试(500ms)` → `第 2 次重试(1500ms)` → 抛出并显示于弹窗：`client api: credentials/set failed: [fenix-rpc-guard] POST /api/credentials/set 超过 3000ms 无响应，已重试 2 次仍失败——请检查网络/代理后重试`；busy 释放，「稍后配置」「保存并继续」均恢复可点，key 保留在输入框。

单元测试：`node /tmp/test-rpc-guard.cjs`（11 检查点，含生命周期 signal 超时兜底 5b、应用 abort 原样传播 5c、预 aborted 放行 5d）。
