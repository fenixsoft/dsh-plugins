# fenix-dsh-auth

dsh web 账号密码登录插件（零构建 JS，dsh 0.2.2-rc.1 实测）。

## 能力

- **登录页接管首页 `/`**：未认证（无有效会话 cookie、无有效 `?token=`）访问 `/` 时返回 200 登录页 HTML，替代原生纯文本 401「dsh web authentication required; reopen the URL printed by dsh web.」。静态渲染，无 CSS 动画/transition；HEAD 请求只返回响应头。
- **双通道登录**：
  - token 通道完整保留——有效 `/?token=` 的原生 303（铸会话 cookie）由插件捕获后原样回放，不复制签名逻辑；
  - 密码通道——`POST /auth/login` 校验通过后 303 到同源 `/?token=<launchToken>`（`authenticatedUrl` 生成），由 dsh 原生 `authorizeIndex` 铸 cookie 后 303 回干净 URL，地址栏不残留 token。
- **设置分区**：客户端半在官方设置弹窗注册「登录」分区（`settings.section`，官方排序尾），可配置用户名/密码（含确认密码）、保存、移除账号密码（回退 token-only）。
- **凭据存储**：经 dsh credentials 服务记录 `fenix-dsh-auth/login`（`kind: "grant"`），payload 仅含 scrypt（新写入 N=131072, r=8, p=1, keylen=64，取 OWASP 交互式登录现行建议档位）派生哈希 + 16 字节随机盐 + 参数，不落明文；校验按记录内落盘参数执行，旧记录（N=16384）继续可验。
- **安全**：登录与凭据写端点校验 Origin/Host 同源（端口按协议默认值归一化，Origin 缺失按同源放行）；凭据接口要求已认证 owner Peer；登录失败限流 5 次/60 秒（按来源地址，进程内内存，锁 60 秒，成功清零）；登录页转义一切反射值，错误码白名单，页面不含 token/凭据。
- **降级**：apply 阶段探测上游契约（`connection.authorizeIndex/authenticatedUrl/admit`、`webServer.register/readResource`、`credentials.modifyRecord`），任一缺失或类型不符时 warn 一次、不注册任何路由，保持 dsh 原生 token-only 行为；运行期异常捕获降级，不产生未处理异常。

## 范围与非目标

- 接管路由仅 `/`、`/auth/login`、`/auth/credentials`；`/api` 前缀鉴权、`/connect` token 交换、静态资源与 ETag 语义零改动。
- `/index.html` 直连不接管（保留原生行为：token 有效正常渲染，过期原生 401 文本）——用户可见入口（启动 URL、跳转、书签）均为 `/`。
- 单 owner 凭据；不做多用户/找回密码/OAuth/2FA/HTTPS 终端（公网部署须 HTTPS 反代，见 DEPLOY.md）。

## 部署

见本 SPEC 交付的 `DEPLOY.md`（fenixd 仓 `spec/changes/add-dsh-web-password-login/plugin-patch/DEPLOY.md`），要点：

1. `/root/.dsh/profiles/web/package.json` 增加 `"fenix-dsh-auth": "link:/root/dsh-plugins/fenix-dsh-auth"`，`node_modules` 建同名符号链接；
2. `cordis.patch.yml` 的 insert 块增加 `- id: fenix-dsh-auth` / `name: fenix-dsh-auth` 两行；
3. `systemctl restart dsh-web`，从 `/var/log/dsh-web.log` 尾部取新 token URL；
4. 浏览器 token 登录 → 设置「登录」分区配置账号密码 → 清 cookie 后 `/` 出现登录页，账号密码可登录。

## 不受信任地址的行为

dsh 原生 `authorizeIndex` 按 cookie 鉴权（不看信任列表），而 `admit` 按 `--trusted-host` 拒绝——两者不对称。若浏览器从**不受信任地址**（不在 `--trusted-host`、非 loopback）打开本服务：

- 未认证时 `/` 登录页直接挂横幅预告「当前访问地址不在信任主机列表中」；
- 登录 POST 信任预检 fail-fast：不校验凭据，303 回登录页挂 `untrusted` 横幅（点击登录立即得到明确反馈，而不是登录后 401）；
- 已有有效 cookie 但 Host 不受信任时，`/` 返回 403 解释页：列出当前地址、受信任地址与两种处理方法（改用受信任地址 / 管理员把地址加入 systemd 单元的 `--trusted-host` 后重启）。

修复前该场景一律显示原生 `dsh web authentication required; …` 文案（用户报障根因）。授权路径 `/api`、`/connect` 的信任语义属 dsh 原生行为，本插件不改动。

## 安全边界

- 密码仅以 scrypt 哈希 + 盐存储于 `<dsh_home>/.credentials.yaml`（dsh credentials 记录），本插件任何响应不回显密码/哈希/盐。
- 登录页与 `/auth/*` 响应不含 launchToken、会话 cookie 值或凭据哈希。
- HTTP 明文传输密码仅限内网/本机场景；公网/公网可达域名必须经 HTTPS 反代部署。
- 反向代理部署 MUST 透传 Host 头（如 nginx `proxy_set_header Host $host`），否则登录 POST 的同源校验会确定性 403。
- 失败限流按 `socket.remoteAddress` 进程内分桶（design D8），存在已知局限：经反向代理或本机聚合访问时，全部客户端共享同一来源地址桶，任一来源连输 5 次即可把该共享地址锁进 60 秒锁定（可持续续锁），表现为该地址上所有用户暂时无法登录。有意不取 `X-Forwarded-For` 按真实来源分桶（该头可伪造，是否信任属产品裁定）；触发锁定时服务端 `warn` 留痕（`/var/log/dsh-web.log`），可据此发现并处置锁死。

## 回滚

- 运行时回退 token-only：已登录态 `DELETE /auth/credentials`（或设置分区「移除账号密码」）。
- 彻底卸载：删除 profile `cordis.patch.yml` 的 insert 两行与 `package.json` 依赖（及 node_modules 链接）→ `systemctl restart dsh-web`。
