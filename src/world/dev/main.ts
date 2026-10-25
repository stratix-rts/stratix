/**
 * 文件职责：world 层的 **dev-only 最小挂载入口** —— 起一个 BattlefieldScene，不接入现有主 UI。
 *   方案来源：任务要求"另建一个 dev-only 最小挂载入口（独立 HTML 或 dev 路由），不接入现有主 UI"。
 * 输入：core/worldStore（状态真相）+ 浏览器容器 #battlefield。
 * 输出：一个跑起来的 Phaser.Game；页面上两块纯 DOM 观测面板（不属于 world 层）。
 * 禁止事项：
 *   1. 被任何生产入口 import —— 本文件只配 world-dev.html 用，vite 不会把它打进正式产物；
 *   2. 灌假单位 / 假状态来"让页面好看" —— 场景里看到什么必须完全来自真实 store；
 *   3. import hud / vue / legacy(stratix-rts) —— 与 world 层同一条铁律。
 *
 * 启动方式：npm run dev 后访问 /src/world/dev/world-dev.html
 */

import Phaser from 'phaser';

import { emitState, onWorldEvent } from '../../core/bus';
import { worldStore } from '../../core/store';
import type { WorldEvent } from '../../core/types';
import { BATTLEFIELD_SCENE_KEY, BattlefieldScene } from '../scenes/BattlefieldScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  backgroundColor: '#0f131b',
  // 视口随窗口变化：相机边界钳制依赖实时视口尺寸，固定尺寸会让 resize 后钳制失准
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [BattlefieldScene],
});

/**
 * 临时：把 store 的变更转发到总线。
 * why 放在这里：core 还没有正式的 runtime / 应用根来广播 state（task_003 只交付了 types/bus/store/unit）。
 * core 建立正式 runtime 后，删掉本文件里的这一段即可，世界层代码无需改动。
 */
worldStore.subscribe(emitState);

/**
 * 首帧推一次当前状态。
 * why 挂在 POST_RENDER：Phaser 的第一个 step 里会先 boot 场景（跑完 create），再渲染，最后才发 POST_RENDER，
 * 所以这里触发时场景的桥接层一定已经订阅好了；早于它就会把初始状态丢在没人听的频道上。
 */
game.events.once(Phaser.Core.Events.POST_RENDER, () => {
  emitState(worldStore.getState());
});

mountEventLog();

/**
 * 观测面板：把**真实**发到总线的 world 事件打出来，用于肉眼确认 world → core 这半条链路是通的。
 * why 放在 dev 入口而不是 world 层：world 只画战场不画 HUD，任何 DOM 面板都不该进 src/world/scenes。
 */
function mountEventLog(): void {
  const panel = document.getElementById('event-log');
  if (!panel) return;

  const lines: string[] = [];
  const render = (): void => {
    panel.textContent =
      lines.length > 0 ? `world → core 事件（最近 ${lines.length} 条）\n${lines.join('\n')}` : 'world → core 事件\n（等待交互）';
  };

  onWorldEvent((event: WorldEvent) => {
    lines.unshift(describe(event));
    lines.length = Math.min(lines.length, 12);
    render();
  });

  // 场景启动完成时同步一次，避免面板一直停在"等待交互"而误判链路没通
  game.events.once(Phaser.Core.Events.POST_RENDER, () => {
    lines.unshift(`scene booted: ${BATTLEFIELD_SCENE_KEY}`);
    render();
  });
}

function describe(event: WorldEvent): string {
  switch (event.type) {
    case 'unit.click':
      return `unit.click      ${event.unitId} (shift=${event.mods.shift} ctrl=${event.mods.ctrl})`;
    case 'selection.box':
      return `selection.box   ${Math.round(event.bounds.width)}×${Math.round(event.bounds.height)} @ ${Math.round(event.bounds.x)},${Math.round(event.bounds.y)}`;
    case 'camera.moved':
      return `camera.moved    zoom=${event.zoom.toFixed(2)} @ ${Math.round(event.center.x)},${Math.round(event.center.y)}`;
    case 'unit.position':
      return `unit.position   ${event.unitId} @ ${Math.round(event.x)},${Math.round(event.y)}`;
    // 右击移动指令（@since v3.21，task_045）：世界层发出的意向，落位由 core 算好广播回来。
    case 'unit.move':
      return `unit.move       ${event.unitIds.length} 单位 @ ${Math.round(event.x)},${Math.round(event.y)}`;
    // 任务生命周期（@since v3.16，task_037）：core/task 发出的域事件，面板里看一眼相位与角色。
    // task.cancelled（@since v3.23，task_047）：排队取消事件，同面展示。
    // task.awaiting_approval / task.approved（@since v3.25，task_049）：审批门生命周期，同面。
    case 'task.queued':
    case 'task.started':
    case 'task.completed':
    case 'task.failed':
    case 'task.cancelled':
    case 'task.awaiting_approval':
    case 'task.approved':
      return `${event.type.padEnd(15)} ${event.task.characterId} :: ${event.task.prompt.slice(0, 20)}`;
    // 经验事件（@since v3.18，task_039）：app 层发射，这里看一眼来源与数额（养成侧观察）。
    case 'exp.gained':
      return `${event.type.padEnd(15)} ${event.characterId} +${event.amount} (${event.source})`;
    // 升级事件（@since v3.19，task_040）：progression-service 广播，看一眼升级跨度（养成侧观察）。
    case 'level.up':
      return `${event.type.padEnd(15)} ${event.characterId} Lv.${event.fromLevel}→${event.toLevel}`;
    // 流水线整线事件（@since v3.27，task_051）：app 编排器广播，面板里看一眼整线终态。
    case 'pipeline.completed':
      return `${event.type.padEnd(15)} ${event.pipelineName}`;
    case 'pipeline.failed':
      return `${event.type.padEnd(15)} ${event.pipelineName} :: ${event.reason}`;
    // agent 健康位（@since v3.30，task_054）：health-monitor 防抖判定广播，看一眼在线翻转。
    case 'agent.online':
    case 'agent.offline':
      return `${event.type.padEnd(15)} ${event.kind}`;
  }
}
