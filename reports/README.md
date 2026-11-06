# reports/ —— 走查留痕区

本目录只放**验收走查的留痕**（截图与批次报告），不放产品资产、不放构建产物。
产品素材走 `assets/`，构建期烘焙产物走 `dist/`（见 `docs/DESIGN-asset-pipelines.md`）。

```
reports/
├── shots/     # 走查截图（命名规范见下）
└── README.md  # 本文件
```

## shots/ 命名规范

> 统一口径（QA-04 / task_224 归整）：**`<主题>-r<批次>-<变体>.png`**

| 段 | 含义 | 取值 |
|----|------|------|
| **主题** | 画面在讲什么（对象 / 场景） | kebab-case 英文，1~2 词；例：`cmdk` / `world-sync` / `character-stage` |
| **批次** | 出图所属的**评审 / 验收批次** | `r<编号>`：UI 评审轮次（`r4`…`r11`）或单任务编号（`r142` / `r161` / `r162`） |
| **变体** | 该批次内的具体画面 / 状态 | kebab-case；可含序号（`z-01`）、时点（`0000ms`）、校验号（`ck154`） |

**判定一条文件名合不合规**：把 `-r<数字>-` 之前的部分当主题、之后的当变体，主题与变体都不得为空。

### 归整前的历史命名（已全部改齐，勿再回退）

| 旧名 | 新名 | 为什么改 |
|------|------|----------|
| `-r9-cmdk-list-default-ck.png` | `cmdk-r9-list-default-ck.png` | 旧名**缺主题段**（文件名以 `-` 开头） |
| `fx-161-celebrate.png` | `fx-r161-celebrate.png` | 旧名用**连字符**而非 `-r<批次>-` 段位 |
| `task142-latency-working.png` | `latency-r142-working.png` | 旧名把**任务号放在主题前面**，与全仓「主题在前」相反 |
| `task154-r11-bottom-taskbar-ck154.png` | `bottom-taskbar-r11-ck154.png` | 旧名主题位是任务号，批次位（r11）反而在中间 |
| `world-sync-event-forward-click.png` | `world-sync-r11-event-forward-click.png` | 旧名**整段缺批次位** |

### 纪律

- **不许留半截名**：文件名缺主题 / 缺批次 / 缺变体任一段，都算不合规（QA-04 归整时的主要债）。
- **改名要连引用一起改**：截图被文档引用时（如 `docs/UNIT-STATE-FLOW.md`），
  改名当轮就要把引用同步掉 —— 引用指向不存在的文件 = 验收链断。
- **图本身不解释自己**：截图只说明「看到了什么」，**结论写在引用它的文档里**
  （截图当证据，文档当结论）。
