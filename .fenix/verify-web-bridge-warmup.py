#!/usr/bin/env python3
"""verify-web-bridge-warmup.py — 被测实例账户区预热门（serve 握手前吸收冷启动/瞬态劣化）

起草：Administrator 2026-11-24（spec=add-bridge-theme-channel inconclusive_loop
根治）。非产品代码，验证基础设施。

机理与证据链：
- 末轮 web 场景批内同实例「概览」按钮秒级在场、Account menu 按钮
  `button[aria-label="Account menu"]` 10s 超时（judge 裁 env：实例启动后
  35-65s 窗口滞后挂载、窗口外全新页面 <1s 对照在场）。
- 引擎 web `wait` 动作超时硬编码 10000ms（core/verify_engine/browser.py
  wait 分支），场景侧不可配；上轮 scenario-repaired（场景内插 wait 步）
  已被证不足——竞态在场景执行前已注定。
- admin 干净盘面冷启动复测（2026-11-24 16:45，serve 后 boot+11s 无头探针）
  证明滞后**非实例固有属性**：首载账户区 59ms 即在场、二次 57ms。即滞后是
  条件性的（验证实例泄漏堆积/CPU 争抢类瞬态劣化才出现），无法在场景/引擎
  侧以静态修复消除，只能在 serve 层吸收。

设计（吸收而非等待）：
- 在 serve 分支 token 捕获后、握手文件交接前调用本脚本：无头 Chromium
  （与引擎 core/verify_engine/browser.py 同款 launch 参数）加载实例页，
  依次等「概览」（壳层渲染，30s 上限——壳层不出即实例坏，fail-fast）与
  「Account menu」（账户区就绪，FENIX_VERIFY_WARMUP_TIMEOUT_MS 上限，
  缺省 120s）。等待命中的正是 web 场景将观察的同一 DOM 可观察面——健康
  时预热即秒级空过（实测 +1.5s boot 预算），劣化时本等待吸收全部冷启动/
  瞬态路径，场景永远看到暖实例。
- 账户区超时：exit 1（serve 侧 fail-fast 终止，boot 级 env 错误优于逐场景
  flaky 超时空耗验证预算）；playwright import 失败：exit 0 fail-open 放行
  （告警留痕；引擎 web 场景与引擎同环境起浏览器，届时另有显性失败面）。
- 直接打上游（真 launch token），不经代理——预热只负责实例侧就绪，代理
  503-until-handshake 语义不受影响（握手文件在本脚本成功后才写）。
"""
import os
import sys
import time

URL = sys.argv[1] if len(sys.argv) > 1 else ""
SHELL_TIMEOUT_MS = 30000
ACCOUNT_TIMEOUT_MS = int(os.environ.get("FENIX_VERIFY_WARMUP_TIMEOUT_MS", "120000"))


def main() -> int:
    if not URL:
        print("[verify-warmup] usage: verify-warmup.py <page-url>", file=sys.stderr)
        return 1
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        print(
            f"[verify-warmup] playwright 不可用（{e}），预热 fail-open 放行"
            "（web 场景引擎侧另有显性失败面）",
            file=sys.stderr,
        )
        return 0

    # launch 参数镜像 core/verify_engine/browser.py（--no-sandbox 仅 root 注入，
    # 同款 geteuid 判据；预热浏览器只读页面不执行场景动作，无被测页风险面差异）
    args = [
        "--disable-animations",
        "--disable-gpu",
        "--font-render-hinting=none",
    ]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        args.append("--no-sandbox")

    steps = (
        ("壳层", 'button[aria-label="概览"]', SHELL_TIMEOUT_MS),
        ("账户区", 'button[aria-label="Account menu"]', ACCOUNT_TIMEOUT_MS),
    )
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=args)
        try:
            context = browser.new_context()
            page = context.new_page()
            t0 = time.monotonic()
            page.goto(URL, wait_until="domcontentloaded", timeout=SHELL_TIMEOUT_MS)
            print(
                f"[verify-warmup] 页面已加载（{(time.monotonic() - t0) * 1000:.0f}ms）",
                flush=True,
            )
            for label, selector, timeout_ms in steps:
                t = time.monotonic()
                try:
                    page.wait_for_selector(selector, state="visible", timeout=timeout_ms)
                except Exception as e:
                    first_line = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
                    print(
                        f"[verify-warmup] {label}按钮 {timeout_ms}ms 未在场"
                        f"（{first_line}）— 实例未就绪",
                        file=sys.stderr,
                    )
                    return 1
                print(
                    f"[verify-warmup] {label}就绪 {selector}"
                    f"（{(time.monotonic() - t) * 1000:.0f}ms）",
                    flush=True,
                )
        finally:
            browser.close()
    print("[verify-warmup] 预热完成：实例账户区就绪，场景可安全观察", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
