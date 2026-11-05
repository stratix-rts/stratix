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
import { FX_ASSET_BASE_URL_KEY, fxBaseUrl } from '../appearance/fx-asset-path';
import { BATTLEFIELD_SCENE_KEY, BattlefieldScene } from '../scenes/BattlefieldScene';
// 特效素材加载场景（@since v3.3，task_161）：与生产入口同款 —— 素材并行加载，战场不等。
import { FxAssetScene } from '../scenes/fx-asset-scene';

/** 本页相对站点根的层数（'/src/world/dev/world-dev.html' → src/world/dev 三层）。 */
const ENTRY_DEPTH = 3;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  backgroundColor: '#0f131b',
  // 视口随窗口变化：相机边界钳制依赖实时视口尺寸，固定尺寸会让 resize 后钳制失准
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [BattlefieldScene, FxAssetScene],
  callbacks: {
    preBoot: (booting) => {
      // 精灵特效素材根（task_161）：world 零 DOM —— document.baseURI 只有组合根能碰。
      booting.registry.set(FX_ASSET_BASE_URL_KEY, fxBaseUrl(document.baseURI, ENTRY_DEPTH));
    },
  },
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
    // 小地图跳转（@since v3.33，task_057）：core 钳制后转发来的相机对中指令。
    case 'camera.center':
      return `${event.type.padEnd(15)} ${Math.round(event.x)},${Math.round(event.y)}`;
    // 镜头震动（@since v3.3，task_080）：里程碑大字的那记小震，看一眼时长与强度。
    case 'camera.shake':
      return `${event.type.padEnd(15)} ${event.durationMs}ms ×${event.intensity}`;
    // 导演模式开关（@since v3.3，task_081）：开关往返都走这一条（开=core→world，关=world 手动介入回报）。
    case 'camera.director':
      return `${event.type.padEnd(15)} enabled=${event.enabled}`;
    // 说话状态（@since v3.37，task_062）：chat 流式期间的战场气泡标志位，看一眼起止。
    case 'unit.speaking':
      return `${event.type.padEnd(15)} ${event.unitId} speaking=${event.speaking}`;
    // 单位气泡（@since v3.3，task_077）：战场要求某个单位冒一句话（气泡系统 task_076 消费）。
    case 'unit.bubble':
      return `${event.type.padEnd(15)} ${event.unitId} 「${event.text}」`;
    // 单位联动（@since v3.4，task_091）：HUD 事件轨条目点击 → core 转发给 world，看一眼点的是谁。
    case 'focus.unit':
      return `${event.type.padEnd(15)} ${event.unitId}`;
    // 音效钩子（@since v3.3，task_077）：只发事件不做音频（声音包 v3.3-10 消费）。
    case 'fx.sound':
      return `${event.type.padEnd(15)} ${event.cue}`;
    // 回放节拍（@since v3.3，task_082）：当日回放的重演指令，看一眼节拍类型与角色。
    case 'replay.beat':
      return `${event.type.padEnd(15)} ${event.beat.kind} ${event.beat.characterId ?? ''}`;
    // 副本切换（@since v3.3，task_177 / M1-03）：core 广播的切换信号与拒绝信号，看一眼切到哪 / 为何被拒。
    case 'project.changed':
      return `${event.type.padEnd(15)} ${event.instanceId ?? '大厅'}`;
    case 'project.enter.failed':
      return `${event.type.padEnd(15)} ${event.instanceId} :: ${event.reason}`;
  }
}
