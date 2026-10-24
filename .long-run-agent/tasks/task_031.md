# task_031: 品牌 agent 默认形象库

## 描述
为每个可检出的本地 CLI agent 设计一份**固定的品牌默认形象**（用户可后续修改），替代纯随机——消除随机不确定性，同时让各 agent 在战场上一眼可辨。

## 需求
1. **预设库**：`src/world/appearance/brand-presets.ts`（或 world 下合适位置，遵守分层——若属 core 契约数据则放 core 并注明）。key = agent kind（与 agent-detector 的 kind 一致：claude-code/codex/opencode/kimi/openclaw/gemini/qwen/crush/goose/aider/copilot），value = 完整 appearance（bodyType + 各类别选择，**带 itemId 精确指定**，用 task_030 扩展后的格式）
2. **品牌配色方向**（worker 从 `dist/frontend/spritesheets/item-metadata.json` 实际变体名里挑最接近的）：
   - claude-code（Anthropic）：暖橙/赤陶/米白，暖棕发——沉稳学者风
   - kimi（月之暗面）：黑/深蓝/月光银，深色系——夜行风
   - opencode：紫色系（有终端黑客感）
   - openclaw：橙色+利落造型（爪/猛禽感，若素材有 claws 类可用）
   - codex（OpenAI）：冷绿/白/灰，极简风
   - gemini：蓝紫渐变感→蓝系
   - 其余 T2/T3 未装的可给通用兜底预设（中性色平民）
   - 注意体面：不用伤口/轮椅/绷带等怪素材；发色/肤色/衣色协调
3. **兜底**：未命中 kind 的 agent 用 minimal 档随机生成一次后固定（或通用预设，选简单的）
4. **有效性校验单测**：每个预设引用的 itemId+variant 必须存在于 item-metadata.json（测试加载元数据文件逐一断言——元数据 1.4MB 可接受，或提取精简 fixture）

## 上下文
- 元数据路径：`dist/frontend/spritesheets/item-metadata.json`（fetch 注入式 PartRegistry 已有加载逻辑）
- 检测器 kind 清单：`src/app/services/agent-detector.ts`
- 030 的 itemId 扩展是前置依赖（依赖它的模型格式）

## 验收标准
- [ ] tsc 零错误
- [ ] 每个 T1 agent（claude-code/codex/opencode/kimi/openclaw）有具名预设且元数据校验通过
- [ ] 兜底逻辑有单测
- [ ] npx jest src/world src/core 全绿
- [ ] 新文件头部契约注释

## 验证方式
npm run typecheck && npx jest src/world src/core --silent

---

## 验证结果（task_031 交付记录 · 2026-10-24）

### 改动文件
- `src/world/appearance/brand-presets.ts`（新增）：品牌预设库 —— `BRAND_PRESETS`（11 种 kind 全量）+ `COMMONER_FALLBACK_PRESET` + `getBrandPreset(kind)`（确定性查表，兜底走静态中性平民预设，**无随机**）
- `src/world/appearance/__tests__/brand-presets.test.ts`（新增）：加载真实 `dist/frontend/spritesheets/item-metadata.json`（1.4MB）逐一断言有效性 / 可解析性 / 确定性 / 体面黑名单，53 个用例全绿

### T1 预设部件选配清单（实际 itemId + variant，均经真元数据断言存在）
| kind | body | head | hair | eyes | ears | nose | torso | legs | feet |
|---|---|---|---|---|---|---|---|---|---|
| claude-code | body/amber | heads_human_male/amber | hair_parted/chestnut | eye_color/brown | head_ears_medium/amber | head_nose_straight/amber | torso_clothes_longsleeve2_cardigan/orange | legs_pants/tan | feet_shoes_revised/brown |
| codex | body/light | heads_human_male/light | hair_buzzcut/ash | eye_color/green | head_ears_medium/light | head_nose_button/light | torso_clothes_longsleeve_formal/white | legs_formal/gray | feet_shoes_revised/gray |
| opencode | body/taupe | heads_human_male/taupe | hair_spiked/purple | eye_color/purple | head_ears_big/taupe | head_nose_button/taupe | torso_clothes_tshirt/purple | legs_pants/charcoal | feet_shoes_basic/black |
| kimi | body/light | heads_human_male/light | hair_long_straight/raven | eye_color/blue | head_ears_medium/light | head_nose_straight/light | torso_clothes_longsleeve/navy | legs_pants/black | feet_boots_basic/black |
| openclaw | body/amber | heads_human_male/amber | hair_shorthawk/orange | eye_color/orange | head_ears_elven/amber（尖耳·利落） | head_nose_straight/amber | torso_armour_leather/orange | legs_pants2/leather | feet_boots_revised/brown |

其余：gemini = 蓝系（hair_swoop/blue + torso_clothes_longsleeve/blue + legs_pants/navy + feet_shoes_basic/blue）；qwen/crush/goose/aider/copilot 共用平民选配（hair_plain + torso_clothes_tshirt/gray + legs_pants/brown + feet_shoes_basic/brown），发色分别为 black / dark brown / gray / light brown / chestnut。兜底 COMMONER_FALLBACK_PRESET = 平民选配 + dark brown 发。

### 验证输出
- `npm run typecheck` → 零错误
- `npx jest src/world src/core --silent` → **Test Suites: 24 passed, Tests: 512 passed**（含新增 brand-presets.test.ts 53 例）

### 未尽事项
- 元数据无 claws 类素材，openclaw 的"爪感"用莫西干头（猛禽冠羽）+ 精灵尖耳 + 皮革甲表达（任务已预留"可用就上"的豁免）
- 品牌预设尚未接线到角色创建/形象编辑流程（属后续任务范围；本任务只交付库 + 查表函数）
