# task_083 声音包

## 描述

按 DEMO-PLAN.md §10：WebAudio 代码合成零音频文件——选中 ack 880Hz 哔 80ms/派活 240Hz 方波哒 60ms/完成 C5→E5 双音/报错 180Hz 低鸣 300ms 失谐/里程碑琶音三音；总开关（demo 默认开）+音量 0-100；AudioContext 首次用户手势 resume；接线 task_077 预留的事件钩子。

## Requirements

hud/sound-engine.ts；无外部资产。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 五音可听包络清晰
- [ ] 开关音量生效
- [ ] 首次点击激活无控制台报错

## deliverables

src/hud/sound-engine.ts + 事件接线

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
