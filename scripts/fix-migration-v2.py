#!/usr/bin/env python3
"""
修复 Character Creator 组件迁移 - V2 (正确处理引号)
关键：不使用字符串替换，而是直接生成正确的代码
"""
import re
import os

BASE_PATH = '/Users/kingj/code/Stratix/src/stratix-character-creator/ui/'

def migrate_file(filepath):
    """迁移单个文件 - 逐行处理"""
    filename = os.path.basename(filepath)
    migrated_path = filepath.replace('.ts', '.migrated.ts')
    
    print(f"\n处理：{filename}")
    print("-" * 60)
    
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    new_lines = []
    replacements_count = 0
    
    # 颜色映射
    COLOR_MAP = {
        "#0d0d14": "color.panel.default",
        "#12121a": "color.panel.default",
        "#0a0a12": "color.panel.subtle",
        "#1a1a2a": "color.panel.subtle",
        "#1a2a3a": "color.panel.subtle",
        "#0F172A": "color.panel.subtle",
        "#2a2a3e": "color.border.default",
        "#1E293B": "color.border.default",
        "#334155": "color.border.hover",
        "#00ffff": "color.primary.default",
        "#1a3a3a": "color.primary.dim",
        "#ffffff": "color.foreground.default",
        "#F8FAFC": "color.foreground.default",
        "#6a6a8a": "color.foreground.muted",
        "#94A3B8": "color.foreground.muted",
        "#64748B": "color.foreground.muted",
        "#00ff88": "color.status.success",
        "#22C55E": "color.status.success",
        "#ff4444": "color.status.error",
        "#EF4444": "color.status.error",
        "#3a2a2a": "color.status.error.bg",
        "#ff6666": "color.status.error",
        "#F59E0B": "color.status.warning",
        "#22D3EE": "color.status.info",
        "#0d0914": "color.panel.default",
    }
    
    HEX_COLOR_MAP = {
        "0x0d0d14": "color.panel.default",
        "0x12121a": "color.panel.default",
        "0x0a0a12": "color.panel.subtle",
        "0x1a1a2a": "color.panel.subtle",
        "0x2a2a3e": "color.border.default",
        "0x00ffff": "color.primary.default",
        "0x00ff88": "color.status.success",
        "0xff4444": "color.status.error",
        "0x4a4a6e": "color.panel.default",
        "0x6a6a8e": "color.panel.hover",
    }
    
    for i, line in enumerate(lines):
        new_line = line
        
        # 处理字符串颜色 (#xxxxxx)
        for old_color, token_path in COLOR_MAP.items():
            # 匹配：'color': '#xxxxxx' 或 "color": "#xxxxxx"
            pattern = r"(['\"])color(['\"])\s*:\s*['\"]" + re.escape(old_color) + r"['\"]"
            replacement = r"\1color\2: getToken('" + token_path + "')"
            if re.search(pattern, new_line):
                new_line = re.sub(pattern, replacement, new_line)
                replacements_count += 1
            
            # 直接的值：'#xxxxxx'
            pattern2 = r"['\"]" + re.escape(old_color) + r"['\"]"
            replacement2 = "getToken('" + token_path + "')"
            if re.search(pattern2, new_line) and "getToken" not in new_line:
                new_line = re.sub(pattern2, replacement2, new_line)
                replacements_count += 1
        
        # 处理 Hex 颜色 (0xxxxx)
        for old_hex, token_path in HEX_COLOR_MAP.items():
            pattern = r"\b" + re.escape(old_hex) + r"\b"
            replacement = "parseInt(getToken('" + token_path + "').replace('#', '0x'))"
            if re.search(pattern, new_line):
                new_line = re.sub(pattern, replacement, new_line)
                replacements_count += 1
        
        # 为容器添加 Depth
        if "scene.add.container" in new_line and ".setDepth" not in new_line:
            new_line = new_line.replace(");", ").setDepth(Depth.UI_OVERLAY);")
        
        if "scene.add.dom" in new_line and ".createFromHTML" in new_line and ".setDepth" not in new_line:
            if not ".setDepth" in new_line:
                new_line = new_line.replace(");", ").setDepth(Depth.UI_OVERLAY);")
        
        new_lines.append(new_line)
    
    # 添加 imports
    content = ''.join(new_lines)
    if "import { getToken }" not in content:
        content = content.replace(
            "import Phaser from 'phaser';",
            "import Phaser from 'phaser';\nimport { getToken } from '@/design-system/config';\nimport { Depth } from '@/design-system/tokens/depth';"
        )
    
    if "DOMElement" in content and "ContainerComponentBase" not in content:
        content = content.replace(
            "import { Depth } from '@/design-system/tokens/depth';",
            "import { Depth } from '@/design-system/tokens/depth';\nimport { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';"
        )
    
    # 更新注释
    content = content.replace("/**\n *", "/**\n * (Migrated)\n *")
    
    with open(migrated_path, 'w') as f:
        f.write(content)
    
    print(f"✓ 完成：{len(lines)} 行，替换 {replacements_count} 处")
    return True

def main():
    print("=" * 60)
    print("Character Creator 组件迁移修复工具 V2")
    print("=" * 60)
    
    files = [
        'CharacterPreview.ts',
        'ButtonGroup.ts',
        'CharacterList.ts',
        'AgentListPanel.ts',
        'SoulEditor.ts',
        'AgentChatPanel.ts',
        'DirectLLMConfigPanel.ts',
        'SkillTreeUI.ts',
        'RulesEditor.ts',
        'PartSelector.ts',
        'OpenClawConnectionPanel.ts',
        'BackendSelector.ts',
        'AgentConfigPanel.ts',
    ]
    
    for filename in files:
        filepath = os.path.join(BASE_PATH, filename)
        if os.path.exists(filepath):
            try:
                migrate_file(filepath)
            except Exception as e:
                print(f"✗ 错误：{e}")
    
    print("\n" + "=" * 60)
    print("✓ 全部完成")
    print("=" * 60)

if __name__ == '__main__':
    main()
