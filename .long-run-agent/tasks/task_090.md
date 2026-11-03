# task_090 HUD v3.4 · Z4 控制岛

## 描述

底栏重构：废除 --hud-bottom-h: min(34cqh,300px) 写死高度，改内容自适应（≈92px）贴底居中、宽 56% 屏宽；命令面板压缩 1 行 6 条；今日回放条（热力条/游标/时钟/▶60秒）与命令面板同岛分层；与左下事件轨、右下小地图零重叠（间距 ≥40px）。

## Requirements

依据 docs/hud-redesign-proposal.html §2.5 Z4 规格与 §1.9 碰撞实测；tsc 零错；测试全绿；回放功能不回归；最小改动。

## Acceptance

- [ ] 控制岛高度 ≤100px 内容自适应
- [ ] 四角零重叠（碰撞区脚本实测）
- [ ] 中轴可用高度提升（720p ≥85%）
- [ ] 回放功能不回归

## deliverables

main-screen.ts 底栏区重构（依赖 task_096）
