用户立项原话（2026-11-13，逐字照录）：

「对于 consolidate-alerts-to-ops-page SPEC：这个SPEC不是有一个工作是在dsh web的菜单中显示当前运维人工事件的条目数量的吗？我没有看到菜单上有数字啊」

「fenix dashboard上有一个小圆弧，dsh web的菜单上则完全没有」

背景：经排查，consolidate-alerts-to-ops-page（fenixd 仓）的 ops-alert-badge 徽标按设计只渲染在 fenix dashboard 独立页侧栏，dsh web 侧无计数。用户选择把待人工裁决告警数暴露到 dsh web 一侧，立本 SPEC。

后续确认（ask_user_question 选择记录）：
- 计数挂载点：左侧栏运维条目（在 dsh web 左侧栏既有「运维」菜单条目图标上叠数字徽标）
- 执行模式：fast-track
- 执行时机：立即执行
