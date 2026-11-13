#!/usr/bin/env bash
# =============================================================================
# .fenix/verify-web-bridge.sh — add-dsh-dashboard-bridge 验证被测实例装配/启动
# 起草：Administrator（spec=add-dsh-dashboard-bridge 验证环境阻塞：
# 场景 kind 集含 api/web，被测应用 = 「dsh web + 本仓库 fenix-dsh-dashboard-bridge
# 插件」实例；验证契约 serve 段经此脚本提供。非产品代码，验证基础设施。）
# 增补：Administrator 2026-11-12（spec=add-session-advanced-search 验证环境
# 阻塞：prepare 硬编码仅装配 bridge，被测插件 fenix-dsh-session-advanced-search
# 从未进 profile → API 三端点 404 / web 入口无从注入，13 场景整轮 env。
# 现按同构形态增补第二被测插件的产物守卫 / plugin add / loader insert 条目 /
# 装配自检；新 SPEC 插件进验证须在此登记，与 verify.yaml prepare 构建步成对。）
#
# 设计（对齐 docs/help/fenix-dashboard-bridge-install.md 人工步骤，验证隔离化）：
# - 隔离 DSH_HOME=/root/.fenix-verify/dsh-web-home：与生产 /root/.dsh（生产
#   dsh web 3080 及其 profile）零交集；不用 /tmp（harness 对 /tmp 有不定期
#   清扫，实证 2026-10-14 处置中途 /tmp 生成物被整批清除——装配产物必须在
#   prepare 与 serve 之间持久存续）。验证永远打隔离新鲜实例（BASE_URL 铁律）。
# - prepare：官方 web 模板初始化隔离 profile → dsh plugin add 链接本仓库插件包
#   → cordis.patch.yml 写 loader insert 条目 → dump-config 装配自检。全程幂等。
# - serve：dsh web 起内部空闲端口（launch token per-process randomBytes 每
#   boot 轮换，无法钉死），解析 boot 行提取真实 token 后 exec
#   verify-web-bridge-proxy.py 于 {port}/FENIX_VERIFY_PORT 注入端口——任意
#   stale ?token= 在途换真实值（web 场景静态 token 从此 boot 无关）；exec 取代
#   shell，进程组归验证框架（start_new_session），内部 dsh web 同组，终局按
#   进程组回收。详见 serve 分支内注释与 verify-web-bridge-proxy.py 模块文档。
# - 上游 dashboard（桥接默认 upstream=127.0.0.1:8787）须在场：tmux 常驻
#   （fenix-dashboard 会话），由 Administrator 运维手册守护。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT/fenix-dsh-dashboard-bridge"
# 2026-11-12 扩展（admin，spec=add-session-advanced-search 验证环境阻塞）：装配链
# 从单插件（bridge）扩为「bridge + session-advanced-search」——bridge 未声明
# dsh.bundle，须显式写 profile cordis.patch.yml insert；SAS 声明了
# dsh.bundle.patch: ./cordis.patch.yml，dsh plugin add 时 loader 自动并入其包内
# patch 条目（实证 dump-config 出现 # == fenix-dsh-session-advanced-search 段），
# 故 SAS 仅需链接、无需显式 insert（显式重写会与其自动条目重复）。
SAS_PLUGIN_DIR="$ROOT/fenix-dsh-session-advanced-search"
VHOME="/root/.fenix-verify/dsh-web-home"

cmd="${1:-}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  prepare)
    mkdir -p "$VHOME"
    exec 9>"$VHOME.lock"
    flock 9
    # 0) sessions 明文残留清扫（admin 2026-11-12，spec=add-session-advanced-search
    #    inconclusive_loop 根治）：实例持久化后端钉 compression=zstd，上一轮场景
    #    种子若遗留明文 session.v4.jsonl，serve boot 扫描即 encodingMismatch，炸掉
    #    workspace→workspaceRegistry→sessionController→ui-deliverables 级联（整轮
    #    env 的跨轮复发根因——种子自清扫在场景执行阶段，永远晚于 boot 一拍）。
    #    prepare 先于 serve boot 执行，在此清扫保证 boot 永见干净盘面；夹具本体
    #    由种子场景每轮以 zstd 形态重写，与彼处清扫构成双层防御。
    find "$VHOME/sessions" -type f -name 'session.v4.jsonl' -delete 2>/dev/null || true
    # 插件产物在场性守卫（构建由 verify.yaml prepare 前置步骤完成）
    if [ ! -f "$PLUGIN_DIR/lib/index.js" ] || [ ! -f "$PLUGIN_DIR/lib/client.js" ]; then
      echo "[verify-web-bridge] 插件 lib/ 缺失：先跑 pnpm --dir fenix-dsh-dashboard-bridge install && pnpm --dir fenix-dsh-dashboard-bridge run build" >&2
      exit 1
    fi
    if [ ! -f "$SAS_PLUGIN_DIR/lib/index.js" ] || [ ! -f "$SAS_PLUGIN_DIR/lib/client.js" ] || [ ! -f "$SAS_PLUGIN_DIR/lib/host.js" ]; then
      echo "[verify-web-bridge] session-advanced-search lib/ 缺失：先跑 pnpm --dir fenix-dsh-session-advanced-search install && pnpm --dir fenix-dsh-session-advanced-search run build" >&2
      exit 1
    fi
    # 1) 官方 web 模板初始化隔离 profile（幂等：profile 已在则直接复用）
    DSH_HOME="$VHOME" dsh --profile web --dump-config >/dev/null 2>&1
    # 2) 链接插件包进 profile workspace（幂等；插件无 prod 依赖，离线秒级）
    DSH_HOME="$VHOME" dsh plugin --profile web add "$PLUGIN_DIR" >/dev/null
    # 2b) 链接 session-advanced-search（其 dsh.bundle.patch 由 add 自动并入组合
    #     tree，无需也不应再显式写 insert——见文件头 2026-11-12 扩展注释）
    DSH_HOME="$VHOME" dsh plugin --profile web add "$SAS_PLUGIN_DIR" >/dev/null
    # 3) loader insert 条目（确定性覆写：隔离 profile 是验证生成物，无人工层；
    #    插件未声明 dsh.bundle，须显式 insert 才会被装载——cordis-plugin-include
    #    语义：顶层非 insert 形态是「改已有条目」，会 warn entry not found）
    # 3a) 壳层首启引导态预注（admin 2026-11-13，spec=add-session-advanced-search
    #     验证环境阻塞根治）：官方壳层两级引导模态在验证实例上跨轮确定性弹出，
    #     全屏遮罩（_mask_14mp3_18 族）拦截 searchButton 点击，7 个 web 场景整轮
    #     env。官方源码考古定案（dsh-client-ui-settings-models/-account）：
    #     - Preview Notice（WelcomeNotice）：ack = ui-settings-general 的
    #       welcomeNoticeVersion 与 bundle 常量 2026-09-28.1 精确相等（生产实例
    #       patch 层同款条目实证）。版本钉死：官方 bump 后旧值失配 → 遮罩拦截
    #       显性失败交裁决，不以硬编码关闭步制造假失败（r10 裁决原则延续）。
    #     - Get started（DeepSeekOnboardingDialog→AccountOnboarding→SignInDialog）：
    #       总闸 = ui-settings-models 的 credentialOnboarding（默认 true）注入
    #       __DSH_MODELS_ONBOARDING__；显示条件=无可用 provider——验证实例无
    #       LLM 配置是场景前提，恒真。置 false 关闭 credential 引导 UI（用户可
    #       在设置里做的配置选择，非 mock、非产品行为篡改；场景的 LLM 降级链路
    #       走 host 半服务缝，与此 client 引导无关）。实测 ui-settings-account
    #       step:done 挡不住 SignInDialog（其渲染只看 account.status），progress
    #       done 仅作 onboarding 流兜底一并预注。
    #     运行时 ack 写回（含 judge 手动 Continue）会被本 heredoc 下轮覆写抹除
    #     ——这正是跨轮复发的机制，故 ack 必须在装配层确定性预注。
    cat > "$VHOME/profiles/web/cordis.patch.yml" <<'PATCH'
# Generated by .fenix/verify-web-bridge.sh (admin) — do not edit; rerun prepare.
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: ui-settings-account
  name: "@deepseek-ai/dsh-client-ui-settings-account"
  config:
    version: 1
    step: done
    completion: skipped
- id: ui-settings-models
  name: "@deepseek-ai/dsh-client-ui-settings-models"
  config:
    credentialOnboarding: false
- insert:
    - id: fenix-dsh-dashboard-bridge
      name: fenix-dsh-dashboard-bridge
PATCH
    # 3b) open-in-app vscode 桌面集成夹具（admin 2026-11-13，spec=add-session-
    #     advanced-search 验证环境阻塞根治）：官方 host 插件 open-in-app 的 vscode
    #     目录项在 Linux 为 desktopSpec("code", cli("code"))，宿主 /root/.local/
    #     bin/code 在 PATH → 会话视图渲染 IDE 图标并请求 /open-in-app/icon/
    #     vscode；而官方 Linux 图标提取沿 desktopId 找 <XDG_DATA>/applications/
    #     code.desktop 的 Icon= 再查 hicolor/pixmaps，宿主无该 desktop entry →
    #     官方按设计答 404（dsh-host-open-in-app lib/index.js 注释自证 404=
    #     generic glyph 兜底）→ Chromium console error → 两跳转场景 no_console_
    #     error 断言必败（判 env 豁免 → 框架硬门拒绝 verified）。真实桌面会话
    #     才有的 vscode 桌面集成文件在此以隔离 XDG 夹具补齐：XDG_DATA_HOME 指
    #     $XDG（见 serve 分支），code.desktop 的 Icon=code 命中 hicolor PNG →
    #     图标路由 200 image/png，no_console_error 真过、无需豁免。PNG 为确定性
    #     生成物（48x48 纯色，非官方美术资产——断言只管无 console error）。
    XDG="$VHOME/xdg-share"
    mkdir -p "$XDG/applications" "$XDG/icons/hicolor/128x128/apps"
    cat > "$XDG/applications/code.desktop" <<'DESKTOP'
[Desktop Entry]
Name=Visual Studio Code
Comment=Code Editing. Redefined
Exec=code %F
Icon=code
Type=Application
Categories=Development;IDE;
DESKTOP
    base64 -d > "$XDG/icons/hicolor/128x128/apps/code.png" <<'PNG'
iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAOklEQVR42u3OQQ0AAAgEoEtiPHMazRbOBxsBSPW8EiEhISEhISEhISEhISEhISEhISEhISEhISGhOwvb9mSmAL3aBgAAAABJRU5ErkJggg==
PNG
    # 4) 装配自检：组合树必须含两插件条目，否则 fail-fast（不带病启动）
    TREE="$(DSH_HOME="$VHOME" dsh --profile web --dump-config 2>/dev/null)"
    if ! grep -q "id: fenix-dsh-dashboard-bridge" <<<"$TREE"; then
      echo "[verify-web-bridge] 装配自检失败：组合树无 fenix-dsh-dashboard-bridge 条目" >&2
      exit 1
    fi
    if ! grep -q "id: fenix-dsh-session-advanced-search" <<<"$TREE"; then
      echo "[verify-web-bridge] 装配自检失败：组合树无 fenix-dsh-session-advanced-search 条目（dsh.bundle.patch 未并入？）" >&2
      exit 1
    fi
    # 4b) 引导态预注自检（admin 2026-11-13）：三条 ack 覆写必须并入组合树，
    #     否则壳层首启引导模态将全屏拦截 web 场景点击（env 复发根因）
    if ! grep -q "welcomeNoticeVersion" <<<"$TREE" \
       || ! grep -q "credentialOnboarding: false" <<<"$TREE"; then
      echo "[verify-web-bridge] 装配自检失败：引导态预注未并入组合树（welcomeNoticeVersion/credentialOnboarding 缺失）" >&2
      exit 1
    fi
    # 4c) open-in-app 图标夹具自检（admin 2026-11-13）：desktop entry 与 PNG 均
    #     在场且 PNG 魔数合法，否则图标路由 404 → no_console_error 断言必败
    XDG="$VHOME/xdg-share"
    if ! grep -q "^Icon=code$" "$XDG/applications/code.desktop" 2>/dev/null \
       || [ "$(head -c 4 "$XDG/icons/hicolor/128x128/apps/code.png" 2>/dev/null)" != $'\x89PNG' ]; then
      echo "[verify-web-bridge] 装配自检失败：open-in-app vscode 图标夹具缺失/损坏（$XDG）" >&2
      exit 1
    fi
    echo "[verify-web-bridge] prepare ok: 隔离 profile 双插件装配就绪（$VHOME）"
    ;;
  serve)
    port="${1:-${FENIX_VERIFY_PORT:-}}"
    if [ -z "$port" ]; then
      echo "[verify-web-bridge] serve 需要端口（{port} 占位符注入或 FENIX_VERIFY_PORT）" >&2
      exit 1
    fi
    # 装配在场守卫（跳过 prepare 直接 serve 时 fail-fast，而非裸启动无插件实例）：
    # bridge 走 profile cordis.patch.yml 显式 insert；SAS 走 bundle patch 自动
    # 并入（不落 profile 文件），以 node_modules 链接为在场凭证
    if ! grep -q "fenix-dsh-dashboard-bridge" "$VHOME/profiles/web/cordis.patch.yml" 2>/dev/null \
       || [ ! -e "$VHOME/profiles/web/node_modules/fenix-dsh-session-advanced-search" ]; then
      echo "[verify-web-bridge] 隔离 profile 未装配（先执行 $0 prepare）" >&2
      exit 1
    fi
    # open-in-app 图标夹具在场守卫（同上 fail-fast 哲学）：缺失即上游图标路由
    # 404 → web 场景 no_console_error 断言必败（admin 2026-11-13 根治项）
    if [ ! -f "$VHOME/xdg-share/applications/code.desktop" ] \
       || [ ! -f "$VHOME/xdg-share/icons/hicolor/128x128/apps/code.png" ]; then
      echo "[verify-web-bridge] open-in-app 图标夹具缺失（先执行 $0 prepare）" >&2
      exit 1
    fi
    # ---------------------------------------------------------------------------
    # token 交换代理（admin 2026-11-02，spec=add-session-grouper-and-shell-polish
    # 验证环境阻塞修复）：dsh web launch token 为 per-process randomBytes（每次
    # boot 轮换、无 CLI/env 可钉死），web 场景 navigate 静态 ?token= 在 serve
    # 重启后必然过期 → 401 壳层空白 → web 断言级联零命中（4 场景整轮 env）。
    # 故 dsh web 改起内部端口，本脚本解析 boot 行提取真实 token 后经握手文件
    # 注入 verify-web-bridge-proxy.py（绑定 {port}/FENIX_VERIFY_PORT 注入端口）
    # ——任意 stale ?token= 在途换真实值，上游照常铸签名 cookie；场景/引擎/
    # 契约三零改动。进程组语义不变——代理/上游 dsh web/本脚本同进程组，终局
    # killpg 一并回收（脚本 wait 代理保持存活句柄）。
    # ---------------------------------------------------------------------------
    # 代理先行（admin 2026-11-03 端口发现竞态根治）：引擎 CommandVerifyServer
    # 端口发现三段式（注入端口探 → ss 进程归属 → 邻近扫描），同进程组内先绑
    # 者胜——旧排序（上游 dsh web 先起 ~2s 绑内部随机端口，代理 token 提取后
    # 才绑注入端口）使 ss 进程归属段在窗口内把内部端口当被测实例钉死 → origin
    # 全量改写直连内部端口 → 占位 token 401 壳层未渲染（2026-11-02 第 1 轮
    # 4 web 场景整轮 env，judge 裁决实证）。现改为：代理以 --handshake 模式
    # 先行启动并【确认绑定注入端口】后，才起上游 dsh web——注入端口探恒先于
    # ss 进程归属命中，排序上根除竞态；握手文件在 token 提取后原子交接。
    # ---------------------------------------------------------------------------
    HS_FILE="$VHOME/proxy-handshake.json"
    rm -f "$HS_FILE" "$HS_FILE.tmp"
    python3 "$ROOT/.fenix/verify-web-bridge-proxy.py" \
      --listen-port "$port" --handshake "$HS_FILE" &
    PROXY_PID=$!
    # 确认代理已绑定注入端口（任一完整 HTTP 响应即绑定；握手期答 503）——
    # 未确认前不起上游，杜绝 ss 进程归属段抢先命中内部端口
    proxy_bound=0
    for _ in $(seq 1 40); do
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null || true)"
      if [ -n "$code" ] && [ "$code" != "000" ]; then proxy_bound=1; break; fi
      if ! kill -0 "$PROXY_PID" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if [ "$proxy_bound" != 1 ]; then
      echo "[verify-web-bridge] 代理未在 10s 内绑定注入端口 $port（启动即死？），终止 serve" >&2
      kill "$PROXY_PID" 2>/dev/null || true
      exit 1
    fi
    echo "[verify-web-bridge] token-exchange proxy bound :$port (handshake mode, 503 until upstream ready)"
    UP_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
    WEB_LOG="$VHOME/web-boot.log"
    : > "$WEB_LOG"
    # XDG_DATA_HOME 注入（admin 2026-11-13）：open-in-app 插件按 desktopData-
    # Directories(home,env) 取 XDG 根，注入隔离夹具目录（user 级首目录被替换，
    # XDG_DATA_DIRS 系统目录不动）→ code.desktop/图标可解析 → 图标路由 200，
    # 消除会话视图 IDE 图标 404 console error（两跳转场景 no_console_error 根因）
    env DSH_HOME="$VHOME" XDG_DATA_HOME="$VHOME/xdg-share" dsh --profile web --no-open --port "$UP_PORT" >"$WEB_LOG" 2>&1 &
    WEB_PID=$!
    TOKEN=""
    for _ in $(seq 1 120); do
      TOKEN="$(grep -oE 'token=[A-Za-z0-9_-]+' "$WEB_LOG" 2>/dev/null | tail -1 | cut -d= -f2 || true)"
      [ -n "$TOKEN" ] && break
      if ! kill -0 "$WEB_PID" 2>/dev/null; then
        echo "[verify-web-bridge] dsh web 启动即死（内部端口 $UP_PORT），boot 日志尾部：" >&2
        tail -20 "$WEB_LOG" >&2 || true
        kill "$PROXY_PID" 2>/dev/null || true
        exit 1
      fi
      sleep 0.5
    done
    if [ -z "$TOKEN" ]; then
      echo "[verify-web-bridge] 60s 内未捕获 dsh web boot 行（token 提取失败），boot 日志尾部：" >&2
      tail -20 "$WEB_LOG" >&2 || true
      kill "$PROXY_PID" 2>/dev/null || true
      kill "$WEB_PID" 2>/dev/null || true
      exit 1
    fi
    echo "[verify-web-bridge] upstream dsh web: http://127.0.0.1:$UP_PORT/?token=$TOKEN"
    # 原子握手交接（temp+mv：代理读侧无半写窗口），随后脚本 wait 代理常伴
    # ——本进程存活句柄与旧 exec 形态等价，终局 killpg 全组回收
    printf '{"upstream_port": %s, "token": "%s"}\n' "$UP_PORT" "$TOKEN" > "$HS_FILE.tmp"
    mv "$HS_FILE.tmp" "$HS_FILE"
    echo "[verify-web-bridge] handshake written: proxy :$port -> upstream :$UP_PORT"
    wait "$PROXY_PID"
    ;;
  *)
    echo "usage: $0 {prepare|serve [port]}" >&2
    exit 2
    ;;
esac
