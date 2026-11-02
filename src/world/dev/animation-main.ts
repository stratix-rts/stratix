/**
 * 文件职责：**单位动画八态 dev 页的挂载入口**（task_075）—— 起一个 Phaser.Game，
 *   把 DOM 按钮接到验收场景的「强制状态」接口上。
 *   方案来源：docs/DEMO-PLAN.md §2「单位动画八态」。
 * 输入：DOM 按钮点击。
 * 输出：一个跑起来的 Phaser.Game + 一排可点的逐态按钮。
 * 禁止事项：
 *   1. 被任何生产入口 import —— 本文件只配 animation-dev.html；
 *   2. 在这里实现动画 —— 动画规则全在 appearance/unit-animation.ts；
 *   3. import hud / vue / legacy(stratix-rts) —— 与 world 层同一条铁律。
 *
 * 启动方式：npm run dev 后访问 /src/world/dev/animation-dev.html
 *
 * @since v3.3（task_075）。
 */

import Phaser from 'phaser';

import type { UnitAnimationState } from '../appearance/unit-animation';
import { WORLD_PALETTE } from '../theme';

import {
  ANIMATION_DEV_SCENE_KEY,
  ANIMATION_STATE_LABELS,
  AnimationDevScene,
} from './animation-dev-scene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  // 色值走调色板门面（唯一事实源）—— 不在本文件另抄一份字面量。
  backgroundColor: WORLD_PALETTE.background,
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [AnimationDevScene],
});

/**
 * 首帧之后才接按钮。
 * why 挂 POST_RENDER：Phaser 的第一个 step 先 boot 场景（跑完 create），再渲染，最后才发
 *   POST_RENDER —— 此刻场景的样例单位与显示对象都已就位，按钮才有东西可操作。
 */
game.events.once(Phaser.Core.Events.POST_RENDER, () => {
  const scene = game.scene.getScene(ANIMATION_DEV_SCENE_KEY) as AnimationDevScene;
  // 默认「同屏八态」：一眼看全八态是否各自可辨。
  scene.showcaseAllStates();
  mountControls(scene);
  setStatus('同屏八态（第 i 个单位 = 第 i 种状态）');
});

/** 按钮条接线：一个委托监听挂在容器上（按钮是静态的，不必逐个挂）。 */
function mountControls(scene: AnimationDevScene): void {
  const bar = document.getElementById('controls');
  if (!bar) return;
  bar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const raw = target?.dataset['state'];
    if (!raw) return;
    if (raw === 'showcase') {
      scene.showcaseAllStates();
      setStatus('同屏八态（第 i 个单位 = 第 i 种状态）');
      return;
    }
    if (raw === 'auto') {
      scene.applyStateToAll(null);
      setStatus('自动（按业务态派生：忙=工作 / 报错=卡住 / 空闲无任务=摸鱼）');
      return;
    }
    const state = raw as UnitAnimationState;
    scene.applyStateToAll(state);
    setStatus(`全部单位：${ANIMATION_STATE_LABELS[state]}`);
  });
}

/** 当前态提示行。 */
function setStatus(text: string): void {
  const status = document.getElementById('status');
  if (status) status.textContent = text;
}
