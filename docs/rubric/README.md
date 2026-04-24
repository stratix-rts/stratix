# docs/rubric/ — 量表与规格文档

本文件夹存放 AI 编码协同的**评价量表**和**任务技术规格**。

## 目录结构

```
docs/rubric/
├── README.md                    ← 本文件
├── SOLO_OBE_RUBRIC.md          ← 通用量表体系（三阶段流水线 + D1-D6/C1-C6 + SOLO 判定细则）
├── v3/                          ← V3 实验组（D1-D6 + C1-C6）
│   ├── CC_V3_RUBRIC.md         ← V3 任务专属代码量表（C1-C6）
│   ├── CC_V3_REQUIREMENTS_RUBRIC.md ← V3 需求设计量表（R1-R5）
│   ├── CC_V3_TASKS.md          ← V3 Task 列表 + 进度（18 task）
│   ├── CC_V3_TECH_SPEC.md      ← V3 技术规格
│   └── prompts/T01-T18/        ← V3 每个 task 的 prompt
└── v4/                          ← V4 实验组（C1-C6 + A1-A8 美学约束）
    ├── CC_V4_RUBRIC.md         ← V4 任务专属量表（C1-C6 + A1-A8）
    ├── CC_V4_REQUIREMENTS_RUBRIC.md ← V4 需求设计量表（R1-R5，与 V3 相同）
    ├── CC_V4_TASKS.md          ← V4 Task 列表（18 task，与 V3 相同）
    ├── CC_V4_TECH_SPEC.md      ← V4 技术规格（与 V3 相同）
    └── prompts/T01-T18/        ← V4 每个 task 的 prompt（= V3 prompt + A1-A8 美学约束）
```

## 实验设计

| 版本 | 代码目录 | 量表 | 唯一变量 |
|:----:|---------|------|---------|
| V2 | `v2/` | 无 | — |
| V3 | `v3/` | C1-C6 | D1-D6 功能量表 |
| V4 | `v4/` | C1-C6 + A1-A8 | A1-A8 美学约束（增量） |

### 对照逻辑
- **V2 vs V3**: 看功能量表（D1-D6）的增量效果
- **V3 vs V4**: 看美学约束（A1-A8）的增量效果（唯一变量）
- **V2 vs V4**: 看完整量表（功能+美学）的整体提升

### V3 和 V4 共享
- 同一份原始需求文档（`docs/CHARACTER_CREATOR_V2_REDESIGN.md`）
- 同一套 Task 拆解（18 个 task）
- 同一套 C1-C6 代码质量量表
- 同一套 R1-R5 需求设计量表

### V4 唯一增量
- A1-A8 美学约束（基于 Ngo, Teo, Byrne 2000）
- 每个 task prompt 末尾追加了美学约束
- 评估时多一套 A 系列打分

## 命名规范

| 前缀 | 含义 | 创建者 |
|------|------|--------|
| `SOLO_OBE_*.md` | 通用量表体系 | 人类 |
| `CC_V3_*.md` | V3 实验规格 | 人类 |
| `CC_V4_*.md` | V4 实验规格 | 人类 |
| `eval_*.md` | 单次评价报告 | 人类 |
| `profile_*.md` | Agent 能力档案 | 人类 |
| `agent_*.md` | Claude 自行创建的文档 | Claude |
