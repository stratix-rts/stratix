#!/usr/bin/env python3
"""
文件职责：重建像素皮肤的**内嵌像素字体子集**（Fusion Pixel 12px Mono zh-Hans）。
  上游：https://github.com/TakWolf/fusion-pixel-font（release 2026.10.25，OFL 1.1 = 可商用）。
  本脚本是**本地工具链**，不参与前端构建、不引入任何 npm 依赖（见 assets/fonts/README.md）。

用法（需先装 fonttools：`pip3 install --user --break-system-packages "fonttools[woff]"`）：
    python3 scripts/build-pixel-font-subset.py \
        --source /tmp/fp/fusion-pixel-12px-monospaced-zh_hans.otf.woff2 \
        --out assets/fonts/fusion-pixel-12px-zh-hans.woff2

字符集口径（与 assets/fonts/README.md 一致）：
    ASCII 可打印区 + 中英常用标点/符号 + GB2312 全集（一级+二级汉字）+ src/** 源码里出现过的汉字。
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PUNCTUATION = (
    "　、。！？：；，．（）《》〈〉「」『』【】〔〕…—～·×÷±°′″¥￥€$％‰℃※§¶†‡"
    "←↑→↓↔⇒⇔✓✗●○◆◇■□▲△▼▽★☆⋯"
)

# 汉字（基本区 + 扩展 A）
HANZI_RE = re.compile(r"[一-鿿㐀-䶿]")


def ascii_printable() -> str:
    return "".join(chr(code) for code in range(0x20, 0x7F))


def gb2312_hanzi() -> str:
    """GB2312 全集：一级（常用 3755 字）+ 二级（次常用 3008 字）。"""
    chars: list[str] = []
    for hi in range(16, 88):
        for lo in range(1, 95):
            try:
                chars.append(bytes([hi + 0xA0, lo + 0xA0]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return "".join(chars)


def source_hanzi(src_dir: str) -> str:
    """源码里出现过的全部汉字（界面文案的真实用字兜底）。"""
    found: set[str] = set()
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in files:
            if not name.endswith((".ts", ".tsx", ".vue", ".js", ".css", ".html")):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, encoding="utf-8", errors="ignore") as handle:
                    found.update(HANZI_RE.findall(handle.read()))
            except OSError:
                continue
    return "".join(sorted(found))


def dedupe(text: str) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for ch in text:
        if ch not in seen:
            seen.add(ch)
            out.append(ch)
    return "".join(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="上游全量 woff2（zh_hans）")
    parser.add_argument("--out", required=True, help="子集输出路径（woff2）")
    args = parser.parse_args()

    charset = dedupe(
        ascii_printable() + PUNCTUATION + gb2312_hanzi() + source_hanzi(os.path.join(REPO_ROOT, "src"))
    )
    print(f"[pixel-font] 字符集：{len(charset)} 码位")

    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as tmp:
        tmp.write(charset)
        text_file = tmp.name
    try:
        cmd = [
            sys.executable,
            "-m",
            "fontTools.subset",
            args.source,
            f"--text-file={text_file}",
            f"--output-file={args.out}",
            "--flavor=woff2",
            "--name-IDs=*",
            "--layout-features=*",
            "--no-hinting",
            "--desubroutinize",
        ]
        subprocess.run(cmd, check=True)
    finally:
        os.unlink(text_file)

    size = os.path.getsize(args.out)
    print(f"[pixel-font] 产物：{args.out}（{size / 1024:.1f} KB）")
    if size > 400 * 1024:
        print("[pixel-font] 警告：超过 400 KB 预算", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
