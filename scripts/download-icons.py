#!/usr/bin/env python3
"""
下载 Lucide Icons SVG 到本地
确保离线使用
"""

import os
import urllib.request
from pathlib import Path

ICON_NAMES = [
    # Agent 相关
    'user', 'user-check', 'user-x',
    # 命令相关
    'arrow-right', 'repeat', 'square', 'shield', 'home',
    # UI 相关
    'x', 'settings', 'check', 'chevron-right', 'chevron-down', 'plus', 'minus',
    'trash', 'edit', 'copy', 'refresh',
    # 状态相关
    'check-circle', 'alert-triangle', 'alert-circle', 'info',
    # 文件相关
    'folder', 'file', 'download', 'upload',
    # 导航相关
    'search', 'menu', 'home',
]

OUTPUT_DIR = Path('src/design-system/icons/lucide')

def download_icons():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    for name in ICON_NAMES:
        url = f'https://unpkg.com/lucide-static@latest/icons/{name}.svg'
        output_path = OUTPUT_DIR / f'{name}.svg'
        
        try:
            urllib.request.urlretrieve(url, output_path)
            print(f'✓ Downloaded {name}')
        except Exception as e:
            print(f'✗ Failed {name}: {e}')
    
    print(f'\n下载完成！图标保存在：{OUTPUT_DIR.absolute()}')

if __name__ == '__main__':
    download_icons()
