# dsh-plugins

DeepSeek Harness (dsh) 第三方插件集。每个子目录一个独立 dsh 插件包（host 半 + client 半），安装进 dsh profile 的 pnpm workspace，经 cordis.patch.yml loader 条目启用。

首个插件：cc-import —— 在 dsh web 的 Models 设置页注入「从 Claude Code 导入」按钮，将 cc-switch 管理的 Claude Code provider（cc-switch.db）经官方写入路径导入 dsh（只加不删，密钥走凭据引用不落明文）。
