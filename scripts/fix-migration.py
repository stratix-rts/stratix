#!/usr/bin/env python3
"""
修复 Character Creator 组件迁移 - 正确的 Design Token 替换
"""

import re
import os

BASE_PATH = "/Users/kingj/code/Stratix/src/stratix-character-creator/ui/"

# 颜色映射：原始颜色 → getToken() 调用
COLOR_MAPPING = {
    "#0d0d14": "getToken('color.panel.default')",
    "#12121a": "getToken('color.panel.default')",
    "#0a0a12": "getToken('color.panel.subtle')",
    "#1a1a2a": "getToken('color.panel.subtle')",
    "#1a2a3a": "getToken('color.panel.subtle')",
    "#0F172A": "getToken('color.panel.subtle')",
    "#2a2a3e": "getToken('color.border.default')",
    "#1E293B": "getToken('color.border.default')",
    "#334155": "getToken('color.border.hover')",
    "#00ffff": "getToken('color.primary.default')",
    "#1a3a3a": "getToken('color.primary.dim')",
    "#ffffff": "getToken('color.foreground.default')",
    "#F8FAFC": "getToken('color.foreground.default')",
    "#6a6a8a": "getToken('color.foreground.muted')",
    "#94A3B8": "getToken('color.foreground.muted')",
    "#64748B": "getToken('color.foreground.muted')",
    "#00ff88": "getToken('color.status.success')",
    "#22C55E": "getToken('color.status.success')",
    "#ff4444": "getToken('color.status.error')",
    "#EF4444": "getToken('color.status.error')",
    "#3a2a2a": "getToken('color.status.error.bg')",
    "#ff6666": "getToken('color.status.error')",
    "#F59E0B": "getToken('color.status.warning')",
    "#22D3EE": "getToken('color.status.info')",
    # Hex colors for Phaser
    "0x0d0d14": "parseInt(getToken('color.panel.default').replace('#', '0x'))",
    "0x12121a": "parseInt(getToken('color.panel.default').replace('#', '0x'))",
    "0x0a0a12": "parseInt(getToken('color.panel.subtle').replace('#', '0x'))",
    "0x1a1a2a": "parseInt(getToken('color.panel.subtle').replace('#', '0x'))",
    "0x2a2a3e": "parseInt(getToken('color.border.default').replace('#', '0x'))",
    "0x00ffff": "parseInt(getToken('color.primary.default').replace('#', '0x'))",
    "0x00ff88": "parseInt(getToken('color.status.success').replace('#', '0x'))",
    "0xff4444": "parseInt(getToken('color.status.error').replace('#', '0x'))",
    "0x4a4a6e": "parseInt(getToken('color.panel.default').replace('#', '0x'))",
    "0x6a6a8e": "parseInt(getToken('color.panel.hover').replace('#', '0x'))",
}

# 需要添加的 imports
REQUIRED_IMPORTS = [
    "import { getToken } from '@/design-system/config';",
    "import { Depth } from '@/design-system/tokens/depth';",
]

CONTAINER_COMPONENT_IMPORT = "import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';"


def migrate_file(filepath):
    """迁移单个文件"""
    filename = os.path.basename(filepath)
    migrated_path = filepath.replace(".ts", ".migrated.ts")

    print(f"\n处理：{filename}")
    print("-" * 60)

    with open(filepath, "r") as f:
        content = f.read()

    original_lines = len(content.split("\n"))

    # 1. 添加 imports (如果没有)
    if "import { getToken }" not in content:
        # 在 Phaser import 后添加
        content = content.replace(
            "import Phaser from 'phaser';",
            "import Phaser from 'phaser';\n" + "\n".join(REQUIRED_IMPORTS),
        )
        print("✓ 添加 Design Token imports")

    # 2. 对于使用 DOM 的组件，添加 ContainerComponentBase
    if "DOMElement" in content and CONTAINER_COMPONENT_IMPORT not in content:
        content = content.replace(
            REQUIRED_IMPORTS[1], REQUIRED_IMPORTS[1] + "\n" + CONTAINER_COMPONENT_IMPORT
        )
        print("✓ 添加 ContainerComponentBase import")

    # 3. 替换颜色 (按长度降序，先替换长的)
    replacements_count = 0
    for old_color, new_token in sorted(COLOR_MAPPING.items(), key=len, reverse=True):
        count = content.count(old_color)
        if count > 0:
            content = content.replace(old_color, new_token)
            print(f"  替换 {old_color:20s} → {new_token:50s} ({count} 处)")
            replacements_count += count

    # 4. 为容器添加 Depth
    # scene.add.container(...) → scene.add.container(...).setDepth(Depth.UI_OVERLAY)
    content = re.sub(
        r"(scene\.add\.container\([^;]+?;)",
        lambda m: (
            m.group(0).replace(".setDepth", "")
            if ".setDepth" in m.group(0)
            else m.group(0).replace(");", ").setDepth(Depth.UI_OVERLAY);")
        ),
        content,
    )

    # scene.add.dom(...).createFromHTML(...) → .setDepth(Depth.UI_OVERLAY)
    content = re.sub(
        r"(scene\.add\.dom\([^)]+\)\.createFromHTML\([^)]+\))",
        r"\1.setDepth(Depth.UI_OVERLAY)",
        content,
    )
    print("✓ 添加 Depth 层级")

    # 5. 更新注释
    content = content.replace("/**\n *", "/**\n * (Migrated)\n *")

    # 写入迁移后的文件
    with open(migrated_path, "w") as f:
        f.write(content)

    new_lines = len(content.split("\n"))
    print(f"✓ 完成：{original_lines} 行 → {new_lines} 行")

    return True


def main():
    """主函数"""
    print("=" * 60)
    print("Character Creator 组件迁移修复工具")
    print("=" * 60)

    files_to_migrate = [
        "CharacterPreview.ts",
        "ButtonGroup.ts",
        "CharacterList.ts",
        "AgentListPanel.ts",
        "SoulEditor.ts",
        "AgentChatPanel.ts",
        "DirectLLMConfigPanel.ts",
        "SkillTreeUI.ts",
        "RulesEditor.ts",
        "PartSelector.ts",
        "OpenClawConnectionPanel.ts",
        "BackendSelector.ts",
        "AgentConfigPanel.ts",
    ]

    success_count = 0
    for filename in files_to_migrate:
        filepath = os.path.join(BASE_PATH, filename)
        if os.path.exists(filepath):
            try:
                if migrate_file(filepath):
                    success_count += 1
            except Exception as e:
                print(f"✗ 错误：{e}")
        else:
            print(f"⊘ 跳过：{filename} (文件不存在)")

    print("\n" + "=" * 60)
    print(f"迁移完成：{success_count}/{len(files_to_migrate)} 个文件")
    print("=" * 60)


if __name__ == "__main__":
    main()
