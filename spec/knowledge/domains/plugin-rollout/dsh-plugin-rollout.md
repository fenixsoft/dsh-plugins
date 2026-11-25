# dsh 插件真机安装与验收
<!-- knowledge: capability=dsh-plugin-rollout rev=4
     sources=spec/changes/verify-dsh-plugins-live, spec/changes/add-sidebar-tabs-plugin -->

把本仓 dsh 插件（cc-import、fenix-dsh-dashboard-bridge 等）装入真实 dsh web 实例并在真机上完成验收的能力：loader 注册 patch 语法、非 loopback 访问前置、隔离验证载体与验收清单的可自动化执行口径。

## 规则

### loader 注册 patch 语法

- 向 profile 的 `cordis.patch.yml` 注册新插件条目必须使用 `- insert: [- id: <plugin>, name: <plugin>]` 列表形式；裸 `- id:/name:` 是对既有条目的覆盖补丁，目标不存在时被 dsh 静默跳过（dsh-app-boot patchStructure：「Unknown targets … are warned and skipped」），插件 host 半不装载、client 半不出现在 `/plugins/` 组合 bundle。
- 插件须先注册进 pnpm workspace：`pnpm add link:<插件目录>`（link 形式实测可完成注册）。

### 非 loopback 访问前置

- 经非 loopback 主机名访问 dsh web 时 settings 读写面整体不可用，Models 页报「加载提供商目录失败: settings are unavailable in this browser」横幅。
- 依赖 settings 写入的插件（含 cc-import）在非 loopback 访问下验收前，须先安装社区插件 `dsh-plugin-loopback-trust`（engines `>=0.1.7 <0.3`，实测 0.2.0-rc.2 生效）；安装文档须声明该前置关系、安装命令与明文 HTTP 暴露的安全注记。

### 隔离 profile 验证载体

- 真机验收一律使用隔离验证 profile：临时 `DSH_HOME` + 独立端口启动 `dsh web`，以 `pnpm add link:` 链接待验插件构建产物、`cordis.patch.yml` 以 insert 形式注册；并复刻 live 关键面（同插件集合含 loopback-trust、`--trusted-host` 参数），防止「隔离过、live 不过」的环境漂移。
- 验证不触碰 live 实例（127.0.0.1:3080）的数据与进程；导入写入全部落在隔离 profile 自身的 settings/credentials，临时 `DSH_HOME` 整体可弃。
- 浏览器自动化经 playwright-cli 驱动：断言以真实运行时实测值为准、时序断言一律条件轮询（禁固定 sleep）；首跑引导弹窗与验证流存在时序竞争，以「连续 2 次无弹窗」为放行口径。
- 验证用临时状态（`/etc/hosts` 测试条目、浏览器会话、上游 registry 夹具）收尾必须清理；停进程先 `ss` 取 pid 再 `kill`，不用 `pkill -f dsh`（自匹配陷阱：会误杀自身与同机其他 dsh 实例）。

### live 实例刷新（人工步骤）

- live profile 已建立插件 symlink 与 insert 注册，实现分支 merge-back 进主树后重启 dsh web 即加载新构建；token 每次重启轮换，从启动日志获取。
- live 重启与对 live 数据的导入是文档化人工步骤，不作为实现任务（实现 Agent 不操作主树与 live 进程）。
- **纯 client.js/CSS 内容改动无需重启**：live 的 node_modules symlink 直指主树，组合 bundle 按请求现读，重载页面即载新代码；仅注册条目/依赖变化才 restart（token 随之轮换，`grep -oP 'token=\S+' /var/log/dsh-web.log | tail -1`）。

### 装载核实姿势（add-sidebar-tabs-plugin 实证）

- 单插件 URL `/plugins/??<id>/client.js` 对任何插件恒 404——该探测姿势无效；组合 bundle `plugins/??a/client.js,b/client.js…&rev=<hash>` 才是真实服务形态，装载核实 = 抓 index.html 检查组合 href 含目标插件 `client.js`。
- 页面访问流：`/?token=<启动日志 token>` → 303 set-cookie（dsh-auth-*）→ 带 cookie 后续访问。
- 官方暗色主题驱动 = `body[data-ds-dark-theme]` 属性，手动设置即整站切暗——真机验证暗色路径无需找主题开关。

### dsh web 侧栏布局事实（钉底/分区操作依据）

- 侧栏根为 flex column 全高；官方导航 `<nav>` 原生 `display:flex; flex-direction:column; gap:2px`；导航末项「更多」（`data-icon="dsw-icon-apps-add-outline-regular"`）是**普通导航项**；regionArea（Workspaces 区）`flex: 1 1 0%`；footArea（= footerActions + settingsArea，内含 Account 菜单触发钮「更多」`data-icon="dsw-icon-ellipsis-outline-medium"`）`flex: 0 0 auto`、列内末位。
- **rc.5 结构改版**（dsh 0.2.2-rc.1 → rc.5，2026-11-25 live 实证）：新会话容器 `controls` 改名 `newSessionRow` 且不再自带下边距；内容区新增官方滚动机包裹 `scrollRegion(margin-top:4px, flex:1 1 0%) > scrollArea(display:grid, overflow:auto)`，nav/regionArea **移入 scrollArea**；footArea 仍在根列末位。连带教训：① 插入型插件推侧栏根不能再用 `nav.parentElement`（rc.5 拿到 scrollArea，连锁失灵 collapsed 窄轨监测与子树外查询），用 `nav.closest('[class*="<根键名>"]')`；② **外来元素 MUST NOT 插进官方 grid 滚动容器 scrollArea**——auto-flow 会把它分到退化轨道压扁（实测 6px 宽）且扰动官方行轨道，插入目标应取根列 + scrollRegion 之前（`nav.closest('[class*="scrollRegion"]') || nav` 回退兼容旧版）；③ CSS-modules 键名锚点跨版稳定性好（sidebarCol/panelList/regionArea/footArea 两版零改动），但**结构序与父级关系会变**——升级 dsh 后除复核键名外，还须复核 root 推导、插入位置与上下文 margin 事实（如 newSessionRow 失去下边距、scrollRegion 自带 margin-top:4px，插件侧用负 margin 精确抵消实现贴零间距）。
- **官方图标无 class**：`<use href="#dsw-icon-*">` + `data-icon` 属性——DOM 探针/锚点必须用 `[data-icon*=…]` 或 aria-label，类名子串匹配会扑空（rev=2 期实证踩坑）。
- 侧栏底部钉底常显（rev=3 修正，**推翻 rev=2 的 flex order 方案**）：钉底对象是 footArea 内 ellipsis「更多」（Account 菜单触发钮），实现 = 展开态 footArea 内联 `margin-top:auto`——功能态 regionArea display:none 后列内失去唯一 flex 伸缩元素，auto margin 补位钉底；工作区态 regionArea 吸满空间、auto margin 恒 0，两态统一贴 auto 无害。**不要用 order 重排**：分区容器互斥可见时官方 DOM 序天然即正确视觉序（rev=2 的 order 1/2/3 + nav 拉伸 + 末子手术属多余且钉错对象，已全部撤销）；导航末项 apps-add「更多」按普通导航项逻辑随导航整体显隐，不特殊处理。内联样式变更不触发 childList MutationObserver → 自愈重贴无反馈环；锚点缺席只降级钉底、不放弃插件（软锚点模式）。
- 同名元素先辨职责再动手：真机改造前用图标/aria-label 探针确认每个视觉相似元素各自的容器与语义（2026-11-24「更多应钉底」反馈被按 nav 末子实现，2026-11-25 用户澄清实际指 footArea 内另一「更多」——返工根因即未先探针区分两个同名元素）。

### 原型自动化验证前置

- 原型 annotator（annotator.js）`annotateMode` 默认 true：document capture 阶段对 click `stopPropagation`，目标元素监听一律不触发（`el.click()` 后 `fired=false` 的元凶）——先点 `.fpa-mode` 按钮切浏览模式再驱动原型交互。
- playwright-cli 口径：会话易断（'browser not open' 需重 open 后重试）；eval 一律函数形态 `() => {...}`；screenshot 无参输出 `.playwright-cli/`；`file://` 被禁，原型验证用临时 `python3 -m http.server <port>`（收尾清理，kill 用 pid 不用 `pkill -f`）；布局断言在单次 eval 内「打开-点击-测量」一条龙完成，降低会话断连窗口。

### 验收清单口径

- bridge：侧栏 5 固定条目（概览/项目/设置/运维/帮助）+ 项目条目与上游 API 一致；点击条目主面板切换为 iframe 且深链 `/fenix-dashboard/?embed=1&apiBase=/fenix-dashboard#/<view>`；静态资源与 POST 经前缀反代与直连一致；面板数据自动刷新且多面板连续切换 ≥10 轮无退化（上游连接数不随切换累积）；移除项目后条目 ≤60s 消失；上游停机时面板收到 502 提示页且 dsh 其余功能不受影响；前缀外路径行为不变。
- cc-import：按钮可见、候选与 cc-switch 一致、全量导入成功且 Models 新行密钥已配置、重复导入标「已存在」默认不勾选、显式「将更新」覆盖同 route 无 `-2` 副本、非 loopback 主机名下入口可用。
- 发现缺陷同批修复并回归。

### 安装文档纪律

- 安装文档（`docs/help/cc-import-install.md`、`docs/help/fenix-dashboard-bridge-install.md`）与真机实测互为印证：workspace 注册 `pnpm add link:` 写法、loader 条目 insert 形式（注明裸 id 形式被静默跳过的原因）、loopback-trust 前置小节、live 刷新人工步骤。
- 文档声明的每个步骤须经过真机实测：「按文档从零重装」在全新临时 profile 上可复现走通。
- 真机验证方法论独立成文 `docs/help/dsh-plugin-live-verification.md`（隔离 profile 装配、playwright-cli 断言口径、临时状态清理清单）。

## 代码锚点

- 文档载体：`docs/help/dsh-plugin-live-verification.md`（隔离 profile 验证方法论）、`docs/help/cc-import-install.md` 与 `docs/help/fenix-dashboard-bridge-install.md`（安装步骤与 live 刷新人工步骤）。

## 溯源

- 2026-11-16 verify-dsh-plugins-live（spec/changes/verify-dsh-plugins-live/）— 新建本页：loader insert 语法、loopback-trust 前置、隔离 profile 验证载体、两插件真机验收清单与安装文档纪律的初始蒸馏。
- 2026-11-24 add-sidebar-tabs-plugin 缺陷修批次（spec/changes/add-sidebar-tabs-plugin/）— rev=2：client.js 热更免重启、组合 bundle 装载核实姿势、`body[data-ds-dark-theme]` 主题探针、侧栏 flex order 钉底方案【rev=3 已推翻，改 margin-top:auto 钉 footArea】与布局事实、annotator 拦截前置、playwright-cli 会话口径。
- 2026-11-25 add-sidebar-tabs-plugin「两更多」修正批（同上 change）— rev=3：钉底对象勘误（footArea ellipsis「更多」= Account 菜单触发钮，nav 末项 apps-add「更多」= 普通导航项）、margin-top:auto 钉底范式、order 重排撤销依据、`data-icon` 属性探针（官方图标无 class）、同名元素先探针辨职责再动手的返工教训。
- 2026-11-25 add-sidebar-tabs-plugin rc.5 适配批（同上 change）— rev=4：dsh rc.5 侧栏滚动机改版事实（controls→newSessionRow、scrollRegion>scrollArea 包裹、newSessionRow 失下边距、scrollRegion margin-top:4px）、根推导 closest('root') 范式、外来元素禁入官方 grid 滚动容器（压扁 6px 实证）、键名锚点跨版稳定但结构序/父级关系必须复核的升级纪律。
