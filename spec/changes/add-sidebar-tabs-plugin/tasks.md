# Tasks: add-sidebar-tabs-plugin（侧栏顶部功能/工作区双Tab切换插件）

## Deliverables

```yaml
- path: fenix-dsh-sidebar-tabs/package.json
  kind: new
- path: fenix-dsh-sidebar-tabs/index.js
  kind: new
- path: fenix-dsh-sidebar-tabs/client.js
  kind: new
- path: fenix-dsh-sidebar-tabs/cordis.patch.yml
  kind: new
- path: fenix-dsh-sidebar-tabs/README.zh.md
  kind: new
```

## 1. 插件包与注入核心

- [x] 1.1 落位插件包骨架：`package.json`（`exports` 三入口、`engines.dsh` 钉 0.2.x、`dsh.bundle.patch` 指向 cordis.patch.yml、`dsh.client.platform=web`，对齐 fenix-dsh-settings-dock 形态）、`cordis.patch.yml` 仅 insert 注册、`index.js` 空 `apply()`
- [x] 1.2 `client.js` 锚点发现与实证：对当前安装版 dsh bundle（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`）核对侧栏列（`[class*="sidebarCol"]`）、全局导航容器、Workspaces 区容器的 CSS-modules 键名映射，钉死选择器签名并记录到 README（升级重钉指引）
- [x] 1.3 `client.js` tab 分段控件注入：新会话按钮下方注入「功能 / 工作区」控件，配色/活动态全部引用 dsh CSS 变量 token（暗/浅主题自适应，视觉基准 = specs/add-sidebar-tabs-plugin/prototype/index.html，仅参照）；任一锚点未命中 → 零注入 + warn 日志
- [x] 1.4 `client.js` 可见性切换与记忆：display 级容器切换（禁 reparent）、独立滚动保持、localStorage 键 `fenix-dsh-sidebar-tabs.tab`（`'func'|'workspace'`，缺省/非法值 `'workspace'`，存储失败降级会话内记忆）、MutationObserver 官方重渲染后状态自愈
- [x] 1.5 收起态与常显：窄轨形态下 tab 控件不渲染、窄轨行为与官方现状一致、展开后恢复记忆 tab；新会话按钮与 Account 菜单两态常显
- [x] 1.6 `enabled=false` 零动作停用路径核对（不加载、不注入、不写 localStorage）
- [x] 1.7 `README.zh.md`：机制（锚点/切换/记忆/回退）、配置项、签名字证快照与升级失配重钉指引

## 2. 静态验证

- [x] 2.1 `node --check` 通过 index.js 与 client.js；package.json/cordis.patch.yml 可被 JSON/YAML 解析器解析
- [x] 2.2 交付物齐平自查：5 个文件全部落位、无多余产物，`spec.knowledge` 引用口径（plugin-rollout 验收）写入 README 验收小节

## 3. 真机隔离验证（隔离 profile，全 Scenario 走查）

- [x] 3.1 搭建隔离验证 profile（临时 `DSH_HOME` + 独立端口、`pnpm add link:` 链接本分支 `fenix-dsh-sidebar-tabs`、`cordis.patch.yml` 以 `- insert:` 注册、复刻 live 关键面含 `dsh-plugin-loopback-trust` 与 `--trusted-host` 参数），启动 `dsh web` 并经 playwright-cli 走查 specs/sidebar-tabs 全部 Scenario：注入成功（品牌区、新会话按钮、全局导航 8 项、Account 菜单行为与点击均不变）、切到工作区/切到功能（滚动位置保持、8 项完整可点）、官方重渲染后状态维持（经新建/删除会话触发）、收起态隐藏与展开恢复记忆 tab、重启恢复与无记忆/非法值缺省「工作区」、localStorage 禁用降级会话内记忆、常显保障（两态下新会话按钮与 Account 菜单可点、高级搜索入口可用）、部分失配回退（临时改写 client.js 内 Workspaces 区锚点签名为不存在的键模拟，断言零注入零异常且日志含失配锚点名）、`enabled=false` 零动作；断言一律真实运行时实测值 + 条件轮询（禁固定 sleep）；共装回归：与 `fenix-dsh-settings-dock`、`fenix-dsh-session-advanced-search` 同时启用，验证两 tab 态下 dock 停靠与高级搜索入口互不破坏；收尾清理临时状态（浏览器会话、隔离进程按 `ss` 取 pid `kill` 不用 `pkill -f dsh`）
- [x] 3.2 依据走查实测回填 `README.zh.md`：签名字证快照更新为实锚命中记录（版本+锚点签名+验证日期）、失配模拟演练结果与重钉步骤有效性确认，文档声明与任务 3.1 实测行为一致
