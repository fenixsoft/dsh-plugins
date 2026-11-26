# dsh 环境装配手册：dsh 运行时 + fenix 插件全家桶

> **本手册由 dsh-plugins 仓库维护**（原 fenixd `docs/install.md` §2 / §6 及 §10/§11 的
> dsh 插件相关行已整体迁入）。插件清单与装配循环由本仓
> `scripts/gen_plugin_docs.py` + `plugin-doc-sync` workflow 自动同步——新增插件合并进
> main 后数分钟内清单自动更新，无需人工回改消费侧文档。
>
> 配套阅读（fenixd 侧，安装框架本体、Claude Code 通道、daemon 与自动更新）：
> [fenixd 安装手册](https://raw.githubusercontent.com/fenixsoft/fenixd/refs/heads/main/docs/install.md)
> （网页版：[github.com/fenixsoft/fenixd/blob/main/docs/install.md](https://github.com/fenixsoft/fenixd/blob/main/docs/install.md)）。
> 读者画像：**已有 dsh 环境**（桌面版 / `dsh web`）并要装 fenix 插件全家桶的用户；
> 只用 Claude Code 不用 dsh 的用户不需要本手册。
>
> 前置：Node ≥ 24（`npm install -g` 自带）、git；源码路径另需 pnpm ≥ 10。

## 1. 安装 dsh 运行时

> 桌面版用户注意：`dsh` CLI 与桌面版**共享同一份 `DSH_HOME`（`~/.dsh`）**——§4 用 CLI 把
> 插件注册进你现有实例的 profile 后，桌面版重启即加载，不需要再单独装一套 dsh。

```bash
npm install -g @deepseek-ai/dsh          # 安装最新稳定版（不钉版本）
dsh --version                            # 打印版本号即可（长时间无输出先怀疑 registry 连通性，可加 --no-audit --no-fund）
```

> npm `latest` tag 可能落在 rc 线（实测曾为 0.2.2-rc.1），属正常；实际兼容锚以
> dsh-bundle 的 `peerDependencies`（fenixd 手册 §7）为准，不符时按本手册 §4
> `allow-version` 放行。

> 版本说明：手册基线是 dsh **最新稳定版**。fenixd 的 headless bundle（fenixd 手册 §7）
> 以 peerDependencies 声明兼容的 dsh 版本线，版本不符时 dsh 经
> `evaluatePluginCompatibility` **跳过 bundle**（stderr 报版本错误、不静默降级），
> fenixd headless 车道随即以 `MISSING_CREDENTIAL` 退出——此时按本手册 §4 的
> `allow-version --accept-risk` 显式放行，或与 fenixd 仓库同步升级 bundle。

## 2. profile 判定：作用于现有环境，不建并行环境

> 每个 dsh 实例（桌面版 / `dsh web`）都有一个**装配 profile**，位于 `$DSH_HOME/profiles/<P>/`
>（`DSH_HOME` 缺省 `~/.dsh`，Windows 为 `%USERPROFILE%\.dsh`；`<P>` 的确定见下）。
> 装配 = **pnpm workspace 依赖（link: 形态）** + **package.json bundles 数组** + **cordis.patch.yml loader 条目** 三件套。
>
> **设计承诺**：本阶段的全部注册——插件、loader 条目、provider 配置——都写进
> **你正在使用的 dsh 实例（桌面版 / `dsh web`）实际加载的那个 profile**。
> 装完重启该实例即可看到变化；**全程不新建、不并行另一套 GUI 环境**。
> dsh 桌面版与 CLI 共享同一个 `DSH_HOME`（`~/.dsh` / `%USERPROFILE%\.dsh`），
> 因此用 `dsh plugin` 命令写进 profile 的内容，桌面版重启后同样生效。
> 桌面版与 CLI 的**版本可能不同步**（如桌面版内置 rc.3、npm CLI 为 rc.1）：
> 各 profile 的插件版本门由各自宿主判定（fenix profile 按 CLI、desktop 按桌面版），
> 共享 DSH_HOME 但不共享版本裁决。

先确定 profile 名，下文统一以 `<P>` 代指：

- **dsh 桌面版用户**：桌面版 设置页 显示当前 profile（通常为 `desktop`）；`$DSH_HOME/profiles/`
  下 `desktop`（Electron 专用，**CLI 不可管理**——`dsh plugin` 对它硬性拒绝，报
  `profile "desktop" is managed exclusively by the Electron application`）或 `web`（CLI 出厂）；
- **`dsh web` CLI 用户**：你的启动命令里 `--profile` 参数；从未指定过则是出厂 `web`。

```bash
dsh plugin --profile <P> list     # 能列出（可能为空）插件清单即 profile 正确、可写
```

> **desktop profile 的插件装配走专用路径（不用上面命令）**，见 §4 末尾的分流说明；
> `dsh plugin` 命令仅适用于 CLI 自建/管理的 profile（`web`、`fenix` 等）。
>
> `web` 是出厂 profile，**不能**作为 `--from-default-profile` 的拷贝目标（带了直接报错）；
> 首次 `dsh plugin --profile <P> add ...`（§4）会自动初始化 profile 目录并自动维护依赖与 bundles 数组。

## 3. 获取 dsh-plugins 制品

**制品路径（默认）**：dsh-plugins 与 fenixd 同为公开仓库，Release 资产匿名直下；
插件 `lib/` 已在发布流水线预构建——**免 Node 工具链**：

```bash
# Linux/macOS（Git Bash 同理）
V=$(curl -s https://api.github.com/repos/fenixsoft/dsh-plugins/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
curl -L -o "dsh-plugins-${V}.zip" "https://github.com/fenixsoft/dsh-plugins/releases/download/${V}/dsh-plugins-${V}.zip"
unzip -q "dsh-plugins-${V}.zip" -d <用户确认的目录>
# 下文以 <plugins> 指代 <用户确认的目录>/dsh-plugins-<版本号>（插件目录数随版本演进：
# v0.1.2 为 10 个；v0.1.3 起新增 fenix-dsh-rpc-guard、fenix-dsh-sidebar-tabs 共 12 个，lib/ 已构建）
```

```powershell
# Windows（PowerShell）
$V = (Invoke-RestMethod "https://api.github.com/repos/fenixsoft/dsh-plugins/releases/latest").tag_name
Invoke-WebRequest "https://github.com/fenixsoft/dsh-plugins/releases/download/$V/dsh-plugins-$V.zip" -OutFile "dsh-plugins-$V.zip"
Expand-Archive "dsh-plugins-$V.zip" -DestinationPath <用户确认的目录>
# <plugins> = <用户确认的目录>\dsh-plugins-<版本号>
```

**源码路径（仅开发者）**：`git clone https://github.com/fenixsoft/dsh-plugins.git`
后逐插件安装依赖并**条件构建**（部分插件免构建——`exports` 直指仓库根源码；
Node ≥ 24 / pnpm ≥ 10；制品路径用户**整段跳过**）：

<!-- fenix:auto-plugin-list:build BEGIN（scripts/gen_plugin_docs.py 生成，勿手改） -->
```bash
for p in cc-import fenix-dsh-auth fenix-dsh-brand-fenix fenix-dsh-chat-polish \
         fenix-dsh-clipboard-fallback fenix-dsh-dashboard-bridge fenix-dsh-rpc-guard \
         fenix-dsh-session-advanced-search fenix-dsh-session-grouper \
         fenix-dsh-settings-dock fenix-dsh-sidebar-tabs fenix-skill-provider; do
  (cd <plugins>/$p && pnpm install && pnpm run --if-present build) || echo "BUILD FAIL: $p"
done
```
<!-- fenix:auto-plugin-list:build END -->

**验证门 E-build**：以各插件 package.json 的 **`exports` 字段为准**，逐条核验其指向的
文件存在（有构建步的插件产物在 `lib/`，免构建插件直指仓库根文件；部分插件 `main` 与
`exports` 双写）。`Command "build" not found` = 该插件免构建，**预期行为**，不是失败。

**bundle / plain 分流清单**（决定装载机制，§4 注册前先判别）：

<!-- fenix:auto-plugin-list:catalog BEGIN（scripts/gen_plugin_docs.py 生成，勿手改） -->
当前 `main` 共 **12 个插件**（bundle 7 + plain 5）：

- 声明 `dsh.bundle`（→ 进 bundles 数组，宿主侧启动挂载）：fenix-dsh-auth、fenix-dsh-chat-polish、fenix-dsh-clipboard-fallback、
  fenix-dsh-rpc-guard、fenix-dsh-session-advanced-search、fenix-dsh-settings-dock、
  fenix-dsh-sidebar-tabs；
- 未声明（**只能**走 §5 loader insert，不得进 bundles）：cc-import、fenix-dsh-brand-fenix、fenix-dsh-dashboard-bridge、
  fenix-dsh-session-grouper、fenix-skill-provider。
<!-- fenix:auto-plugin-list:catalog END -->

判别命令（在 `<plugins>` 目录执行）：

```bash
node -e "for (const p of require('fs').readdirSync('.').filter(d=>!d.startsWith('.'))) { try { const j=require('./'+p+'/package.json'); if(j.dsh) console.log(p.padEnd(36), j.dsh.bundle?'bundle':'plain', JSON.stringify(j.peerDependencies&&Object.keys(j.peerDependencies).filter(k=>k.startsWith('@deepseek-ai'))||[])) } catch(e){} }"
```
（第三列输出 peer 对 `@deepseek-ai/*` 的钉版——精确钉版在更新的 dsh 上会被版本门跳过，
属预期，见 §9「版本门跳过」。plugin-manager 里版本门跳过的判定特征：该项
**`enabled=false` 且 `fiberPhase=null`**（loader enabled:false），比翻找 stderr 直观——
数到的 active 数比插件总数少一个（session-grouper 版本门跳过）即正常：v0.1.2 制品
10 个插件为 9/10，v0.1.3 起 12 个插件为 11/12。）

> `pnpm add link:` / plugin-manager 安装时的警告
> `linked in dependency will not resolve the peer dependencies … use file:` 为**预期噪音**：
> peer 由 dsh 宿主运行时解析，不代表失败，勿中断重试。

## 4. 注册进 profile workspace

<!-- fenix:auto-plugin-list:register BEGIN（scripts/gen_plugin_docs.py 生成，勿手改） -->
```bash
cd ~/.dsh/profiles/<P>
for p in cc-import fenix-dsh-auth fenix-dsh-brand-fenix fenix-dsh-chat-polish \
         fenix-dsh-clipboard-fallback fenix-dsh-dashboard-bridge fenix-dsh-rpc-guard \
         fenix-dsh-session-advanced-search fenix-dsh-session-grouper \
         fenix-dsh-settings-dock fenix-dsh-sidebar-tabs fenix-skill-provider; do
  dsh plugin --profile <P> add "link:<plugins绝对路径>/$p"
done
```
<!-- fenix:auto-plugin-list:register END -->

> Windows 下 link 路径写绝对盘符形态：`dsh plugin --profile <P> add "link:C:\repo\dsh-plugins\cc-import"`。
> ⚠ 必须用 `link:` 软链形态——`file:` 拷贝装会使副本失去 `node_modules`、peer 断链（真机踩过）。
>
> `plugin add` 报版本风险拦截（`to accept the risk, run: dsh plugin ... allow-version ...`）时，
> 按提示显式放行后重装：`dsh plugin --profile <P> allow-version <pkg>@<version> --dsh-version <已装dsh版本> --accept-risk`。
> 注册时打 `warning: declares no dsh.bundle — installed as a plain dependency` 也是**预期行为**
> （这类插件靠 §5 的 insert 条目装载，不进 bundles）。**不要**把它们手工塞进
> `dsh.profile.bundles`——boot 时会被 `skip with errors` 拒载（E2E 实证）。

**非 loopback 主机名访问 GUI 时必装**（frp/域名反代场景；仅 127.0.0.1 访问可跳过）：

```bash
dsh plugin --profile <P> add github:6mt/dsh-plugin-loopback-trust
```

`plugin add` 会自动维护 `dsh.profile.bundles`（声明了 `dsh.bundle` 的插件自动入列，无需手工编辑）。
仅在绕过 plugin add 手工改 package.json 时才需要对照下面的形状：

```jsonc
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "dsh-plugin-loopback-trust",     // 非 loopback 访问时
  // …保留既有条目（仅列声明了 dsh.bundle 的插件；plain 型禁止入列）
] } }
```

**desktop profile（桌面版）专用装配路径**——`dsh plugin` 对它不可用，按分流走：

1. **bundle 型插件（§3 清单 bundle 型，v0.1.3 起为 7 个）**：用桌面版 GUI 的插件管理入口（plugin-manager）
   安装，spec 形态 `link:<plugins 绝对路径>/<插件名>`（**正斜杠**；⚠ 路径必须是
   **你的真实克隆目录**——照抄文档示例路径会失败）。失败不污染 profile
   （package.json 与 bundles 均不被改动），改正路径直接重装即可。装完即时挂载并
   自动写入 `dsh.profile.bundles`。agent 读者注意：plugin-manager 同时暴露 agent 工具面
   （`plugin_manager` 工具），注册 bundle 型无需人工点 GUI；
2. **plain 型插件（§3 清单 plain 型，5 个）**：手工编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`
   的 `dependencies`（键值用 `link:C:/...` **正斜杠**形态，与官方写入一致），然后在
   profile 目录执行 `pnpm install`（junction 链接自动生成）；cordis.patch.yml 的
   `- insert:` 条目**只写这些 plain 型**——bundle 型已由 plugin-manager/bundles
   挂载，重复 insert 有双重装载风险；
3. 装完**完全退出桌面版（含托盘）再启动**加载（plain 型与 insert 条目仅启动时装配）。

同时确认 profile 的 `pnpm-workspace.yaml` 含（出厂模板已带前两项）：

```yaml
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
# 出厂模板不含 minimumReleaseAge，无需配置 exclude；
# 仅当安装报 minimumReleaseAge 拦截时再加：
# minimumReleaseAgeExclude:
#   - <pkg>@<version>
```

## 5. loader 条目（cordis.patch.yml）

> 本节样例为 **CLI 自管 profile 的口径**（全量 insert）；桌面版只 insert plain 型（§4）。
> 文件结构：**顶层数组**。既有 `- id:` 条目（如出厂的 bundle 配置覆盖、已有
> `llm-pi-ai` / `agent-default-model` provider）**原样保留**——尤其 profile 已有
> provider 配置时不要重抄本节样例（会造重复）；只把下面的 `- insert:` 块作为
> **新的顶层数组项追加在末尾**。

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，加入插件 insert 列表：

<!-- fenix:auto-plugin-list:insert BEGIN（scripts/gen_plugin_docs.py 生成，勿手改） -->
```yaml
- insert:
    - id: cc-import
      name: cc-import
    - id: fenix-dsh-auth
      name: fenix-dsh-auth
    - id: fenix-dsh-brand-fenix
      name: fenix-dsh-brand-fenix
    - id: fenix-dsh-chat-polish
      name: fenix-dsh-chat-polish
    - id: fenix-dsh-clipboard-fallback
      name: fenix-dsh-clipboard-fallback
    - id: fenix-dsh-dashboard-bridge
      name: fenix-dsh-dashboard-bridge
    - id: fenix-dsh-rpc-guard
      name: fenix-dsh-rpc-guard
    - id: fenix-dsh-session-advanced-search
      name: fenix-dsh-session-advanced-search
    - id: fenix-dsh-session-grouper
      name: fenix-dsh-session-grouper
    - id: fenix-dsh-settings-dock
      name: fenix-dsh-settings-dock
    - id: fenix-dsh-sidebar-tabs
      name: fenix-dsh-sidebar-tabs
    - id: fenix-skill-provider
      name: fenix-skill-provider
```
<!-- fenix:auto-plugin-list:insert END -->

> ⚠ dsh patch 语义要求**容器键**：裸写 `- id:/name:` 列表项会被当作未知 target
> **静默跳过**（不报错、插件不装载）。必须写成 `- insert:` 列表。

## 6. LLM provider 配置（cordis.patch.yml）

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      my-llm:                            # 路由名自取（提供商无关）
        apiKeyEnv: LLM_API_KEY           # 兜底：从环境变量读 key（中性名，任何提供商）
        api: anthropic-messages          # Anthropic 兼容端点用此线协议；OpenAI 兼容端点改 openai-completions
        baseURL: https://open.bigmodel.cn/api/anthropic
        models:
          - id: glm-5.3-flash
            contextWindow: 1000000
            input: [text, image]
        displayName: bigmodel.cn
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: bigmodel-cn
    model: glm-5.3-flash
```

> 线协议错配（端点是 Anthropic 兼容却配 `openai-completions`）= TRANSPORT 断流，验收期必踩。
>
> **key 优先走 GUI 凭据库，不写进本节**：Models 设置页直接登录提供商，或「从 Claude Code
> 导入」（cc-import 桥接 cc-switch 数据库）——key 存进 harness 凭据库
> （`~/.dsh/.credentials.yaml`，文件形态，不进环境变量、不进配置文件）。
> 本节手工声明（apiKeyEnv 兜底）仅在 GUI 路径覆盖不到时使用。若需从凭据库**提取值**
> 注入 headless 侧 `LLM_API_KEY`（fenixd 手册 §7 手工调试半步），脱敏结构示例——
> `refs:` 下 `<ENV 名>: "<key 字面量>"`，取该行引号内值赋给环境变量即可：
>
> ```yaml
> refs:
>   BIGMODEL_API_KEY: "<key 字面量>"   # 从该行提取值注入 LLM_API_KEY
> ```

## 7. 生效时机（排障前先读）

| 变更 | 何时生效 | 动作 |
| --- | --- | --- |
| bundle 型插件注册（plugin-manager / plugin add） | 宿主侧**即时挂载** | 无需重启 |
| 客户端 UI 模块（inject 进 ui-* 的面板/按钮） | **页面重新加载**时拉取 | 浏览器刷新即可 |
| plain 型依赖 + `- insert:`（cordis.patch.yml） | 带 HMR 的 dsh 会**热应用** profile patch（实测 insert 写入后随即 active）；**进程启动时**装配是权威兜底 | 热应用未命中的变更才需要托盘完整退出重启 / 重启 dsh web |

注册后 GUI"没变化"的排查顺序：先插件清单（plugin-manager 页/`list_plugins`）确认装载状态，
再做页面重载，最后才完整重启（验收口径以完整重启后为准）。

## 8. 重启你现有的 dsh 实例并验证门 E

插件与 loader 配置在实例启动时装配——**让注册生效 = 重启你现有的实例**：

- **dsh 桌面版**：完全退出（含**系统托盘右键退出**，不是关窗口）后重新打开；
- **`dsh web`（CLI）**：停掉现有进程，用你原来的启动命令重开，例如
  （非 loopback 域名访问加 `--trusted-host`，可重复多组）：

```bash
dsh --profile <P> --no-open --port 3080 --trusted-host home.example.com:3080
```

- **全新机器**（还没有任何 dsh 实例在跑）：上面这条命令就是你的首次启动。

逐项确认（都在**重启后的现有 GUI** 里验）：

1. 打开 GUI（桌面版即原入口；`dsh web` 为 `http://127.0.0.1:3080` 或 trusted-host，token 见启动日志首行）；
2. 输入框按 "/"：菜单出现 `/fenix-new /fenix-status /fenix-setup …`
   —— 这是 `fenix-skill-provider` 在扫 `~/.claude/skills` 下 `fenix-*`
   （fenixd 手册 §4 安装的技能），来源目录新增 skill 数秒内自动反映，无需重启。
   ⚠ 注意：`/` 菜单出现 fenix 条目**不足以证明插件生效**——dsh 原生 skill-filesystem
   本就扫 `~/.claude/skills`；确认插件本体以 plugin-manager 插件清单为准；
3. fenixd dashboard 启动后（fenixd 手册 §8），侧栏出现 概览/项目/设置/运维/帮助 条目
   —— `fenix-dsh-dashboard-bridge` 反代 `/fenix-dashboard/` 生效；
4. Models 设置页底部「从 Claude Code 导入」按钮可见（cc-import；需 cc-switch 数据库才有候选，可选项）。
5. 细粒度验收复用各插件自带清单（深链/SSE/502 降级/pattern 覆盖等逐项口径）：
   本仓 `docs/help/` 下 cc-import / fenix-dashboard-bridge / fenix-skill-provider /
   dsh-session-grouper 各有「安装步骤 + 真机验收清单」（制品包不含 docs/，
   网页见 https://github.com/fenixsoft/dsh-plugins/tree/main/docs/help）。

## 9. 排障速查（插件装配）

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| 插件装了但 web 无变化 | loader 条目没写 `- insert:` 容器键（静默跳过），或包不在 bundles 数组 | 两处都补上后重启 |
| dsh web 会话区仍是 920px 居中（fenix-dsh-chat-polish 全宽/留白/输入卡打磨全部未生效） | 插件版本 < 0.2.1：旧版按 dsh 构建哈希钉扎选择器，装机 dsh 版本不同 → 哈希漂移 → 全部覆盖静默 no-op | 升级 dsh-plugins ≥ v0.1.2（chat-polish 0.2.1 起改语义后缀选择器跨版本韧性）→ 重跑 §4 注册 + 重启；验证：浏览器硬刷新后会话内容贴左右 24px 留白铺满 |
| GUI 经域名访问时设置页出「memory 横幅」、写不进 | 非 loopback 访问未装 `dsh-plugin-loopback-trust` | 装 + 进 bundles + `--trusted-host` |
| 插件构建报 `Command "build" not found` | 该插件免构建（exports 直指源码） | 预期行为，跳过；按 §3 验证门 E-build 的 exports 语义核验 |
| `dsh plugin add` 被拦提示 allow-version | 插件 engines 与已装 dsh 版本过版本风险门 | 按提示 `allow-version <pkg>@<ver> --dsh-version <dsh版> --accept-risk` 后重装 |
| `dsh --profile <P> --from-default-profile web` 报 cannot be a custom profile target | web 是出厂 profile，不能作拷贝目标 | 不需要拷贝——直接在你现有 profile 上注册（§2） |
| `dsh plugin` 报 `profile "desktop" is managed exclusively by the Electron application` | CLI 硬拒绝 desktop profile | 见 §4 desktop 专用装配路径 |
| `fenix-dsh-session-grouper` 被版本门跳过（loader enabled:false），11/12 活跃（v0.1.2 制品 10 插件为 9/10） | 其 peerDependencies 把 @deepseek-ai/session 系精确钉在旧版（桌面版无法 allow-version——该命令仅 CLI 自管 profile 可用） | **预期结果**，非故障；处置=等上游放宽 pin，或自行改 linked 包 peer 声明（精确 pin 通常意味着内部 API 耦合，强启有稳定性风险） |

fenixd 框架本体、dsh-bundle（§7 headless）、daemon 服务的排障见
[fenixd 安装手册 §10](https://raw.githubusercontent.com/fenixsoft/fenixd/refs/heads/main/docs/install.md)。

## 10. 卸载（dsh 插件与 dsh 运行时）

- dsh 插件：从 `cordis.patch.yml` 删 loader 条目 → `dsh plugin --profile <P> remove <name>` → 重启你现有的 dsh 实例；
- dsh 整体：`npm uninstall -g @deepseek-ai/dsh` + 删 `~/.dsh/`（会一并移除各 profile，
  含 fenixd 手册 §7 的 fenix profile 与 dsh-bundle link）。

fenixd 框架本体（skills/daemon/dashboard）与 dsh-bundle 的卸载见
[fenixd 安装手册 §11](https://raw.githubusercontent.com/fenixsoft/fenixd/refs/heads/main/docs/install.md)。

---

## 附：本手册如何自动维护（贡献者/维护者须知）

- 文档中 `fenix:auto-plugin-list:*` 标记块（build / catalog / register / insert 四块）由
  `scripts/gen_plugin_docs.py` 扫描仓内插件目录（含 `package.json` 且带 `dsh` 字段）自动生成，
  **勿手改标记块内内容**——下次同步会被覆盖。
- `plugin-doc-sync` workflow：push main（paths：`*/package.json` 与生成器脚本）→ 重生成；
  有 diff 自动提交推送。另含每周 cron 兜底与 `workflow_dispatch` 手动触发。
- PR 守卫：同 workflow 的 `guard` job 在插件目录变更的 PR 上跑 `--check`，插件清单与文档
  漂移时 fail——落地新插件的实现者必须在同一 PR 里跑
  `python3 scripts/gen_plugin_docs.py` 重生成后提交。
- 手工补写 prose（警告、版本演进注记）时只动标记块外的内容。
