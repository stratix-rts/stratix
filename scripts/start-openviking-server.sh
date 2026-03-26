#!/bin/bash
# 启动 OpenViking Server 作为后台服务
# 监听端口 1933
# 数据目录: ./openviking_data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_ROOT/openviking_data"
PORT=1933
LOG_FILE="$PROJECT_ROOT/openviking_server.log"

# 确保数据目录存在
mkdir -p "$DATA_DIR"

echo "[OpenViking] 启动服务..."
echo "[OpenViking] 数据目录: $DATA_DIR"
echo "[OpenViking] 监听端口: $PORT"

# 检查是否已经有服务在运行
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "[OpenViking] 端口 $PORT 已被占用，检查现有进程..."
    EXISTING_PID=$(lsof -t -i :$PORT)
    echo "[OpenViking] 现有进程 PID: $EXISTING_PID"
    echo "[OpenViking] 如果需要重启，请先运行: kill $EXISTING_PID"
    exit 0
fi

# 检查是否有 openviking-server 命令
if ! command -v openviking-server &> /dev/null; then
    echo "[OpenViking] 错误: openviking-server 命令未找到"
    echo "[OpenViking] 请确保 OpenViking 已安装并配置在 PATH 中"
    echo "[OpenViking] 或通过 npm 安装: npm install -g openviking-server"
    exit 1
fi

# 启动服务（后台运行）
nohup openviking-server \
    --port $PORT \
    --data-dir "$DATA_DIR" \
    > "$LOG_FILE" 2>&1 &

SERVER_PID=$!
echo "[OpenViking] 服务已启动，PID: $SERVER_PID"
echo "[OpenViking] 日志文件: $LOG_FILE"

# 等待服务启动并检查健康状态
sleep 2

# 验证服务是否成功启动
for i in {1..10}; do
    if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo "[OpenViking] 服务健康检查通过"
        exit 0
    fi
    echo "[OpenViking] 等待服务启动... ($i/10)"
    sleep 1
done

echo "[OpenViking] 警告: 服务可能未正常启动，请检查日志: $LOG_FILE"
echo "[OpenViking] 可以通过以下命令查看日志: tail -f $LOG_FILE"
exit 1
