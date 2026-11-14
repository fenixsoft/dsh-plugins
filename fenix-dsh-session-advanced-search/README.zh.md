# fenix-dsh-session-advanced-search

dsh web 会话高级搜索插件（**独立页形态**）：host 半在 `/session-advanced-search` 注册一个自包含的独立高级搜索页面（零会话界面注入），以自然语言描述发起跨工作区会话分析任务——只读收集全部会话产物、机械预筛、经 profile 既有 LLM 单调用语义排序（失败降级机械评分），结果卡片点击跳回对应会话。

与侧栏原生搜索的差异：原生搜索按标题/内容子串精确匹配单工作区列表；本插件把「找那次修 XX 问题的会话」这类模糊意图交给 LLM 语义排序，且跨工作区（全部持久化会话）。

界面（页面骨架 / 步骤流 / 降级横幅 / composer 卡）以 `specs/optimize-session-advanced-search/prototype/`（`index.html` + 截图）为真相源。

> 形态沿革：v1 为会话界面注入（搜索框按钮 + 内容区视图），因官方 DOM 缝脆弱且干扰会话输入区，已按需求转向独立页。当前形态：会话界面唯一触碰点 = 官方搜索框旁「高级搜索」入口按钮（点击整页跳转独立页），搜索 UI 全部在独立页（`dsh.client.inject` 为空数组——零服务依赖；`src/client/` 仅保留入口按钮装配）。

## 机制

### 入口（`src/client/index.ts` + `src/client/searchButton.ts`）

会话界面唯一触碰点：官方侧栏搜索框（`input[class*="searchInput"]` 之后）注入「高级搜索」入口按钮（官方 IconSearchOutlineMedium 几何，MutationObserver 持续维护在位）。点击整页跳转独立页 `GET /session-advanced-search`——无覆盖层、不触碰会话 composer；独立页「返回会话」或浏览器后退回到主界面。锚点失配 warn 限流一次并放弃注入（不影响会话界面）。

### host 半

host 半 cordis Service（`static inject = ['webServer', 'sessionPersistence']`），装载期 `webServer.register` 四端点（Node 风格 `writeHead/end`）：

| 端点 | 语义 |
| --- | --- |
| `GET /session-advanced-search` | 独立高级搜索页（自包含单文件 HTML，`no-store`；HEAD 同头空体；其余方法 405） |
| `POST /api/session-advanced-search/jobs` | 建任务，立即返回 `{jobId}`（管线异步推进） |
| `GET /api/session-advanced-search/jobs/:id` | 轮询：`phase` + `results`（终态）+ `degraded` + `degradedReason?` + `progress?`（过程步骤流，可选扩展字段，向后兼容） |
| `DELETE /api/session-advanced-search/jobs/:id` | 取消（幂等：不存在 404，已终态 200 noop） |

### 页面（`src/host/page.ts`）

单文件 HTML（DSH light 令牌），与定稿原型同源：

- **底部 composer**：居中 max 952px / radius 28px 输入卡（与 DSH 会话输入区一致），Enter 或发送按钮提交；空查询禁提交。
- **AI 分析步骤流面板**：轮询载荷 `progress[]` 按 canonical `collecting → filtering → analyzing → done` 渲染（完成 ✓ / 进行中 spinner + 流点 / 失败 ✕；host 实报 detail 原样展示，不伪造中间进度）；status-pill 本地计时逐 0.1s 刷新「分析中 · X.Xs」；在途时提供「中断」按钮 = `DELETE` 在途任务。
- **降级横幅**：终态 `degraded=true` 时按 `degradedReason` 精确映射中文文案（见下表）；`credential-missing` 附「前往模型设置配置凭证」与「仅重试 AI 分析」两动作按钮。
- **结果列表**：标题 / 工作区 chip / 活动时间 / 命中理由 / 置信度条（AI 排序蓝渐变、机械灰）+ 排序方式标注。
- **会话跳转缝**：结果卡点击 → `localStorage['dsh.sessions.current'] = {"sessionId":...}` → `location.href='/'`——DSH 官方 workspace 启动时 `restoreSelection` 读取该键并打开对应会话（跨工作区天然支持）。顶栏「返回会话」= 直接回 `/`。
- **轮询容错**：700ms 间隔，连续 2 次失败才判失败；401 显式给「打开 DSH 登录」入口。

### 分析管线（单轮）

1. **collecting**：`sessionPersistence.list()` 全量会话快照 → `sessionController.list()` 增强 title/活动时间 → **cold 会话 title 折叠回退**（controller.list 对未激活会话只回投影缓存且永不折叠，无缓存行 title 恒空——对时间过滤后仍无投影 title 的会话，`open()` 只读事件流折叠最后一条 `session/title` 事件补齐标题，最近活跃优先、上限 200，单会话失败跳过不中断；同一会话的事件流读取同时提取首条用户消息供节选复用，每会话至多读一次）。
2. **filtering**：机械预筛——标题/内容关键词命中计分（多词 AND 优先、子串兜底），按分排序取 `maxCandidates` 上限（同分取最近活跃）。
3. **analyzing**：LLM 语义排序——路由解析优先级 插件配置 `analyzeRoute` > `ctx.agentDefaultModel.currentSelection()` 默认路由；`ctx.llm.stream` 单调用，输出 JSON 排名解析回会话 id，取 `topN`。**超时硬解耦**：流消费 promise 与超时 marker `Promise.race` 竞速——`llmTimeoutMs` 到点立即降级返回，不依赖底层流闭合（pi-ai 惰性流 abort 不返回的实证根因）；外部取消（DELETE）优先于超时（不降级不产出）。**凭证预检**：发起调用前按路由 provider 读 credential-ref（llm providers 投影优先，缺失按 dsh 命名约定 `<ROUTE 大写蛇形>_API_KEY` 派生），进程环境非空或 `ctx.credentials` 凭据库已配置才放行；两处皆无 → 不发起调用快速失败降级（`credential-missing`）；缝/形状漂移 warn 一次跳过预检（不误杀，由超时硬解耦兜底）。

LLM 缝为可选缝（不进 `static inject`，管线执行期 `ctx.get` 探测），避免宿主服务缺失时插件永不激活。

### 降级矩阵

| 触发 | 行为 | 用户可见 |
| --- | --- | --- |
| LLM 服务缝缺失 / 默认路由缺失 | 机械评分排序（预筛序原样） | 结果可用 + 降级横幅（`degraded=true`，原因 `llm-missing`） |
| 分析路由凭证缺失（env 与凭据库皆未配置） | 不发起调用，快速失败 | 横幅（`credential-missing`）+ 两动作按钮 |
| LLM 调用超时（`llmTimeoutMs` 硬上限） | 同上 | 横幅（`timeout`） |
| LLM 调用失败（流中断等） | 同上 | 横幅（`call-failed`） |
| LLM 输出解析失败（含零有效行） | 同上 | 横幅（`parse-failed`） |
| 空候选（预筛零命中） | 直接空态完成，不走 LLM | 空态文案（非降级） |
| host `enabled=false` | 零注册（info 停用） | 页面与 API 均 404 |
| 页面轮询遇任务 404 | —— | 「任务已丢失（宿主可能已重启）」 |

**降级横幅原因 → 文案映射**（`UI_TEXT.degradedReasonText`，缺项回退「LLM 分析不可用，已按机械匹配排序」）：

| degradedReason | 横幅文案 |
| --- | --- |
| `llm-missing` | LLM 分析服务不可用，已按机械匹配排序 |
| `credential-missing` | 分析模型路由缺少凭证，已按机械匹配排序 |
| `timeout` | 分析超时，守卫已中断等待，已按机械匹配排序 |
| `call-failed` | 模型调用失败，已按机械匹配排序 |
| `parse-failed` | 分析输出解析失败，已按机械匹配排序 |

任务被取消（DELETE 或宿主重启丢任务表）：`cancelled` 中断机械回退无意义，直接静默退出。

## 配置（loader config）

| 键 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 总开关：false 时 host 零注册（页面与 API 均不存在） |
| `maxCandidates` | `number` | `30` | 机械预筛候选集上限（评分优先、同分取最近活跃截断），约束 LLM 输入规模 |
| `topN` | `number` | `5` | LLM 排序后返回的 Top-N 候选数量 |
| `llmTimeoutMs` | `number` | `120000` | LLM 单调用端到端超时（毫秒），超时回退机械评分排序。默认值按实机标定取 2 倍余量：bigmodel-cn/glm-5.3-flash 对 30 候选的真实排序耗时 60~70s |
| `analyzeRoute` | `object?` | （缺省） | 可选 `{ provider, model }`（均非空串）：把语义分析路由指到指定 provider/model，优先于 profile 默认路由——典型用途是路由到有凭证的 provider（凭证预检按该 provider 判定） |

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

3. **重启 dsh-web（web profile 宿主进程）**：以上两步改的是 profile 目录文件，**必须重启 web profile 宿主进程才生效**（例如 `systemctl restart dsh-web`，或按部署形态重启对应服务/容器）。重启后 host 半随 loader 清单装载并注册页面路由。

安装后访问 `http://<dsh-web 地址>/session-advanced-search` 即独立高级搜索页。

## 回滚

移除第 2 步的 insert 片段（`cordis.patch.yml` 中 `fenix-dsh-session-advanced-search` 两条）并重启 profile 即完成卸载——插件零持久化写入（只读收集，不落任何台账/备份目录），无数据残留。第 1 步的 workspace link 可保留（不装载即不生效）。

## 已知限制

- **页面与 API 不经 webserver auth 层**：与既有插件路由（fenix-dsh-auth 的注册形态）行为一致，插件注册路由不挂官方登录门。本插件页面能列出全部会话标题与内容节选——**若 dsh-web 暴露到不可信网络，须在网关层自行加鉴权**（当前部署仅监听本机回环，可接受）。
- **会话跳转依赖官方深链缝**：`localStorage['dsh.sessions.current']` 的 JSON 形状（`{sessionId}`）取自 0.2.2-rc.1 workspace bundle 的 `restoreSelection` 实现；官方若改持久化键名/形状，跳转退化为仅回首页（不报错）。修缝 = 调整 `src/host/page.ts` 内 `jumpToSession` 一处。
- **设置导航缝未接**：降级横幅「前往模型设置配置凭证」按钮在独立页形态下跳转 `/`（回主界面自行前往设置）；官方提供可编程设置导航缝后可直达。
- **不展示查询语法 chips**：原型含 `ws:` / `since:` / `in:` 语法提示装饰，host 管线未实现前缀语法解析（自然语言即全部输入面），实装不保留——避免宣传未实现的语法。
- **client 半休眠**：`src/client/` 与 `lib/client.js` 保留但不再装配（`package.json` 无 `dsh.client` 块，loader 不会加载）；相关测试仍维护，作为未来可能的官方缝回归保险。
- **单在途任务以页面为单位**：同一页面同时只有一个在途任务（新提交先 DELETE 旧任务再新建；中断/关闭标签页不自动清理，任务由管线超时或完成自然收敛）。
- **LLM 排序质量受预筛截断约束**：`maxCandidates` 截断发生在 LLM 之前，关键词机械分低的会话不进语义排序；调大 `maxCandidates` 换召回、耗 token。
