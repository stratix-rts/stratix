/**
 * 文件职责：**特效触点的 dev-only 验收入口**（@since v3.3，task_161）——
 *   起一个挂**生产场景**（BattlefieldScene）的 Phaser.Game，把 DOM 按钮接到真实的触点路径上。
 *   方案来源：task_161 requirement 2 / acceptance「≥4 个语义触点实际播放（浏览器直开 7523 可见）」。
 * 输入：DOM 按钮点击。
 * 输出：战场上真的演出 sheet 动画特效（庆祝 / 报错 / 上场 / 下场 / 指令 / 升级）。
 * 禁止事项：
 *   1. 被任何生产入口 import —— 本文件只配 fx-dev.html，vite 不会把它打进正式产物；
 *   2. 自己实现特效 —— 播什么、播多久、怎么回收全在 world 层（objects/sprite-fx-layer.ts）；
 *   3. 给生产战场塞样例单位 —— 样例单位只进 dev 沙盒的 worldStore（主战场一个都不加）；
 *   4. import hud / vue / legacy(stratix-rts) —— 与 world 层同一条铁律。
 *
 * ★ 每个按钮走的都是**生产路径**（不另开特效专用后门）：
 *   - 任务完成 / 报错 / 升级 → core/bus 的 world 通道事件 → 桥接层 → 场景钩子；
 *   - 上场 / 退场 → state 通道的单位对账（场景 syncUnits）；
 *   - 指令 → 场景的 issueMoveCommandAt（与右键短按同一条路）。
 *
 * 启动方式：npm run dev 后访问 /src/world/dev/fx-dev.html
 */

import Phaser from 'phaser';

import { emitState, emitWorldEvent, onWorldEvent } from '../../core/bus';
import { worldStore } from '../../core/store';
import type { CharacterTask, UnitView, WorldEvent } from '../../core/types';
import { FX_ASSET_BASE_URL_KEY, fxBaseUrl } from '../appearance/fx-asset-path';
import { BATTLEFIELD_SCENE_KEY, BattlefieldScene } from '../scenes/BattlefieldScene';
// 特效素材加载场景（@since v3.3，task_161）：素材并行加载，战场 create() 不等素材。
import { FxAssetScene } from '../scenes/fx-asset-scene';
import { WORLD_PALETTE } from '../theme';

/**
 * 本页相对站点根的层数（'/src/world/dev/fx-dev.html' → 3 层：src/world/dev）。
 * why 手写而不是算：dev 页是固定路径，层数是常量；生产入口的层数事实源在 app/entry-paths.ts。
 * ★ 必须与页面真实路径一致：层数算少了 → 基址落到 '/src/fx'（vite 回退成 index.html，
 *   表现为 JSON 解析报错 "Unexpected token '<'"），层数是 3 才对得上站点根下的 '/fx'。
 */
const ENTRY_DEPTH = 3;

/** dev 沙盒里的样例角色 id（任务 / 升级事件按它落到单位头上）。 */
const SAMPLE_CHARACTER_ID = 'fx_demo_char_1';

/** 常驻单位 id（dev 沙盒的"锚点单位"）—— 任务 / 升级 / 指令三类触点的落点。 */
const BASE_UNIT_ID = 'fx_demo_unit_0';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  backgroundColor: WORLD_PALETTE.background,
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [BattlefieldScene, FxAssetScene],
  callbacks: {
    preBoot: (booting) => {
      // 精灵特效素材根（sheet PNG + atlas JSON）：dev 页比站点根深 2 层，按相对规则回退。
      booting.registry.set(FX_ASSET_BASE_URL_KEY, fxBaseUrl(document.baseURI, ENTRY_DEPTH));
    },
  },
});

/**
 * 把 store 的变更转发到总线（与 world-dev 的做法同款：场景只认总线）。
 * why 需要它：core 还没有正式的 runtime 来广播 state（dev 页直接接 store）。
 */
worldStore.subscribe(emitState);

/**
 * 首帧推一次当前状态（POST_RENDER 时场景的桥接层已订阅好）。
 *
 * why 挂在 POST_RENDER：Phaser 的第一个 step 里会先 boot 场景（跑完 create），再渲染，
 *   最后才发 POST_RENDER —— 此刻桥接层一定订阅好了，早于它就会把初始状态丢在没人听的频道上。
 * why 这里还要塞一个锚点单位：任务 / 升级 / 指令三类触点是**落在单位头上**的演出，
 *   场上没有对应单位就没有落点（见 baseUnit 的说明）。
 */
game.events.once(Phaser.Core.Events.POST_RENDER, () => {
  worldStore.patch({ units: [baseUnit()] });
  emitState(worldStore.getState());
  mountControls();
  startStatusLoop();
  mountEventLog();
  mountDevHandle();
});

/**
 * dev-only 观测句柄（供 e2e 断言"特效真的播了"）。
 * why 需要：截图只能证明"画面上有点东西"，证不了"那正是这条触点的特效" ——
 *   句柄给出实例数与纹理是否加载到位两个读数，断言才能落到事实上。
 * 只读，不提供任何"替场景演一遍"的入口 —— 演出只能由真实触点触发。
 */
function mountDevHandle(): void {
  (window as unknown as { __srfFx?: unknown }).__srfFx = {
    /** 当前在播的特效实例数。 */
    activeCount: (): number => sceneHandle()?.activeFxCount ?? 0,
    /** 某张 sheet 纹理是否已加载（atlas key 形如 'fx:celebrate'）。 */
    hasTexture: (key: string): boolean => sceneHandle()?.textures.exists(key) ?? false,
    /** 场上单位数（特效的落点 —— 没单位就没落点，e2e 据此区分"没播"与"没地方播"）。 */
    unitCount: (): number => sceneHandle()?.unitCount ?? 0,
  };
}

/** 造一条样例单位（dev 沙盒专用）。 */
function sampleUnit(index: number): UnitView {
  return {
    id: `fx_demo_unit_${index}`,
    name: `样例 ${index + 1}`,
    status: 'idle',
    missionId: null,
    power: 50,
    characterId: index === 0 ? SAMPLE_CHARACTER_ID : `fx_demo_char_${index + 1}`,
  };
}

/**
 * 常驻的锚点单位（dev 沙盒专用）。
 *
 * why 需要它：任务 / 升级 / 指令这三类触点是**落在单位头上**的演出 ——
 *   场上没有对应的单位，场景就没有落点（这是生产语义，不是缺陷：core 的 task 事件只带
 *   characterId，战场靠它反查单位）。没有锚点单位的话，打开页面直接点「任务完成」
 *   会什么也不播 —— 验收页就白开了。
 * why 只留一个：锚点负责"落点"，上场 / 退场按钮负责"增删"，各司其职。
 */
function baseUnit(): UnitView {
  return sampleUnit(0);
}

/** 造一条样例任务（dev 沙盒专用；字段与 core 契约同形）。 */
function sampleTask(status: 'completed' | 'failed'): CharacterTask {
  const now = Date.now();
  return {
    id: `fx_demo_task_${status}`,
    characterId: SAMPLE_CHARACTER_ID,
    prompt: 'dev 沙盒任务（特效触点验收用）',
    status,
    createdAt: now,
    startedAt: now - 1000,
    endedAt: now,
    output: status === 'completed' ? '完成' : '失败',
  };
}

// ============================================================================
// 按钮接线
// ============================================================================

function mountControls(): void {
  const bar = document.getElementById('controls');
  if (!bar) return;
  bar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const act = target?.dataset['act'];
    if (!act) return;
    switch (act) {
      case 'spawn': {
        // 上场：state 通道的单位对账 → 场景给新单位播 spawn。
        // 保留锚点单位（它是任务 / 升级 / 指令的落点）—— 只增临时单位。
        worldStore.patch({ units: [baseUnit(), ...[1, 2, 3, 4].map(sampleUnit)] });
        setStatus('单位上场（spawn ×4）');
        break;
      }
      case 'despawn': {
        // 退场：把临时单位从 state 里摘掉 → 场景在其最后位置播 despawn。
        // 锚点单位留着（否则后面的完成 / 报错 / 升级就没落点了）。
        worldStore.patch({ units: [baseUnit()] });
        setStatus('单位退场（despawn ×4）');
        break;
      }
      case 'complete': {
        emitWorldEvent({ type: 'task.completed', task: sampleTask('completed') });
        setStatus('任务完成（celebrate）');
        break;
      }
      case 'fail': {
        emitWorldEvent({ type: 'task.failed', task: sampleTask('failed') });
        setStatus('任务报错（error）');
        break;
      }
      case 'levelup': {
        emitWorldEvent({
          type: 'level.up',
          characterId: SAMPLE_CHARACTER_ID,
          fromLevel: 1,
          toLevel: 2,
        });
        setStatus('角色升级（levelUp）');
        break;
      }
      case 'command': {
        // 指令：先选中一个单位（与右键移动的选中集同源），再按世界坐标发起同一条指令。
        worldStore.patch({
          selection: { unitIds: [BASE_UNIT_ID], previewUnitIds: [], revision: 1 },
        });
        const scene = sceneHandle();
        if (scene) scene.issueMoveCommandAt({ x: 1900, y: 1080 });
        setStatus('指令下达（command）');
        break;
      }
      case 'burst': {
        // 并发压力：一次触发 8 条（上限 4 条 —— 最老的先让位）。
        for (let index = 0; index < 4; index += 1) {
          emitWorldEvent({ type: 'task.completed', task: sampleTask('completed') });
          emitWorldEvent({
            type: 'level.up',
            characterId: SAMPLE_CHARACTER_ID,
            fromLevel: 1,
            toLevel: 2 + index,
          });
        }
        setStatus('并发压力：触发 8 条（上限 4 条）');
        break;
      }
      default:
        break;
    }
  });
}

/** 取场景实例（按钮要按世界坐标发起指令）。 */
function sceneHandle(): BattlefieldScene | null {
  const scene = game.scene.getScene(BATTLEFIELD_SCENE_KEY) as BattlefieldScene | null;
  return scene ?? null;
}

/** 状态行：在播特效实例数（并发上限的现场读数）。 */
function startStatusLoop(): void {
  window.setInterval(() => {
    const scene = sceneHandle();
    if (!scene) return;
    const count = scene.activeFxCount;
    const status = document.getElementById('status');
    if (status) status.textContent = `在播特效实例：${count}（上限 4）`;
  }, 200);
}

/** 当前态提示行（按钮点完立刻给一句人话）。 */
function setStatus(text: string): void {
  const status = document.getElementById('status');
  if (status) status.textContent = text;
}

/**
 * 观测面板：把真实发到总线的 world 事件打出来（dev-only，不属于 world 层）。
 * why 放这儿：world 只画战场不画 HUD，任何 DOM 面板都不该进 src/world/scenes。
 */
function mountEventLog(): void {
  const panel = document.getElementById('event-log');
  if (!panel) return;
  const lines: string[] = [];
  const render = (): void => {
    panel.textContent = lines.length > 0 ? lines.join('\n') : '（等待交互）';
  };
  onWorldEvent((event: WorldEvent) => {
    if (event.type === 'task.completed' || event.type === 'task.failed') {
      lines.unshift(`${event.type} → ${event.task.characterId}`);
    } else if (event.type === 'level.up') {
      lines.unshift(`level.up → ${event.characterId} Lv.${event.toLevel}`);
    } else {
      return;
    }
    lines.length = Math.min(lines.length, 8);
    render();
  });
}
