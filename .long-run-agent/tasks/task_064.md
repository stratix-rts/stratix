# task_064 界面视觉打磨（Kimi Code 品味局）

## 需求来源
2026-10-26 12:34 用户指令：「kimi 的前端品味不错，让他对这版本的界面进行优化」。

## 需求
对 hud 层做一轮**视觉品味打磨**（不是功能、不是重构）：
1. **设计 token 一致性**：审计 --srf-* CSS 变量的使用——找出硬编码颜色/字号/间距（绕过 token 的散点），归一到 token；token 缺口（常用档位没有对应变量）就补 token 不散写
2. **间距节奏**：面板/卡片/抽屉的内边距与元素纵向间距统一到一致的节奏（如 4/8/12/16/24 阶梯），消除随意 5px/10px/13px
3. **层次与可读性**：标题/正文/辅助文字的字阶与字重层级明确；次要信息降饱和；分隔线/背景层次统一
4. **交互态补全**：hover/active/disabled/focus 态缺失的组件补齐（用既有 token 的 hover 变体，不新造色彩）；过渡动画统一时长曲线（一个 --srf-transition token 或集中常量）
5. **细节品味**：圆角/阴影统一档位；空状态文案与视觉（引导语区）统一处理；滚动条样式统一（webview scrollbar）
6. 只动 `src/hud/**`（styles/screens/panels/components）+ 必要时 hud 内 token 定义；**不碰 world/app/core**；架构铁律不变（hud 不 import world/app）
7. 改动后视觉回归靠人眼（用户稍后开 dev 栈验收），代码门槛是 typecheck+jest 全绿

## 验收标准
- [x] 无硬编码颜色/字号绕过 token 的新增（存量散点归一或显著减少，报告给数字）
- [x] 间距/圆角/阴影/过渡各自收敛到统一档位
- [x] 交互态（hover 等）补全不破现有行为
- [x] npm run typecheck 零错误 && npx jest --silent 全绿（3656 基线不回归）
- [x] 不引入新依赖；不新增组件文件（除非空状态等确有必要，报告说明）

## 验证方式
npm run typecheck && npx jest --silent；token 使用统计对比（改前/改后 grep 计数）

## 验证结果（2026-10-26）
- Token 归一：8 套皮肤统一为 40 个 token；新增等宽字体、xs 字号、两档字重、2px/24px 间距、胶囊圆角、大阴影、遮罩与统一过渡档位。
- Grep 颜色计数（`#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(`，src/hud 的 ts/css）：624 → 160；其中消费方 488 → 10，剩余为 canvas 在无 token/jsdom 环境的必要回退，其他 150 处均在 token 定义文件。
- Grep 硬编码字号计数（`font-size\s*:\s*[^;]*[0-9](px|rem|em)`）：147 → 0。
- Grep 硬编码间距计数（margin/padding/gap/定位属性）：233 → 1；唯一命中为 `.hud-root` 的 `--hud-bottom-h: min(34cqh, 300px)` 布局尺寸，不是组件间距。
- 视觉收口：面板/卡片/抽屉采用 2/4/8/12/16/24 间距阶梯；字阶统一为 xs/sm/md/lg；辅助信息统一 muted/disabled；圆角分常规/胶囊两档，阴影分常规/悬浮两档；空状态、滚动条、分隔线统一。
- 交互态：按钮、筹码、输入框、选择器及可点卡片补齐 hover/active/disabled/focus-visible；过渡统一使用 `--srf-transition`，不改 DOM 结构与事件逻辑。
- `npm run typecheck`：通过，零错误。
- `npx jest --silent`：`Test Suites: 168 passed, 168 total`；`Tests: 6 skipped, 3656 passed, 3662 total`；`Snapshots: 0 total`；`Time: 27.672 s, estimated 34 s`。
- 快照更新：无。测试文件仅同步 token 规范清单（30 → 40），未改断言语义。
- 环境说明：系统 `/usr/bin/python3` 因 Xcode 许可返回 exit 69，最终验证使用本机 Homebrew Python 的 `PATH=/opt/homebrew/opt/python@3.12/libexec/bin:$PATH`；一次既有 health-monitor 定时器用例抖动已单独复跑并通过，最终全量通过。
- 未引入依赖、字体、外链资源或新组件文件；未修改 world/app/core。人眼视觉回归由用户稍后开 dev 栈验收。
