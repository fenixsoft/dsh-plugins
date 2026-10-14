# cc-import 插件安装与真机验收

`cc-import` 把 cc-switch 托管的 Claude Code provider 导入 dsh Models 设置页。本文记录**人工安装步骤**与**真机验收清单**；这些动作发生在本仓库之外的运行环境（`/root/.dsh/profiles/web/`），不由实现 Agent 执行。

## 前置条件

- dsh ≥ 0.2.0-rc.2（双面插件 loader）。
- Node ≥ 24（Host 半使用内置 `node:sqlite` 只读 cc-switch）。
- `~/.cc-switch/cc-switch.db` 存在且至少有一个含 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + 模型的 claude 行。
- `cc-import/` 已构建：`cd cc-import && pnpm install && pnpm build`，产出 `lib/index.js` 与 `lib/client.js`。
- **非 loopback 主机名访问时**：加 `dsh-plugin-loopback-trust`（见下节），否则反代/域名访问下设置页与凭据写入被 dsh 判为非 host 持有而拒绝（Models 页出现「memory 横幅」，导入写不进去）。仅 `127.0.0.1` 访问可跳过。

## dsh-plugin-loopback-trust 前置（非 loopback 访问需要）

- **安装**：在 web profile 目录内 `pnpm add github:6mt/dsh-plugin-loopback-trust`，并把包名加进 profile `package.json` 的 `dsh.profile.bundles` 数组（仅作依赖安装不进 bundles 不会装载）。
- **engines 匹配**：该插件声明 `engines: { dsh: ">=0.1.7 <0.3" }`，与 dsh 0.2.0-rc.2 匹配；升级 dsh 大版本时同步核对。
- **明文 HTTP 安全注记**：该插件把页面连接标记为 host 持有以恢复设置持久化，信任边界 = 网络暴露面；dsh web 默认无 TLS，凭据经明文 HTTP 传输，只在可信内网/隧道（如 frp+本地回环）后面启用，不要直接暴露公网。
- **配套启动参数**：`dsh web` 启动时加 `--trusted-host <域名>:<端口>`（如 `--trusted-host home.icyfenix.cn:3444`），并让该域名解析到本机（临时验证可加 `/etc/hosts` 条目，用后删除）。

## live 实例刷新人工步骤（本仓库外执行）

```sh
# 1. 找 pid 再杀（不要用 pkill -f "dsh"——自匹配陷阱：命令行含 "dsh" 的
#    脚本/终端会把自己一并杀掉）
ss -tlnp | grep 3444            # 取 LISTEN pid
kill <pid>
# 2. 重启（DSH_HOME 指向 live profile）
setsid nohup env DSH_HOME=/root/.dsh dsh --profile web --no-open --port 3444 \
  --trusted-host home.icyfenix.cn:3444 >> /var/log/dsh-web.log 2>&1 &
# 3. token 从启动日志第一行取（重启后必变）
grep -oP 'token=\S+' /var/log/dsh-web.log | tail -1
```


## 人工步骤（不由实现 Agent 执行）

1. **注册进 web profile 的 pnpm workspace**：在该 profile 目录下把本仓库的 `cc-import/` 链接为依赖（真机验证过的方式）：

   ```sh
   cd /root/.dsh/profiles/web/
   pnpm add link:<本仓库绝对路径>/cc-import
   ```

   （等效做法：把 `cc-import/` 目录复制/软链进 profile 的 pnpm workspace globs 覆盖的层级后 `pnpm install`。）
2. **加 loader 条目**：编辑该 profile 的 `cordis.patch.yml`。注意 dsh 的 patch 语义要求**容器键**：裸写 `- id:/name:` 列表项会被当作未知 target **静默跳过**（不报错、插件不装载）。必须写成 `- insert:` 列表：

   ```yaml
   - insert:
       - id: cc-import
         name: cc-import
   ```

3. **重启**：`dsh web` 重启后打开 Web 界面（Host 半随主进程装载，Client 半 `lib/client.js` 由前端 ModuleLoader 注入；zod 已由客户端构建内联，无需额外安装）。

## 真机验收清单

按顺序逐项确认（以下为 2026-10-14 真机实测口径）：

1. **按钮可见**：设置 → Models 页底部出现「从 Claude Code 导入」按钮。
2. **对话框候选与 cc-switch 一致**：点击按钮，对话框候选列表与 `sqlite3 ~/.cc-switch/cc-switch.db "SELECT name FROM providers WHERE app_type='claude'"` 一致（实测该机 cc-switch 为 11 行 claude：10 个可导入——含 OpenCodeGo / bytedance-volces / bigmodel.cn 等；唯一跳过行为 OAuth 型「Claude Official」，无勾选框）。跳过原因标注按 缺 `ANTHROPIC_BASE_URL` → 缺 `ANTHROPIC_AUTH_TOKEN` → 缺模型 的先后判定；「Claude Official」两者皆缺时显示缺 BASE_URL。
3. **导出全部可导入候选**：全选（可导入行默认已勾选）→ 导入，结果反馈「Imported 10」且无失败明细。
4. **Models 页出现新行且密钥状态点绿色**：每个导入候选在 Models 列表出现为新 provider 行（api = Anthropic Messages），密钥状态点为绿色（凭据已入 `<DSH_HOME>/.credentials.yaml` 的 refs，settings 里 provider 只写 `apiKeyEnv` 凭据引用名，无 token 明文）。
5. **既有 provider 未受影响**：导入前已配置的 provider 行原样保留（cc-import 只产生 `set` op，不 unset、不整体替换 `providers`）。
6. **重复导入行为**：再次打开对话框，已存在行默认不勾选并标「Already exists」（勾选框提示「Will update (overwrite this route)」）；显式勾选后导入，同名 route 被原位覆盖而不是出现 `-2` 副本。
