#!/bin/bash
# PreToolUse hook: .env 파일 직접 수정 차단 (ADR-0001 참고)
# 입력은 stdin 의 JSON (tool_input.file_path). 회귀 검사: scripts/hooks/test-hooks.sh
set -uo pipefail

FILE_PATH=$(python3 "$(dirname "$0")/read-tool-input.py" file_path) || exit 0
NAME=$(basename -- "$FILE_PATH")

# .env.example 은 허용
[[ "$NAME" == ".env.example" ]] && exit 0

# .env, .env.local 같은 파일 수정 차단
if [[ "$NAME" == ".env" ]] || [[ "$NAME" == .env.* ]]; then
  echo "BLOCKED: .env 파일 직접 수정 금지. .env.example 을 수정하거나 사용자에게 수동 변경을 요청하세요." >&2
  exit 2
fi

exit 0
