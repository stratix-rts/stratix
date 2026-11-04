# 内嵌字体资产（v3.8 / task_134）

## fusion-pixel-12px-zh-hans.woff2

- **字体**：Fusion Pixel 12px Mono zh-Hans Regular（缝合像素字体）
- **上游**：https://github.com/TakWolf/fusion-pixel-font
- **版本**：2026.10.25（release tag `2026.10.25`）
- **许可**：SIL Open Font License 1.1 —— **可商用**（副本见同目录 `OFL-FusionPixel.txt`）
  - OFL 要求：保留版权与许可声明、不得单独售卖字体本身、衍生字体须同许可发布。
    本项目满足前两条（声明随文件入库并随产物分发），未做衍生发布。
- **上游原文件**：`fusion-pixel-font-12px-monospaced-otf.woff2` 里的
  `fusion-pixel-12px-monospaced-zh_hans.otf.woff2`（684 KB 全量，含简中 + 拉丁 + 符号）。

## 子集化口径（本仓库产物 = 上游的子集）

用 `fonttools`（本地工具链，**未引入任何 npm 依赖**）裁剪：

```
pyftsubset fusion-pixel-12px-monospaced-zh_hans.otf.woff2 \
  --text-file=<字符集> --output-file=fusion-pixel-12px-zh-hans.woff2 \
  --flavor=woff2 --name-IDs='*' --layout-features='*' --no-hinting --desubroutinize
```

字符集（6928 个码位，实测覆盖）：

| 段 | 内容 | 量 |
| --- | --- | --- |
| ASCII | `U+0020`–`U+007E`（含全部拉丁字母、数字、常用符号） | 95 |
| 常用标点 | 中英标点、`，。！？：；（）《》「」【】…—·×÷±°￥€$`、箭头 `←↑→↓↔`、勾叉 `✓✗`、几何 `●○◆◇■□▲△▼▽`、星 `★☆` 等 | ~80 |
| 汉字 | GB2312 全集（一级 3755 常用字 + 二级 3008 次常用字） | 6763 |
| 源码实际文案 | `src/**` 里出现过的全部汉字（含注释外的界面文案用字） | 与上表并集，无额外增量 |

- 覆盖：GB2312 全集 = 现行通用规范汉字表一级 + 二级，**中国大陆界面文案全覆盖**；
  罕见字（GBK 扩展区、生僻字）不在集内 → 浏览器自动回退到系统字体，不出现豆腐块。
- 产物：6928 码位 / 6810 字形 / **175 KB**（目标 ≤ 400 KB，余量充足）。
- name 表保留全部（`--name-IDs='*'`）：版权、许可声明、许可 URL、上游家族名
  `Fusion Pixel 12px Mono zh-Hans` 均在字体内部，随文件分发。

## 重建方式

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
curl -sL -o /tmp/fp12.zip \
  "https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.10.25/fusion-pixel-font-12px-monospaced-otf.woff2-v2026.10.25.zip"
unzip -j /tmp/fp12.zip "fusion-pixel-12px-monospaced-zh_hans.otf.woff2" "OFL.txt" -d /tmp/fp
python3 scripts/build-pixel-font-subset.py   # 字符集汇总 + pyftsubset 调用
```
