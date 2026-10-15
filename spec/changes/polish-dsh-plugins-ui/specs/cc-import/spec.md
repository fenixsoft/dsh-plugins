## MODIFIED Requirements

### Requirement: Models 页导入入口

client 半 SHALL 经 `slots.inject("settings.models.footer", ...)` 在 dsh web Models 设置页 footer 注入「从 Claude Code 导入」按钮；点击打开候选对话框：每行含勾选框、名称 / baseURL / 模型摘要、状态标（可导入 / 已存在 / 跳过-原因）。文案 SHALL 经 `ctx.locale.register` 注册中英双语。对话框 SHALL 占视口宽度 80%（大屏下候选表格不拥挤）；操作区 SHALL 在「全选可导入」旁提供「取消全部选择」按钮：清空全部勾选（含「将更新」集），导入按钮随之回到无可导入项的禁用态；文案中英双语。

#### Scenario: 按钮出现于 Models 页

- **WHEN** 插件已启用且用户打开 dsh web 的 Models 设置页
- **THEN** 页面 footer 区域渲染「从 Claude Code 导入」按钮；插件禁用时按钮不出现且页面无报错

#### Scenario: 对话框状态标注

- **WHEN** 打开对话框且 `scan` 返回混合结果（可导入 2、已存在 1、跳过 1）
- **THEN** 四行分别渲染对应状态；跳过行无勾选框；可导入行默认勾选；已存在行默认不勾选

#### Scenario: 对话框宽度 80% 视口

- **WHEN** 在任意常见桌面视口（≥1280px 宽）打开导入对话框
- **THEN** 对话框宽度为视口的 80%，候选行的名称 / baseURL / 模型摘要各列有明显间隔，无换行挤压

#### Scenario: 取消全部选择

- **WHEN** 存在勾选项（含任一「将更新」行）时点击「取消全部选择」
- **THEN** 全部行回到未勾选态、「将更新」标全部清除，导入按钮禁用（计数为 0）
