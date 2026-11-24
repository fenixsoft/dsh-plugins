## Deliverables

```yaml
- path: fenix-dsh-chat-polish/client.js
  kind: modify
- path: fenix-dsh-chat-polish/README.zh.md
  kind: modify
- path: fenix-dsh-chat-polish/package.json
  kind: modify
```

## 1. 开关 store 与功能条件化重构

- [x] 1.1 拆分 `fenix-dsh-chat-polish/client.js` 的 `POLISH_CSS`/`VIEW_CSS` 为 design.md D2 映射的按功能分块（`whitespace`/`scrollbar`/`composer-width`/`hero-row`/`markdown`，`history-nav` 无 CSS），实现模块级单例开关 store（localStorage 键 `fenix-chat-polish.toggles`、只记录非默认关闭项、读取容错忽略损坏/未知键按开启、写失败降级为会话内生效 + `console.warn` 降级告警、get/set/subscribe 接口），样式标签 `textContent` 改为按开启集合在 store.set 内同步重建（先改样式后通知订阅者），嵌入豁免前缀（`.embeddedBody` 豁免）原样保留在各规则内；全开态下注入的样式串与 v0.2.2 等效（逐块比对无规则增删改，单测快照比对 39 条规则集合逐字一致）
- [x] 1.2 `MarkdownUserView` 按 store 分流：`markdown` 关闭时走官方等效纯文本投影分支（同一气泡结构、附件/图片卡行为不变、不挂 `MarkdownText` 与复制按钮），开启恢复现行渲染；`HistoryController` 与 document 捕获阶段监听入口按 store 分流：`history-nav` 关闭时 keydown/input 处理器直接放行（不接管、不 preventDefault），开启恢复现行召回行为；两组分流均不改变现有 dispose/abdicate 语义与监听器挂载方式

## 2. 设置分区 UI

- [x] 2.1 经 `settings.section` 与 `settings.section.icon` 注册「对话区打磨」分区（先例 `fenix-dsh-auth/client.js:328-355`：id `fenix-chat-polish`、order 经 `ctx.slots.entries` 尾随探测失败回退先例同款 `FALLBACK_MAX_ORDER`、逐槽 try/catch 失配仅 `console.warn` 菜单缺席），分区面板渲染 6 个功能行（功能名 + 一句话说明 + 开关控件：优先复用宿主基线包现成开关组件，不可得则自绘 toggle 对齐官方分区视觉），点击开关写 store 即时生效且行内开关态与实际生效状态一致

## 3. 真机隔离验证（隔离 profile，全 Scenario 走查）

- [x] 3.1 搭建隔离验证 profile（临时 `DSH_HOME` + 独立端口、`pnpm add link:` 链接本分支 `fenix-dsh-chat-polish`、`cordis.patch.yml` 以 `- insert:` 注册、复刻 live 关键面含 `dsh-plugin-loopback-trust` 与 `--trusted-host` 参数），启动 `dsh web` 并经 playwright-cli 走查 specs/chat-polish-feature-toggles 全部 Scenario：分区可见可达、默认全开、六开关逐一切换即时生效（含对话页已渲染状态下切换不刷新）、刷新后状态保持、损坏持久化数据回退、localStorage 不可用降级、全部关闭等于官方原生、插槽失配降级（可经临时改写注册键模拟失配验证菜单缺席不伤功能）、嵌入形态恒豁免；断言一律真实运行时实测值 + 条件轮询（禁固定 sleep）、首跑引导弹窗按「连续 2 次无弹窗」放行；收尾清理临时状态（hosts 测试条目、浏览器会话、隔离进程按 `ss` 取 pid `kill` 不用 `pkill -f dsh`）
- [x] 3.2 更新 `fenix-dsh-chat-polish/README.zh.md`：功能清单增补「设置页独立开关」小节（设置页入口、六功能开关、持久化与降级口径、插槽失配降级行为）；`fenix-dsh-chat-polish/package.json` 版本号演进（0.2.2 → 0.3.0）与 description 增补开关能力一句；文档声明与任务 3.1 实测行为一致
