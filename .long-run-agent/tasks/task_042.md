# task_042: 合 master + tag v3.1【需用户目视验收后执行】

## 描述
v3.x 特性批次（021-041）收官：全链路验收 + 合并 master + 打 tag。

## ⚠️ 前置门槛（不可逆操作，必须用户确认）
1. 用户目视验收：品牌形象（031）、向导每 agent 形象（032）、聊天回路（034-036）、派任务工作流（037-039）、养成解锁（040-041）
2. 用户点头后才执行合并——执行者若未获确认，停在验收清单处

## 需求
1. 全量验证：typecheck + jest 全量 + build + dev 手测冒烟（创建→对话→派任务→完成→升级）
2. 合并策略：`git checkout master && git merge --no-ff refactor/game-v3`（保留历史，merge commit 注明 v3.1 特性清单）
3. tag `v3.1`（annotated，含特性摘要）
4. 冒烟发现的问题：小修直接修（提交进 v3 分支再合并），大问题停下报用户

## 验收标准
- [ ] master 合并后 CI 级验证全绿（typecheck/jest/build）
- [ ] tag v3.1 存在且指向 merge commit
- [ ] refactor/game-v3 分支保留不删

## 验证方式
合并前后各跑一次 npm run typecheck && npx jest --silent && npm run build
