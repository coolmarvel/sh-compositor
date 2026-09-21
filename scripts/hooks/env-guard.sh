#!/bin/bash
# PreToolUse hook: .env 파일 직접 수정 차단 (ADR-0001 참고)
set -euo pipefail

FILE_PATH=$(python3 -c "
import json, os
data = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(data.get('file_path', ''))
" 2>/dev/null) || exit 0

# .env.example 은 허용
[[ "$FILE_PATH" == *".env.example" ]] && exit 0

# .env 파일 수정 차단
if [[ "$FILE_PATH" == *"/.env" ]] || [[ "$FILE_PATH" == *"/.env."* ]]; then
  echo "BLOCKED: .env 파일 직접 수정 금지. .env.example 을 수정하거나 사용자에게 수동 변경을 요청하세요."
  exit 2
fi

exit 0
