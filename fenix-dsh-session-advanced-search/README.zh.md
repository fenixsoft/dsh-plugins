# fenix-dsh-session-advanced-search

dsh web 宿主侧会话高级搜索插件：在侧栏搜索框内注入「高级搜索」入口，弹窗以自然语言描述（可选时间范围）发起跨工作区会话分析任务——host 半只读收集全部会话产物、机械预筛、经 profile 既有 LLM 单调用语义排序（失败降级机械评分），结果列表一键跳转会话。

与侧栏原生搜索的差异：原生搜索按标题/内容子串精确匹配单工作区列表；本插件把「找那次修 XX 问题的会话」这类模糊意图交给 LLM 语义排序，且跨工作区（全部持久化会话）。

## 机制

双半装配，经 `lib/index.js`（host，ESM cordis 插件）与 `lib/client.js`（client，`window.__ModuleLoader__.load` CJS 工厂）两个独立产物分别进入 web profile 的 loader 清单与 client 模块表。

### client 半（入口 + 弹窗）

1. **搜索框注入缝**（DOM）：官方搜索框锚点 `input[class*="searchInput"]`（属性子串匹配，容忍构建哈希前缀漂移）；`input.after(button)` 注入入口按钮（即 clearButton 左侧）。`MutationObserver`（`documentElement` 子树）持续维护在位——官方重渲染移除后自动补插，侧栏懒挂载（面板未打开时锚点不存在）也由观察覆盖；去抖防热循环。锚点失配 warn 限流一次后放弃注入（不抛错）。
2. **弹窗**（React `createRoot`，自建容器挂 `document.body`）：描述输入（空/空白禁提交）、可选开始/结束日期（闭开区间，本地时区日界；结束早于开始禁提交）、关闭按钮与 Esc、关闭重开状态重置。提交 = `POST /api/session-advanced-search/jobs`，随后 1s 轮询任务状态（阶段文案：收集会话 → 语义排序）。同一弹窗单在途：在途期间再次提交先 `DELETE` 旧任务再新建；关闭弹窗同样 `DELETE` 在途任务。
3. **结果跳转**：候选行点击 → `uiWorkspace.openSession(sessionId)` 优先（跨工作区天然支持）；服务缝不可用时兜底侧栏列表项标题精确匹配 + `click()`；两者皆不可达 warn 不跳转（不抛错）。跳转前先关弹窗。

### host 半（HTTP API + 分析管线）

cordis Service（`static inject = ['webServer', 'sessionPersistence']`），装载期 `webServer.register` 三端点（Node 风格 `writeHead/end`，请求体上限 64KB）：

| 端点 | 语义 |
| --- | --- |
| `POST /api/session-advanced-search/jobs` | 建任务，立即返回 `{jobId}`（管线异步推进） |
| `GET /api/session-advanced-search/jobs/:id` | 轮询：`phase` + `results`（终态）+ `degraded` |
| `DELETE /api/session-advanced-search/jobs/:id` | 取消（幂等：不存在 404，已终态 200 noop） |

任务状态机：`collecting → filtering → analyzing → done | error | cancelled`（终态幂等）。管线单轮：

1. **collecting**：`sessionPersistence.list()` 全量会话快照 → `sessionController.list()` 增强 title/活动时间 → **cold 会话 title 折叠回退**（controller.list 对未激活会话只回投影缓存且永不折叠，无缓存行 title 恒空——对时间过滤后仍无投影 title 的会话，`open()` 只读事件流折叠最后一条 `session/title` 事件补齐标题，最近活跃优先、上限 200，单会话失败跳过不中断；同一会话的事件流读取同时提取首条用户消息供节选复用，每会话至多读一次）。
2. **filtering**：机械预筛——标题/内容关键词命中计分（多词 AND 优先、子串兜底），按分排序取 `maxCandidates` 上限（同分取最近活跃）。
3. **analyzing**：LLM 语义排序——`ctx.agentDefaultModel.currentSelection()` 取默认路由 + `ctx.llm.stream` 单调用，输出编号列表解析回会话 id，取 `topN`；端到端 `llmTimeoutMs` 超时守卫。

LLM 缝为可选缝（不进 `static inject`，管线执行期 try/catch 探测），避免宿主服务缺失时插件永不激活。

### 降级矩阵

| 触发 | 行为 | 用户可见 |
| --- | --- | --- |
| LLM 服务缝缺失 / 默认路由缺失 | 机械评分排序（预筛序原样） | 结果可用 + 顶部「降级」横幅（`degraded=true`，原因 `llm-missing`） |
| LLM 调用超时（`llmTimeoutMs`） | 同上 | 横幅（`timeout`） |
| LLM 调用失败（流中断等） | 同上 | 横幅（`call-failed`） |
| LLM 输出解析失败（含零有效行） | 同上 | 横幅（`parse-failed`） |
| 空候选（预筛零命中） | 直接空态完成，不走 LLM | 空态文案（非降级） |
| `uiWorkspace` 缺失/形态漂移 | 侧栏列表项标题匹配 `click()` 兜底 | 未命中时 warn，弹窗保持打开 |
| 搜索框锚点失配 | warn 限流一次，放弃注入 | 入口缺失（见「已知限制」修缝指引） |
| host `enabled=false` | 零注册（info 停用） | POST 404 → 弹窗显式「高级搜索服务未启用」 |

任务被取消（DELETE 或宿主重启丢任务表）：`cancelled` 中断机械回退无意义，直接静默退出；轮询 404 → 弹窗「任务已丢失（宿主可能已重启）」。

`enabled=false` 为合法零动作停用；必选服务缝漂移（`webServer.register` / `sessionPersistence.list+open` 形态不符）为 error 级显式停用。

## 配置（loader config）

| 键 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 总开关：false 时 host 零注册路由；client 半无法感知宿主配置（见已知限制） |
| `maxCandidates` | `number` | `30` | 机械预筛候选集上限（评分优先、同分取最近活跃截断），约束 LLM 输入规模 |
| `topN` | `number` | `5` | LLM 排序后返回的 Top-N 候选数量 |
| `llmTimeoutMs` | `number` | `60000` | LLM 单调用端到端超时（毫秒），超时回退机械评分排序 |

## 安装（人工步骤）

以下三步均为**人工步骤**（涉及 profile 目录与宿主重启，不随插件构建自动完成）：

1. **目录进 profile pnpm workspace**：在 `/root/.dsh/profiles/web/package.json` 的 `dependencies` 追加：

   ```json
   "fenix-dsh-session-advanced-search": "link:/root/dsh-plugins/fenix-dsh-session-advanced-search"
   ```

   然后在 `/root/.dsh/profiles/web/` 内执行 `pnpm install`。

2. **loader 清单 insert 登记**：在 `/root/.dsh/profiles/web/cordis.patch.yml` 追加（对齐 fenix-dsh-auth / fenix-dsh-settings-dock 先例形态；插件仓库内的 `cordis.patch.yml` 即此片段的单源）：

   ```yaml
   - insert:
       - id: fenix-dsh-session-advanced-search
         name: fenix-dsh-session-advanced-search
   ```

3. **重启 web profile**：重启后 client 半随 client 模块表下发，host 半随 loader 清单装载。

client 半的产物 `lib/client.js` 经 `package.json` 的 `exports["./client"]` 暴露，由 dsh client-modules 机制（`__ModuleLoader__` 工厂）加载；`inject: ['uiWorkspace']` 声明消费的服务键。

## 回滚

移除第 2 步的 insert 片段（`cordis.patch.yml` 中 `fenix-dsh-session-advanced-search` 两条）并重启 profile 即完成卸载——插件零持久化写入（只读收集，不落任何台账/备份目录），无数据残留。第 1 步的 workspace link 可保留（不装载即不生效）。

## 已知限制

- **搜索框锚点签名**（官方升级后第一修缝点，`src/client/searchButton.ts` 的 `ANCHOR`）：0.2.2-rc.1 发行包实证，官方搜索框（WorkspaceBrowser，侧栏面板内）DOM 层级为
  `div.<hash>_searchSlot > div.<hash>_search > button.<hash>_searchButton / input.<hash>_searchInput / button.<hash>_clearButton（仅展开态渲染）`，
  类值带构建哈希前缀（会漂移），键名稳定——锚点签名取 `input[class*="searchInput"]` 属性子串匹配。官方若改名 `searchInput` 键或改用非 input 元素，注入静默放弃（warn 限流一次）；修缝 = 改 `ANCHOR.inputSelector` 一处。
- **client 半无法感知 host `enabled`**：dsh client-modules 不下发插件配置，`enabled=false` 时 client 仍注入入口与弹窗，POST 得 404 后显式提示「高级搜索服务未启用」。属显式接受的偏差（`enabled` 实际约束 host 注册面）。
- **单在途任务以弹窗为单位**：同一 client 半同时只有一个在途任务（新提交/关弹窗均 DELETE 旧任务）；多弹窗场景不存在（单例 React root）。
- **跳转兜底的标题匹配是精确相等**：`uiWorkspace` 不可用时按结果行 title 与侧栏列表项 `textContent.trim()` 精确匹配后 `click()`；标题渲染带前后缀修饰（未读标记等）时未命中，仅 warn。
- **LLM 排序质量受预筛截断约束**：`maxCandidates` 截断发生在 LLM 之前，关键词机械分低的会话不进语义排序；调大 `maxCandidates` 换召回、耗 token。
