#!/bin/bash
# PreToolUse hook: 민감 파일 staging 방지 (ADR-0001 참고)
set -euo pipefail

COMMAND=$(python3 -c "
import json, os
data = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(data.get('command', ''))
" 2>/dev/null) || exit 0

[[ "$COMMAND" != *"git add"* ]] && exit 0

if echo "$COMMAND" | grep -qE 'git add.*\.env($|\s)'; then
  echo "BLOCKED: .env 파일을 git 에 추가할 수 없습니다."
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git add\s+(-A|--all|\.\s*$)'; then
  echo "BLOCKED: 'git add -A' / 'git add .' 대신 특정 파일을 지정하세요. .env·시크릿·대용량 산출물이 포함될 수 있습니다."
  exit 2
fi

exit 0
