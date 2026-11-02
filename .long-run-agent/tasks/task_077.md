# task_077 点击与指令特效

## 描述

按 DEMO-PLAN.md §4：框选升级（青色半透明+2px霓虹边框+四角亮块+松手收缩闪烁+命中单位 40ms 间隔波浪式弹选择环）；下达指令（单位到目标流动虚线渐变 800ms 淡出+目标双重涟漪+统一「收到」气泡）；任务认领 3D 翻卡；任务完成插旗（旗杆 0.5s 升起+旗面 Back.Out 弹开）；集火支援全队冒泡+位移脉冲。

## Requirements

升级 selection-box.ts 与 task-fx 层；音效只发事件钩子不做音频（task_083 接）。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 框选波浪点亮可见
- [ ] 指令流线/涟漪/翻卡/插旗动画完整
- [ ] 集火冒泡触发

## deliverables

selection-box.ts 升级、task-fx 扩展、插旗对象

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
