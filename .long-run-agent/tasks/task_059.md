# task_059 角色编辑中心
## 需求
向导后的持续编辑入口：改名/改人设/改形象统一面板（命令已齐：character.persona.update/appearance.update，UI 补全）。
## 要点
1. 角色屏（已有形象编辑面板 041）扩展为完整编辑中心：三个 tab（档案/人设/形象）
2. 人设 tab：结构化分节编辑（043 分节格式）+ 预设重套 + 生效提示
3. 改名走既有命令（若有 name.update 命令则用，无则补 HudCommand）
4. 编辑实时反映战场（appearance 已原子刷新，persona 下次会话生效注明）
## 验收
- 三个 tab 全可编辑保存；战场形象即时更新
- typecheck/jest 全绿

---

## 验证结果（task_059 · 执行报告）

**执行日期**：2026-10-26 · 分支 `refactor/game-v3`（基线 HEAD 7ed6ec2）

### 改动文件

| 文件 | 增量 |
|------|------|
| `src/core/types.ts` | 新增 HudCommand `character.name.update`（v3.35 契约注释：trim 非空 / ≤24 码点 / 除自己重名拒发 error Notice / 同一次 setState 刷战场单位名） |
| `src/core/character/profile.ts` | 新增纯函数 `resolveCharacterName`（名字合法性唯一真相，createAgentProfile 改为复用）；`hasDuplicateCharacterName` 增可选 `excludeCharacterId`（改名豁免自己） |
| `src/core/character/manager.ts` | 新增 `CharacterNameResult` + `updateName`：形状（纯函数）→ 重名除自己（manager 判）→ 落库 + 同一次 setState 同步刷新 `unit_<id>` 的 name；与自己完全同名幂等不广播（注意：不是大小写不敏感——只改大小写如 Neo→NEO 是真改名要落库）；duplicate-name 走 error 级 Notice |
| `src/core/runtime.ts` | 接线 `character.name.update` → manager.updateName |
| `src/hud/screens/character-catalog.ts` | `characterSignature` 增 characters.name + units.name（改名广播到达时屏必须重画）；新增纯函数 `personaSectionSummary`（分节概览条） |
| `src/hud/screens/character-screen.ts` | **编辑中心**：三 tab（档案/人设/形象）+ 脏保护 + 保存回读 + 改名前置校验（详见下） |
| `src/core/__tests__/character.test.ts` | +8：updateName 全路径（含战场单位同广播刷新 / 豁免自己 / 大小写重名 / 幂等 / runtime 闭环） |
| `src/hud/__tests__/character-editor-tabs.test.ts` | 新文件 +11：三 tab 切换 / 人设保存链路（命令→DAO→提示）/ 脏保护（切 tab + 返回主屏 + 干净态畅通）/ 重名+空名+超长 / 改名链路+屏上新名可见 / 预设重套（推荐排序+覆写草稿）/ 分节概览 / 无编辑对象不渲染 |

### 三 tab 说明

- **档案（profile）**：改名输入框预填当前名；非空 / 超长(>24 码点) / 与其它角色重名（trim + 大小写不敏感、豁免自己，本地用 core 同一份 `hasDuplicateCharacterName`）前置校验给即时反馈；通过则发 `character.name.update`，core 同一次 setState 刷档案 + 战场单位名（战场单位名实时刷新，无二次广播）。上下文开关**未迁入**：053 已住在 agent-panel 角色卡，两处开关必漂移——按需求①「共存注明」口径，档案 tab 留一句指路文案（本处不重复）。
- **人设（persona）**：只读分节概览条（`personaSectionSummary` 识别 `# 分节头`）+ 可编辑 textarea 全文（按 043「预览可直接改」取舍：分节头留在正文里，全文编辑）；预设重套 chips 用 `presetsForKind`（该角色 kind 专属预设推荐排首 + 角标），点击覆写草稿（改脏，不保存不落库）；脏保护 = 人设未保存时切 tab / 返回主屏被拦 + 屏内提示（保存或放弃后放行）；保存发 `character.persona.update` → 广播回读一致后清草稿 + 点亮「人设已保存，下次对话生效」轻提示 4s（**回读而不是乐观提示**：命令被拒时提示不会撒谎；toast 的屏内替身——屏不碰组合根的 toast-host，反馈面只在自己 shadow DOM）。
- **形象（appearance）**：041 面板**原样迁入 tab 体内**（迁移成本低：`renderAppearanceEditor` 整体作为 tab body 输出，解锁灰显 / 重随机 / 编辑 / 预览画布宿主逻辑零改动），`data-group="appearance-edit"` 选择器与全部 041 测试**原样通过**。缺省 tab = appearance（041 老入口行为不变，缺省落形象编辑）。
- 草稿纪律：人设 / 改名草稿与形象草稿同口径——仅元素内存、切换单位（换编辑对象）即重置；textarea/input 走 input 事件只入内存不重画（不打断光标），脏标记直写 tab 钮 data-dirty。

### 验证输出

```
npm run typecheck → tsc --noEmit 通过（零错误）
npx jest --silent → Test Suites: 159 passed / Tests: 3542 passed, 6 skipped, 3548 total
基线 3523 → 3542（+19：core 8 + hud 11），零回归
```

### 取舍与未尽事项

1. **形象面板迁移方式**：选了「原样迁入 tab」而非「保留原位 + 锚点跳转」——`renderAppearanceEditor` 本就是独立方法，放进 tab body 只是包一层分组，041 的 11 条测试原样通过即为行为不变的证明。
2. **只改大小写的改名**（Neo → NEO）按真改名落库（`isSameCharacterName` 是大小写不敏感的比较，用它判「与己同名」会吞掉用户明确的写法变更；幂等判据是 trim 后**完全相等**）。重名（对别人）仍按大小写不敏感拒发，与建档同口径。
3. **人设保存成功提示是屏内轻提示**（toast 替身）：toast-host 是组合根装配的跨面板组件，屏不能 import app；被拒场景（竞态下重名 / 内部错误）由 core Notice 兜底，屏内提示只在回读一致后点亮。
4. **脏保护覆盖切 tab + 返回主屏**；打开聊天抽屉（openChat）不拦——抽屉是覆盖层不离开本屏，且「保存后下次对话生效」的时机提醒已在人设 tab 常驻。
5. game-save-coordinator（033）无需改动：characters 数组 diff 落库走既有链路，name/persona 列映射已就绪。
