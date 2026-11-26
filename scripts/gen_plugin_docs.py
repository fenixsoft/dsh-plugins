#!/usr/bin/env python3
"""Regenerate the fenix:auto-plugin-list:* blocks in docs/install-dsh-plugins.md.

扫描仓内插件目录（顶层目录且 package.json 带 `dsh` 字段），按字母序重生成四个标记块：
  build    —— §3 源码路径逐插件条件构建循环
  catalog  —— §3 bundle/plain 分流清单与计数
  register —— §4 逐插件注册循环
  insert   —— §5 cordis.patch.yml 全量 - insert: 条目（CLI 自管 profile 口径）

用法：
  python3 scripts/gen_plugin_docs.py            # 就地重生成
  python3 scripts/gen_plugin_docs.py --check    # 只校验漂移，漂移则非零退出（PR 守卫用）

规则：
  - 标记块内内容由本脚本唯一拥有，勿手改（下次同步会被覆盖）；
  - prose、警告、版本演进注记在标记块外，手工维护；
  - 新插件 PR 必须重跑本脚本并把文档一并提交，否则 plugin-doc-sync workflow 的
    guard job 会 fail。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOC = REPO / "docs" / "install-dsh-plugins.md"

SKIP_DIRS = {"pkg", "out", "dist", "node_modules", "docs", "scripts", "pkg-out"}

WRAP_LIMIT = 88          # bash 循环行的目标宽度（含缩进）
CONT_INDENT = " " * 9    # "for p in " 的宽度，续行对齐


def discover_plugins(repo: Path) -> list[dict]:
    """顶层目录中 package.json 带 `name` 字段的目录 = 插件；按名称字母序返回。

    注意：不能只认 `dsh` 字段——fenix-skill-provider 的 package.json 无 dsh 字段
    （免声明 bundle 的 plain 型），但它是正式插件，须进全部循环与清单。
    """
    plugins: list[dict] = []
    for d in sorted(repo.iterdir(), key=lambda p: p.name):
        if not d.is_dir() or d.name.startswith(".") or d.name in SKIP_DIRS:
            continue
        pj = d / "package.json"
        if not pj.is_file():
            continue
        try:
            import json

            j = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(j, dict) or not isinstance(j.get("name"), str):
            continue  # 顶层非插件目录（仓库根 package.json 不在迭代范围内）
        dsh = j.get("dsh")
        plugins.append({
            "name": d.name,
            "bundle": isinstance(dsh, dict) and bool(dsh.get("bundle")),
        })
    return plugins


def wrap_names(names: list[str], *, prefix: str, indent: str, limit: int,
               suffix: str = "; do") -> str:
    """把名称序列折成 bash 反斜杠续行形态（确定性与名称序一致）。"""
    lines: list[str] = []
    cur = prefix
    first = True
    for n in names:
        cand = cur + ("" if first else " ") + n
        if not first and len(cand) > limit:
            lines.append(cur + " \\")
            cur = indent + n
        else:
            cur = cand
        first = False
    lines.append(cur + suffix)
    return "\n".join(lines)


def wrap_prose(names: list[str], *, indent: str, limit: int, tail: str) -> str:
    """把名称序列折成 `name、name、…` 的中文顿号 prose 形态；折行处行尾保留顿号。"""
    lines: list[str] = []
    cur = names[0]
    for w in names[1:]:
        cand = cur + "、" + w
        if len(cand) > limit:
            lines.append(cur + "、")  # 折行处顿号留在行尾
            cur = indent + w
        else:
            cur = cand
    lines.append(cur + tail)
    return "\n".join(lines)


def render_blocks(plugins: list[dict]) -> dict[str, str]:
    names = [p["name"] for p in plugins]
    bundle = [p["name"] for p in plugins if p["bundle"]]
    plain = [p["name"] for p in plugins if not p["bundle"]]

    build_loop = wrap_names(names, prefix="for p in ", indent=CONT_INDENT,
                            limit=WRAP_LIMIT, suffix="; do")
    build = (
        "```bash\n"
        + build_loop + "\n"
        + "  (cd <plugins>/$p && pnpm install && pnpm run --if-present build) || echo \"BUILD FAIL: $p\"\n"
        + "done\n"
        + "```"
    )

    register_loop = wrap_names(names, prefix="for p in ", indent=CONT_INDENT,
                               limit=WRAP_LIMIT, suffix="; do")
    register = (
        "```bash\n"
        + "cd ~/.dsh/profiles/<P>\n"
        + register_loop + "\n"
        + "  dsh plugin --profile <P> add \"link:<plugins绝对路径>/$p\"\n"
        + "done\n"
        + "```"
    )

    catalog_lines = [
        f"当前 `main` 共 **{len(names)} 个插件**（bundle {len(bundle)} + plain {len(plain)}）：",
        "",
        "- 声明 `dsh.bundle`（→ 进 bundles 数组，宿主侧启动挂载）："
        + wrap_prose(bundle, indent="  ", limit=80, tail="；"),
        "- 未声明（**只能**走 §5 loader insert，不得进 bundles）："
        + wrap_prose(plain, indent="  ", limit=80, tail="。"),
    ]
    catalog = "\n".join(catalog_lines)

    insert_items = "\n".join(
        f"    - id: {n}\n      name: {n}" for n in names
    )
    insert = "```yaml\n- insert:\n" + insert_items + "\n```"

    return {"build": build, "catalog": catalog, "register": register, "insert": insert}


def process(doc: Path, plugins: list[dict], *, check: bool) -> int:
    if not doc.is_file():
        print(f"ERROR: doc not found: {doc}", file=sys.stderr)
        return 2
    text = doc.read_text(encoding="utf-8")
    blocks = render_blocks(plugins)
    changed: list[str] = []
    for kind, content in blocks.items():
        begin = f"<!-- fenix:auto-plugin-list:{kind} BEGIN（scripts/gen_plugin_docs.py 生成，勿手改） -->"
        end = f"<!-- fenix:auto-plugin-list:{kind} END -->"
        i = text.find(begin)
        j = text.find(end)
        if i < 0 or j < 0 or j < i:
            print(f"ERROR: markers for '{kind}' missing or malformed in {doc}",
                  file=sys.stderr)
            return 2
        body = text[i + len(begin):j]
        new_body = "\n" + content + "\n"
        if body != new_body:
            changed.append(kind)
            if not check:
                text = text[: i + len(begin)] + new_body + text[j:]

    if check:
        if changed:
            print("DOC DRIFT — regenerate and commit. Stale blocks: "
                  + ", ".join(changed))
            return 1
        print(f"OK — {len(plugins)} plugins, all auto blocks in sync")
        return 0

    if changed:
        doc.write_text(text, encoding="utf-8")
        print(f"updated blocks: {', '.join(changed)} ({len(plugins)} plugins)")
    else:
        print(f"no changes ({len(plugins)} plugins)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="only verify blocks match repo state; exit 1 on drift")
    ap.add_argument("doc", nargs="?", default=str(DOC),
                    help=f"target doc (default {DOC})")
    args = ap.parse_args()
    plugins = discover_plugins(REPO)
    if not plugins:
        print("ERROR: no plugin dirs discovered (package.json with `dsh` field)",
              file=sys.stderr)
        return 2
    return process(Path(args.doc), plugins, check=args.check)


if __name__ == "__main__":
    sys.exit(main())
