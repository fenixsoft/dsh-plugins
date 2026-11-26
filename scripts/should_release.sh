#!/usr/bin/env bash
# should_release.sh — 判定 main 相对最新 tag 是否有「插件内容」变更。
#
# 被 .github/workflows/fenix-release-sync.yml 调用：fenixd 发新版本时触发
# 本仓发布检查——有未发版的插件变更则输出 next_tag（patch+1）由 sync workflow
# 打 tag（构建发布复用 release.yml 单一链路）；没有则 should_release=false 不变。
#
# 判定口径：
#   1. HEAD == 最新 tag 指向的 commit → 无变更；
#   2. 否则取 diff（tag..HEAD），只有落在「插件目录」（顶层含 package.json 的
#      目录，与 gen_plugin_docs.py 发现口径一致）或根构建配置
#      （package.json / tsdown.config.* / pnpm-lock.yaml）内的变更才算——
#      docs/、scripts/、.github/、README 等非制品内容变更不触发发版
#      （zip 只含插件目录，这类变更不影响制品内容）。
#
# 输出（GITHUB_OUTPUT，本地运行打到 stdout）：
#   should_release=true|false
#   next_tag=vX.Y.Z（仅 should_release=true 时）
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

TAG="$(git tag --list 'v*' --sort=-v:refname | head -1)"
if [ -z "$TAG" ]; then
  # 无任何 tag：首版直接发 v0.1.0
  echo "should_release=true"
  echo "next_tag=v0.1.0"
  exit 0
fi

HEAD_SHA="$(git rev-parse HEAD)"
TAG_SHA="$(git rev-parse "${TAG}^{commit}")"
if [ "$TAG_SHA" = "$HEAD_SHA" ]; then
  echo "no-change: HEAD == ${TAG} (${TAG_SHA:0:7})"
  echo "should_release=false"
  exit 0
fi

# 插件目录 = 顶层含 package.json 的目录（与 release.yml Package 步、
# gen_plugin_docs.py discover_plugins 同口径）
plugin_dirs=()
for d in */; do
  d="${d%/}"
  [ -f "${d}/package.json" ] && plugin_dirs+=("$d")
done
if [ "${#plugin_dirs[@]}" -eq 0 ]; then
  echo "error: 未发现任何插件目录" >&2
  exit 1
fi

alt_re="$(IFS='|'; echo "${plugin_dirs[*]}")"
filter_re="^(${alt_re})/|^(package\.json|pnpm-lock\.yaml|tsdown\.config\.(ts|js|mts)|tsconfig\.(json|mts))$"

changed="$(git diff --name-only "${TAG}..HEAD" | grep -E "$filter_re" || true)"
if [ -z "$changed" ]; then
  echo "no plugin-content change since ${TAG}（仅 docs/scripts/CI 类变更，不发版）"
  echo "should_release=false"
  exit 0
fi

echo "plugin-content change since ${TAG}:"
echo "$changed" | sed 's/^/  /'

# next tag = 最新 tag 的 patch +1（插件集合快照语义，patch 递增）
ver="$(echo "$TAG" | sed -E 's/^v([0-9]+)\.([0-9]+)\.([0-9]+)$/\1 \2 \3/')"
read -r MA MI PA <<< "$ver"
if [ -z "${PA:-}" ]; then
  echo "error: 无法从 tag ${TAG} 解析语义版本" >&2
  exit 1
fi
echo "should_release=true"
echo "next_tag=v${MA}.${MI}.$((PA + 1))"
