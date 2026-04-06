#!/bin/zsh
# 启动 stratix-gateway dev server，创建一个命名的进程组
# kill 时只需 kill -9 -$(pgrep -f stratix-gateway-test-group)

set -m  # 创建新进程组（macOS zsh 下有效）
export STRATIX_TEST_GROUP=stratix-gateway-test-group
# 用 psgi 让这个进程组可被识别
exec env STRATIX_TEST_GROUP="$STRATIX_TEST_GROUP" npm run dev:backend
