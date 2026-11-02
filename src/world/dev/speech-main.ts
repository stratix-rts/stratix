/**
 * 文件职责：**气泡说话系统 dev 页的挂载入口**（task_076）—— 起一个 Phaser.Game，
 *   把 DOM 按钮接到验收场景上（四类事件气泡 / 原话气泡 / 事件风暴 / 清屏）。
 *   方案来源：docs/DEMO-PLAN.md §3。
 * 输入：DOM 按钮点击。
 * 输出：一个跑起来的 Phaser.Game + 一排可点的验收按钮 + 实时状态行（同屏几个 / 排队几个）。
 * 禁止事项：
 *   1. 被任何生产入口 import —— 本文件只配 speech-dev.html；
 *   2. 在这里实现气泡规则 —— 规则全在 objects/speech-bubble.ts；
 *   3. import hud / vue / legacy(stratix-rts) —— 与 world 层同一条铁律。
 *
 * 启动方式：npm run dev 后访问 /src/world/dev/speech-dev.html
 *
 * @since v3.3（task_076）。
 */

import Phaser from 'phaser';

import { WORLD_PALETTE } from '../theme';

import { SPEECH_DEV_SCENE_KEY, SpeechDevScene } from './speech-dev-scene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  // 色值走调色板门面（唯一事实源）—— 不在本文件另抄一份字面量。
  backgroundColor: WORLD_PALETTE.background,
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [SpeechDevScene],
});

/**
 * 首帧之后才接按钮。
 * why 挂 POST_RENDER：Phaser 的第一个 step 先 boot 场景（跑完 create），再渲染，最后才发
 *   POST_RENDER —— 此刻场景的样例单位与气泡层都已就位，按钮才有东西可操作。
 */
game.events.once(Phaser.Core.Events.POST_RENDER, () => {
  const scene = game.scene.getScene(SPEECH_DEV_SCENE_KEY) as SpeechDevScene;
  mountControls(scene);
  refresh(scene);
  // 状态行每 250ms 刷一次（气泡会自己收，数字要跟着变）。
  window.setInterval(() => refresh(scene), 250);
});

/** 按钮条接线：一个委托监听挂在容器上（按钮是静态的，不必逐个挂）。 */
function mountControls(scene: SpeechDevScene): void {
  const bar = document.getElementById('controls');
  if (!bar) return;
  bar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const action = target?.dataset['action'];
    if (!action) return;
    if (action === 'burst') {
      scene.burst();
      return;
    }
    if (action === 'clear') {
      scene.clear();
      return;
    }
    if (action === 'text') {
      scene.speakText('收到');
      return;
    }
    scene.speak(action as Parameters<SpeechDevScene['speak']>[0]);
  });
}

/** 刷新状态行：同屏几个 / 排队几个 / 总共冒过几个。 */
function refresh(scene: SpeechDevScene): void {
  const status = document.getElementById('status');
  if (!status) return;
  const stats = scene.stats();
  status.textContent = `同屏 ${stats.onScreen} / 排队 ${stats.pending}`;
}
