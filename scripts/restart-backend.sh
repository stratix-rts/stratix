#!/bin/bash

# Restart Stratix Backend
# Usage: ./scripts/restart-backend.sh

# Use Node 20
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

PORT=7524
PROCESS_NAME="stratix-gateway"

echo "🔄 Restarting Stratix Backend..."

# Find and kill existing process on port 7524
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
    echo "⏹  Killing process on port $PORT (PID: $PID)..."
    kill -9 $PID 2>/dev/null
    sleep 1
fi

# Also kill any running tsx/stratix-gateway processes
pkill -f "stratix-gateway" 2>/dev/null
pkill -f "tsx src/stratix-gateway" 2>/dev/null
sleep 1

echo "▶  Starting backend..."
cd "$(dirname "$0")/.." || exit 1
npm run dev:backend
