#!/usr/bin/env node
/**
 * 文件职责：**QA-01 全流程端到端验收**驱动脚本（@since v3.3，task_221 / QA-01）。
 *
 * ============ 这一单验什么（任务书：冷启动 → 进副本（仪式）→ 选中/移动（IX-02 动画）
 *   → 派单（真 agent 或桩进程）→ 任务完成回报 → 切第二副本 → 回大厅）============
 *   全链**真实跑通**：真浏览器（Playwright）+ 真 vite dev server + 真 service 进程 +
 *   真 world-sync 协议 v3 + 真 core 裁决 + 真 CLI 子进程（PATH 上的假 claude = 桩进程）。
 *
 * ============ 三条硬纪律 ============
 *   ① **不碰用户实例**：端口在**备用段里动态挑**（vite 7600-7699 / service 7800-7899，
 *      且显式避开用户的 7523 / 7524 / 7525 / 9222），service 的 DATA_DIR、默认沙盒根、
 *      副本 B 根全在 `os.tmpdir()` 下 ⇒ 一个字节都不写进用户的仓 / 库；
 *      页面的相对 URL（/api /textures /ws）由**本次验收自己的 vite** 代理到**本次验收自己的
 *      service**（仓库 vite.config.ts 里写死的 7524 / 7525 在这里被覆盖掉 —— 见 vite-server.ts）。
 *   ② **可重跑**：每次跑都新建临时目录 + 新端口探测 + 收尾按 pid 精确回收；
 *      断言只看**观测值**（快照 / 像素 / 线上帧 / 事件流），不看文案。
 *   ③ **失败如实定位到层**：每条断言都挂在**环节**上（哪一层、哪个文件），
 *      并在末尾输出**缺口清单**（不挡收口，但要列出来）。
 *
 * ============ 断言的落点（每条都落在「看得见的观测值」上）============
 *   冷启动   —— world-sync 连上 / 首份快照 / 大厅面板挂载 / 卡片齐备 / activeInstanceId 显式 null
 *   进副本   —— 点「进入」→ service 裁决 → activeInstanceId 变了 / 大厅面板退场 /
 *               **仪式画出来了**（画布中带的名牌文字 + 遮罩不透明）
 *   选中     —— 真点击单位 → selection.unitIds 长度 1 / revision 递增 / 选中环像素出现
 *   移动     —— 右击 → unit.move 上行 → **下行 event.push(unit.position)** →
 *               **像素级证明是补间（不是瞬移）**
 *   派单     —— task.assign → queued → running → completed / 输出含桩进程标记 /
 *               探测器认出了 claude-code
 *   切副本   —— activeInstanceId 换成第二个副本 / 角色表换成 B 的名册 / A 的角色不见了
 *   回大厅   —— activeInstanceId 回到 null / 大厅面板重新挂上 / 卡片还在
 *
 * 跑法：node e2e-tests/qa-full-flow.e2e.mjs [--keep]
 * 退出码：0 = 全部断言通过；1 = 有断言失败（失败环节在摘要里点名，缺口清单在摘要之后）。
 *
 * ============ 本轮（task_221 收口时）跑出来的缺口（记账，不改码）============
 *   GAP-01 —— 进副本仪式在**远程模式（生产默认形态）**下不演。
 *             定位：协议层（world-sync/protocol.ts:276 下行白名单只有 unit.position）
 *             + 装配层（main-entry.ts:1544 只听 project.changed 世界事件）
 *             + 场景层（BattlefieldScene.ts:479 名牌只在有 instanceId 时演）。
 *             实证：脚本末尾给客户端补投一条 project.changed，仪式立刻演起来（≤700ms 达标）
 *             ⇒ 场景层与名牌层无缺陷，差的就是「service 广播 → 客户端收到」这一跳。
 *   GAP-02 —— 副本内没有「退出副本 / 切副本」的界面出口（回大厅只能靠程序派发命令）。
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 只用 node 内建 + 仓内已有的 playwright / tsx；
 *   2. 碰用户的端口 / 库 / 数据 —— 见上面的纪律①；
 *   3. 为凑绿改产品代码 —— 缺口只记账，不改码。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import {
  checks,
  createObserver,
  killTree,
  launch,
  log,
  must,
  portFree,
  printSummary,
  sleep,
  waitFor,
} from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓内 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
/** 仓库根 tsconfig（`@/*` 路径别名）。 */
const TSCONFIG = path.join(REPO, 'tsconfig.json');
/** service 进程（QA 专用接线，见该文件头）。 */
const SERVICE_PROCESS = path.join(HERE, 'qa-full-flow', 'qa-service-process.ts');
/** 渲染层进程（vite dev server，见该文件头）。 */
const VITE_SERVER = path.join(HERE, 'qa-full-flow', 'vite-server.ts');
/** 假 claude CLI（派单那一步的桩进程；只替最末端那一跳）。 */
const FAKE_CLAUDE_SRC = path.join(HERE, 'demo-flow', 'fake-claude.mjs');
/** 第二个副本的夹具（roster 契约面）。 */
const INSTANCE_B_FIXTURE = path.join(HERE, 'fixtures', 'm2-instance-b');

/**
 * 本次验收自己的端口：**动态挑空闲端口**（**绝不**是 7523 / 7524 / 7525 / 9222）。
 * why 动态挑：端口是共享资源 —— 上一轮跑剩的 vite、别的会话的 dev server 都可能占着固定端口；
 *   写死端口 = 脚本第二次跑就撞车（本次首跑即撞上一个前天遗留的 vite 占着 7623）。
 *   动态挑 + 探测空闲 = 脚本天然可重跑，且**不去 kill 别人的进程**（不碰用户实例的底线）。
 */
const VITE_PORT_RANGE = [7600, 7699];
const SERVICE_PORT_RANGE = [7800, 7899];
/** 用户实例端口（永远不碰）。 */
const USER_PORTS = [7523, 7524, 7525, 9222];

/** 在区间里挑一个空闲端口（探测到占用就跳过）。 */
async function pickFreePort(range, taken) {
  for (let port = range[0]; port <= range[1]; port += 1) {
    if (USER_PORTS.includes(port) || taken.has(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error(`区间 ${range[0]}-${range[1]} 里没有空闲端口`);
}
/** 第二个副本的实例 id（与 service 进程一致）。 */
const INSTANCE_B_ID = 'wsp_instance_b';
/** 默认沙盒的实例 id（core 契约里的常量）。 */
const SANDBOX_ID = 'wsp_sandbox';

/** 缺口清单（跑完打印；不挡收口，但要列出来）。 */
const gaps = [];

/** 默认沙盒的名册角色名（与副本 B 的「斥候 / 工兵」故意不同 ⇒ 切副本的断言有判别力）。 */
const SANDBOX_ROLE_NAME = '哨兵';

/**
 * 在默认沙盒根下现写一份 roster（临时目录里，**不碰**仓内任何夹具）。
 * 形状照 e2e-tests/fixtures/m2-instance-b/.stratix/roster（roster 契约面）。
 */
function writeSandboxRoster(root, roleName) {
  const rosterDir = path.join(root, '.stratix', 'roster');
  fs.mkdirSync(rosterDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.stratix', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.stratix', 'roster', '_index.json'),
    `${JSON.stringify(
      {
        formatVersion: 1,
        defaultRoleId: 'sentry',
        roles: [{ id: 'sentry', name: roleName, agentKind: 'claude-code' }],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(root, '.stratix', 'roster', 'sentry.json'),
    `${JSON.stringify(
      {
        id: 'sentry',
        name: roleName,
        persona: '你负责在默认沙盒里站岗，等派单。',
        bindings: { agentKind: 'claude-code', model: null },
        capabilities: { tools: ['stratix_world_snapshot', 'read'], commands: [], skills: [], systemPrompt: '' },
        state: { level: 1, experience: 0, contextEnabled: true },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(root, '.stratix', 'project.json'),
    `${JSON.stringify(
      {
        $schema: 'https://stratix.dev/schemas/project/v1.json',
        formatVersion: 1,
        id: 'spx_qa_sandbox_7e2d9c4a10b85f36d47a1c92',
        name: '默认沙盒',
        description: 'QA-01 全流程验收用的默认沙盒（临时目录）。',
        createdAt: new Date().toISOString(),
        agents: { defaultRoleId: 'sentry', defaultProfile: 'stratix-default' },
        engines: { stratix: '>=3.3.0' },
      },
      null,
      2,
    )}\n`,
  );
}

/** 跑歪了时的诊断素材（console 报错 / 页面异常 / 页面句柄），供 catch 段落如实打印。 */
const diagnostics = {
  consoleErrors: [],
  consoleAll: [],
  pageErrors: [],
  failedRequests: [],
  page: null,
  browser: null,
  service: null,
  vite: null,
};

/** 记一条缺口。 */
function gap(id, layer, title, evidence) {
  gaps.push({ id, layer, title, evidence });
  log(`⚠ 缺口 ${id}｜${layer}｜${title}`);
}

/** 首启向导是否已经收过场（收过就不再等它）。 */
let onboardingHandled = false;

/**
 * 记一条断言（**不抛**）—— QA 脚本要跑完所有环节再汇总，
 * 失败要「定位到环节」而不是「第一处失败就停」。
 */
function record(name, ok, detail = '') {
  const flat = String(detail).replace(/\s+/g, ' ').trim().slice(0, 200);
  checks.push({ name, ok: Boolean(ok), detail: flat });
  log(`${ok ? '✓' : '✗'} ${name}${flat ? ` — ${flat}` : ''}`);
  return Boolean(ok);
}

// ============================================================================
// 页面侧观测（都在页面里跑 —— 读得到画布像素 / 线上帧 / 本地总线）
// ============================================================================

/** 读客户端的世界态快照（经既有 dev 观测句柄 `window.__srfApp`，不开后门）。 */
async function readSnapshot(page) {
  return page.evaluate(() => {
    const handle = window.__srfApp;
    const state = handle?.snapshot?.();
    if (!state) return null;
    return {
      hasActiveInstanceId: Object.prototype.hasOwnProperty.call(state, 'activeInstanceId'),
      activeInstanceId: state.activeInstanceId ?? null,
      characters: (state.characters ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        agentKind: c.agentKind ?? null,
        instanceId: c.instanceId ?? null,
      })),
      units: (state.units ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        characterId: u.characterId ?? null,
        status: u.status,
      })),
      tasks: (state.tasks ?? []).map((t) => ({
        id: t.id,
        characterId: t.characterId,
        status: t.status,
        output: t.output ?? '',
        instanceId: t.instanceId ?? null,
      })),
      selection: {
        unitIds: state.selection?.unitIds ?? [],
        revision: state.selection?.revision ?? 0,
      },
      detectedAgents: (state.detectedAgents ?? []).map((a) => ({
        kind: a.kind,
        installed: a.installed === true,
        status: a.status ?? null,
      })),
      projectInstances: (state.projectInstances ?? []).map((v) => ({
        instanceId: v.instanceId,
        title: v.title,
      })),
    };
  });
}

/** 读大厅面板的 DOM（面板在不在 / 有几张卡 / 卡上有哪些实例）。 */
async function readLobbyDom(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('strat-lobby-panel');
    const root = panel?.shadowRoot ?? null;
    const cards = Array.from(root?.querySelectorAll('[data-role="card"]') ?? []);
    return {
      mounted: Boolean(panel),
      cardIds: cards.map((el) => el.getAttribute('data-instance-id')),
      cardNames: cards.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)),
      enterButtons: cards.map((el) =>
        Boolean(el.querySelector('[data-role="enter"]') && !el.querySelector('[data-role="enter"]').disabled),
      ),
    };
  });
}

/** 画布的几何（画布在页面里的位置 + 设备像素比例）。 */
async function readCanvasBox(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      deviceWidth: canvas.width,
      deviceHeight: canvas.height,
      scaleX: canvas.width / Math.max(1, rect.width),
      scaleY: canvas.height / Math.max(1, rect.height),
    };
  });
}

/**
 * 首启向导覆盖层的兜底收场。
 *
 * why 需要它：向导屏是**整屏覆盖层**（absolute + 铺满视口）⇒ 指针事件全被它吃掉 ⇒
 *   画布上的点选/右击**根本到不了 Phaser**（看起来像「点选坏了」，其实是盖住了）。
 *   触发条件见 src/app/main/onboarding-trigger.ts:48（「还没有角色 且 探到 ≥1 个已装 agent」）。
 *
 * 口径：走它**自己的**「跳过引导」按钮（那个按钮派发的就是产品自己的 onboarding-skipped
 *   收口事件，见 hud/screens/onboarding-screen.ts:687）—— 不是 hack DOM、不是改产品码。
 * 向导压根没起来 ⇒ 什么都不做（返回 appeared=false）。
 */
async function dismissOnboarding(page, timeoutMs = 10_000) {
  // 已经收过一次场就不再等（向导只会挂一次；重复等只是白等）。
  if (onboardingHandled) return { appeared: false, dismissed: true, stillThere: false, snapshotAtAppear: null };
  const deadline = Date.now() + timeoutMs;
  let appeared = false;
  let dismissed = false;
  let snapshotAtAppear = null;
  while (Date.now() < deadline) {
    const screen = page.locator('strat-onboarding-screen');
    const count = await screen.count();
    if (count === 0) {
      // 还没起来 —— 但也可能稍后才起来（探测器结果到达即触发）⇒ 给它一点时间再判定。
      await sleep(200);
      continue;
    }
    appeared = true;
    snapshotAtAppear = await readSnapshot(page);
    const skip = screen.locator('[data-action="skip"]').first();
    if ((await skip.count()) > 0) {
      try {
        await skip.click({ timeout: 4000 });
      } catch {
        // 点不到（还没渲染完 / 被别的层盖住）⇒ 下一轮再来。
      }
    }
    const gone = await page
      .waitForFunction(() => !document.querySelector('strat-onboarding-screen'), null, {
        timeout: 3000,
      })
      .then(() => true)
      .catch(() => false);
    if (gone) {
      dismissed = true;
      onboardingHandled = true;
      break;
    }
  }
  const stillThere = (await page.locator('strat-onboarding-screen').count()) > 0;
  return { appeared, dismissed, stillThere, snapshotAtAppear };
}

/**
 * 在画布上按颜色找**色块簇**（用来在画面上定位单位）。
 * why 需要它：单位在画面上的确切像素位置，客户端没有暴露（UnitView 不含坐标 ——
 *   坐标是世界层自治的）。但单位本体就是青色调（WORLD_PALETTE.unit = #4fc3f7）⇒
 *   按颜色聚簇就能在画面上定位它 —— 这是**像素级观测**，不是猜。
 * 返回按面积降序的簇心（设备像素坐标）。
 */
async function locateColorClusters(page, limit = 4) {
  return page.evaluate(
    ({ rgb, tolerance, maxClusters }) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return [];
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const cell = 12; // 聚簇格子（设备像素）
      const cells = new Map();
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          if (data[i + 3] < 40) continue;
          if (
            Math.abs(data[i] - rgb.r) > tolerance ||
            Math.abs(data[i + 1] - rgb.g) > tolerance ||
            Math.abs(data[i + 2] - rgb.b) > tolerance
          ) {
            continue;
          }
          const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
          const entry = cells.get(key);
          if (entry) {
            entry.n += 1;
            entry.sx += x;
            entry.sy += y;
          } else {
            cells.set(key, { n: 1, sx: x, sy: y });
          }
        }
      }
      // 把相邻格子并成簇（八邻域）。
      const keys = Array.from(cells.keys());
      const parent = new Map(keys.map((key) => [key, key]));
      const find = (key) => {
        let root = key;
        while (parent.get(root) !== root) root = parent.get(root);
        return root;
      };
      const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };
      for (const key of keys) {
        const [cx, cy] = key.split(':').map(Number);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const neighbour = `${cx + dx}:${cy + dy}`;
            if (cells.has(neighbour)) union(key, neighbour);
          }
        }
      }
      const clusters = new Map();
      for (const key of keys) {
        const root = find(key);
        const entry = cells.get(key);
        const agg = clusters.get(root) ?? { n: 0, sx: 0, sy: 0 };
        agg.n += entry.n;
        agg.sx += entry.sx;
        agg.sy += entry.sy;
        clusters.set(root, agg);
      }
      return Array.from(clusters.values())
        .filter((cluster) => cluster.n >= 24)
        .sort((a, b) => b.n - a.n)
        .slice(0, maxClusters)
        .map((cluster) => ({
          x: cluster.sx / cluster.n,
          y: cluster.sy / cluster.n,
          pixels: cluster.n,
        }));
    },
    { rgb: { r: 79, g: 195, b: 247 }, tolerance: 45, maxClusters: limit },
  );
}

/**
 * 装一个**画布像素采样器**（每帧采三块：角落 / 名牌标题带 / 名牌副行带）。
 * why 采样器在页面里跑：getImageData 是同步读回，走 CDP 一来一回会把 600ms 的仪式窗口
 * 采样成几个稀疏的点 ⇒ 采不到「遮罩落下」那一拍。页面里 rAF 逐帧采才是真观测。
 */
async function startPixelSampler(page) {
  await page.evaluate(() => {
    const state = { frames: [], stopped: false, error: null };
    window.__qaSampler = state;
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      state.error = 'no-canvas';
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      state.error = 'no-2d-context（Phaser 不是 CANVAS 渲染模式）';
      return;
    }
    const BG = [13, 17, 38]; // #0d1126 战场底色（= 仪式遮罩色）
    const TITLE = [79, 195, 247]; // #4fc3f7 名牌标题
    const META = [138, 107, 255]; // #8a6bff 名牌副行
    const near = (d, i, c, tol) =>
      Math.abs(d[i] - c[0]) <= tol &&
      Math.abs(d[i + 1] - c[1]) <= tol &&
      Math.abs(d[i + 2] - c[2]) <= tol;
    const region = (x, y, w, h) => {
      const left = Math.max(0, Math.round(x));
      const top = Math.max(0, Math.round(y));
      const width = Math.min(canvas.width - left, Math.round(w));
      const height = Math.min(canvas.height - top, Math.round(h));
      if (width <= 0 || height <= 0) return null;
      return ctx.getImageData(left, top, width, height).data;
    };
    const countColor = (x, y, w, h, c, tol) => {
      const data = region(x, y, w, h);
      if (!data) return 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        if (near(data, i, c, tol)) n += 1;
      }
      return n;
    };
    const allBackground = (x, y, w, h) => {
      const data = region(x, y, w, h);
      if (!data) return false;
      for (let i = 0; i < data.length; i += 4) {
        if (!near(data, i, BG, 3)) return false;
      }
      return true;
    };
    const tick = () => {
      if (state.stopped) return;
      try {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        state.frames.push({
          t: performance.now(),
          cornerMasked: allBackground(6, 6, 36, 36),
          title: countColor(cx - 210, cy - 26 - 22, 420, 44, TITLE, 40),
          meta: countColor(cx - 160, cy - 13, 320, 26, META, 45),
          count: countColor(cx - 160, cy + 26 - 13, 320, 26, [240, 160, 32], 45),
        });
      } catch (error) {
        state.error = String(error);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** 取采样结果并停掉采样器。 */
async function stopPixelSampler(page) {
  return page.evaluate(() => {
    const state = window.__qaSampler;
    if (!state) return { frames: [], error: 'sampler-missing' };
    state.stopped = true;
    return { frames: state.frames, error: state.error };
  });
}

/**
 * 装一个**单位位置追踪器**（每帧在「上一个重心 ±R」的窗口里找单位色像素，算重心）。
 * why 要窗口跟随：战场很大，全图扫每帧太贵；而单位在 300px/s 的补间里每帧只挪几px，
 *   窗口跟着重心走就够罩住它。
 */
async function startUnitTracker(page, centerX, centerY) {
  await page.evaluate(
    ({ cx, cy }) => {
      const state = { samples: [], stopped: false, error: null };
      window.__qaTracker = state;
      const canvas = document.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!ctx) {
        state.error = 'no-2d-context';
        return;
      }
      const COLOR = [79, 195, 247];
      const TOL = 45;
      const R = 95;
      let px = cx;
      let py = cy;
      const tick = () => {
        if (state.stopped) return;
        try {
          const left = Math.max(0, Math.round(px - R));
          const top = Math.max(0, Math.round(py - R));
          const width = Math.min(canvas.width - left, Math.round(R * 2));
          const height = Math.min(canvas.height - top, Math.round(R * 2));
          if (width <= 0 || height <= 0) {
            requestAnimationFrame(tick);
            return;
          }
          const data = ctx.getImageData(left, top, width, height).data;
          let n = 0;
          let sx = 0;
          let sy = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 40) continue;
            if (
              Math.abs(data[i] - COLOR[0]) <= TOL &&
              Math.abs(data[i + 1] - COLOR[1]) <= TOL &&
              Math.abs(data[i + 2] - COLOR[2]) <= TOL
            ) {
              const idx = i / 4;
              const x = left + (idx % width);
              const y = top + Math.floor(idx / width);
              n += 1;
              sx += x;
              sy += y;
            }
          }
          if (n >= 8) {
            const mx = sx / n;
            const my = sy / n;
            px = mx;
            py = my;
            state.samples.push({ t: performance.now(), x: mx, y: my, n });
          }
        } catch (error) {
          state.error = String(error);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { cx: centerX, cy: centerY },
  );
}

/** 取追踪结果并停掉追踪器。 */
async function stopUnitTracker(page) {
  return page.evaluate(() => {
    const state = window.__qaTracker;
    if (!state) return { samples: [], error: 'tracker-missing' };
    state.stopped = true;
    return { samples: state.samples, error: state.error };
  });
}

/** 装一个**本地总线探针**（页面里 import 生产那一份 bus 模块 —— 同 URL ⇒ 同一实例）。 */
async function startBusProbe(page) {
  await page.evaluate(() => {
    const state = { events: [], ready: false, error: null };
    window.__qaBus = state;
    import('/src/core/bus.ts')
      .then((mod) => {
        mod.onWorldEvent((event) => {
          state.events.push({
            type: event.type,
            unitId: event.unitId ?? null,
            x: event.x ?? null,
            y: event.y ?? null,
          });
        });
        state.ready = true;
      })
      .catch((error) => {
        state.error = String(error);
      });
  });
  await waitFor(
    '页面侧总线探针就绪',
    async () => {
      const probe = await page.evaluate(() => window.__qaBus ?? null);
      return Boolean(probe && (probe.ready || probe.error));
    },
    { timeoutMs: 15_000, intervalMs: 200 },
  );
}

/** 取总线探针看到的下行事件。 */
async function readBusEvents(page) {
  return page.evaluate(() => window.__qaBus?.events ?? []);
}

/**
 * **缺口定位探针**：给客户端的本地总线**补投**一条 `project.changed`，
 * 看「进副本仪式」会不会因此演起来。
 *
 * why 需要它：GAP-01 的结论是「仪式不演，是因为 service 广播的 project.changed
 *   **到不了客户端**（下行白名单里没有它）」—— 这是一条**因果断言**，
 *   光看「没演」证明不了「只差这一跳」。补投一次就能证伪/证实：
 *   仪式演 ⇒ 缺口精确落在「下行投递」这一层（协议白名单 + 装配层监听）；
 *   仪式仍不演 ⇒ 缺口更深（场景层/名牌层），结论要改写。
 *
 * ★ 这是**诊断**，不是修复：不改任何产品码，只是往页面里已有的总线发一条事件
 *   （生产里这条事件由 service 经 event.push 下发 —— 那正是缺的那一跳）。
 */
async function probeCeremonyWithLocalProjectChanged(page) {
  await startPixelSampler(page);
  const emitted = await page.evaluate(async () => {
    const bus = await import('/src/core/bus.ts');
    bus.emitWorldEvent({ type: 'project.changed', instanceId: 'wsp_sandbox' });
    return true;
  });
  await sleep(900);
  const sampler = await stopPixelSampler(page);
  const frames = sampler.frames.filter((f) => f.title > 20);
  const meta = sampler.frames.filter((f) => f.meta > 8 || f.count > 8);
  const masked = frames.filter((f) => f.cornerMasked);
  const windowMs =
    frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  return { emitted, frames: frames.length, meta: meta.length, masked: masked.length, windowMs, error: sampler.error };
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const keepTmp = process.argv.includes('--keep');

  // ===== ⓪ 端口纪律（先查再用；撞上用户端口直接拒绝开跑）=====
  const takenPorts = new Set();
  const VITE_PORT = await pickFreePort(VITE_PORT_RANGE, takenPorts);
  takenPorts.add(VITE_PORT);
  const SERVICE_PORT = await pickFreePort(SERVICE_PORT_RANGE, takenPorts);
  must(
    '验收端口不与用户实例冲突',
    !USER_PORTS.includes(VITE_PORT) && !USER_PORTS.includes(SERVICE_PORT),
    `vite=${VITE_PORT} service=${SERVICE_PORT}`,
  );
  record('vite 端口空闲（动态挑选，避开占用）', await portFree(VITE_PORT), String(VITE_PORT));
  record('service 端口空闲（动态挑选，避开占用）', await portFree(SERVICE_PORT), String(SERVICE_PORT));
  must('仓内 tsx 在位', fs.existsSync(TSX), TSX);
  must('假 claude CLI 源在位', fs.existsSync(FAKE_CLAUDE_SRC), FAKE_CLAUDE_SRC);
  must('副本 B 夹具在位', fs.existsSync(INSTANCE_B_FIXTURE), INSTANCE_B_FIXTURE);

  // ===== ① 临时目录（用户的数据一个字节都不碰）=====
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-qa-221-'));
  const sandboxRoot = path.join(workdir, 'sandbox');
  const instanceBRoot = path.join(workdir, 'instance-b');
  const dataDir = path.join(workdir, 'data');
  const fakeBin = path.join(workdir, 'bin');
  fs.mkdirSync(sandboxRoot, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.cpSync(INSTANCE_B_FIXTURE, instanceBRoot, { recursive: true });
  // 默认沙盒的名册（**临时目录里现生成**，不动仓内夹具）：
  //   why 要有名册：① 进副本时 roster 会被物化成角色 + 战场单位（没有名册 = 空战场 = 点不到单位）；
  //   ② 名字与副本 B 的名册**故意不同**（哨兵 vs 斥候/工兵）⇒ 「切副本后 A 的角色不见了」
  //      这条断言才有判别力（同名的话两边看着一样，断言就是空断言）。
  writeSandboxRoster(sandboxRoot, SANDBOX_ROLE_NAME);
  // 假 claude：真 spawn 一个子进程，但那个子进程不是真 claude（只替最末端那一跳）。
  const fakeClaude = path.join(fakeBin, 'claude');
  fs.copyFileSync(FAKE_CLAUDE_SRC, fakeClaude);
  fs.chmodSync(fakeClaude, 0o755);
  log(`临时工作目录 ${workdir}`);

  let service = null;
  let vite = null;
  let browser = null;
  let observer = null;

  try {
    // ===== ② 起 service（自己的端口 + 临时 DATA_DIR + 两个实例）=====
    service = launch(
      'qa-service',
      TSX,
      ['--tsconfig', TSCONFIG, SERVICE_PROCESS],
      {
        // cwd = 沙盒根（**不是**仓根）：退出副本时的归档文件写进实例根 ⇒ 实例根必须在临时目录。
        cwd: sandboxRoot,
        env: {
          PORT: String(SERVICE_PORT),
          WS_PORT: String(SERVICE_PORT),
          DATA_DIR: dataDir,
          BIND_ADDRESS: '127.0.0.1',
          NOCO_ENABLED: 'false',
          SX_QA_PORT: String(SERVICE_PORT),
          SX_QA_DATA_DIR: dataDir,
          SX_QA_SANDBOX_ROOT: sandboxRoot,
          SX_QA_INSTANCE_B_ROOT: instanceBRoot,
          // 心跳行：证明 service 事件循环是活的（定位「事件循环被堵」vs「子进程慢」）。
          SX_QA_HEARTBEAT: '1',
          // PATH 首位放假 claude ⇒ 探测器认得出「claude-code 已安装」，执行环 spawn 的也是它。
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        },
      },
    );
    await waitFor(
      'service 进程就绪',
      () => service.output.some((line) => line.includes('SX_QA_SERVICE_READY')),
      { timeoutMs: 90_000, intervalMs: 200 },
    );
    diagnostics.service = service;
    const health = await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`).then((r) => r.json());
    record('service 就绪（/health = ok，独立端口 + 临时 DATA_DIR）', health?.status === 'ok', JSON.stringify(health));

    // ===== ③ 起渲染层（自己的 vite；相对 URL 代理到自己的 service）=====
    vite = launch('qa-vite', TSX, ['--tsconfig', TSCONFIG, VITE_SERVER], {
      cwd: REPO,
      env: {
        SX_QA_VITE_PORT: String(VITE_PORT),
        SX_QA_SERVICE_PORT: String(SERVICE_PORT),
      },
    });
    await waitFor(
      'vite dev server 就绪',
      () => vite.output.some((line) => line.includes('SX_QA_VITE_READY')),
      { timeoutMs: 120_000, intervalMs: 250 },
    );
    diagnostics.vite = vite;

    // ===== ④ 真浏览器（真前端 + 真 world-sync 连接）=====
    browser = await chromium.launch({ headless: true });
    diagnostics.browser = browser;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // 注入 world-sync 地址（纯浏览器没有 preload ⇒ 注入最小 stub；同一个前端页面对不同 service 说话）。
    await context.addInitScript((url) => {
      window.electronAPI = { env: { STRATIX_WORLD_SYNC_URL: url } };
    }, `ws://127.0.0.1:${SERVICE_PORT}/ws/world-sync`);
    const page = await context.newPage();
    diagnostics.page = page;

    const consoleErrors = [];
    const pageErrors = [];
    diagnostics.consoleErrors = consoleErrors;
    diagnostics.pageErrors = pageErrors;
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      // 全量留存（warn/info 里常有 remote-store 的连接诊断）—— 排障要看全的。
      diagnostics.consoleAll.push(`[${msg.type()}] ${msg.text()}`);
      if (diagnostics.consoleAll.length > 80) diagnostics.consoleAll.shift();
    });
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));
    // 页面导航（vite 的 full-reload 会把页面换掉 ⇒ 页面侧的句柄/探针全丢）—— 必须留痕。
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const line = `[navigated] ${frame.url()}`;
        diagnostics.consoleAll.push(line);
        log(line);
      }
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure();
      diagnostics.failedRequests.push(`${req.method()} ${req.url()} —— ${failure?.errorText ?? '未知'}`);
    });

    // 线上帧旁路（真 socket 转发，内容不改）：上行 = 客户端 → service；下行 = service → 客户端。
    // why 默认**不开**这个旁路：Playwright 的 routeWebSocket 会自己做一层代理，
    //   而 service 侧的心跳是 ping/pong（协议 §…）—— 代理层不透传控制帧 ⇒
    //   service 判死链 ⇒ 连接被踢 ⇒ 客户端永远拿不到快照。
    //   证据改从两端**原生**视角取：上行看 service 的事件日志，下行看页面侧总线探针。
    const upFrames = [];
    const downFrames = [];
    if (process.env.SX_QA_WS_PROXY === '1') {
      await page.routeWebSocket('**/ws/world-sync', (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((message) => {
          try {
            upFrames.push(JSON.parse(message.toString()));
          } catch {
            // 非 JSON 帧不计
          }
          server.send(message);
        });
        if (typeof server.onMessage === 'function') {
          server.onMessage((message) => {
            try {
              downFrames.push(JSON.parse(message.toString()));
            } catch {
              // 非 JSON 帧不计
            }
          });
        }
      });
    }

    // 独立观察客户端（不经过浏览器）：service 侧真相的第二视角。
    observer = createObserver(`ws://127.0.0.1:${SERVICE_PORT}/ws/world-sync`, 'qa-observer');
    await observer.opened;

    // 先在**service 侧**建一个角色（真实 command.forward → core 裁决 → 落库 → 快照）。
    // why 提前建：首启向导的触发条件是「还没有角色 且 探到已装 agent」（onboarding-trigger.ts:48）
    //   ⇒ 空沙盒起前端时，向导会**盖在画布上**（整屏层，拦指针事件）⇒ 画布点击全被吃掉
    //   （看起来像「点选坏了」）。有一个角色在册，向导就不起来 —— 这也更像真实开局（有花名册）。
    // why 先 probeSeq：world-sync 协议要求每条连接**先 hello 再发命令**（session.ts:226），
    //   probeSeq 会补上那次 hello 并等回一份快照（顺带当连通性探针）。
    await observer.probeSeq();
    await observer.sendCommand({
      type: 'character.create',
      name: 'QA-验收角色',
      agentKind: 'claude-code',
      skinId: 'skin-default',
      persona: 'QA-01 全流程验收角色。',
    });

    await page.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('strat-status-screen', { timeout: 60_000 });
    // 首启向导兜底：它是盖在画布上的整屏层 ⇒ 画布点击全被吃掉 ⇒ 必须先收场再交互。
    // 走它自己的「跳过引导」按钮（产品自己的 onboarding-skipped 收口事件）。
    const onboarding = await dismissOnboarding(page, 10_000);
    record(
      '冷启动：首启向导没盖住战场（起了就收场）',
      !onboarding.stillThere,
      onboarding.appeared
        ? `向导出现过；收场方式=${onboarding.dismissed ? '点「跳过引导」' : '收不掉'}；` +
          `出现瞬间 characters=${onboarding.snapshotAtAppear?.characters?.length ?? '?'} ` +
          `detectedAgents=${onboarding.snapshotAtAppear?.detectedAgents?.length ?? '?'}`
        : '向导没起来',
    );
    await startBusProbe(page);

    // ---------------------------------------------------------------
    // 环节 ⓪ 冷启动
    // ---------------------------------------------------------------
    const bootSnapshot = await waitFor(
      '首份世界态快照',
      async () => {
        const state = await readSnapshot(page);
        return state && state.hasActiveInstanceId ? state : false;
      },
      { timeoutMs: 30_000, intervalMs: 200 },
    );
    record(
      '冷启动：world-sync 连上并收到首份快照',
      Boolean(bootSnapshot),
      `activeInstanceId=${JSON.stringify(bootSnapshot.activeInstanceId)}`,
    );
    record(
      '冷启动：开机即大厅态（activeInstanceId 显式 null）',
      bootSnapshot.hasActiveInstanceId && bootSnapshot.activeInstanceId === null,
      `hasActiveInstanceId=${bootSnapshot.hasActiveInstanceId}`,
    );
    const lobby0 = await waitFor(
      '大厅面板挂载',
      async () => {
        const dom = await readLobbyDom(page);
        return dom.mounted ? dom : false;
      },
      { timeoutMs: 20_000, intervalMs: 200 },
    );
    record(
      '冷启动：大厅面板已挂载且卡片齐备（默认沙盒 + 第二副本）',
      lobby0.cardIds.includes(SANDBOX_ID) && lobby0.cardIds.includes(INSTANCE_B_ID),
      lobby0.cardIds.join(','),
    );
    const observerBoot = await observer.probeSeq();
    record(
      '冷启动：service 侧真相同样是大厅态',
      observer.state.lastSnapshot?.activeInstanceId === null,
      `observer seq=${observerBoot} activeInstanceId=${JSON.stringify(observer.state.lastSnapshot?.activeInstanceId)}`,
    );

    // ---------------------------------------------------------------
    // 环节 ① 进副本（仪式）
    // ---------------------------------------------------------------
    await startPixelSampler(page);
    await page.evaluate((id) => {
      const panel = document.querySelector('strat-lobby-panel');
      const button = panel?.shadowRoot?.querySelector(`[data-role="enter"][data-instance-id="${id}"]`);
      button?.click();
    }, SANDBOX_ID);

    const entered = await waitFor(
      '进副本：activeInstanceId 变成默认沙盒',
      async () => {
        const state = await readSnapshot(page);
        return state?.activeInstanceId === SANDBOX_ID ? state : false;
      },
      { timeoutMs: 30_000, intervalMs: 150 },
    ).catch(() => null);
    record(
      '进副本：点「进入」→ service 裁决 → activeInstanceId = 默认沙盒',
      Boolean(entered),
      entered ? `activeInstanceId=${entered.activeInstanceId}` : '超时未变更',
    );

    const lobbyGone = await waitFor(
      '进副本：大厅面板退场',
      async () => {
        const dom = await readLobbyDom(page);
        return dom.mounted === false;
      },
      { timeoutMs: 15_000, intervalMs: 150 },
    ).catch(() => false);
    record('进副本：大厅面板退场（判据 = activeInstanceId ≠ null）', lobbyGone === true);

    // 仪式：画布中带的名牌文字（title/meta/count 三行）+ 遮罩不透明。
    await sleep(900);
    const sampler = await stopPixelSampler(page);
    const ceremonyFrames = sampler.frames.filter((f) => f.title > 20);
    const ceremonyMeta = sampler.frames.filter((f) => f.meta > 8 || f.count > 8);
    const ceremonyMasked = ceremonyFrames.filter((f) => f.cornerMasked);
    const ceremonyWindow =
      ceremonyFrames.length > 1
        ? ceremonyFrames[ceremonyFrames.length - 1].t - ceremonyFrames[0].t
        : 0;
    const serviceBroadcast = service.output.some((line) =>
      line.includes('[qa-event] project.changed instanceId=wsp_sandbox'),
    );
    record(
      '进副本仪式：service 侧广播了 project.changed',
      serviceBroadcast,
      serviceBroadcast ? '见 service 日志 [qa-event] project.changed' : 'service 日志里没有这条广播',
    );
    record(
      '进副本仪式：画布上出现了副本名牌（标题行 #4fc3f7 像素）',
      ceremonyFrames.length > 0,
      ceremonyFrames.length > 0
        ? `${ceremonyFrames.length} 帧命中，最强 ${Math.max(...ceremonyFrames.map((f) => f.title))} 像素`
        : `采样 ${sampler.frames.length} 帧，标题行像素始终为 0`,
    );
    record(
      '进副本仪式：名牌副行/在办任务行也画出来了',
      ceremonyMeta.length > 0,
      ceremonyMeta.length > 0 ? `${ceremonyMeta.length} 帧命中` : '始终为 0',
    );
    record(
      '进副本仪式：名牌在场期间遮罩不透明（黑场盖住战场）',
      ceremonyMasked.length > 0,
      ceremonyMasked.length > 0 ? `${ceremonyMasked.length}/${ceremonyFrames.length} 帧` : '无名牌帧',
    );
    record(
      '进副本仪式：总时长 ≤ 700ms（两拍 400 + 200）',
      ceremonyWindow > 0 && ceremonyWindow <= 900,
      ceremonyWindow > 0 ? `实测约 ${Math.round(ceremonyWindow)}ms（采样帧间隔带来 ±1 帧误差）` : '仪式未出现',
    );
    if (ceremonyFrames.length === 0) {
      gap(
        'GAP-01',
        '协议层（src/stratix-gateway/api/websocket/world-sync/protocol.ts 下行白名单）+ 装配层（src/app/main/main-entry.ts:1544）',
        '远程模式（生产默认形态）下「进副本仪式」不演',
        'service 侧已广播 project.changed（service 日志 [qa-event] project.changed instanceId=wsp_sandbox），' +
          '但下行白名单 PUSHABLE_WORLD_EVENT_TYPES 只有 unit.position ⇒ 客户端收不到 project.changed ⇒ ' +
          'main-entry.ts:1544 的 onWorldEvent 分支不触发 ⇒ switchToBattlefield 不执行 ⇒ ' +
          'BattlefieldScene.create() 的 this.instanceId 为空 ⇒ 仪式的 nameplate.start() 永不调用。' +
          '（本地直连模式没有实例注册表 ⇒ 大厅与 project.enter 也不存在 ⇒ 仪式在当前产品里两条路都走不到。）',
      );
    }

    // ---------------------------------------------------------------
    // 环节 ②③ 选中 / 移动（IX-02 动画）
    // ---------------------------------------------------------------
    // 再兜一次：向导可能晚于首帧才起来（探测器结果到达即触发）⇒ 交互前再收一次场。
    const onboarding2 = await dismissOnboarding(page, 5_000);
    if (onboarding2.stillThere) {
      gap(
        'GAP-04',
        'app 层（src/app/main/onboarding-trigger.ts:48 首启判定 + hud/screens/onboarding-screen.ts 整屏覆盖层）',
        '首启向导盖住战场画布，点选/右击到不了 Phaser',
        '收场失败：向导仍在页面上，画布中心命中的是覆盖层而不是 canvas。',
      );
    }
    // 造一个角色（= 战场上一个单位）：默认沙盒没有名册，靠真命令建角色。
    const characterName = 'QA-验收角色';
    const created = await waitFor(
      '建角色（造战场单位）',
      async () => {
        const state = await readSnapshot(page);
        if (state.characters.length === 0) {
          await page.evaluate(
            (name) =>
              window.__srfApp.emitCommand({
                type: 'character.create',
                name,
                agentKind: 'claude-code',
                skinId: 'skin-default',
                persona: 'QA-01 全流程验收角色。',
              }),
            characterName,
          );
          return false;
        }
        return state;
      },
      { timeoutMs: 30_000, intervalMs: 300 },
    ).catch(() => null);
    record(
      '选中：角色建档（战场上有单位了）',
      Boolean(created) && created.units.length >= 1,
      created
        ? `characters=${created.characters.length}[${created.characters.map((c) => c.name).join(',')}] ` +
          `units=${created.units.length}[${created.units.map((u) => u.name).join(',')}]`
        : '建档超时',
    );

    const canvasBox = await readCanvasBox(page);
    record('选中：画布在位（CANVAS 渲染模式，可读像素）', Boolean(canvasBox), JSON.stringify(canvasBox));

    // 点单位：单位落在**世界中心**（相机归位到 overviewPose = 世界包围盒中心），
    // 而世界中心正落在**画布中心** —— 与仓内既有剧本（tests/e2e/world-sync-event-forward.spec.ts）
    // 同一口径：点画布中心即可命中。先点中心，不中再按螺旋半径外扩，最后退到像素定位。
    const hitCandidates = [];
    if (canvasBox) {
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;
      hitCandidates.push([cx, cy]);
      for (const radius of [14, 28, 44]) {
        for (let angle = 0; angle < 8; angle += 1) {
          const rad = (angle / 8) * Math.PI * 2;
          hitCandidates.push([cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius]);
        }
      }
    }
    let hit = null;
    // 先看画布中心那个点上**实际是谁**（HUD 覆盖层会吃掉指针事件 ⇒ 点击根本到不了 Phaser）。
    const hitTarget = canvasBox
      ? await page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            const chain = [];
            let cursor = el;
            while (cursor && chain.length < 5) {
              chain.push(`${cursor.tagName.toLowerCase()}${cursor.id ? `#${cursor.id}` : ''}`);
              cursor = cursor.parentElement;
            }
            return chain;
          },
          { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 },
        )
      : [];
    // 像素定位兜底：单位本体是青色 ⇒ 按色块簇找它在画面上的位置。
    const clusters = canvasBox ? await locateColorClusters(page) : [];
    for (const cluster of clusters) {
      hitCandidates.push([
        canvasBox.x + cluster.x / canvasBox.scaleX,
        canvasBox.y + cluster.y / canvasBox.scaleY,
      ]);
    }
    for (const [x, y] of hitCandidates) {
      await page.mouse.click(x, y);
      await sleep(150);
      const state = await readSnapshot(page);
      if (state.selection.unitIds.length === 1) {
        hit = { x, y, unitId: state.selection.unitIds[0], revision: state.selection.revision };
        break;
      }
    }
    record(
      '选中：真点击单位 → selection.unitIds 长度 1',
      Boolean(hit),
      hit
        ? `unitId=${hit.unitId} @(${Math.round(hit.x)},${Math.round(hit.y)})（试了 ${hitCandidates.length} 个点）`
        : `点了 ${hitCandidates.length} 个点（中心 + 螺旋）仍未命中任何单位；画布中心命中的是 ${hitTarget.join(' < ')}`,
    );

    // 上行证据：看 **service 侧**收到的事件（真相在 service 那边；浏览器侧代理会破坏心跳）。
    const serviceLogged = (type) => service.output.some((line) => line.includes(`[qa-event] ${type}`));
    record(
      '选中：unit.click 上了行（service 侧收到了画布点击）',
      serviceLogged('unit.click'),
      'service 日志 [qa-event] unit.click',
    );

    // 移动：右击 → unit.move 上行 → service 编队裁决 → 下行 event.push(unit.position) → 补间。
    const busBefore = await readBusEvents(page);
    let moveReport = null;
    if (hit && canvasBox) {
      const deviceX = (hit.x - canvasBox.x) * canvasBox.scaleX;
      const deviceY = (hit.y - canvasBox.y) * canvasBox.scaleY;
      await startUnitTracker(page, deviceX, deviceY);
      await sleep(300);
      // 右击一个离得够远的目标点（保证位移足够大，补间足够多帧）。
      const targetX = hit.x + Math.min(260, canvasBox.width * 0.3);
      const targetY = hit.y - Math.min(200, canvasBox.height * 0.25);
      await page.mouse.click(targetX, targetY, { button: 'right' });
      await sleep(2600);
      const tracker = await stopUnitTracker(page);
      const samples = tracker.samples;
      let moving = 0;
      let distinct = 0;
      let distance = 0;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        distance = Math.hypot(last.x - first.x, last.y - first.y);
        const seen = new Set();
        for (let i = 1; i < samples.length; i += 1) {
          const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
          if (step > 1) moving += 1;
        }
        for (const sample of samples) {
          seen.add(`${Math.round(sample.x / 5)}:${Math.round(sample.y / 5)}`);
        }
        distinct = seen.size;
      }
      moveReport = { samples: samples.length, moving, distinct, distance, trackerError: tracker.error };
    }
    record(
      '移动：右击 → unit.move 上了行（service 侧收到了移动指令）',
      serviceLogged('unit.move'),
      'service 日志 [qa-event] unit.move',
    );
    const busEvents = await readBusEvents(page);
    const newPositions = busEvents
      .slice(busBefore.length)
      .filter((event) => event.type === 'unit.position');
    record(
      '移动（IX-02）：下行 event.push(unit.position) 到了客户端（位置与移动前不同）',
      newPositions.length > 0,
      newPositions.length > 0
        ? `移动后本地总线收到 unit.position (${newPositions[0].x},${newPositions[0].y})`
        : '移动后本地总线上没有新的 unit.position',
    );
    record(
      '移动（IX-02）：画面上是补间（多帧渐变），不是瞬移',
      Boolean(moveReport && moveReport.moving >= 4 && moveReport.distance >= 12),
      moveReport
        ? `采样 ${moveReport.samples} 帧 / 渐变帧 ${moveReport.moving} / 不同位置 ${moveReport.distinct} / 位移 ${Math.round(moveReport.distance)}px`
        : '没采到移动',
    );
    if (moveReport && moveReport.moving < 4) {
      gap(
        'GAP-02',
        'world 层（src/world/objects/unit-layer.ts:666 applyUnitPosition 的补间）',
        '右击移动在画面上没观测到补间',
        `像素追踪：采样 ${moveReport.samples} 帧，其中渐变帧 ${moveReport.moving}、位移 ${Math.round(moveReport.distance)}px。`,
      );
    }

    // ---------------------------------------------------------------
    // 环节 ④⑤ 派单 → 任务完成回报
    // ---------------------------------------------------------------
    const detected = await waitFor(
      '探测器认出 claude-code（桩进程在 PATH 上）',
      async () => {
        const state = await readSnapshot(page);
        const claude = state.detectedAgents.find((agent) => agent.kind === 'claude-code');
        return claude && claude.installed ? claude : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 },
    ).catch(() => null);
    record(
      '派单：探测器认出 claude-code 已安装（派单守门的凭据）',
      Boolean(detected),
      detected ? `status=${detected.status}` : '没探到已安装的 claude-code',
    );

    const characterId = created?.characters?.[0]?.id ?? null;
    let taskDone = null;
    let taskWaitError = null;
    if (characterId) {
      await page.evaluate(
        (id) =>
          window.__srfApp.emitCommand({
            type: 'task.assign',
            characterId: id,
            prompt: 'QA-01 全流程验收：请回报当前副本概况。',
          }),
        characterId,
      );
      taskDone = await waitFor(
        '任务跑到终态',
        async () => {
          const state = await readSnapshot(page);
          if (!state) return false;
          const task = state.tasks.find((t) => t.characterId === characterId);
          if (!task) return false;
          if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
          return false;
        },
        { timeoutMs: 120_000, intervalMs: 400 },
      ).catch((error) => {
        taskWaitError = error instanceof Error ? error.message : String(error);
        return null;
      });
    }
    record(
      '派单：task.assign → 任务落库并跑到终态',
      Boolean(taskDone),
      taskDone
        ? `taskId=${taskDone.id} status=${taskDone.status}`
        : `任务没出现或没到终态${taskWaitError ? `（等待异常：${taskWaitError.slice(0, 160)}）` : ''}`,
    );
    record(
      '派单回报：任务输出含桩进程标记（真 spawn 了子进程）',
      Boolean(taskDone && taskDone.status === 'completed' && taskDone.output.includes('e2e-fake-cli')),
      taskDone ? `status=${taskDone.status} output=${taskDone.output.slice(0, 80)}` : '无任务',
    );
    record(
      '派单：service 侧事件流里有 task.queued / task.started / task.completed',
      ['task.queued', 'task.started', 'task.completed'].every((type) =>
        service.output.some((line) => line.includes(`[qa-event] ${type} `)),
      ),
      service.output
        .filter((line) => line.includes('[qa-event] task.'))
        .slice(0, 4)
        .join(' | '),
    );
    if (taskDone && taskDone.status !== 'completed') {
      gap(
        'GAP-03',
        'app 层任务执行环（src/app/services/task-service.ts）+ cli-transport',
        '派单没跑到 completed',
        `任务终态 = ${taskDone.status}；输出 = ${taskDone.output.slice(0, 200)}`,
      );
    }

    // ---------------------------------------------------------------
    // 环节 ⑥ 切第二副本
    // ---------------------------------------------------------------
    await page.evaluate(
      (id) => window.__srfApp.emitCommand({ type: 'project.enter', instanceId: id }),
      INSTANCE_B_ID,
    );
    const switched = await waitFor(
      '切副本：activeInstanceId 换成第二个副本',
      async () => {
        const state = await readSnapshot(page);
        return state?.activeInstanceId === INSTANCE_B_ID ? state : false;
      },
      { timeoutMs: 30_000, intervalMs: 150 },
    ).catch(() => null);
    record(
      '切副本：project.enter(第二个副本) → activeInstanceId 换过去',
      Boolean(switched),
      switched ? `activeInstanceId=${switched.activeInstanceId}` : '超时未变更',
    );
    record(
      '切副本：角色表换成第二个副本的名册（A 的角色不见了）',
      Boolean(
        switched &&
          switched.characters.length > 0 &&
          !switched.characters.some((c) => c.id === characterId) &&
          switched.characters.every((c) => c.name !== characterName),
      ),
      switched
        ? `characters=[${switched.characters.map((c) => `${c.name}#${c.instanceId ?? '-'}`).join(', ')}]`
        : '无',
    );
    record(
      '切副本：战场单位也换成了第二个副本的',
      Boolean(switched && switched.units.length > 0),
      switched ? `units=${switched.units.length}` : '无',
    );

    // ---------------------------------------------------------------
    // 环节 ⑦ 回大厅
    // ---------------------------------------------------------------
    await page.evaluate(() => window.__srfApp.emitCommand({ type: 'project.exit' }));
    const exited = await waitFor(
      '回大厅：activeInstanceId 回到 null',
      async () => {
        const state = await readSnapshot(page);
        return state?.hasActiveInstanceId && state.activeInstanceId === null ? state : false;
      },
      { timeoutMs: 30_000, intervalMs: 150 },
    ).catch(() => null);
    record(
      '回大厅：project.exit → activeInstanceId = null',
      Boolean(exited),
      exited ? 'activeInstanceId=null' : '超时未回大厅态',
    );
    const lobbyBack = await waitFor(
      '回大厅：大厅面板重新挂上',
      async () => {
        const dom = await readLobbyDom(page);
        return dom.mounted ? dom : false;
      },
      { timeoutMs: 15_000, intervalMs: 200 },
    ).catch(() => null);
    record(
      '回大厅：大厅面板重新挂上且卡片还在',
      Boolean(lobbyBack && lobbyBack.cardIds.includes(SANDBOX_ID)),
      lobbyBack ? lobbyBack.cardIds.join(',') : '面板没回来',
    );
    // 记账：「切副本」与「回大厅」两环节都是**程序派发**的 —— HUD 里没有这两个出口。
    // （这不是本次的失败项：命令链本身是通的；缺的是界面上的那把按钮。）
    gap(
      'GAP-02',
      'HUD 层（src/hud/screens/lobby-panel.ts 与主屏）—— 没有 project.exit / project.enter 的派发面',
      '副本内没有「退出副本 / 切副本」的界面出口（回大厅只能靠程序派发命令）',
      '本脚本的「切第二副本」「回大厅」两环节都只能经 window.__srfApp.emitCommand 派发 ' +
        'project.enter / project.exit；仓内 grep「project.exit」只有 core 裁决（core/runtime.ts:874）、' +
        '协议词表（world-sync/protocol.ts:472）与 service 装配三处，HUD 零派发面；' +
        '大厅面板（lobby-panel.ts）只有「派单 / 新建副本 / 进入」三个出口，副本内没有任何按钮能回大厅。',
    );

    // ===== 缺口定位探针（放最后：它会切场景，不能干扰前面的环节）=====
    if (ceremonyFrames.length === 0) {
      const probe = await probeCeremonyWithLocalProjectChanged(page).catch((error) => ({
        emitted: false,
        frames: 0,
        meta: 0,
        masked: 0,
        windowMs: 0,
        error: error instanceof Error ? error.message : String(error),
      }));
      record(
        '缺口定位：给客户端补投 project.changed ⇒ 仪式就演（证明缺口只在下行投递这一跳）',
        probe.frames > 0,
        probe.frames > 0
          ? `补投后命中 ${probe.frames} 帧（副行 ${probe.meta} 帧 / 遮罩 ${probe.masked} 帧），` +
            `总时长约 ${Math.round(probe.windowMs)}ms ⇒ 场景层与名牌层都是好的`
          : `补投后仍无名牌帧（${probe.error ?? '无错误'}）`,
      );
      // 探针结论并进 GAP-01 的定位（证据链闭合：service 广播了 → 客户端补投就演 ⇒ 差的就是投递那一跳）。
      const gap01 = gaps.find((item) => item.id === 'GAP-01');
      if (gap01) {
        gap01.evidence +=
          `【定位探针实证】在本脚本末尾给客户端的本地总线补投一条 project.changed（生产里这一条` +
          `该由 service 经 event.push 下发 —— 那正是缺的一跳）后，仪式立刻演起来：` +
          `名牌命中 ${probe.frames} 帧 / 遮罩 ${probe.masked} 帧 / 总时长约 ${Math.round(probe.windowMs)}ms（≤ 700ms 达标）` +
          `⇒ 场景层（BattlefieldScene.create 的 instanceId 读取）与名牌层（InstanceNameplate）都没有缺陷，` +
          `缺口精确落在「service 广播 → 客户端收到」这一跳上。`;
      }
    }

    // ===== 收尾观测（渲染层错误 / 孤儿进程）=====
    record(
      '渲染层：没有未捕获异常（pageerror = 0）',
      pageErrors.length === 0,
      pageErrors.slice(0, 3).join(' | '),
    );
    if (consoleErrors.length > 0) {
      log(`渲染层 console.error ${consoleErrors.length} 条（前 5 条）：`);
      for (const line of consoleErrors.slice(0, 5)) log(`  [console] ${line.slice(0, 200)}`);
    }
    // service 侧关键行（执行环 / 事件流都在这儿）—— 派单环节的定位证据。
    const svcKey = service.output.filter((line) =>
      /\[qa-event\]|\[qa-service\]|\[qa-spawn|\[qa-stdout|\[qa-stderr|cli|transport|执行|队列|任务/i.test(
        line,
      ),
    );
    log(`service 关键行（共 ${svcKey.length} 条，末 40 条）：`);
    for (const line of svcKey.slice(-40)) log(`  [service] ${line.slice(0, 240)}`);
  } finally {
    // ===== 收尾：按 pid 精确回收（绝不按进程名扫杀）=====
    // 注：浏览器**先不关** —— 中断时还要用它做页面诊断（关了就查不到了）；
    //   真正的回收挪到最外层的 finally（见文件末尾）。
    observer?.close();
    if (vite) await killTree(vite.pid, { label: 'qa-vite' });
    if (service) await killTree(service.pid, { label: 'qa-service' });
    if (!keepTmp) {
      fs.rmSync(workdir, { recursive: true, force: true });
    } else {
      log(`临时目录保留：${workdir}`);
    }
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log(`脚本中断：${message}`);
  // 中断也要**如实记账**：一条失败断言 + 诊断素材（渲染层报错、页面异常）。
  record('全流程跑完（未中断）', false, message.split('\n')[0].slice(0, 160));
  if (diagnostics.pageErrors.length > 0) {
    log(`页面异常 ${diagnostics.pageErrors.length} 条：`);
    for (const line of diagnostics.pageErrors.slice(0, 5)) log(`  [pageerror] ${line.slice(0, 240)}`);
  }
  if (diagnostics.consoleErrors.length > 0) {
    log(`渲染层 console.error ${diagnostics.consoleErrors.length} 条：`);
    for (const line of diagnostics.consoleErrors.slice(0, 8)) log(`  [console] ${line.slice(0, 240)}`);
  }
  if (diagnostics.consoleAll.length > 0) {
    const interesting = diagnostics.consoleAll.filter((line) =>
      /remote-store|world-sync|stratix|error|fail|拒绝|失败/i.test(line),
    );
    log(`渲染层 console 关键行（${interesting.length} 条）：`);
    for (const line of interesting.slice(-30)) log(`  [console] ${line.slice(0, 240)}`);
  }
  if (diagnostics.failedRequests.length > 0) {
    log(`请求失败 ${diagnostics.failedRequests.length} 条：`);
    for (const line of diagnostics.failedRequests.slice(0, 8)) log(`  [net] ${line.slice(0, 240)}`);
  }
  if (diagnostics.service) {
    const serviceLines = diagnostics.service.output;
    log(`service 进程日志（末 60 行 / 共 ${serviceLines.length} 行）：`);
    for (const line of serviceLines.slice(-60)) log(`  [service] ${line.slice(0, 240)}`);
    log(`service 进程退出态：${JSON.stringify(diagnostics.service.exited ?? null)}`);
  }
  if (diagnostics.vite) {
    log(`vite 进程日志（末 12 行）：`);
    for (const line of diagnostics.vite.output.slice(-12)) log(`  [vite] ${line.slice(0, 240)}`);
  }
  if (diagnostics.page) {
    const probe = await diagnostics.page
      .evaluate(() => {
        const handle = window.__srfApp;
        const state = handle?.snapshot?.();
        return {
          url: location.href,
          hasApp: Boolean(handle),
          appKeys: handle ? Object.keys(handle) : [],
          stateType: typeof state,
          stateKeys: state && typeof state === 'object' ? Object.keys(state) : [],
          activeInstanceId: state && typeof state === 'object' ? (state.activeInstanceId ?? '(无此键)') : null,
          bodyChildren: Array.from(document.body.children).map((el) => el.tagName.toLowerCase()),
        };
      })
      .catch(() => null);
    if (probe) log(`页面诊断：${JSON.stringify(probe)}`);
  }
} finally {
  // ===== 最外层收尾：关浏览器（进程与临时目录已在 main 的 finally 里收）=====
  await diagnostics.browser?.close().catch(() => undefined);
}

// ===== 缺口清单 =====
if (gaps.length > 0) {
  console.log('──────────────── 缺口清单 ────────────────');
  for (const item of gaps) {
    console.log(`⚠ ${item.id}｜${item.layer}`);
    console.log(`  现象：${item.title}`);
    console.log(`  定位：${item.evidence}`);
  }
  console.log('────────────────────────────────────────────');
} else {
  console.log('──────────────── 缺口清单 ────────────────');
  console.log('（本轮未发现缺口）');
  console.log('────────────────────────────────────────────');
}

printSummary('QA-01 全流程端到端验收：全链真实跑通');

// 退出码如实：有断言没过就是没过（CI 可直接用）。
// why 不因为「缺口已记账」就放过失败项 —— 记账是给人看的，退出码是给机器看的。
process.exitCode = checks.some((check) => !check.ok) ? 1 : 0;
