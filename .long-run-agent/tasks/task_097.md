# task_097 v3.4 验收修复：按钮点击无反应诊断

## 描述

用户实测"不少按钮没反应"。全量点击体检：HUD 全部可点元素逐个真实点击，记录 dispatch/可见变化/console 报错。嫌疑：(a) 096 层级 L2/L3 误伤 L1 可点性；(b) 089 弹层 handler 漏接；(c) shadow DOM 冒泡被 pointer-events:none 吞。产出：体检表+修复+防回归断言。

## Requirements

demo/v3.3 分支，commit 前缀 v3.4-fix；总线铁律；tsc 零错；40 项断言不回归；新增点击→可见变化断言。

## Acceptance

- [ ] 全部可点元素体检表（PASS/FAIL+原因）
- [ ] FAIL 全修复+断言防回归
- [ ] 真实点击路径覆盖

## deliverables

诊断+修复+断言
