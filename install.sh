#!/usr/bin/env bash
# astryx-contrib MCP 설치. 두 번 돌려도 같은 결과.
#
#   ./install.sh [--repo <astryx 체크아웃 경로>]
#
# 하는 일: 전제 확인 → pnpm install + mcp 빌드 → 위키 사전 클론 → Claude Code / Codex 등록 → 자가진단.
# 설치된 클라이언트(claude, codex)마다 등록하고, 둘 다 없으면 멈춘다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$ROOT/mcp/dist/server.js"
CACHE="$HOME/.cache/astryx-contrib"
OLD_CACHE="$HOME/.cache/astryx-contrib-mcp"
WIKI="$CACHE/wiki"
NAME="astryx-contrib"
REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    *) echo "모르는 인자: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

step "전제 확인"
command -v node >/dev/null || fail "node 가 없다. https://nodejs.org 에서 22 이상을 설치하라."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "node 22 이상이 필요하다 (현재 $(node -v))."
command -v pnpm >/dev/null || fail "pnpm 이 없다. 설치: corepack enable && corepack prepare pnpm@latest --activate"
command -v git >/dev/null || fail "git 이 없다."
command -v gh >/dev/null || fail "gh 가 없다. 설치: brew install gh"
gh auth status >/dev/null 2>&1 || fail "gh 로그인이 안 되어 있다. 실행: gh auth login"
HAS_CLAUDE=0; HAS_CODEX=0
command -v claude >/dev/null && HAS_CLAUDE=1
command -v codex >/dev/null && HAS_CODEX=1
[ "$HAS_CLAUDE" = 1 ] || [ "$HAS_CODEX" = 1 ] || fail "claude 도 codex 도 없다. 하나는 설치하라: npm i -g @anthropic-ai/claude-code 또는 npm i -g @openai/codex"
echo "node $(node -v) · pnpm $(pnpm -v) · gh $(gh auth status 2>&1 | grep -o 'account [^ ]*' | head -1) · claude=$HAS_CLAUDE codex=$HAS_CODEX"

step "astryx 체크아웃 찾기"
is_checkout() { [ -d "$1/packages/core" ] && [ -f "$1/docs/README.md" ]; }
if [ -z "$REPO" ]; then
  for c in "$PWD" "$ROOT/../astryx" "$HOME/astryx" "$HOME/src/astryx" "$HOME/code/astryx"; do
    if is_checkout "$c"; then REPO="$c"; break; fi
  done
fi
if [ -z "$REPO" ]; then
  [ -t 0 ] || fail "astryx 체크아웃을 못 찾았다. --repo <경로> 를 넘겨라."
  read -r -p "astryx 체크아웃 경로를 입력하라 (예: ~/astryx): " REPO
  REPO="${REPO/#\~/$HOME}"
fi
REPO="$(cd "$REPO" 2>/dev/null && pwd)" || fail "경로가 없다: $REPO"
is_checkout "$REPO" || fail "$REPO 는 astryx 체크아웃이 아니다 (packages/core 와 docs/README.md 가 있어야 한다)."
echo "$REPO"

step "의존성 설치와 빌드"
(cd "$ROOT" && pnpm install --frozen-lockfile && pnpm -F mcp build)

step "위키 캐시"
if [ -d "$OLD_CACHE/wiki/.git" ] && [ ! -d "$WIKI" ]; then
  mkdir -p "$CACHE" && mv "$OLD_CACHE/wiki" "$WIKI" && echo "옛 캐시를 옮겼다: $OLD_CACHE/wiki → $WIKI"
fi
if [ -d "$WIKI/.git" ]; then
  echo "이미 있음: $WIKI (갱신은 Claude 에서 refresh 툴)"
else
  mkdir -p "$CACHE"
  git clone --quiet --depth 1 https://github.com/facebook/astryx.wiki.git "$WIKI"
  echo "클론함: $WIKI"
fi

if [ "$HAS_CLAUDE" = 1 ]; then
  step "Claude Code 등록 (user 범위)"
  claude mcp remove --scope user "$NAME" >/dev/null 2>&1 || true
  claude mcp add --scope user "$NAME" -e "ASTRYX_REPO=$REPO" -- node "$SERVER"
fi
if [ "$HAS_CODEX" = 1 ]; then
  step "Codex 등록 (~/.codex/config.toml)"
  codex mcp remove "$NAME" >/dev/null 2>&1 || true
  codex mcp add "$NAME" --env "ASTRYX_REPO=$REPO" -- node "$SERVER"
fi

step "자가진단"
ASTRYX_REPO="$REPO" node "$SERVER" --check

step "끝"
cat <<EOF
서버:   $SERVER
체크아웃: $REPO  (astryx 체크아웃 안에서 Claude Code 를 켜면 그 워크트리를 우선 읽는다)
위키:   $WIKI
확인:   $([ "$HAS_CLAUDE" = 1 ] && echo "claude mcp get $NAME") $([ "$HAS_CODEX" = 1 ] && echo "· codex mcp get $NAME")
EOF
