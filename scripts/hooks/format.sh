#!/bin/bash
# PostToolUse hook: Edit/Write 한 소스 파일을 Prettier 로 정리 (printWidth 200 — .prettierrc.json)
# 실패해도 작업을 막지 않는다 (포매터 문제로 편집이 막히면 안 됨).
FILE_PATH=$(python3 -c "
import json, os
data = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
print(data.get('file_path', ''))
" 2>/dev/null) || exit 0
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.css) ;;
  *) exit 0 ;;
esac
[[ -f "$FILE_PATH" ]] || exit 0
[[ -x node_modules/.bin/prettier ]] || exit 0
node_modules/.bin/prettier --write --log-level warn "$FILE_PATH" >/dev/null 2>&1 || true
exit 0
