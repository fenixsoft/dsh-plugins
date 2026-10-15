## MODIFIED Requirements

### Requirement: 每项目动态条目
Client 半 SHALL 启动时经 `<prefix>/api/projects` 拉取项目列表，项目 SHALL NOT 逐个注册为顶层侧栏条目，SHALL 在「项目」固定条目（`fenix-projects`）内以分组形式展示：视觉与交互参照 dsh web 侧栏「工作区」区域——可折叠分组、每项目一行为首字母徽标 + 项目名、分组列表 SHALL 有最大高度并以内部滚动容纳超出行数。点击项目行 SHALL 把主面板切换为该项目 iframe（深链 `#/projects/<name>` 契约不变）；点击分组头部行 SHALL 仅切换展开/折叠态，不切换主面板；分组态（展开/折叠、当前高亮项目）SHALL 在交互后保持一致。项目数据仍由轮询同步机制维护（见「项目列表轮询同步」）；对应 `main` keyed 面板注册契约不变。

#### Scenario: 项目收纳进分组
- **WHEN** 上游项目列表含 fenixd、dsh-plugins 两个项目，用户打开 dsh web 侧栏
- **THEN** 侧栏不出现平铺的项目顶层条目；「项目」条目处呈现分组（展开态含 2 个项目行，首字母徽标 + 项目名），项目行不再出现在「帮助」之后

#### Scenario: 点击项目行切换面板
- **WHEN** 用户点击分组内项目行「fenixd」
- **THEN** 主面板切换为该项目 iframe（src 深链 `#/projects/fenixd`），分组内该项目行呈高亮

#### Scenario: 分组高度有上限
- **WHEN** 上游项目数量超出分组最大高度可容纳行数
- **THEN** 分组列表以内部滚动呈现其余项目，侧栏整体高度不被撑破

#### Scenario: 空列表不出错
- **WHEN** 上游返回空项目列表或拉取失败
- **THEN** 分组呈现空态（或收起），侧栏与控制台无未处理异常
