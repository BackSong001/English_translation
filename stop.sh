#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/app.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "실행 중인 서버가 없습니다."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in {1..20}; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -9 "$PID" 2>/dev/null || true
  echo "서버를 종료했습니다."
else
  echo "서버 프로세스가 이미 종료되어 있습니다."
fi
rm -f "$PID_FILE"

