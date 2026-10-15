# fenix-skill-provider 插件安装与真机验收

`fenix-skill-provider` 把外部 Claude 风格 skill 目录（默认 `~/.claude/skills` 下 `fenix-*`）自动注册进 dsh web 原生 skill 体系，使 fenix 工作流可在 dsh web 输入框按 "/" 直接调起。本文记录**人工安装步骤**与**真机验收清单**；这些动作发生在本仓库之外的运行环境（`/root/.dsh/profiles/web/`），**不由实现 Agent 执行**（对齐 `fenix-dashboard-bridge-install.md` / `cc-import-install.md` 口径）。

## 前置条件

- dsh 0.2.0-rc.2（`ctx.skills.registerProvider` / skill provider 契约属该版 API 面，唯一钉版）。
- Node ≥ 24（Host 半使用 `node:fs` / `fs.watch`，无原生扩展）。
- 来源目录存在（默认 `~/.claude/skills`，其中 `fenix-*` 真身在 `/root/fenixd/skills/`，多为软链；软链指向目录同样收录）。目录不存在不阻塞安装——插件装载成功但返回空集，日志有 warn。
- `fenix-skill-provider/` 已构建：`cd fenix-skill-provider && pnpm install && pnpm build`，产出 `lib/index.js`。
- **非 loopback 主机名访问时**：与 cc-import 相同，需要 `dsh-plugin-loopback-trust` 前置（见 `cc-import-install.md` 对应小节）。本插件本身无鉴权与凭据面，但 "/" 菜单与会话功能在非 loopback 场景受同一 dsh 信任模型约束。
- **live 实例刷新**：重启步骤与 token 获取引用 `cc-import-install.md`「live 实例刷新人工步骤」小节（找 pid 再杀，勿 `pkill -f dsh`；token 从重启后启动日志第一行取）。

## 人工步骤（不由实现 Agent 执行）

1. **注册进 web profile 的 pnpm workspace**：

   ```sh
   cd /root/.dsh/profiles/web/
   pnpm add link:<本仓库绝对路径>/fenix-skill-provider
   ```

2. **加 loader 条目**：编辑该 profile 的 `cordis.patch.yml`。注意 dsh 的 patch 语义要求**容器键**：裸写 `- id:/name:` 列表项会被当作未知 target **静默跳过**（不报错、插件不装载）。必须写成 `- insert:` 列表：

   ```yaml
   - insert:
       - id: fenix-skill-provider
         name: fenix-skill-provider
         # config 可整体省略（默认 sourceDir: ~/.claude/skills、pattern: fenix-*）；
         # 覆盖示例：
         # config:
         #   sourceDir: /root/fenixd/skills
         #   pattern: openspec-*
   ```

   config 非法（如 `pattern: fen[x]-*`）时该条目装载失败并输出含键名与原因的可读错误——同一 `- insert:` 列表中的其余条目不受牵连。

3. **重启**：`dsh web` 重启后 Host 半随主进程装载；浏览器侧无 client 半产物需要注入。

## 真机验收清单

按顺序逐项确认（默认 config，除非小节另行声明）：

1. **"/" 菜单出现全部 fenix 条目**：dsh web 输入框按 "/"，菜单出现全部 `fenix-*` 匹配条目（当前实测 8 个：fenix-approve / fenix-archive / fenix-dashboard / fenix-new / fenix-process / fenix-ready / fenix-setup / fenix-status），条目描述与各 SKILL.md frontmatter `description` 一致；`~/.claude/skills` 下非 fenix 条目（anysearch、openspec-* 等）不出现。
2. **点选注入无 frontmatter 残留**：点选 `fenix-new`，会话发送 `/fenix-new` 字面文本，host 注入的 skill 内容为该 SKILL.md 剥离 frontmatter 后的 Markdown 正文（注入内容无 `---` frontmatter 段残留）；手打 `/fenix-new` 回车等效。
3. **新增 skill 自动出现**：在 `~/.claude/skills/` 新建 `fenix-demo/SKILL.md`（含合法 frontmatter），数秒后重新展开 "/" 菜单，`fenix-demo` 条目出现（无需重启 dsh web）。
4. **移除 skill 自动消失**：删除（或改名为不匹配 pattern）`fenix-demo/`，数秒后重新展开 "/" 菜单，条目消失，其余 fenix 条目不受影响。
5. **pattern 覆盖生效**：loader 条目 config 写 `pattern: openspec-*` 并重启，"/" 菜单出现 `openspec-propose` 等 openspec 条目而不出现 `fenix-*` 条目；验收后恢复默认并重启。
6. **sourceDir 覆盖生效**：config 写 `sourceDir: /root/fenixd/skills`（pattern 默认）并重启，"/" 菜单出现来源目录中的 fenix 条目（以该目录实际匹配条目数为准），内容与来源一致；验收后恢复默认并重启。
7. **非法 pattern 拒绝装载**：config 写 `pattern: fen[x]-*` 并重启，启动日志出现含 `pattern` 键名与非法原因的可读错误，本插件未注册（"/" 菜单无本插件条目），dsh web 其余功能不受影响；验收后恢复并重启。
8. **来源目录缺失容错**：config 写 `sourceDir: /nonexistent/dir` 并重启，dsh web 正常启动，日志有一条含该路径的 warn，"/" 菜单无本插件条目，会话与设置等其余功能不受影响。
9. **卸载与回滚**：从 `cordis.patch.yml` 移除 loader 条目并重启——"/" 菜单恢复原状（无数据/状态残留，插件无持久化）；如需彻底移除再执行 `pnpm remove fenix-skill-provider`。

## 故障定位

- 插件 warn 日志是容错路径（目录缺失 / watch 降级 / 非法条目跳过 / 重名）的唯一观测抓手，按 `fenix-skill-provider:` 前缀过滤启动日志。
- "/" 菜单不出现条目但无 warn：核对 loader 条目是否写在 `- insert:` 容器键下（裸列表项被静默跳过）、`lib/index.js` 是否已构建。
