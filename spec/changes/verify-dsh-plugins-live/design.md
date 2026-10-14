## Context

两插件（cc-import、fenix-dsh-dashboard-bridge）mock 级验证已通过，真机（dsh 0.2.0-rc.2）安装由人工完成后暴露三类事实：

1. **cc-import client 激活失败**：页面 boot 报 `web boot: 1 entry did not activate / cc-import: failed`（控制台 stack 指向前端 bootloader，底层 reject 被吞）。host 半正常装载。bridge client 半无 boot 报错（其清单项未验）。client bundle 确认已被服务与拉取（`/plugins/` 组合清单含 `cc-import/client.js`），失败发生在入口 `apply` 执行期——嫌疑面按 `src/client/index.ts` 的 `apply` 顺序：`ctx.remote.$mount(TYPERT_REMOTE)`（typert 描述符 src-json 编解码在真机 typert-protocol 版本上的兼容性）、`locale.register`、`slots.inject('settings.models.footer')`。
2. **安装文档步骤被证伪**：裸 `- id:/name:` loader 条目被 dsh patch 语义静默跳过（`dsh-app-boot` `patchStructure` description 原文），必须 `- insert:`。`pnpm add link:` 实测可完成 workspace 注册。
3. **非 loopback 前置**：settings 面仅 loopback 浏览器可用；已人工安装 `6mt/dsh-plugin-loopback-trust` v0.1.1（实测 0.2.0-rc.2 生效，Models 页在 home.icyfenix.cn 下正常渲染）。

运行环境事实：dsh web 监听 127.0.0.1:3080（frp 经 home.icyfenix.cn 暴露，启动日志 `/tmp/dsh-web.log`，token 每次启动轮换）；上游 dashboard 127.0.0.1:8787 运行中；node v24.19.0；本机 `~/.cc-switch/cc-switch.db` 为 11 行 claude（10 可导入 + 1 缺 token）；playwright-cli 可用；live profile（`/root/.dsh/profiles/web/`）已由人工完成 link + insert 注册，与主树 `/root/dsh-plugins/` 建立 symlink——worktree 修复经 merge-back 进主树后，重启 live 即加载新构建。

## Goals / Non-Goals

**Goals**

- 定位并修复 cc-import client 激活失败的根因（仓库源码层，附隔离复现路径）
- 两插件真机验收清单的可自动化项在隔离 profile 上全量执行并出结论
- 两份安装文档修正为实测可行版本 + 新增验证方法论文档
- live 实例保持在「已注册、可一键刷新」状态（重启即生效）

**Non-Goals**

- 不改 dsh 本体、不实现受信主机的官方 settings 放行（跟踪上游 discussion #2689）
- 不处理 frp 链路 TLS 化（用户明示延后）
- bridge 验收清单中需要长时观察/人工感知的项（如 SSE 数十轮连续切换的体感、多端同步）不做全自动化，取可自动化子集并记录取舍
- 不在本 SPEC 内做 live 实例的导入写入（用户回来后按文档刷新 live 再操作）

## Decisions

1. **验证载体 = 隔离 profile（临时 DSH_HOME + 独立端口 + worktree 产物）**，而非直接用 live 实例。理由：实现分支的修复在 merge-back 前不在主树，live profile 的 symlink 指向主树；隔离 profile 用 `pnpm add link:<worktree路径>` 直链 worktree 构建产物，使「实现→真机验证」在同分支闭环；同时导入写入落在临时 DSH_HOME，零污染 live。备选（把 live profile 改指 worktree）被否：污染人工维护的 live 状态、且验证期与用户使用期冲突。
2. **激活失败的定位路径 = 先观测后假设**：在隔离 profile 复现 → 浏览器 console + `performance` 资源清单 + 在 client 入口源码插桩（console.warn 逐段标记 apply 进度，构建后复测）→ 收敛到具体 reject 点。不做「先改一版试试」。bootloader 吞错则从插件侧插桩补可观测性，修复要求含「激活失败可定位到具体服务/模块」。
3. **文档修正以实测为准绳**：文档任务与验证任务同批交付，文档中每个步骤在本 SPEC 验证过程中被实际执行过（「按文档从零重装可复现」场景），避免再交付一份未经执行的文档。
4. **live 实例刷新 = 文档化人工步骤**（重启 dsh web 即加载 merge-back 后的新构建），不在任务门禁内：实现 Agent 在 worktree 无法也不应操作主树与 live 进程；该步骤写入文档并在 `.fenix/todo.md` 留人工提示。
5. **typert 描述符兼容策略**：若根因坐实为 src-json 编解码/描述符在 0.2.0-rc.2 typert-protocol 上的形态差异，以真机可用的最小描述符面修正 `TYPERT_REMOTE`（对齐 bridge 已验证可激活的描述符写法），不升级 dsh。

## Risks / Trade-offs

- [bootloader 吞掉底层 reject，根因定位慢] → 插件侧逐段插桩 + 隔离 profile 快速重启回路（秒级），必要时以 `--dump-config` 核对装载树
- [隔离 profile 与 live profile 环境漂移（缺 loopback-trust / 受信主机差异）导致「隔离过、live 不过」] → 隔离 profile 复刻 live 的关键面：同样的插件集合（含 loopback-trust）与 `--trusted-host` 参数；验收场景含非 loopback 主机名路径（临时 hosts 条目 + 收尾清理）
- [导入闭环测试写坏临时 profile 的 settings] → 仅隔离环境承受写入；临时 DSH_HOME 整体可弃
- [上游 dashboard 进程被 502 场景停掉后未恢复] → 场景内先记录 pid/启动命令，停机验证后立即按原命令拉起并探活 `GET /api/projects`
- [bridge SSE/iframe 类验收受 playwright 等待语义干扰（误报超时）] → 断言用条件轮询（DOM/请求事实）而非固定 sleep；SSE 自动刷新项以「数字变化且网络请求发生」为事实口径

## Migration Plan

实现分支合入主树后：live profile 已有 symlink 与 insert 注册，人工只需 `pkill` 掉旧 dsh web 进程并按 `/tmp/dsh-web.log` 同参重启（文档提供完整命令与注意事项），新构建即生效；回滚 = `git revert` 对应提交并重启，patch 层与 symlink 无需变更。

## Open Questions

- cc-import 激活失败根因（待隔离复现后收敛；不阻塞其余验收项并行推进）
- bridge 验收清单第 10 项（移除项目 ≤60s 消失）是否纳入自动化：依赖上游数据变更触发，倾向以「手工改上游数据 + 条件轮询」自动化，若不稳定则记录为人工项
