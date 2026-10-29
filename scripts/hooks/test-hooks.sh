#!/bin/bash
# 하네스 훅 회귀 검사 (ADR-0001). 사용: bash scripts/hooks/test-hooks.sh
# Claude Code 는 훅에 {"tool_name": ..., "tool_input": {...}} JSON 을 stdin 으로 넘긴다.
# 2026-10-27 project-seed 감사: 환경변수 CLAUDE_TOOL_INPUT 만 읽던 훅은 늘 빈 값을 받아 아무것도 막지 못했다.
# 그래서 "파일이 있다"가 아니라 "합성 입력을 넣으면 실제로 막는다/통과시킨다"를 검사한다. 차단 exit 2, 통과 exit 0.
set -u
cd "$(dirname "$0")" || exit 1
fail=0

check() { # check <hook> <field> <value> <expected-exit>
  local payload got
  payload=$(python3 -c 'import json,sys; print(json.dumps({"tool_name": "X", "tool_input": {sys.argv[1]: sys.argv[2]}}))' "$2" "$3")
  printf '%s' "$payload" | env -u CLAUDE_TOOL_INPUT bash "$1" >/dev/null 2>&1
  got=$?
  if [[ $got -ne $4 ]]; then
    echo "FAIL $1 [$3] expected $4 got $got"
    fail=1
  fi
}

check env-guard.sh file_path /repo/.env 2
check env-guard.sh file_path .env 2
check env-guard.sh file_path /repo/.env.local 2
check env-guard.sh file_path /repo/.env.example 0
check env-guard.sh file_path /repo/src/main.ts 0
check env-guard.sh file_path /repo/docs/environment.md 0

check git-add-guard.sh command "git add -A" 2
check git-add-guard.sh command "git add --all" 2
check git-add-guard.sh command "git add ." 2
check git-add-guard.sh command "git add . && git commit -m x" 2
check git-add-guard.sh command "cd /repo && git add -A" 2
check git-add-guard.sh command "git add .env" 2
check git-add-guard.sh command "git add -- .env" 2
check git-add-guard.sh command "git status; git add config/.env.local" 2
check git-add-guard.sh command "git add .env.example .env" 2
check git-add-guard.sh command "git add .env.example" 0
check git-add-guard.sh command "git add src/a.ts docs/b.md" 0
check git-add-guard.sh command "git status" 0
# 명령 안의 문서 문구(heredoc·echo)는 명령이 아니다 (2026-10-29 sh-llm-study 오탐 2회)
check git-add-guard.sh command "echo '| \`git add -A/.\`·.env staging 차단 |' >> CLAUDE.md" 0
check git-add-guard.sh command $'python3 - <<\'EOF\'\ns = "`git add . && ...` 누락"\nEOF' 0

# JSON 이 아닌 입력은 막지 않는다 (훅 오류로 작업 전체가 멈추지 않게)
echo "not json" | bash env-guard.sh >/dev/null 2>&1 || { echo "FAIL env-guard.sh malformed input"; fail=1; }

# 옛 입력 방식이 남은 훅이 없어야 한다
if grep -l --exclude=test-hooks.sh "environ.get('CLAUDE_TOOL_INPUT'" ./*.sh 2>/dev/null; then
  echo "FAIL 위 훅이 아직 CLAUDE_TOOL_INPUT 환경변수만 읽는다"
  fail=1
fi

[[ $fail -eq 0 ]] && echo "hooks: all passed"
exit $fail
