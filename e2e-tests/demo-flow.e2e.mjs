#!/usr/bin/env node
/**
 * 文件职责：**e2e 演示收口剧本**（task_084 / DEMO-PLAN.md §11）——
 *   把演示链「派活 → 框选 → 指令特效 → 干活动画 → 卡住 → 集火 → 完成插旗 → 区域点亮 →
 *   里程碑 → 回放 60s」在**假 CLI（fake 模式）**下真跑一遍，留下可复贴的断言清单。
 *
 * ============ 拓扑真相（why 分三段 —— 这一条链在两种拓扑里各跑一半）============
 *   产品的三种形态各有各的**触发面**，演示链跨了三者：
 *     A 段（dev 验收页 /src/app/dev/hello-loop.html）：
 *       框选 / 指令特效 / 卡住体态 / 集火。
 *       why 在这一页：**单位状态 'error'（卡住）在生产应用里不可达** ——
 *         全仓只有一处写 'error'（core/agent-link/manager.ts 的 applyRemoteStatus），
 *         而 agent-link 没接进主入口；于是「卡住体态」与「集火（右键卡住单位 = 支援）」
 *         只能在种了 error 单位的 dev 验收页上演。这是**如实报告的产品缺口**，不是绕路。
 *     B 段（生产入口 /src/app/main/index.html · 本地模式）：派活 / 干活 / 完成插旗 /
 *       区域点亮 / 里程碑。
 *       why 必须本地模式：task.* 生命周期事件由**渲染进程自己的 core** 发出，
 *         远程模式下渲染进程不起 core runtime（见 app/main/main-entry.ts 的
 *         `const stopRuntime = remote ? () => undefined : runtime.start();`），
 *         里程碑与跑马灯就都听不到事件了。
 *     C 段（生产入口 · 远程模式 + service）：当日回放 60s。
 *       why 必须远程模式：回放读取口的基址在远程模式由 world-sync 地址换协议得出
 *         （本地模式是写死的本机 gateway 端口 —— 那是用户的端口，剧本不许碰）。
 *
 * ============ 替身口径（fake 模式 = 既有架构约定，不是 mock）============
 *   替身只落在**最末端那一跳**：
 *     - B 段（本地模式）：PATH 上的 `claude` 二进制 → e2e-tests/demo-flow/fake-claude.mjs
 *       （本地模式没有 adapter 注入口，唯一的替身位置就是这个二进制）；
 *     - C 段（远程模式）：service 侧注入既有 fake CLI adapter（e2e-tests/service-resident/fake-cli.ts）。
 *   被替掉的只有 CLI；core 的裁决、队列、相位、落库、区域点亮、里程碑、回放读面全是真的。
 *
 * ============ 观测口径（why 用「页面内总线探针」而不是加调试句柄）============
 *   生产入口禁止挂 window.__srf* 调试句柄（app/main/main-entry.ts 文件头禁止事项 ④），
 *   所以本剧本**不改一行生产代码**：在页面里 `await import('/src/core/bus.ts')` 拿到
 *   **与 app 同一个 ESM 模块实例**（Vite 把 ../../core/bus 解析到同一个 URL），
 *   订阅 world 事件与状态广播，于是能读到真实发生的 selection.box / unit.bubble /
 *   fx.sound / task.* / replay.beat。dev 验收页额外用它自己已有的 window.__srfHelloLoop
 *   句柄取相机与单位位置（既有约定）。
 *
 * ★ 生产入口有两个「遮挡」事实（不绕开就点不到战场 —— 这两条是 @since task_084 踩出来的）：
 *   ① 首启向导（`<strat-onboarding-screen>`）在首启时**整屏**盖在战场上 —— 剧本走产品自己的
 *      「跳过引导」按钮收掉它（宿主靠 onboarding-skipped 事件收起覆盖层），不拆 DOM；
 *   ② HUD 面板（命令面板等）浮在战场上并吃事件 —— 右键落点用「扫格子 + elementFromPoint」
 *      挑一块真正落在画布上的空地（按世界坐标换算出来的点可能正落在面板上）。
 *
 * ★ 端口与进程纪律（与既有 e2e 剧本同一口径）：
 *   - 用户的 dev 实例占着 7523 / 7524 / 9222 —— 本剧本**一个都不碰**，全部走备用端口；
 *   - 清理**只杀自己拉起的 pid**（连同它自己的后代树）—— 全程不 pkill / pgrep 按进程名扫杀；
 *   - 端口占用先查再用（portFree），撞上用户端口直接拒绝开跑。
 *
 * 禁止事项：
 *   1. mock 核心链路数据 —— 唯一替身是最末端的 CLI（见上）；
 *   2. 引入新依赖 —— 只用 node 内置 + 本目录既有夹具；
 *   3. 改生产代码加观测口 —— 观测全靠页面内探针。
 *
 * 用法：
 *   node e2e-tests/demo-flow.e2e.mjs            # 默认：fake CLI（确定性）
 *   node e2e-tests/demo-flow.e2e.mjs --keep     # 保留临时目录（排查用）
 *   SX_DEMO_PHASES=A,B node e2e-tests/demo-flow.e2e.mjs   # 只跑某几段（排查用）
 *
 * @since task_084（e2e 演示收口）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectPage } from './lib/cdp.mjs';
import {
  createObserver,
  killTree,
  launch,
  liveSpawned,
  log,
  mcpCall,
  must,
  portFree,
  printSummary,
  sleep,
  spawnedRecords,
  waitFor,
} from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓库内的可执行文件（不经 npx —— 少一层进程与解析开销）。 */
const bin = (name) => path.join(REPO, 'node_modules', '.bin', name);

// ============================================================================
// 端口与常量（全部备用端口；用户实例的 7523 / 7524 / 9222 一个都不碰）
// ============================================================================

const VITE_PORT = Number(process.env.SX_DEMO_VITE_PORT || 7611);
const CDP_DEV = Number(process.env.SX_DEMO_CDP_DEV || 7612);
const CDP_LOCAL = Number(process.env.SX_DEMO_CDP_LOCAL || 7613);
const CDP_REMOTE = Number(process.env.SX_DEMO_CDP_REMOTE || 7614);
const SERVICE_PORT = Number(process.env.SX_DEMO_SERVICE_PORT || 7811);
const SERVICE_WS_PORT = Number(process.env.SX_DEMO_SERVICE_WS_PORT || 7812);
/** 用户实例占用的端口 —— 剧本自己撞上就是错（启动前先查）。 */
const RESERVED_PORTS = new Set([7523, 7524, 9222]);
/** world-sync 协议路径（契约见 src/stratix-gateway/api/websocket/world-sync/protocol.ts）。 */
const WORLD_SYNC_PATH = '/ws/world-sync';
/** 生产入口 HTML（镜像 src/app/entry-paths.ts）。 */
const ENTRY_HTML = 'src/app/main/index.html';
/** dev 验收页 HTML（种了 error 单位的那一页 —— 卡住体态 / 集火只能在这里演）。 */
const DEV_HTML = 'src/app/dev/hello-loop.html';
/** 演示链里要跑完的任务条数（里程碑阈值 = 10，见 hud/components/marquee/milestone.ts）。 */
const DEMO_TASK_COUNT = 10;
/** 假 CLAUDE 的 PATH 替身（本地模式专用）。 */
const FAKE_CLAUDE_SRC = path.join(HERE, 'demo-flow', 'fake-claude.mjs');
/** 本次要跑哪几段（A / B / C；默认全跑）。 */
const PHASES = (process.env.SX_DEMO_PHASES || 'A,B,C')
  .split(',')
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);

// ============================================================================
// 页面侧表达式（探针 / 读数 / 视图）
// ============================================================================

/**
 * 页面内总线探针：订阅 world 事件与状态广播，装在 window.__e2eProbe 上。
 * why 动态 import 而不是加调试句柄：见文件头「观测口径」。
 */
const PROBE_INSTALL = `(async () => {
  const bus = await import('/src/core/bus.ts');
  if (window.__e2eProbe) return { ok: true, reused: true };
  const probe = { events: [], types: {}, state: null, positions: {}, camera: null };
  bus.onWorldEvent((event) => {
    probe.events.push({ type: event.type, event });
    probe.types[event.type] = (probe.types[event.type] || 0) + 1;
    if (probe.events.length > 8000) probe.events.splice(0, 2000);
    if (event.type === 'unit.position') probe.positions[event.unitId] = { x: event.x, y: event.y };
    if (event.type === 'camera.moved') probe.camera = { center: event.center, zoom: event.zoom };
  });
  bus.onState((state) => { probe.state = state; });
  window.__e2eProbe = probe;
  return { ok: true };
})()`;

/** 读探针（页面侧先裁剪好再回传 —— 免得把整份状态搬回 node）。 */
const PROBE_READ = `(() => {
  const p = window.__e2eProbe;
  if (!p) return { error: 'no-probe' };
  const s = p.state || {};
  const of = (type) => p.events.filter((e) => e.type === type).map((e) => e.event);
  return {
    types: p.types,
    camera: p.camera,
    positions: p.positions,
    selection: s.selection
      ? { unitIds: (s.selection.unitIds || []).slice(), revision: s.selection.revision ?? null }
      : null,
    units: (s.units || []).map((u) => ({
      id: u.id,
      name: u.name,
      status: u.status,
      online: u.online ?? null,
      characterId: u.characterId ?? null,
      missionId: u.missionId ?? null,
    })),
    tasks: (s.tasks || []).map((t) => ({
      id: t.id,
      characterId: t.characterId,
      status: t.status,
      missionId: t.missionId ?? null,
      output: (t.output || '').slice(0, 160),
    })),
    missions: (s.missions || []).map((m) => ({
      id: m.id,
      title: m.title,
      phase: m.phase,
      unitIds: m.unitIds || [],
    })),
    characters: (s.characters || []).map((c) => ({
      id: c.id,
      name: c.name,
      agentKind: c.agentKind ?? null,
    })),
    detectedAgents: (s.detectedAgents || []).map((a) => ({
      kind: a.kind,
      installed: a.installed,
      status: a.status,
      version: a.version ?? null,
    })),
    notices: (s.notices || []).slice(-8).map((n) => ({ level: n.level, text: (n.text || '').slice(0, 140) })),
    bubbles: of('unit.bubble').map((e) => ({ unitId: e.unitId, text: e.text })),
    sounds: of('fx.sound').map((e) => e.cue),
    boxes: of('selection.box').map((e) => ({
      unitIds: (e.unitIds || []).slice(),
      bounds: e.bounds,
      additive: e.additive === true,
    })),
    moves: of('unit.move').map((e) => ({ unitIds: e.unitIds, x: e.x, y: e.y })),
    clicks: of('unit.click').map((e) => e.unitId),
    beats: of('replay.beat').map((e) => ({
      kind: e.beat.kind,
      at: e.beat.at,
      label: e.beat.label || '',
    })),
  };
})()`;

/** 读 HUD 组件（跑马灯 / 里程碑 / 回放条 / 时间戳角标）的观察口。 */
const HUD_READ = `(() => {
  const q = (sel) => document.querySelector(sel);
  const shadowText = (el, role) => {
    if (!el || !el.shadowRoot) return null;
    const node = el.shadowRoot.querySelector('[data-role="' + role + '"]');
    return node ? node.textContent : null;
  };
  const marquee = q('strat-marquee');
  const milestone = q('strat-milestone');
  const replay = q('strat-day-replay');
  const clock = q('strat-replay-clock');
  return {
    marquee: marquee
      ? { entries: (marquee.entries || []).map((e) => ({ kind: e.kind, text: e.text })), visible: marquee.visible === true }
      : null,
    milestone: milestone
      ? {
          completedCount: milestone.completedCount,
          showing: milestone.showing === true,
          text: milestone.text,
          enabled: milestone.enabled === true,
        }
      : null,
    replay: replay
      ? {
          entryCount: replay.entryCount,
          playing: replay.playing === true,
          count: shadowText(replay, 'count'),
          playText: shadowText(replay, 'play'),
          empty: shadowText(replay, 'empty'),
          clock: shadowText(replay, 'clock'),
        }
      : null,
    replayClock: clock
      ? {
          currentAt: clock.currentAt ?? null,
          visible: clock.visible === true,
          time: shadowText(clock, 'time'),
        }
      : null,
  };
})()`;

/**
 * 生产入口的视图参数：相机位姿（探针里的 camera.moved）+ 单位世界坐标 → 屏幕坐标。
 * why 相机从事件里取：生产入口没有调试句柄，camera.moved 是相机位姿的唯一出口。
 */
const PROD_VIEW = `(() => {
  const probe = window.__e2eProbe;
  const canvas = document.querySelector('#battlefield canvas');
  if (!probe || !canvas) return { error: 'no-view' };
  const rect = canvas.getBoundingClientRect();
  const cam = probe.camera;
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const toScreen = (wx, wy) => {
    if (!cam) return null;
    return {
      x: rect.left + ((wx - cam.center.x) * cam.zoom + canvas.width / 2) * scaleX,
      y: rect.top + ((wy - cam.center.y) * cam.zoom + canvas.height / 2) * scaleY,
    };
  };
  return {
    camera: cam,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    canvas: { width: canvas.width, height: canvas.height },
    units: Object.entries(probe.positions).map(([id, p]) => ({ id, world: p, screen: toScreen(p.x, p.y) })),
  };
})()`;

/**
 * dev 验收页的视图参数：用它自己已有的调试句柄取相机与单位（既有约定，不改生产代码）。
 * 同时把「世界坐标 → 屏幕坐标」装成 window.__e2eToScreen（node 侧只拿结果）。
 */
const DEV_VIEW = `(() => {
  const handle = window.__srfHelloLoop;
  if (!handle || !handle.game) return { error: 'no-handle' };
  const scene = handle.game.scene.getScene('battlefield');
  if (!scene) return { error: 'no-scene' };
  const cam = scene.cameras.main;
  const canvas = document.querySelector('#battlefield canvas');
  if (!canvas) return { error: 'no-canvas' };
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / cam.width;
  const scaleY = rect.height / cam.height;
  // 屏幕 → 世界 的反函数：在三个点上取仿射基（不猜 Phaser 相机内部约定）。
  const o = cam.getWorldPoint(0, 0);
  const ex = cam.getWorldPoint(1, 0);
  const ey = cam.getWorldPoint(0, 1);
  const a = ex.x - o.x;
  const b = ey.x - o.x;
  const c = ex.y - o.y;
  const d = ey.y - o.y;
  const det = a * d - b * c;
  window.__e2eToScreen = (wx, wy) => {
    if (!det) return null;
    const dx = wx - o.x;
    const dy = wy - o.y;
    const gx = (d * dx - b * dy) / det;
    const gy = (-c * dx + a * dy) / det;
    return { x: rect.left + gx * scaleX, y: rect.top + gy * scaleY };
  };
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    camera: { center: { x: cam.midPoint.x, y: cam.midPoint.y }, zoom: cam.zoom },
    units: scene.units.list().map((u) => ({
      id: u.id,
      name: u.name,
      status: u.status,
      online: u.online,
      world: { x: u.position.x, y: u.position.y },
      screen: window.__e2eToScreen(u.position.x, u.position.y),
    })),
  };
})()`;

/**
 * 等单位跑到位（坐标不再变）并返回最新视图。
 * why 必须等：指令下达后编队会**跑**到目标点 —— 拿指令前的旧坐标去点，会打在空处
 *   （点空地 = 零面积框选 = 清空选择集，既不报 unit.click 也点不中单位）。
 */
async function settleUnits(session, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let latest = null;
  while (Date.now() < deadline) {
    const current = await evalOrError(session, DEV_VIEW);
    if (current && !current.error && current.units.length) {
      latest = current;
      const moved = previous
        ? current.units.some((unit) => {
            const before = previous.get(unit.id);
            return (
              !before ||
              Math.abs(before.x - unit.world.x) > 1 ||
              Math.abs(before.y - unit.world.y) > 1
            );
          })
        : true;
      const snapshot = new Map(current.units.map((unit) => [unit.id, unit.world]));
      if (!moved) return current;
      previous = snapshot;
    }
    await sleep(250);
  }
  return latest;
}

/**
 * 收掉首启向导覆盖层（生产入口**首启必弹** —— 它整屏盖在战场上，点不到画布）。
 * why 走产品自己的「跳过引导」按钮：宿主是靠 onboarding-skipped 事件收覆盖层的，
 *   走按钮 = 走产品路径（不是把 DOM 拆了 —— 拆 DOM 绕过了产品的收起逻辑）。
 * why 不能只查一次「在不在」：向导是**探测到 agent 之后**才挂的 —— 装探针那会儿
 *   往往还没扫完，一查「不在」就放行，几秒后它照样弹出来挡住画布。所以这里轮询到它消失为止。
 */
async function dismissOnboarding(session, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = { done: false, reason: 'not-checked' };
  while (Date.now() < deadline) {
    const present = await evalOrError(
      session,
      `(() => Boolean(document.querySelector('strat-onboarding-screen')))()`
    );
    if (present === true) {
      last = await evalOrError(
        session,
        `(() => {
          const screen = document.querySelector('strat-onboarding-screen');
          if (!screen) return { done: true, reason: 'absent' };
          const button = screen.shadowRoot ? screen.shadowRoot.querySelector('[data-action="skip"]') : null;
          if (button) { button.click(); return { clicked: true }; }
          screen.dispatchEvent(new CustomEvent('onboarding-skipped', { bubbles: true, composed: true }));
          return { dispatched: true };
        })()`
      );
    } else {
      last = { done: true, reason: 'absent' };
    }
    await sleep(300);
    const gone = await evalOrError(
      session,
      `(() => !document.querySelector('strat-onboarding-screen'))()`
    );
    if (gone === true) return last;
  }
  throw new Error(`首启向导收不掉（最后一次：${JSON.stringify(last)}）`);
}

/**
 * 找一个「点得到、且点不到单位」的画布空地 —— 右键指令的落点。
 * why 要找：生产入口的 HUD 面板（命令面板等）浮在战场上并吃事件，
 *   随便挑一个世界坐标换算出来的屏幕点可能正落在面板上 —— 战场根本收不到这次右键。
 * why 扫格子：用 elementFromPoint 判「这一像素的最上层是不是画布」，比猜面板位置可靠。
 */
const pickGroundPoint = (unitScreens) => `(() => {
  const canvas = document.querySelector('#battlefield canvas');
  if (!canvas) return { error: 'no-canvas' };
  const rect = canvas.getBoundingClientRect();
  const units = ${JSON.stringify(unitScreens)};
  let best = null;
  for (let y = rect.top + 24; y < rect.top + rect.height - 24; y += 24) {
    for (let x = rect.left + 24; x < rect.left + rect.width - 24; x += 24) {
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const distance = units.length
        ? Math.min(...units.map((unit) => Math.hypot(unit.x - x, unit.y - y)))
        : Infinity;
      if (!best || distance > best.distance) best = { x, y, distance };
    }
  }
  return best ? { x: best.x, y: best.y, distance: best.distance } : { error: 'no-ground' };
})()`;

/** 卡住体态：让**生产动画模块**对 dev 页上那个 error 单位算一次姿态。 */
const STUCK_POSE = `(async () => {
  const handle = window.__srfHelloLoop;
  const scene = handle.game.scene.getScene('battlefield');
  const unit = scene.units.get('u-cipher');
  if (!unit) return { error: 'no-unit' };
  const pose = unit.animation.pose(
    {
      status: unit.status,
      online: unit.online,
      hasMission: unit.missionId !== null,
      selected: false,
      hovered: false,
    },
    Date.now()
  );
  return { status: unit.status, base: pose.base };
})()`;

/** 干活动画：对**活着的**单位，用生产动画模块算一次姿态。 */
const WORKING_POSE = `(async (unitId) => {
  const { UnitAnimationController } = await import('/src/world/appearance/unit-animation.ts');
  const p = window.__e2eProbe;
  const unit = (p.state?.units || []).find((u) => u.id === unitId);
  if (!unit) return { error: 'no-unit' };
  const pose = new UnitAnimationController(unitId).pose(
    {
      status: unit.status,
      online: unit.online ?? true,
      hasMission: unit.missionId !== null,
      selected: false,
      hovered: false,
    },
    Date.now()
  );
  return { status: unit.status, base: pose.base };
})`;

/** 地图口径：用**生产映射模块**（MapBoard）对活着的状态对账一次 —— 建筑态与区域点亮。 */
const MAP_BOARD = `(async () => {
  const { MapBoard } = await import('/src/world/objects/task-building.ts');
  const p = window.__e2eProbe;
  const s = p.state || {};
  const board = new MapBoard();
  const result = board.sync(s.missions || [], s.tasks || []);
  return {
    regions: result.regions.map((r) => ({
      id: r.id,
      name: r.name,
      cleared: r.cleared,
      buildingCount: r.buildingCount,
    })),
    buildings: result.buildings.map((b) => ({
      id: b.id,
      regionId: b.regionId,
      state: b.state,
      failed: b.failed,
    })),
  };
})()`;

// ============================================================================
// CDP 鼠标（画布交互靠真实鼠标事件驱动 —— 不注入业务事件）
// ============================================================================

/** 发一条鼠标事件。 */
async function mouse(session, params) {
  await session.send('Input.dispatchMouseEvent', params);
}

/** 点一下（按下 + 抬起，同一坐标 —— 右键短按即「移动指令 / 集火」）。 */
async function clickAt(session, x, y, button = 'left') {
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
  await mouse(session, { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  await sleep(40);
  await mouse(session, { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
  await sleep(150);
}

/** 拖一段（框选）。 */
async function dragFromTo(session, from, to, steps = 12) {
  await mouse(session, { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    await mouse(session, {
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      button: 'left',
      buttons: 1,
    });
    await sleep(16);
  }
  await sleep(50);
  await mouse(session, { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
}

// ============================================================================
// 通用小工具
// ============================================================================

/** 在页面里求值（失败不抛，返回带 error 的对象）。 */
async function evalOrError(session, expression) {
  try {
    return await session.evaluate(expression);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

/** 读探针快照。 */
async function readProbe(session) {
  const view = await evalOrError(session, PROBE_READ);
  if (!view || view.error) throw new Error(`读探针失败：${view?.error ?? '未知'}`);
  return view;
}

/** 读 HUD 快照。 */
async function readHud(session) {
  const view = await evalOrError(session, HUD_READ);
  if (!view || view.error) throw new Error(`读 HUD 失败：${view?.error ?? '未知'}`);
  return view;
}

/** 派一条 HudCommand（走 agent-panel 的 adapter —— HUD → core 的唯一合法通道）。 */
async function dispatch(session, command) {
  const result = await evalOrError(
    session,
    `(() => {
      const panel = document.querySelector('strat-agent-panel');
      if (!panel) return { error: 'no-agent-panel' };
      const adapter = panel.adapter;
      if (!adapter || typeof adapter.dispatch !== 'function') return { error: 'no-adapter' };
      try {
        adapter.dispatch(${JSON.stringify(command)});
        return { ok: true };
      } catch (e) {
        return { error: 'dispatch-failed: ' + (e && e.message ? e.message : String(e)) };
      }
    })()`
  );
  if (!result || result.error) throw new Error(`派命令失败（${command.type}）：${result?.error ?? '未知'}`);
  return result;
}

/** 等页面就绪并装上探针。 */
async function attachProbe(port, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    let session = null;
    let handedOver = false;
    try {
      session = await connectPage({ base: `127.0.0.1:${port}` });
      const installed = await evalOrError(session, PROBE_INSTALL);
      if (installed && installed.ok) {
        // 交出去之后不能再关 —— finally 会跑，返回的 session 必须活着给调用方用。
        handedOver = true;
        return session;
      }
      lastError = installed?.error ?? 'probe-not-installed';
    } catch (error) {
      lastError = String(error?.message ?? error);
    } finally {
      if (session && !handedOver) session.close();
    }
    await sleep(500);
  }
  throw new Error(`等页面 + 装探针超时：${lastError}`);
}

/**
 * 相对路径的 electron require（tsc-alias 把 require('electron') 改写成 require('../../electron')）。
 * 这种产物在 Electron 启动时直接抛 `Cannot find module '../../electron'`。
 */
const RELATIVE_ELECTRON_REQUIRE = /require\((['"])(?:\.\.\/)+electron\1\)/;

/**
 * 产物是否还活着（没被 tsc-alias 改坏）。
 * why 要单独查健康度而不只看 mtime：`npm run build`（build:backend 的 tsc-alias）会把
 *   dist/electron/electron/{main,preload}.js 里的 require('electron') 改写成相对路径 ——
 *   产物时间戳是新的（比源码新），但 Electron 起不来。只看 mtime 会误判成「产物最新，跳过重建」。
 */
function electronArtifactIsHealthy(file) {
  if (!existsSync(file)) return false;
  return !RELATIVE_ELECTRON_REQUIRE.test(readFileSync(file, 'utf-8'));
}

/**
 * 确保 Electron 壳的构建产物是最新的、且没被改坏。
 * why 要这一步：preload 的 env 白名单（STRATIX_REMOTE / STRATIX_WORLD_SYNC_URL）与
 *   main 的 STRATIX_DEV_SERVER_URL 都是运行期开关 —— 产物比源码旧 → 开关开不起来。
 */
async function ensureFreshElectronBuild() {
  const builtMain = path.join(REPO, 'dist', 'electron', 'electron', 'main.js');
  const builtPreload = path.join(REPO, 'dist', 'electron', 'electron', 'preload.js');
  const sources = [
    path.join(REPO, 'src', 'electron', 'main.ts'),
    path.join(REPO, 'src', 'electron', 'preload.ts'),
  ];
  const newestSource = Math.max(
    ...sources.filter((file) => existsSync(file)).map((file) => statSync(file).mtimeMs)
  );
  const oldestBuilt = [builtMain, builtPreload]
    .filter((file) => existsSync(file))
    .map((file) => statSync(file).mtimeMs)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const stale = !existsSync(builtMain) || !existsSync(builtPreload) || oldestBuilt < newestSource;
  const healthy = electronArtifactIsHealthy(builtMain) && electronArtifactIsHealthy(builtPreload);
  if (!stale && healthy) {
    log('Electron 构建产物是最新的（跳过重建）');
    return;
  }
  log(
    healthy
      ? 'Electron 构建产物过期 → 重新构建（npm run build:electron）'
      : 'Electron 构建产物被 build:backend 的 tsc-alias 改坏（相对路径 electron require）→ 重新构建（npm run build:electron）'
  );
  const build = launch('build:electron', 'npm', ['run', 'build:electron'], { cwd: REPO });
  const code = await new Promise((resolve) => {
    build.proc.on('exit', (exitCode) => resolve(exitCode ?? -1));
  });
  if (code !== 0) {
    throw new Error(`npm run build:electron 失败（exit=${code}）：\n${build.output.slice(-20).join('\n')}`);
  }
  if (!electronArtifactIsHealthy(builtMain) || !electronArtifactIsHealthy(builtPreload)) {
    throw new Error('Electron 构建完成但产物仍带相对路径 electron require —— 壳起不来');
  }
  log('Electron 构建完成');
}

/** 装一份可执行的假 claude 到临时 bin 目录（PATH 替身 —— 只替最末端那一跳）。 */
async function installFakeClaude(binDir) {
  await copyFile(FAKE_CLAUDE_SRC, path.join(binDir, 'claude'));
  await chmod(path.join(binDir, 'claude'), 0o755);
}

// ============================================================================
// A 段：dev 验收页 —— 框选 / 指令特效 / 卡住体态 / 集火
// ============================================================================

async function phaseDevAcceptance({ viteUrl, tmpDirs }) {
  log('── A 段：dev 验收页（框选 / 指令特效 / 卡住体态 / 集火）──');
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-demo-dev-'));
  tmpDirs.push(userDataDir);
  const electron = launch(
    'electron#A',
    bin('electron'),
    ['.', `--remote-debugging-port=${CDP_DEV}`, `--user-data-dir=${userDataDir}`],
    { cwd: REPO, env: { STRATIX_DEV_SERVER_URL: `${viteUrl}/${DEV_HTML}` } }
  );
  log(`A 段 Electron 已拉起（pid=${electron.pid}，调试端口 ${CDP_DEV}）`);
  const session = await attachProbe(CDP_DEV);
  try {
    // 等种子单位就位（dev 页写的是真实 store，广播真实状态）。
    let lastDevView = null;
    try {
      await waitFor(
        'dev 页种子单位',
        async () => {
          const current = await evalOrError(session, DEV_VIEW);
          lastDevView = current;
          return current && !current.error && current.units.length >= 4 ? current : false;
        },
        { timeoutMs: 60_000, intervalMs: 400 }
      );
    } catch (error) {
      const page = await evalOrError(
        session,
        `(() => ({
          href: location.href,
          title: document.title,
          hasHandle: Boolean(window.__srfHelloLoop),
          hasGame: Boolean(window.__srfHelloLoop && window.__srfHelloLoop.game),
          canvas: Boolean(document.querySelector('#battlefield canvas')),
          bodyText: (document.body ? document.body.innerText : '').slice(0, 300),
        }))()`
      );
      throw new Error(
        `等待超时：dev 页种子单位\n页面态：${JSON.stringify(page)}\n末次视图：${JSON.stringify(lastDevView)}\n原始错误：${error?.message ?? error}`
      );
    }
    const seeded = await evalOrError(session, DEV_VIEW);
    log(`A 段单位就位：${seeded.units.map((u) => `${u.name}(${u.id},${u.status})`).join(' / ')}`);

    // 把镜头对准单位（dev 页自己摆的机位对着战场左上角，单位在画面外）。
    // why 走 camera.center：这是产品的真实指令通道（HUD → core → world），不是作弊。
    const center = {
      x: Math.round(seeded.units.reduce((sum, unit) => sum + unit.world.x, 0) / seeded.units.length),
      y: Math.round(seeded.units.reduce((sum, unit) => sum + unit.world.y, 0) / seeded.units.length),
    };
    const centered = await evalOrError(
      session,
      `(() => {
        const handle = window.__srfHelloLoop;
        if (!handle || !handle.adapter) return { error: 'no-adapter' };
        handle.adapter.dispatch({ type: 'camera.center', x: ${center.x}, y: ${center.y} });
        return { ok: true };
      })()`
    );
    if (centered?.error) throw new Error(`dev 页镜头对中失败：${centered.error}`);
    await sleep(500);

    const positioned = await evalOrError(session, DEV_VIEW);
    const onScreen = positioned.units.filter(
      (unit) =>
        unit.screen &&
        unit.screen.x >= positioned.rect.left &&
        unit.screen.x <= positioned.rect.left + positioned.rect.width &&
        unit.screen.y >= positioned.rect.top &&
        unit.screen.y <= positioned.rect.top + positioned.rect.height
    );
    must(
      'dev 页：镜头对准后单位全部在画面内（点位换算自活相机）',
      onScreen.length === positioned.units.length,
      `画面内 ${onScreen.length}/${positioned.units.length} 个`
    );

    const toScreen = async (world) => {
      const point = await evalOrError(
        session,
        `(() => (window.__e2eToScreen ? window.__e2eToScreen(${world.x}, ${world.y}) : null))()`
      );
      if (!point) throw new Error(`世界坐标换算失败：${JSON.stringify(world)}`);
      return point;
    };

    const minX = Math.min(...positioned.units.map((unit) => unit.world.x));
    const minY = Math.min(...positioned.units.map((unit) => unit.world.y));
    const maxX = Math.max(...positioned.units.map((unit) => unit.world.x));
    const maxY = Math.max(...positioned.units.map((unit) => unit.world.y));

    // ── A1 框选：从所有单位外侧的空地起手，拖过全部单位 ──
    await dragFromTo(
      session,
      await toScreen({ x: minX - 120, y: minY - 120 }),
      await toScreen({ x: maxX + 120, y: maxY + 120 }),
      14
    );
    const afterBox = await readProbe(session);
    const box = afterBox.boxes[afterBox.boxes.length - 1];
    must(
      '框选：拖拽产出了 selection.box 事件并带命中 id',
      Boolean(box) && box.unitIds.length >= 2,
      `命中 ${box?.unitIds.length ?? 0} 个：${(box?.unitIds ?? []).join(',')}`
    );
    must(
      '框选：core 选择集与命中一致（状态机裁决，不是画面自说自话）',
      Boolean(afterBox.selection) &&
        afterBox.selection.unitIds.length >= 2 &&
        box.unitIds.every((id) => afterBox.selection.unitIds.includes(id)),
      `选择集：${(afterBox.selection?.unitIds ?? []).join(',') || '空'}`
    );
    must(
      '框选：选中音效 cue（select）真实发出',
      afterBox.sounds.includes('select'),
      `cues：${afterBox.sounds.join(',') || '无'}`
    );

    // ── A2 指令特效：右键空地 = 给选中编队下移动指令 ──
    const groundScreen = await toScreen({ x: minX - 120, y: maxY + 160 });
    const beforeBubble = (await readProbe(session)).bubbles.length;
    await clickAt(session, groundScreen.x, groundScreen.y, 'right');
    const afterCommand = await readProbe(session);
    const newBubbles = afterCommand.bubbles.slice(beforeBubble);
    must(
      '指令特效：选中单位冒「收到」气泡（unit.bubble 事件）',
      newBubbles.length >= 1 && newBubbles.every((bubble) => bubble.text === '收到'),
      `新气泡：${newBubbles.map((bubble) => bubble.text).join('/') || '无'}`
    );
    must(
      '指令特效：编队移动指令上报（unit.move 事件）',
      afterCommand.moves.length >= 1,
      `移动 ${afterCommand.moves.length} 次`
    );
    must(
      '指令特效：指令音效 cue（command）真实发出',
      afterCommand.sounds.includes('command'),
      `cues：${afterCommand.sounds.join(',') || '无'}`
    );

    // ── A3 卡住体态：error 单位在生产动画模块里就是「卡住」姿态 ──
    const pose = await evalOrError(session, STUCK_POSE);
    must(
      '卡住体态：error 单位的状态与生产动画模块判定一致（stuck）',
      pose?.status === 'error' && pose?.base === 'stuck',
      `status=${pose?.status} base=${pose?.base}`
    );

    // ── A4 集火：点选一个单位后，右键落在卡住单位上 = 支援它 ──
    // why 要重新取坐标：上一段的移动指令让编队**跑**到了空地，旧坐标已经过期 ——
    //   拿旧坐标点下去会落在空地（= 零面积框选 = 清空选择集），点不中也报不出 unit.click。
    const settled = await settleUnits(session);
    const helper = settled.units.find((unit) => unit.status !== 'error');
    const stuck = settled.units.find((unit) => unit.status === 'error');
    const helperScreen = await toScreen(helper.world);
    await clickAt(session, helperScreen.x, helperScreen.y, 'left');
    const afterClick = await readProbe(session);
    const clickedId = afterClick.clicks[afterClick.clicks.length - 1] ?? null;
    must(
      '点选单位：点击上报 unit.click 且 core 选中了它',
      Boolean(clickedId) && (afterClick.selection?.unitIds ?? []).includes(clickedId),
      `点击：${afterClick.clicks.join(',') || '无'} / 选择集：${(afterClick.selection?.unitIds ?? []).join(',') || '空'}`
    );

    const stuckNow = await evalOrError(session, DEV_VIEW);
    const stuckUnit = (stuckNow.units ?? []).find((unit) => unit.status === 'error') ?? stuck;
    const stuckScreen = await toScreen(stuckUnit.world);
    const beforeFocus = (await readProbe(session)).bubbles.length;
    await clickAt(session, stuckScreen.x, stuckScreen.y, 'right');
    const afterFocus = await readProbe(session);
    const focusBubbles = afterFocus.bubbles.slice(beforeFocus);
    must(
      '集火：右键卡住单位 = 支援（气泡换成「来了来了」）',
      focusBubbles.length >= 1 && focusBubbles.every((bubble) => bubble.text === '来了来了'),
      `新气泡：${focusBubbles.map((bubble) => bubble.text).join('/') || '无'}`
    );
    must(
      '集火：集火音效 cue（focus）真实发出',
      afterFocus.sounds.includes('focus'),
      `cues：${afterFocus.sounds.join(',') || '无'}`
    );
  } finally {
    session.close();
    await killTree(electron.pid, { label: 'electron#A' });
  }
}

// ============================================================================
// B 段：生产入口 · 本地模式 —— 派活 / 干活 / 完成插旗 / 区域点亮 / 里程碑
// ============================================================================

async function phaseLocalProduction({ viteUrl, tmpDirs, fakeBinDir }) {
  log('── B 段：生产入口 · 本地模式（派活 / 干活 / 完成插旗 / 区域点亮 / 里程碑）──');
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-demo-local-'));
  tmpDirs.push(userDataDir);
  const electron = launch(
    'electron#B',
    bin('electron'),
    ['.', `--remote-debugging-port=${CDP_LOCAL}`, `--user-data-dir=${userDataDir}`],
    {
      cwd: REPO,
      env: {
        STRATIX_DEV_SERVER_URL: `${viteUrl}/${ENTRY_HTML}`,
        // 假 CLI 在 PATH 最前 —— 本地模式没有 adapter 注入口，替身只能落在这最后一跳。
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    }
  );
  log(`B 段 Electron 已拉起（pid=${electron.pid}，调试端口 ${CDP_LOCAL}）`);
  const session = await attachProbe(CDP_LOCAL);
  try {
    // ── B0 agent 探测：假 CLI 必须在 PATH 上被探到「已安装」 ──
    const agent = await waitFor(
      'agent 探测结果',
      async () => {
        const probe = await readProbe(session);
        const found = (probe.detectedAgents ?? []).find((item) => item.kind === 'claude-code');
        return found && found.installed ? found : false;
      },
      { timeoutMs: 90_000, intervalMs: 500 }
    );
    must(
      '本地模式：claude-code 被探测为已安装（PATH 上的假 CLI）',
      agent.installed === true,
      `version=${agent.version ?? '?'}`
    );

    // ── B0.5 首启向导：它整屏盖在战场上，不收掉就点不到画布 ──
    await dismissOnboarding(session);
    const reachable = await evalOrError(
      session,
      `(() => {
        const canvas = document.querySelector('#battlefield canvas');
        if (!canvas) return { error: 'no-canvas' };
        const rect = canvas.getBoundingClientRect();
        const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { topTag: el ? el.tagName : null, isCanvas: el === canvas };
      })()`
    );
    must(
      '生产入口：首启向导已收起，战场画布可点（没被覆盖层挡住）',
      reachable?.isCanvas === true,
      `画布中心最上层元素：${reachable?.topTag ?? '无'}`
    );

    // ── B1 建角色（真命令 → 真落库 → 真单位投影） ──
    for (let index = 0; index < 3; index += 1) {
      await dispatch(session, {
        type: 'character.create',
        name: `演示角色${index + 1}${String(Date.now()).slice(-4)}`,
        agentKind: 'claude-code',
        skinId: 'skin-default',
      });
    }
    const created = await waitFor(
      '三个角色与单位就位',
      async () => {
        const probe = await readProbe(session);
        return probe.characters.length >= 3 && probe.units.length >= 3 ? probe : false;
      },
      { timeoutMs: 60_000, intervalMs: 300 }
    );
    must(
      '建角色：三个角色建档并投影出战场单位',
      created.characters.length >= 3 && created.units.length >= 3,
      `角色 ${created.characters.length} 个 / 单位 ${created.units.length} 个`
    );
    const worker = created.units.find((unit) => unit.characterId === created.characters[0].id);
    const unitIds = created.units.map((unit) => unit.id);

    // ── B2 建编组任务（= 地图上的一个街区） ──
    await dispatch(session, { type: 'mission.create', title: '演示街区', unitIds });
    const withMission = await waitFor(
      '编组任务就位',
      async () => {
        const probe = await readProbe(session);
        return probe.missions.length >= 1 ? probe : false;
      },
      { timeoutMs: 30_000, intervalMs: 200 }
    );
    const mission = withMission.missions[0];
    must(
      '建编组任务：mission 落进状态（地图上的街区）',
      Boolean(mission.id),
      `mission=${mission.id} phase=${mission.phase}`
    );

    // ── B3 框选（生产入口 · 真实相机） ──
    // 相机位姿的唯一出口是 camera.moved 事件；探针可能装得晚（错过开局那一声），
    // 所以先派一条 camera.center 把镜头挪到单位身上 —— 位姿一变，事件就来了。
    const unitPositions = Object.values((await readProbe(session)).positions);
    must(
      '生产入口：单位落位坐标上报了（unit.position 事件）',
      unitPositions.length >= 3,
      `坐标 ${unitPositions.length} 份`
    );
    const focusPoint = {
      x: Math.round(unitPositions.reduce((sum, p) => sum + p.x, 0) / unitPositions.length),
      y: Math.round(unitPositions.reduce((sum, p) => sum + p.y, 0) / unitPositions.length),
    };
    await dispatch(session, { type: 'camera.center', x: focusPoint.x, y: focusPoint.y });
    const view = await waitFor(
      '相机位姿事件到达',
      async () => {
        const current = await evalOrError(session, PROD_VIEW);
        // why 要对焦而不是「有 camera 事件就行」：探针可能装得早（抢在场景 create 之前），
        //   那时手上已经有**初始**那声 camera.moved —— 直接拿来换算会拿到开局的机位。
        if (!current || current.error || !current.camera) return false;
        const { x, y } = current.camera.center;
        return Math.abs(x - focusPoint.x) <= 4 && Math.abs(y - focusPoint.y) <= 4 ? current : false;
      },
      { timeoutMs: 20_000, intervalMs: 200 }
    );
    const positioned = view.units.filter((unit) => unit.screen);
    must(
      '生产入口：相机位姿与单位屏幕坐标都拿到了（camera.moved / unit.position 事件）',
      positioned.length >= 3,
      `相机 zoom=${view.camera?.zoom ?? '?'} / 定位单位 ${positioned.length} 个`
    );

    const rect = view.rect;
    const scaleX = rect.width / view.canvas.width;
    const scaleY = rect.height / view.canvas.height;
    const toScreen = (wx, wy) => ({
      x: rect.left + ((wx - view.camera.center.x) * view.camera.zoom + view.canvas.width / 2) * scaleX,
      y: rect.top + ((wy - view.camera.center.y) * view.camera.zoom + view.canvas.height / 2) * scaleY,
    });
    const minX = Math.min(...positioned.map((unit) => unit.world.x));
    const minY = Math.min(...positioned.map((unit) => unit.world.y));
    const maxX = Math.max(...positioned.map((unit) => unit.world.x));
    const maxY = Math.max(...positioned.map((unit) => unit.world.y));
    await dragFromTo(session, toScreen(minX - 120, minY - 120), toScreen(maxX + 120, maxY + 120), 14);
    const afterBox = await readProbe(session);
    const box = afterBox.boxes[afterBox.boxes.length - 1];
    must(
      '生产入口框选：拖拽命中多个单位并落到 core 选择集',
      Boolean(box) && box.unitIds.length >= 2 && (afterBox.selection?.unitIds ?? []).length >= 2,
      `命中 ${box?.unitIds.length ?? 0} 个 / 选择集 ${(afterBox.selection?.unitIds ?? []).length} 个`
    );
    must(
      '生产入口框选：选中音效 cue（select）真实发出',
      afterBox.sounds.includes('select'),
      `cues：${afterBox.sounds.join(',') || '无'}`
    );

    // ── B4 指令特效（右键空地） ──
    // why 用「扫格子挑空地」而不是按世界坐标换算：生产入口的命令面板浮在战场上，
    //   换算出来的那个点可能正落在面板上 —— 右键被面板吃掉，战场收不到（既没气泡也没指令）。
    const bubblesBefore = afterBox.bubbles.length;
    const groundPoint = await evalOrError(
      session,
      pickGroundPoint(positioned.map((unit) => unit.screen))
    );
    must(
      '生产入口指令特效：落点确实在画布上（没被 HUD 面板挡住）',
      Boolean(groundPoint) && !groundPoint.error,
      `落点：${groundPoint?.error ?? JSON.stringify({ x: Math.round(groundPoint?.x), y: Math.round(groundPoint?.y) })}`
    );
    await clickAt(session, groundPoint.x, groundPoint.y, 'right');
    const afterCommand = await readProbe(session);
    const commandBubbles = afterCommand.bubbles.slice(bubblesBefore);
    must(
      '生产入口指令特效：选中单位冒「收到」气泡',
      commandBubbles.length >= 1 && commandBubbles.every((bubble) => bubble.text === '收到'),
      `新气泡：${commandBubbles.map((bubble) => bubble.text).join('/') || '无'}`
    );
    must(
      '生产入口指令特效：编队移动指令上报 + 指令音效 cue',
      afterCommand.moves.length >= 1 && afterCommand.sounds.includes('command'),
      `移动 ${afterCommand.moves.length} 次 / cues：${afterCommand.sounds.join(',') || '无'}`
    );

    // ── B5 派活：10 条（里程碑阈值）+ 观察干活态 ──
    for (let index = 0; index < DEMO_TASK_COUNT; index += 1) {
      await dispatch(session, {
        type: 'task.assign',
        characterId: worker.characterId,
        prompt: `演示任务 ${index + 1}：把第 ${index + 1} 块地建起来`,
        missionId: mission.id,
      });
    }
    let busySeen = false;
    let busyUnit = null;
    let workingPose = null;
    const finished = await waitFor(
      '演示任务跑到完成',
      async () => {
        const probe = await readProbe(session);
        const busy = probe.units.find((unit) => unit.status === 'busy');
        if (busy) {
          busySeen = true;
          busyUnit = busy;
          // why 要**当场**取姿态：等 10 条全跑完时单位早回到 idle 了 ——
          //   干活态只在任务在跑的那一瞬间成立，事后补采就只剩 idle。
          if (!workingPose) {
            workingPose = await evalOrError(session, `${WORKING_POSE}(${JSON.stringify(busy.id)})`);
          }
        }
        return (probe.types['task.completed'] ?? 0) >= DEMO_TASK_COUNT ? probe : false;
      },
      { timeoutMs: 240_000, intervalMs: 150 }
    );
    must(
      '派活：task.queued 事件逐条发出（真命令进真队列）',
      (finished.types['task.queued'] ?? 0) >= DEMO_TASK_COUNT,
      `queued=${finished.types['task.queued'] ?? 0}`
    );
    must(
      '干活：task.started 事件逐条发出',
      (finished.types['task.started'] ?? 0) >= DEMO_TASK_COUNT,
      `started=${finished.types['task.started'] ?? 0}`
    );
    must(
      '干活：单位状态被置为 busy（core 派生，非画面猜测）',
      busySeen,
      busyUnit ? `unit=${busyUnit.id} status=${busyUnit.status}` : '未采到 busy 状态'
    );
    must(
      '干活动画：busy 单位在生产动画模块里就是「干活中」姿态（working）',
      workingPose?.base === 'working',
      `base=${workingPose?.base} status=${workingPose?.status}`
    );
    must(
      '完成：task.completed 事件逐条发出',
      (finished.types['task.completed'] ?? 0) >= DEMO_TASK_COUNT,
      `completed=${finished.types['task.completed'] ?? 0}`
    );
    must(
      '完成插旗：完成音效 cue（complete）真实发出 —— 插旗演出与它同帧',
      finished.sounds.includes('complete'),
      `cues：${finished.sounds.join(',') || '无'}`
    );

    // ── B6 地图口径：建筑完工 + 区域点亮 ──
    const map = await evalOrError(session, MAP_BOARD);
    const missionRegion = (map.regions ?? []).find((region) => region.id === mission.id);
    const missionBuildings = (map.buildings ?? []).filter((building) => building.regionId === mission.id);
    must(
      '完成插旗：地图上该街区的建筑全部是「完工」态（done）',
      missionBuildings.length >= DEMO_TASK_COUNT &&
        missionBuildings.every((building) => building.state === 'done'),
      `建筑 ${missionBuildings.length} 栋 / 完工 ${missionBuildings.filter((b) => b.state === 'done').length} 栋`
    );
    must(
      '区域点亮：街区被点亮（cleared）',
      Boolean(missionRegion) && missionRegion.cleared === true,
      `区域 ${missionRegion?.name ?? '无'} cleared=${missionRegion?.cleared}`
    );

    // ── B7 里程碑：满 10 个完成 → 中央金色大字 ──
    const milestone = await waitFor(
      '里程碑计数到 10',
      async () => {
        const hud = await readHud(session);
        return hud.milestone && hud.milestone.completedCount >= DEMO_TASK_COUNT ? hud : false;
      },
      { timeoutMs: 30_000, intervalMs: 100 }
    );
    must(
      '里程碑：完成计数到 10（组件自己数，喂进去的都是完成事件）',
      milestone.milestone.completedCount === DEMO_TASK_COUNT,
      `completedCount=${milestone.milestone.completedCount}`
    );
    must(
      '里程碑：中央金色大字在屏',
      milestone.milestone.showing === true,
      `text=${milestone.milestone.text}`
    );
    must(
      '跑马灯：派活与完成的条目进了事件流（真实事件驱动）',
      milestone.marquee !== null &&
        milestone.marquee.entries.some(
          (entry) =>
            entry.kind === 'dispatch' || entry.kind === 'complete' || entry.kind === 'milestone'
        ),
      `条目 ${milestone.marquee?.entries.length ?? 0} 条`
    );

    // ── B8 卡住：一条会失败的任务 → task.failed + 跑马灯报错 ──
    await dispatch(session, {
      type: 'task.assign',
      characterId: worker.characterId,
      prompt: 'E2E_FAIL 演示任务：这一单要卡住',
    });
    const failed = await waitFor(
      '任务失败事件',
      async () => {
        const probe = await readProbe(session);
        return (probe.types['task.failed'] ?? 0) >= 1 ? probe : false;
      },
      { timeoutMs: 120_000, intervalMs: 200 }
    );
    must(
      '卡住：任务失败产出 task.failed 事件（假 CLI 那一跳明着失败）',
      (failed.types['task.failed'] ?? 0) >= 1,
      `failed=${failed.types['task.failed'] ?? 0}`
    );
    const hudAfterFail = await readHud(session);
    must(
      '卡住：跑马灯出现报错条目',
      hudAfterFail.marquee !== null &&
        hudAfterFail.marquee.entries.some((entry) => entry.kind === 'error'),
      `条目：${(hudAfterFail.marquee?.entries ?? []).map((entry) => entry.kind).join(',')}`
    );
    const failedTask = failed.tasks.find((task) => task.status === 'failed');
    must(
      '卡住：任务在状态里落成 failed（core 裁决）',
      Boolean(failedTask),
      failedTask ? `task=${failedTask.id}` : '状态里没有 failed 任务'
    );
  } finally {
    session.close();
    await killTree(electron.pid, { label: 'electron#B' });
  }
}

// ============================================================================
// C 段：生产入口 · 远程模式 —— 当日回放 60s
// ============================================================================

async function phaseRemoteReplay({ viteUrl, tmpDirs }) {
  log('── C 段：生产入口 · 远程模式（当日回放 60s）──');

  // C1：起 service（假 CLI adapter 注入 —— 既有约定），并在它那儿真跑一条任务，
  //     让今天真的有一段 task_run 会话事件流可回放。
  const serviceDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-demo-service-'));
  tmpDirs.push(serviceDataDir);
  const service = launch(
    'service',
    bin('tsx'),
    [path.join(HERE, 'service-resident', 'service-process.ts')],
    {
      cwd: REPO,
      env: {
        SX_SERVICE_PORT: String(SERVICE_PORT),
        SX_WS_PORT: String(SERVICE_WS_PORT),
        SX_DATA_DIR: serviceDataDir,
        SX_REAL_CLI: '0',
      },
    }
  );
  const readyLine = await waitFor(
    'service 就绪',
    () => service.output.find((line) => line.startsWith('SX_SERVICE_READY ')),
    { timeoutMs: 120_000, intervalMs: 200 }
  );
  const ready = JSON.parse(readyLine.slice('SX_SERVICE_READY '.length));
  must('回放段：service 进程起来了（执行环 + 存储 + 只读 REST）', ready.pid > 0, `pid=${ready.pid}`);

  const observer = createObserver(
    `ws://127.0.0.1:${SERVICE_PORT}${WORLD_SYNC_PATH}`,
    'e2e-demo-observer'
  );
  try {
    await observer.opened;
    // why 要先探一次 seq：service 侧要先收到 hello 才把客户端登记进转发表 ——
    //   只 open 不 hello 的话，command.forward 发出去没人接（回执永远不来）。
    await observer.probeSeq();

    // C2：在 service 里真派一条任务（假 CLI 那一跳）→ 落成今天的 task_run 会话事件流。
    const registry = await waitFor(
      'agent 探测结果',
      async () => {
        const data = await mcpCall('stratix_registry', {}, SERVICE_PORT);
        return data.agents.some((agent) => agent.installed) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    const installed = registry.agents.filter((agent) => agent.installed);
    const agentKind =
      installed.find((agent) => agent.kind === 'claude-code')?.kind ?? installed[0].kind;
    log(`回放段：检出可用 agent ${agentKind}`);
    const characterName = `回放角色${String(Date.now()).slice(-5)}`;
    await observer.sendCommand({
      type: 'character.create',
      name: characterName,
      agentKind,
      skinId: 'skin-default',
    });
    const snapshot = await waitFor(
      'world_snapshot 里出现单位',
      async () => {
        const data = await mcpCall(
          'stratix_world_snapshot',
          { filters: { domains: ['units', 'characters'], limit: 50 } },
          SERVICE_PORT
        );
        return data.totals.units > 0 ? data : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 }
    );
    const character = snapshot.characters.items.find((item) => item.name === characterName);
    const unit = snapshot.units.items.find((item) => item.character_id === character?.id);
    const assigned = await mcpCall(
      'stratix_task_assign',
      { character: character.id, prompt: '回放演示：请原样回复 E2E 回放通过。' },
      SERVICE_PORT
    );
    const finished = await waitFor(
      '任务跑到终态',
      async () => {
        const data = await mcpCall(
          'stratix_task_status',
          { task_id: assigned.task_id, include_output: false },
          SERVICE_PORT
        );
        return ['completed', 'failed', 'cancelled'].includes(data.status) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    must(
      '回放段：service 里真跑完一条任务（今天有一段可回放的会话事件流）',
      finished.status === 'completed',
      `task=${assigned.task_id} status=${finished.status} unit=${unit?.id ?? '无'}`
    );

    // C3：Electron 远程模式（纯视图：state = service 推的快照）。
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-demo-remote-'));
    tmpDirs.push(userDataDir);
    const electron = launch(
      'electron#C',
      bin('electron'),
      ['.', `--remote-debugging-port=${CDP_REMOTE}`, `--user-data-dir=${userDataDir}`],
      {
        cwd: REPO,
        env: {
          STRATIX_REMOTE: '1',
          STRATIX_WORLD_SYNC_URL: `ws://127.0.0.1:${SERVICE_PORT}${WORLD_SYNC_PATH}`,
          STRATIX_DEV_SERVER_URL: `${viteUrl}/${ENTRY_HTML}`,
        },
      }
    );
    log(`C 段 Electron 已拉起（pid=${electron.pid}，调试端口 ${CDP_REMOTE}）`);
    const session = await attachProbe(CDP_REMOTE);
    try {
      // 远程模式同样可能弹首启向导（角色从 service 推来之前，状态里还没有角色）。
      await dismissOnboarding(session);
      // C4：回放条读到今天的条目（读的是 service 的只读 REST，不是造的数据）。
      const hud = await waitFor(
        '当日回放条目加载',
        async () => {
          const view = await readHud(session);
          return view.replay && view.replay.entryCount > 0 ? view : false;
        },
        { timeoutMs: 60_000, intervalMs: 400 }
      );
      must(
        '回放 60s：当日回放条读到了今天的条目（读 service 的只读 REST）',
        hud.replay.entryCount > 0,
        `条目 ${hud.replay.entryCount} 条 / 文案「${hud.replay.count ?? ''}」`
      );

      // C5：点「▶ 60 秒看完今天」→ 节拍开跑。
      const played = await evalOrError(
        session,
        `(() => {
          const el = document.querySelector('strat-day-replay');
          if (!el || !el.shadowRoot) return { error: 'no-replay' };
          const button = el.shadowRoot.querySelector('[data-role="play"]');
          if (!button) return { error: 'no-play-button' };
          if (button.disabled) return { error: 'play-disabled' };
          button.click();
          return { ok: true, text: button.textContent };
        })()`
      );
      if (played?.error) throw new Error(`点播放按钮失败：${played.error}`);
      // 边播边采：节拍与播放态要**同时**抓到（播完就停，只看末态会误判）。
      let sawPlaying = false;
      let beats = [];
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const [probe, current] = await Promise.all([readProbe(session), readHud(session)]);
        if (current.replay?.playing === true) sawPlaying = true;
        beats = probe.beats ?? [];
        // why 要等到「完成」那一拍：头两拍是 reset + spawn，还没演到完成 ——
        //   看见两拍就收手，会把「还没演到」误判成「今天没有完成事件」。
        if (beats.length >= 2 && beats.some((beat) => beat.kind === 'done')) break;
        await sleep(120);
      }
      log(
        `回放段：角标与节拍 — ${JSON.stringify(
          await evalOrError(
            session,
            `(() => {
              const clock = document.querySelector('strat-replay-clock');
              return {
                clockFound: Boolean(clock),
                clockAt: clock ? clock.currentAt : null,
                clockText:
                  clock && clock.shadowRoot
                    ? (clock.shadowRoot.querySelector('[data-role="time"]') || {}).textContent ?? null
                    : null,
              };
            })()`
          )
        )}`
      );
      must(
        '回放 60s：节拍经 world 通道发出（replay.beat 事件）',
        beats.length >= 2,
        `节拍 ${beats.length} 个：${beats.map((beat) => beat.kind).join(',')}`
      );
      must(
        '回放 60s：节拍里有「完成」那一拍（done）',
        beats.some((beat) => beat.kind === 'done'),
        `节拍种类：${[...new Set(beats.map((beat) => beat.kind))].join(',')}`
      );
      must('回放 60s：控制器进入播放态', sawPlaying, `playing=${sawPlaying}`);
      const hudPlaying = await readHud(session);
      must(
        '回放 60s：左上角时间戳角标出现（可见且带时刻）',
        hudPlaying.replayClock !== null &&
          hudPlaying.replayClock.visible === true &&
          hudPlaying.replayClock.currentAt !== null,
        `currentAt=${hudPlaying.replayClock?.currentAt ?? 'null'} / 文案「${hudPlaying.replayClock?.time ?? ''}」`
      );
      must(
        '回放 60s：回放条目进了跑马灯（观众看得出这是回放）',
        hudPlaying.marquee !== null && hudPlaying.marquee.entries.length >= 1,
        `跑马灯条目 ${hudPlaying.marquee?.entries.length ?? 0} 条`
      );
    } finally {
      session.close();
      await killTree(electron.pid, { label: 'electron#C' });
    }
  } finally {
    observer.close();
    await killTree(service.pid, { label: 'service' });
  }
}

// ============================================================================
// 剧本主体
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  const keepTmp = argv.includes('--keep');
  const tmpDirs = [];

  log('开始：演示链全流程（fake CLI 模式，确定性）');
  log(
    `端口：vite=${VITE_PORT} cdp(dev/local/remote)=${CDP_DEV}/${CDP_LOCAL}/${CDP_REMOTE} service=${SERVICE_PORT}`
  );
  log(`本次跑的段：${PHASES.join(' / ')}`);

  for (const port of [VITE_PORT, CDP_DEV, CDP_LOCAL, CDP_REMOTE, SERVICE_PORT, SERVICE_WS_PORT]) {
    if (RESERVED_PORTS.has(port)) {
      throw new Error(`拒绝使用用户实例占用的端口：${port}`);
    }
    if (!(await portFree(port))) {
      throw new Error(`端口 ${port} 被占用（换端口或先收掉占用者）`);
    }
  }
  log('前置检查通过：备用端口空闲，未触碰 7523 / 7524 / 9222');

  const fakeBinDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-demo-bin-'));
  tmpDirs.push(fakeBinDir);
  await installFakeClaude(fakeBinDir);
  log(`假 claude 已装到 ${fakeBinDir}（PATH 替身：只替最末端那一跳）`);

  try {
    // 自己的 vite dev server（备用端口）—— 三段共用一个（两个入口页都归它供）。
    const vite = launch(
      'vite',
      bin('vite'),
      ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
      { cwd: REPO }
    );
    const viteUrl = `http://127.0.0.1:${VITE_PORT}`;
    await waitFor(
      'vite dev server 就绪',
      async () => {
        try {
          const response = await fetch(`${viteUrl}/${ENTRY_HTML}`, { method: 'HEAD' });
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    log(`vite 就绪：${viteUrl}`);

    await ensureFreshElectronBuild();

    if (PHASES.includes('A')) await phaseDevAcceptance({ viteUrl, tmpDirs });
    if (PHASES.includes('B')) await phaseLocalProduction({ viteUrl, tmpDirs, fakeBinDir });
    if (PHASES.includes('C')) await phaseRemoteReplay({ viteUrl, tmpDirs });

    await killTree(vite.pid, { label: 'vite' });
    const leftovers = liveSpawned();
    must(
      '剧本拉起的进程全部收干净（无孤儿）',
      leftovers.length === 0,
      leftovers.map((record) => `${record.label}:${record.pid}`).join(', ') || '无残留'
    );
    log('收尾完成：只回收了本剧本拉起的 pid，用户实例未受影响');
  } finally {
    for (const record of liveSpawned()) {
      await killTree(record.pid, { label: record.label });
    }
    if (!keepTmp) {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      log(`--keep：临时目录保留在 ${tmpDirs.join(', ')}`);
    }
    printSummary(
      'PASS（演示链全流程：派活 → 框选 → 指令特效 → 干活 → 卡住 → 集火 → 插旗 → 区域点亮 → 里程碑 → 回放 60s）'
    );
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    // 失败时把各子进程的尾部日志打出来（否则只有一句断言失败，无法定位）。
    for (const record of spawnedRecords()) {
      if (!record.output.length) continue;
      console.error(`[e2e] ---- ${record.label}（pid=${record.pid}）日志尾部 ----`);
      for (const line of record.output.slice(-15)) console.error(`[${record.label}] ${line}`);
    }
    process.exitCode = 1;
  });
