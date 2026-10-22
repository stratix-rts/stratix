# task_027

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_027.md`

**工作目录**: 项目根目录

## 描述

world: 复活 LPC 角色合成器（CharacterComposer+PartRegistry+appearance 模型，素材指向幸存 spritesheets）-模块

## requirements

从 git 历史 a9498ae~1 复活 LPC 角色合成栈：src/stratix-character-creator/core/CharacterComposer.ts、PartRegistry.ts、constants.ts（含 SPRITESHEET_BASE_PATH）、types 里 PartSelection、config/partConfig.ts。落位新架构：合成器+注册表放 src/world/appearance/（渲染层）；appearance 数据模型（Record<category, variant> 字典 + bodyType）进 src/core/types.ts 并挂 AgentProfile.appearance（021 的 AgentProfile 扩展，向后兼容：字段可选）。素材不挪动，SPRITESHEET_BASE_PATH 指向 dist/frontend/spritesheets（vite publicDir 或显式静态路由，调研后选最稳的，写清注释）。PartRegistry 的 fetch 注入保可测。

## design

git show a9498ae~1:src/stratix-character-creator/core/CharacterComposer.ts 取源码，适配：去掉 Vue 依赖（本就纯 TS）、types.ts 契约注释、world/appearance 新文件头契约注释。body 目录 18 肤色×male/female 体型。合成含 LRU 图缓存逻辑原样保留。测试：注入假 fetch/Image 的单测（元数据解析/精灵路径构建/LRU），canvas 合成真机手测归 029。

## acceptance

- tsc 零错误
- appearance 模型单测（元数据解析/路径构建/LRU 驱逐）
- AgentProfile.appearance 可选字段向后兼容（021 测试不破）
- jest src/world + src/core 全绿

## 交付物

按 design 落地的新增/修改文件 + 测试

## 验证证据（完成前必填）

- [x] **实现证明**:
  - `src/world/appearance/` 新增 LPC 合成栈（从 git 历史 a9498ae~1 复活，零 Vue / 零 DOM）：
    `constants.ts`（精灵表几何 / 动画行偏移 / 别名表 / 部位类别 / z 序）、
    `types.ts`（PartMetadata / PartSelection / ComposeOptions…）、
    `part-registry.ts`（**fetch 注入**；元数据解析 + 类别别名索引 + 精灵路径构建 + 版权署名 +
    由 core 外观模型展开部位选择）、
    `character-composer.ts`（**画布 / 图片工厂注入**；合成计划 → 取图 → 按 z 序绘制；
    LRU 位图缓存；裁动画 / 裁单帧 / 缩略图）、
    `image-cache.ts`（LRU 缓存，上限 100 张，命中刷新次序、并发去重、失败不缓存）、
    `part-config.ts`（部位类别展示配置）、`spritesheet-path.ts`（素材基址解析，纯函数）。
  - `src/core/types.ts`：新增外观数据模型 `CharacterAppearance`（`bodyType` + `Record<category, variant>`）
    与体型词表 `APPEARANCE_BODY_TYPES`；`AgentProfile.appearance` 与 `CharacterView.appearance` 均为**可选**字段。
  - `src/core/character/profile.ts`：建档可带外观（校验体型词表 / 部位字典有界 / 变体非空字符串），
    非法一律拒发（`invalid-appearance`）；投影 `toAgentProfile` 原样透传。
  - `src/app/entry-paths.ts` + `src/app/services/appearance-environment.ts`：**唯一碰 DOM 的绑定处**
    （world/README 铁律：world 不直接用 `document.*`），并给出素材基址。
  - 素材**不挪动、不复制、不入库**：真源 `assets/spritesheets/`（vite `publicDir: 'assets'` → dev 挂
    `/spritesheets`、构建拷进 `dist/frontend/spritesheets`）；electron 正式包走 `file://`，
    故基址用**相对**规则 `../../../spritesheets`（深度取自 `ENTRY_PATH_DEPTH`，入口挪位置自动跟随）。
- [x] **测试验证**: typecheck + jest 输出见下（另：全量 `npx jest` 104 套 / 2405 通过；
  `npm run typecheck:tests` 零错误；改动文件 eslint 零告警）
- [x] **影响范围**:
  - 只新增 `src/world/appearance/`、`src/app/services/appearance-environment.ts`、
    `src/core/__tests__/appearance.test.ts`、world 测试夹具；
  - 改动仅 3 处既有文件：`src/core/types.ts`（**只加**可选字段与新类型）、
    `src/core/character/profile.ts`（外观入参校验 + 投影透传）、
    `src/app/entry-paths.ts`（+ 入口深度常量）、`src/world/README.md`（布局说明）；
  - **未碰** `src/hud/`、`src/app/main/`（028/029 的活）、未引入新依赖、未动 1.3G 素材；
  - 既有 021 测试未破（`AgentProfile` 形状在无外观时逐字不变 —— `appearance` 键不出现）。

### 验证结果

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零输出 = 零错误）

$ npx jest src/world src/core --silent
Test Suites: 21 passed, 21 total
Tests:       415 passed, 415 total
Snapshots:   0 total
Time:        2.476 s

$ npx jest --silent --maxWorkers=2   # 全量（确认没碰坏别的）
Test Suites: 104 passed, 104 total
Tests:       6 skipped, 2405 passed, 2411 total
Time:        21.941 s
```

真实素材联通性抽查（不 mock 素材，读真 `assets/spritesheets/item-metadata.json`）：
解析出 **657 个部位 / 109 个类别**（与素材文件条目数一致）；默认部位 `shadow` + `body`，
拼出的路径 `/spritesheets/shadow/adult/walk/shadow.png` 等在磁盘上**确实存在**；
素材不支持的动画（shadow 没有 idle/run）正确被跳过。
