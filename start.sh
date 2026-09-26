#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/app.pid"
LOG_FILE="$ROOT_DIR/app.log"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "이미 실행 중입니다: http://127.0.0.1:5000"
  exit 0
fi

cd "$ROOT_DIR"
nohup "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/backend/app.py" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 1

if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "실행 완료: http://127.0.0.1:5000"
  echo "로그: $LOG_FILE"
else
  echo "실행에 실패했습니다. 로그를 확인하세요: $LOG_FILE" >&2
  exit 1
fi
