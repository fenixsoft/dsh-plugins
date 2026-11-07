# fenix-dsh-settings-dock

把 dsh web 官方设置弹窗**页面化停靠**到侧栏右侧内容区：点击「设置」不再弹出固定
800×800 的居中浮窗，而是铺满内容区像切到一页设置；无遮罩、无头部关闭按钮
（用户定调 2026-11-07），退出 = Esc / 侧栏导航 / 设置触发按钮。各设置页
（模型/内置插件/Agent 预设等）内容自适应停靠宽度。窄屏（<768px）维持官方弹窗形态。

## 插件形态

dsh 0.2.0-rc.2 零构建插件（对齐 `fenix-dsh-chat-polish` 先例）：

- **Host 半**（`index.js`）：空 apply，仅为 loader 条目提供可加载的 cordis 插件。
- **Client 半**（`client.js`）：纯浏览器侧，不依赖任何宿主包——
  - 注入一条 `<style>`：≥768px 视口下把设置弹窗壳重排为停靠形态：
    overlay 整层 `pointer-events:none`（面板显式 `pointer-events:auto` 取回事件
    ——pointer-events 是继承属性）、遮罩 `display:none`、面板 `position:fixed`
    停靠（left/right/top/bottom 四边由 CSS 变量给值，圆角与阴影归零、宽高改
    auto 铺满）、头部关闭按钮隐藏、section 根容器 `max-width:none`（自适应
    停靠宽度）；
  - 打开期间 rAF 逐帧测量并写 `--fdx-dock-left` / `--fdx-dock-right`（自愈式：
    侧栏拖拽、收缩/展开、右栏开关、窗口缩放均被下一帧纠正；关闭即停环）；
  - 文档级 capture 点击监听（常驻，设置开态才动作）：侧栏区（x < dock 左缘）
    点击 = 导航意图，合成 Esc 即刻收设置——否则目标面板在后台切换被停靠页
    盖住（观感「点了没反应」）；设置触发按钮（官方 `open()` 幂等开，停靠态
    首次可达后无 toggle 语义可依赖）拦截官方 handler 代管为开关切换。

## 官方行为保留面

- 打开/关闭状态机、设置 section 导航、表单、快捷键全部原样——本插件只做
  几何重排，不触碰官方状态与 `aria-modal` 语义；
- 官方「关闭设置」快捷指令经 `closeTopModal`（按 `[role="dialog"][aria-modal="true"]`
  找面板）照常工作，因此停靠态**不**翻转 `aria-modal`；
- 升级失配（结构/属性漂移）时选择器自动失配 → 整体退回官方弹窗，无副作用。

## 停靠几何与测量锚

| 边 | 取值 | 测量锚（0.2.0-rc.2） |
| --- | --- | --- |
| left | 侧栏列右缘 | 主锚：侧栏列元素 `[class*="sidebarCol"]` 的 rect.right（展开 ~276px / 收缩残留 56px 窄轨，全形态通用）；兜底：拖拽把手 `[data-side="sidebar"]` rect.left（收缩态不渲染，勿把缺席当列宽 0——会盖住窄轨） |
| right | 右栏左缘距视口 | `[data-rightbar-col]` rect（宽度 0/缺席 → 0） |
| top | 框架 chrome 下缘 | CSS 变量 `--dsh-frame-chrome-top`（web 恒 0） |
| bottom | 0 | — |

侧栏宽度官方为 JS 驱动可拖拽、无 CSS 变量，故运行时测量；面板稳定钩子为官方
非哈希属性 `[data-shortcut-modal="settings"]`（弹窗壳的 overlay/mask 为构建哈希类
`*_overlay` / `*_mask`，样式经结构选择器 `body > div[role="presentation"]:has(> …)`
定位，不做哈希钉扎；关闭按钮与 section 根同理，分别按
`[class*="_header"] > button`（header 行唯一直接 button 子元素）与
`[class*="_section"]`（全 settings 族 section 根唯一类片段，无 `_section*` 变体）定位）。

## 已知边缘

- 设置打开期间官方模态语义保留（`aria-modal="true"`）：侧栏内的输入框（如会话
  搜索）键盘输入会被官方 `isBehindModal` 判定让位——小众边缘，不改官方语义换此收敛。
- 右栏全屏态（`data-rightbar-fullscreen`）与设置停靠叠加时以官方层序为准，未做仲裁。

## 安装

```bash
ln -s /root/dsh-plugins/fenix-dsh-settings-dock /root/.dsh/profiles/web/node_modules/fenix-dsh-settings-dock
# loader 条目（cordis.patch.yml 的 insert 列表）加：
#   - id: fenix-dsh-settings-dock
#     name: fenix-dsh-settings-dock
systemctl restart dsh-web
```

无配置键。

## dsh 版本兼容表

| dsh 版本 | 兼容性 | 说明 |
| --- | --- | --- |
| 0.2.0-rc.2 | ✅ 唯一钉版 | 开发与验收基线（`[data-shortcut-modal="settings"]`、`[data-side="sidebar"]`、`[data-rightbar-col]`、`--dsh-frame-chrome-top`、body 直挂 portal、useModalLayer 行为） |
| 其它/升级 | ⚠️ 自动降级 + 须同步重测 | 结构漂移时样式失配自动回官方弹窗；恢复停靠需按新构建产物复核测量锚 |

## 真机验收清单（2026-11-07 全量通过）

1. 点侧栏底部「设置」→ 面板铺满内容区（无居中浮窗、无遮罩模糊、无圆角阴影、无头部 X）；
2. 打开期间点侧栏条目（运维/配置/会话等）→ 设置即刻收起，目标面板正常切出；
3. 开着设置点设置触发按钮 → 关闭；关着点 → 打开（代管 toggle 双向）；
4. Esc 退出，退出后无残留（遮罩/观察环；dock 变量残值无害，面板未挂载不生效）；
5. 拖拽侧栏宽度把手 → 设置页左缘实时跟随；
6. 侧栏收缩 → 56px 窄轨完整可见，设置页左缘贴窄轨右缘（窄轨形态下开设置同验）；
7. 开关右栏 → 设置页右缘实时跟随；
8. 窄屏（<768px）→ 官方弹窗形态原样（652×800 居中卡片）；
9. 模型/内置插件/Agent 预设页 → 内容自适应铺满停靠宽度（右缘仅剩 24px 内边距）；
10. 设置内切换 section 导航正常；console 零报错。
