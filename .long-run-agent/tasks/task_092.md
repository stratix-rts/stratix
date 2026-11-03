# task_092 HUD v3.4 · Z2b 单位联动

## 描述

world 侧消费 focus.unit 总线事件：对应单位描边高亮 + 左下条目到中屏单位的引导弧线（屏幕空间绘制，沿 hud/world 契约拿 camera 换算坐标）；导演模式开启时中屏出现取景框标识（L3）。

## Requirements

弧线为屏幕坐标绘制，world 只提供 camera 状态契约，不走 hud 引用；遵守总线铁律；tsc 零错；测试全绿；最小改动。

## Acceptance

- [ ] 点击条目→单位描边+弧线 800ms 内出现
- [ ] 镜头移动后弧线跟随
- [ ] 关闭联动可恢复
- [ ] 总线铁律测试通过

## deliverables

world 侧 focus.unit 消费 + 描边 + 引导弧线（依赖 task_091）
