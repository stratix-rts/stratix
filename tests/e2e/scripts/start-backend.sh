#!/bin/zsh
# 启动 stratix-gateway dev server，创建一个命名的进程组
# kill 时只需 kill -9 -$(cat /tmp/stratix-test-backend.pid)

set -m  # 创建新进程组（macOS zsh 下有效）

PID_FILE="/tmp/stratix-test-backend.pid"
LOG_FILE="/tmp/stratix-test-backend.log"

# 如果已存在旧进程，先 kill 掉
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
fi

# 启动新进程，重定向 stdout/stderr 到日志文件
export STRATIX_TEST_GROUP=stratix-gateway-test-group
npm run dev:backend > "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_FILE"
echo "[start-backend] PID=$BACKEND_PID started, log=$LOG_FILE"