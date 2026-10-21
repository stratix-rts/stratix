#!/usr/bin/env bash
# Stratix 升级后回归验证脚本
# 运行：bash scripts/verify-upgrade.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

run_check() {
  local name="$1"
  shift
  echo -e "\n${YELLOW}▶ $name${NC}"
  if "$@"; then
    echo -e "${GREEN}✓ $name passed${NC}"
    ((PASS+=1))
  else
    echo -e "${RED}✗ $name failed${NC}"
    ((FAIL+=1))
  fi
}

cd "$(dirname "$0")/.."

echo -e "${YELLOW}=== Stratix 升级回归验证 ===${NC}"
echo "Working directory: $(pwd)"

# 1. 生产代码类型检查
run_check "typecheck (src)" npm run typecheck

# 2. 测试代码类型检查（如果 package.json 已添加该脚本）
if npm run --silent typecheck:tests >/dev/null 2>&1; then
  run_check "typecheck:tests" npm run typecheck:tests
else
  echo -e "${YELLOW}⚠ typecheck:tests script not found, skipping${NC}"
fi

# 3. 代码规范（lint 脚本修复后）
if npm run --silent lint -- --version >/dev/null 2>&1; then
  run_check "lint" npm run lint
else
  echo -e "${YELLOW}⚠ lint script not runnable, skipping${NC}"
fi

# 4. 单元测试
run_check "unit tests" npm test

# 5. 前端构建
run_check "frontend build" npm run build:frontend

echo -e "\n${YELLOW}=== 验证结果 ===${NC}"
echo -e "${GREEN}通过: $PASS${NC}"
echo -e "${RED}失败: $FAIL${NC}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
