# task_060 音效反馈系统
## 需求
关键事件音效：任务完成/失败/升级/派发/消息到达（Tech→Product 音频方法论：少而准）。
## 要点
1. 考古 v2 音频资产（git ls-tree master 查 audio/资源目录），有则复用；无则 WebAudio 简单合成（短促正弦/噪声包络）
2. sfx-service（app 层）：订阅 task.*/level.up/exp.gained → 播放；全局音量+静音开关（设置持久化 localStorage）
3. 事件→音映射表常量（≤5 种，克制）；连续事件节流（1s 内同音不重播）
4. 音频资源懒加载（首事件才初始化 AudioContext）
## 验收
- 完成/失败/升级三事件有清晰可辨音效；静音开关生效
- typecheck/jest 全绿

---

## 验证结果（task_060 执行记录，2026-10-26）

### 改动文件
- `src/hud/components/sfx/sfx-service.ts`（新增）：音效服务 —— SFX_TABLE 合成参数表（5 种）、sfxKeyForEvent 事件映射、planNote 纯函数、localStorage 读写（stratix.sfx.enabled / stratix.sfx.volume）、createSfxService（懒建 AudioContext + 1s 节流 + 自动播放策略容错）
- `src/hud/__tests__/sfx-service.test.ts`（新增）：22 个用例（映射表完整性 / 事件映射 / 合成参数 / 持久化 / 懒初始化 / 节流 / 开关音量 / 解锁丢弃）
- `src/hud/screens/settings-screen.ts`（修改）：偏好组「音效」行改为 localStorage 直写（开关 + 音量滑条，与「上下文注入」行同口径）；core 契约键 soundEnabled 保留但不再有 UI 写入方；新增 input 委托监听
- `src/hud/__tests__/settings-screen.test.ts`（修改）：偏好行测试迁移到 notificationsEnabled + 音效行 4 个新用例
- `src/app/main/main-entry.ts`（修改）：组合根接线 createSfxService + onWorldEvent → sfxKeyForEvent → play；pagehide 清理（退订阅 + dispose）

### 映射表（v2 无音频资产，全 WebAudio 正弦合成，考古 `git ls-tree -r master` 无 mp3/ogg/wav）
| 事件 | 音色 | 参数 |
|---|---|---|
| task.completed | 轻快双音 A5→D6 | 880Hz/90ms + 1174.66Hz/140ms，gain 0.5 |
| task.failed | 低沉单音 G3 | 196Hz/320ms，gain 0.5 |
| level.up | 上行三连音 C5→E5→G5 | 523.25/659.25/783.99Hz，尾音 200ms，gain 0.45 |
| task.awaiting_approval | 提示两音 F#5→C#5（下行） | 739.99Hz/110ms + 554.37Hz/170ms，gain 0.4 |
| agent.offline | 短低音 E3 | 164.81Hz/180ms，gain 0.4 |

exp.gained 刻意不配音（每次任务都发，太频繁）。

### 验证输出
- `npm run typecheck`：通过（无错误）
- `npx jest --silent`：Test Suites 160 passed / 160 total；Tests 3568 passed + 6 skipped = 3574 total（基线 3542 + 新增 26，零回归）

### 备注
- AudioContext 懒初始化：首个真正要发声的事件才创建；suspended（浏览器自动播放策略未解锁）时请求 resume 并静默丢弃本次播放、不占节流坑（文件头契约注记）
- 节流：同 key 1s 内不重播（SFX_THROTTLE_MS=1000），不同 key 互不影响；只有真正发声才记节流时间戳
- 测试经注入 mock AudioContext（结构最小面 SfxAudioContext）驱动服务逻辑，jsdom 无 AudioContext 环境本身也是被测路径
