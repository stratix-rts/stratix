#!/bin/bash
# 安全替换 .migrated 文件为正式文件
# 提供完整的备份和回滚支持

set -e

echo "============================================================"
echo "  替换 .migrated 文件为正式文件"
echo "============================================================"
echo ""

BACKUP_DIR="/tmp/stratix-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📦 备份目录：$BACKUP_DIR"
echo ""

# Vue 组件替换
VUE_FILES=(
  "src/stratix-command-panel/components/CommandLog.vue"
  "src/components/MainLayout.vue"
  "src/components/AgentPanel.vue"
  "src/components/CharacterCreatorModal.vue"
  "src/stratix-command-panel/components/ParamForm.vue"
  "src/stratix-command-panel/components/SkillList.vue"
  "src/stratix-command-panel/components/LogDetailModal.vue"
  "src/stratix-command-panel/components/ConfirmDialog.vue"
  "src/stratix-command-panel/components/CancelConfirmDialog.vue"
  "src/components/ParamFormModal.vue"
  "src/components/HeroManagementModal.vue"
  "src/components/LogPanelModal.vue"
  "src/components/StatusPanelModal.vue"
)

echo "📝 处理 Vue 组件..."
for file in "${VUE_FILES[@]}"; do
  migrated_file="${file%.vue}.migrated.vue"
  if [ -f "$migrated_file" ]; then
    echo "  处理：$file"
    
    # 备份原文件
    if [ -f "$file" ]; then
      cp "$file" "$BACKUP_DIR/$(basename $file).backup"
      echo "    ✓ 已备份原文件"
    fi
    
    # 替换
    cp "$migrated_file" "$file"
    echo "    ✓ 已替换为 .migrated 版本"
  else
    echo "  ⚠️ 跳过：$migrated_file 不存在"
  fi
done

# TypeScript 组件替换
TS_FILES=(
  "src/stratix-character-creator/ui/ButtonGroup.ts"
  "src/stratix-character-creator/ui/CharacterPreview.ts"
  "src/stratix-character-creator/ui/CharacterList.ts"
  "src/stratix-character-creator/ui/AgentListPanel.ts"
  "src/stratix-character-creator/ui/SoulEditor.ts"
  "src/stratix-character-creator/ui/AgentChatPanel.ts"
  "src/stratix-character-creator/ui/DirectLLMConfigPanel.ts"
  "src/stratix-character-creator/ui/SkillTreeUI.ts"
  "src/stratix-character-creator/ui/RulesEditor.ts"
  "src/stratix-character-creator/ui/PartSelector.ts"
  "src/stratix-character-creator/ui/OpenClawConnectionPanel.ts"
  "src/stratix-character-creator/ui/BackendSelector.ts"
  "src/stratix-character-creator/ui/AgentConfigPanel.ts"
)

echo ""
echo "📝 处理 TypeScript 组件..."
for file in "${TS_FILES[@]}"; do
  migrated_file="${file%.ts}.migrated.ts"
  if [ -f "$migrated_file" ]; then
    echo "  处理：$file"
    
    # 备份原文件
    if [ -f "$file" ]; then
      cp "$file" "$BACKUP_DIR/$(basename $file).backup"
      echo "    ✓ 已备份原文件"
    fi
    
    # 替换
    cp "$migrated_file" "$file"
    echo "    ✓ 已替换为 .migrated 版本"
  else
    echo "  ⚠️ 跳过：$migrated_file 不存在"
  fi
done

echo ""
echo "============================================================"
echo "  ✅ 替换完成！"
echo "============================================================"
echo ""
echo "📦 备份位置：$BACKUP_DIR"
echo ""
echo "🔄 如需回滚，执行:"
echo "   cd $BACKUP_DIR"
echo "   for f in *.backup; do cp \"\$f\" \"../src/**/\${f%.backup}\"; done"
echo ""
echo "🔍 下一步:"
echo "   1. npm run typecheck  # 验证 TypeScript"
echo "   2. npm run test       # 运行测试"
echo ""
