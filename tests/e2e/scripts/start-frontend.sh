#!/bin/zsh
# 启动 stratix-project dev server，创建一个命名的进程组
# kill 时只需 kill -9 -$(pgrep -f stratix-frontend-test-group)

set -m  # 创建新进程组（macOS zsh 下有效）
export STRATIX_TEST_GROUP=stratix-frontend-test-group
exec env STRATIX_TEST_GROUP="$STRATIX_TEST_GROUP" npm run dev:frontend
