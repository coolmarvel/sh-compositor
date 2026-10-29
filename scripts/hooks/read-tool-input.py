"""훅 공용: Claude Code 가 stdin 으로 넘기는 JSON 에서 tool_input 의 한 필드를 출력한다.

Claude Code 훅은 `{"tool_name": ..., "tool_input": {...}}` 를 stdin 으로 받는다 (공식 훅 문서).
2026-10-27 project-seed 감사: 환경변수 CLAUDE_TOOL_INPUT 만 읽던 이전 판은 늘 빈 값을 받아 아무것도 막지 못했다.
사용: `python3 read-tool-input.py file_path < 훅입력.json`
"""

import json
import sys

field = sys.argv[1]
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)  # 입력이 JSON 이 아니면 빈 값 (훅은 통과시킨다)
print((data.get("tool_input") or {}).get(field, ""))
