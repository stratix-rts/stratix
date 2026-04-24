#!/bin/bash

# Kill processes on Stratix dev ports
# Usage: ./scripts/kill-ports.sh

echo "🔪 Killing processes on dev ports..."

for PORT in 7523 7524 7525 9222; do
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "   Killing port $PORT (PID: $PID)..."
        kill -9 $PID 2>/dev/null
    fi
done

# Kill stray electron/node processes from previous dev sessions
pkill -f "electron .* electron.config.json" 2>/dev/null
pkill -f "electron/app" 2>/dev/null
pkill -f "tsx src/stratix-gateway" 2>/dev/null
pkill -f "nodemon.*stratix-gateway" 2>/dev/null

echo "✅ Ports cleared"
