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

- [ ] 1.1 落位插件包骨架：`package.json`（`exports` 三入口、`engines.dsh` 钉 0.2.x、`dsh.bundle.patch` 指向 cordis.patch.yml、`dsh.client.platform=web`，对齐 fenix-dsh-settings-dock 形态）、`cordis.patch.yml` 仅 insert 注册、`index.js` 空 `apply()`
- [ ] 1.2 `client.js` 锚点发现与实证：对当前安装版 dsh bundle（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js`）核对侧栏列（`[class*="sidebarCol"]`）、全局导航容器、Workspaces 区容器的 CSS-modules 键名映射，钉死选择器签名并记录到 README（升级重钉指引）
- [ ] 1.3 `client.js` tab 分段控件注入：新会话按钮下方注入「功能 / 工作区」控件，配色/活动态全部引用 dsh CSS 变量 token（暗/浅主题自适应，视觉基准 = specs/add-sidebar-tabs-plugin/prototype/index.html，仅参照）；任一锚点未命中 → 零注入 + warn 日志
- [ ] 1.4 `client.js` 可见性切换与记忆：display 级容器切换（禁 reparent）、独立滚动保持、localStorage 键 `fenix-dsh-sidebar-tabs.tab`（`'func'|'workspace'`，缺省/非法值 `'workspace'`，存储失败降级会话内记忆）、MutationObserver 官方重渲染后状态自愈
- [ ] 1.5 收起态与常显：窄轨形态下 tab 控件不渲染、窄轨行为与官方现状一致、展开后恢复记忆 tab；新会话按钮与 Account 菜单两态常显
- [ ] 1.6 `enabled=false` 零动作停用路径核对（不加载、不注入、不写 localStorage）
- [ ] 1.7 `README.zh.md`：机制（锚点/切换/记忆/回退）、配置项、签名字证快照与升级失配重钉指引

## 2. 静态验证

- [ ] 2.1 `node --check` 通过 index.js 与 client.js；package.json/cordis.patch.yml 可被 JSON/YAML 解析器解析
- [ ] 2.2 交付物齐平自查：5 个文件全部落位、无多余产物，`spec.knowledge` 引用口径（plugin-rollout 验收）写入 README 验收小节
