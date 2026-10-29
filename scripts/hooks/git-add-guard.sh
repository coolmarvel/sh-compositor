#!/bin/bash
# PreToolUse hook: 민감 파일 staging 방지 (ADR-0001 참고)
# 입력은 stdin 의 JSON (tool_input.command). 회귀 검사: scripts/hooks/test-hooks.sh
# 명령을 ; && || | 줄바꿈으로 나눈 뒤 "git add" 로 시작하는 구간의 인자만 본다.
# (명령 전체를 grep 하면 heredoc·echo 안의 문서 문구까지 잡는다: 2026-10-29 오탐 2회)
# 셸 우회(변수·eval·alias 등)까지 막지는 못한다.
set -uo pipefail

COMMAND=$(python3 "$(dirname "$0")/read-tool-input.py" command) || exit 0
[[ "$COMMAND" != *"git add"* ]] && exit 0

VERDICT=$(COMMAND="$COMMAND" python3 - <<'EOF'
import os, re, shlex

for seg in re.split(r"&&|\|\||[;|\n()]", os.environ["COMMAND"]):
    try:
        tokens = shlex.split(seg)
    except ValueError:  # 따옴표가 구간 경계에서 잘린 경우
        tokens = seg.split()
    if tokens[:2] != ["git", "add"]:
        continue
    for arg in tokens[2:]:
        name = os.path.basename(arg.rstrip("/"))
        if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
            print("env")
            raise SystemExit
        if arg in ("-A", "--all", "."):
            print("all")
            raise SystemExit
EOF
)

case "$VERDICT" in
  env)
    echo "BLOCKED: .env 파일을 git 에 추가할 수 없습니다." >&2
    exit 2 ;;
  all)
    echo "BLOCKED: 'git add -A' / 'git add .' 대신 특정 파일을 지정하세요. .env·시크릿·대용량 산출물이 포함될 수 있습니다." >&2
    exit 2 ;;
esac
exit 0
