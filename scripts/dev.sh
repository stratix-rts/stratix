#!/bin/bash
# Stratix 一键开发启动脚本
# - 清理残留端口/进程
# - 后台启动 gateway (7524/7525)
# - 前台启动 vite (7523)，并把 CLI 参数（如 --port/--host）转发给 vite
#   用法: npm run dev -- --port 7100 --host 0.0.0.0
# - 退出时自动清理后端进程组

set -m  # 启用作业控制：后台作业获得独立进程组，便于整组清理

cd "$(dirname "$0")/.."

./scripts/kill-ports.sh

npm run dev:backend > /tmp/stratix-dev-backend.log 2>&1 &
BACKEND_PID=$!
echo "🚀 backend started (pid $BACKEND_PID), log: /tmp/stratix-dev-backend.log"

cleanup() {
    echo "🧹 stopping backend process group $BACKEND_PID..."
    kill -9 -"$BACKEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

# 前台运行 vite；所有 CLI 参数透传给 vite
npm run dev:frontend -- "$@"
