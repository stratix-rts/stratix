#!/usr/bin/env node
/**
 * 文件职责：**PERF-01 冷启动到首帧的时间基线测量脚本**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 这一单量什么（三个维度，各跑 N 次取中位数）============
 *   ① **service 侧**：进程起 → `/health` 可应答，中间的分段耗时
 *      （node/tsx 启动 / git 分支探测 / SQLite 开库 / 实例注册表 / 组合根 / 端口 listen）。
 *   ② **渲染侧**（真浏览器 headless）：navigation start → FCP → 首屏（大厅面板挂载）
 *      → 战场 scene create 完成（vite 侧注入的 performance.mark）。
 *   ③ **端到端**：起 service → 起 vite → 页面可用（**点进沙盒**成功）总时长。
 *
 * ============ 三条硬纪律（与 QA harness 同款）============
 *   ① **不碰用户实例**：端口在**备用段里动态挑**（vite 7600-7699 / service 7800-7899，
 *      显式避开用户的 7523 / 7524 / 7525 / 9222），service 的 DATA_DIR 与沙盒根全在
 *      `os.tmpdir()` 下 ⇒ 一个字节都不写进用户的仓 / 库。
 *   ② **可重跑**：每次跑都新建临时目录 + 新端口探测 + 收尾按 pid 精确回收。
 *   ③ **只测量不优化**：本脚本不改任何产品码（场景 create 的打点是 vite 侧注入的，
 *      仓库里的 `src/**` 一个字节都没动）。
 *
 * 输入：命令行开关
 *   `--runs <n>`     跑几轮（缺省 3；基线口径 = 中位数）
 *   `--out <file>`   把原始 JSON 结果写到文件（缺省只打 stdout）
 *   `--keep`         保留临时目录（排障用）
 *   `--mode <m>`     `dev`（缺省，vite dev server）/ `prod`（vite preview 服务生产产物）
 *   `--build`        `prod` 模式下**先跑一次生产构建**（缺省不构建 ⇒ 产物目录须已存在）
 * 输出：stdout 的一段 markdown 表（三维数据 + 中位数）+ 一段 JSON（原始数据）。
 *   退出码：0 = 全程量完；1 = 中途失败（失败原因与已量到的数据照打）。
 *
 * 跑法：node e2e-tests/perf-baseline.e2e.mjs [--runs 3] [--out results.json] [--mode prod --build]
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 只用 node 内建 + 仓内已有的 playwright / tsx；
 *   2. 碰用户的端口 / 库 / 数据；
 *   3. 把测量结果**写进产品码**（本单的产物是 docs/PERF-baselines.md，不是优化）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { killTree, launch, log, portFree, sleep, waitFor } from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓内 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
/** 仓库根 tsconfig（`@/*` 路径别名）。 */
const TSCONFIG = path.join(REPO, 'tsconfig.json');
/** 被测的 service 进程（分段掐表版，见该文件头）。 */
const SERVICE_PROCESS = path.join(HERE, 'perf-baseline', 'perf-service-process.ts');
/** 被测的渲染层进程（dev：vite dev server + 场景 create 打点注入）。 */
const VITE_SERVER_DEV = path.join(HERE, 'perf-baseline', 'vite-server.ts');
/** 被测的渲染层进程（prod：vite preview 服务生产产物；打点已在构建期注入）。 */
const VITE_SERVER_PROD = path.join(HERE, 'perf-baseline', 'preview-server.ts');
/** 生产构建脚本（prod 模式用）。 */
const PERF_BUILD = path.join(HERE, 'perf-baseline', 'perf-build.ts');
/** 生产产物目录（相对仓库根）。 */
const PROD_OUT_DIR = 'dist/perf-frontend';

/** 端口段：**绝不**是 7523 / 7524 / 7525 / 9222（用户实例）。 */
const VITE_PORT_RANGE = [7600, 7699];
const SERVICE_PORT_RANGE = [7800, 7899];
const USER_PORTS = [7523, 7524, 7525, 9222];

/** 默认沙盒的实例 id（core 契约常量）。 */
const SANDBOX_ID = 'wsp_sandbox';
/** 第二个副本的实例 id（**带名册** ⇒ 进副本时会发生 roster 物化）。 */
const INSTANCE_B_ID = 'wsp_instance_b';

/** 在区间里挑一个空闲端口（探测到占用就跳过）。 */
async function pickFreePort(range, taken) {
  for (let port = range[0]; port <= range[1]; port += 1) {
    if (USER_PORTS.includes(port) || taken.has(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error(`区间 ${range[0]}-${range[1]} 里没有空闲端口`);
}

/**
 * 在临时目录里现写一份名册（roster 契约面：`.stratix/roster` + `.stratix/project.json`）。
 *
 * why 要有名册：**进副本时 roster 会被物化成角色 + 战场单位**
 *   （步 N6 物化，见 src/app/services/persistence/instance-loader-node.ts）——
 *   没有名册 ⇒ 空战场 ⇒ 「点进沙盒」这一段量到的只是空场景。
 */
function writeSandboxRoster(root) {
  const rosterDir = path.join(root, '.stratix', 'roster');
  fs.mkdirSync(rosterDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.stratix', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(rosterDir, '_index.json'),
    `${JSON.stringify(
      {
        formatVersion: 1,
        defaultRoleId: 'sentry',
        roles: [{ id: 'sentry', name: '哨兵', agentKind: 'claude-code' }],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(rosterDir, 'sentry.json'),
    `${JSON.stringify(
      {
        id: 'sentry',
        name: '哨兵',
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
        id: 'spx_perf_sandbox_7e2d9c4a10b85f36d47a1c92',
        name: '默认沙盒',
        description: 'PERF-01 冷启动基线用的默认沙盒（临时目录）。',
        createdAt: new Date().toISOString(),
        agents: { defaultRoleId: 'sentry', defaultProfile: 'stratix-default' },
        engines: { stratix: '>=3.3.0' },
      },
      null,
      2,
    )}\n`,
  );
}

/** 读一行 `SX_PERF_SERVICE_READY {json}` 里的 json。 */
function parseReadyLine(lines, marker) {
  const line = [...lines].reverse().find((item) => item.includes(marker));
  if (!line) return null;
  const json = line.slice(line.indexOf('{'));
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** 一轮测量（起 service → 起 vite → 真浏览器 → 点进沙盒 → 收尾）。 */
async function runOnce(index, { keepTmp, mode }) {
  const takenPorts = new Set();
  const vitePort = await pickFreePort(VITE_PORT_RANGE, takenPorts);
  takenPorts.add(vitePort);
  const servicePort = await pickFreePort(SERVICE_PORT_RANGE, takenPorts);
  if (USER_PORTS.includes(vitePort) || USER_PORTS.includes(servicePort)) {
    throw new Error('端口纪律破了：挑到了用户端口');
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-perf-230-'));
  const sandboxRoot = path.join(workdir, 'sandbox');
  const instanceBRoot = path.join(workdir, 'instance-b');
  const dataDir = path.join(workdir, 'data');
  fs.mkdirSync(sandboxRoot, { recursive: true });
  fs.mkdirSync(instanceBRoot, { recursive: true });
  writeSandboxRoster(sandboxRoot);
  // 第二个副本也放一份名册 ⇒ 进它的时候 roster 会被**物化**（默认沙盒不物化 —— 沙盒不误伤）。
  writeSandboxRoster(instanceBRoot);

  let service = null;
  let vite = null;
  let browser = null;

  const result = {
    run: index + 1,
    vitePort,
    servicePort,
    service: {},
    render: {},
    e2e: {},
  };

  try {
    // ===== ① service：进程起 → READY → /health ok =====
    const tSpawn = Date.now();
    service = launch(
      'perf-service',
      TSX,
      ['--tsconfig', TSCONFIG, SERVICE_PROCESS],
      {
        cwd: sandboxRoot,
        env: {
          PORT: String(servicePort),
          WS_PORT: String(servicePort),
          DATA_DIR: dataDir,
          BIND_ADDRESS: '127.0.0.1',
          NOCO_ENABLED: 'false',
          SX_PERF_PORT: String(servicePort),
          SX_PERF_DATA_DIR: dataDir,
          SX_PERF_SANDBOX_ROOT: sandboxRoot,
          SX_PERF_INSTANCE_B_ROOT: instanceBRoot,
        },
      },
    );

    // /health 轮询**与 READY 等待并行**（量的是「最早的应答」，不是「READY 之后的应答」）。
    const healthPromise = (async () => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${servicePort}/health`);
          if (response.ok) {
            const body = await response.json();
            if (body?.status === 'ok') return { t: Date.now(), body };
          }
        } catch {
          // 还没起来 —— 继续等
        }
        await sleep(20);
      }
      throw new Error('service /health 超时');
    })();

    await waitFor(
      'service READY',
      () => service.output.some((line) => line.includes('SX_PERF_SERVICE_READY')),
      { timeoutMs: 120_000, intervalMs: 100 },
    );
    const tReady = Date.now();
    const ready = parseReadyLine(service.output, 'SX_PERF_SERVICE_READY');
    const health = await healthPromise;
    const tHealthOk = health.t;

    result.service = {
      spawnToReadyMs: tReady - tSpawn,
      spawnToHealthOkMs: tHealthOk - tSpawn,
      stages: ready?.stages ?? {},
    };
    log(
      `  [run ${index + 1}] service：spawn→READY ${result.service.spawnToReadyMs}ms / ` +
        `spawn→/health ok ${result.service.spawnToHealthOkMs}ms / 分段 ${JSON.stringify(result.service.stages)}`,
    );

    // ===== ② 渲染层进程（dev = vite dev server / prod = vite preview）=====
    const tViteSpawn = Date.now();
    vite = launch(
      'perf-vite',
      TSX,
      ['--tsconfig', TSCONFIG, mode === 'prod' ? VITE_SERVER_PROD : VITE_SERVER_DEV],
      {
        cwd: REPO,
        env: {
          SX_PERF_VITE_PORT: String(vitePort),
          SX_PERF_SERVICE_PORT: String(servicePort),
          SX_PERF_OUT_DIR: PROD_OUT_DIR,
        },
      },
    );
    await waitFor(
      'vite READY',
      () => vite.output.some((line) => line.includes('SX_PERF_VITE_READY')),
      { timeoutMs: 180_000, intervalMs: 200 },
    );
    const tViteReady = Date.now();
    result.e2e.viteReadyMs = tViteReady - tViteSpawn;
    log(`  [run ${index + 1}] vite：起进程→READY ${result.e2e.viteReadyMs}ms`);

    // ===== ③ 真浏览器（渲染侧）=====
    browser = await chromium.launch({ headless: true });
    const tBrowserReady = Date.now();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // 注入 world-sync 地址（纯浏览器没有 preload ⇒ 注入最小 stub）。
    await context.addInitScript((url) => {
      window.electronAPI = { env: { STRATIX_WORLD_SYNC_URL: url } };
    }, `ws://127.0.0.1:${servicePort}/ws/world-sync`);
    // 注入 DOM 出现时刻的观测器（首屏 = 大厅面板挂载的时刻；页面时钟 ⇒ 与 FCP 同一把尺）。
    await context.addInitScript(() => {
      window.__perfDom = {};
      const watch = () => {
        for (const selector of ['strat-status-screen', 'strat-lobby-panel', 'canvas']) {
          if (window.__perfDom[selector] === undefined && document.querySelector(selector)) {
            window.__perfDom[selector] = performance.now();
          }
        }
      };
      const observer = new MutationObserver(watch);
      const start = () => {
        watch();
        observer.observe(document.documentElement, { childList: true, subtree: true });
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

    const tNav = Date.now();
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'domcontentloaded' });
    const tDomContentLoaded = Date.now();

    // 大厅面板挂载（= 首屏）+ 卡片齐备。
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('strat-lobby-panel');
        const root = panel?.shadowRoot ?? null;
        return Boolean(root?.querySelector('[data-role="card"]'));
      },
      null,
      { timeout: 90_000 },
    );
    const tLobby = Date.now();

    // 首启向导（整屏覆盖层）若起来了 ⇒ 先收场（它会吃掉指针事件 ⇒ 点不进沙盒）。
    const onboardingStart = Date.now();
    let onboardingAppeared = false;
    let onboardingDismissed = false;
    const screen = page.locator('strat-onboarding-screen');
    if ((await screen.count()) > 0) {
      onboardingAppeared = true;
      const skip = screen.locator('[data-action="skip"]').first();
      if ((await skip.count()) > 0) {
        await skip.click({ timeout: 5000 }).catch(() => undefined);
      }
      const gone = await page
        .waitForFunction(() => !document.querySelector('strat-onboarding-screen'), null, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      onboardingDismissed = gone;
    }
    const tOnboardingDone = Date.now();

    // 点「进入」→ service 裁决 → activeInstanceId = 默认沙盒。
    const tClick = Date.now();
    await page.evaluate((id) => {
      const panel = document.querySelector('strat-lobby-panel');
      const button = panel?.shadowRoot?.querySelector(`[data-role="enter"][data-instance-id="${id}"]`);
      button?.click();
    }, SANDBOX_ID);
    await page.waitForFunction(
      () => {
        const state = window.__srfApp?.snapshot?.();
        return state?.activeInstanceId === 'wsp_sandbox';
      },
      null,
      { timeout: 60_000 },
    );
    const tEntered = Date.now();

    // ===== ⓪ 副本切换（roster 物化发生在**进副本**链上，不在开机链上）=====
    // why 要单独量：roster 物化（契约 → 运行层）只在**非沙盒**副本上发生
    //   （沙盒不误伤，见 roster-materializer.ts）⇒ 只能进第二个副本才量得到。
    // why 放在端到端口径**之后**：端到端那一格的终点是「点进沙盒」⇒ 这一段不能污染它。
    const tExitClick = Date.now();
    await page.evaluate(() => window.__srfApp.emitCommand({ type: 'project.exit' }));
    await page
      .waitForFunction(
        () => {
          const state = window.__srfApp?.snapshot?.();
          return state?.activeInstanceId === null;
        },
        null,
        { timeout: 30_000 },
      )
      .catch(() => undefined);
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('strat-lobby-panel');
        const root = panel?.shadowRoot ?? null;
        return Boolean(root?.querySelector(`[data-role="enter"][data-instance-id="${'wsp_instance_b'}"]`));
      },
      null,
      { timeout: 30_000 },
    );
    const tBackToLobby = Date.now();
    const tBClick = Date.now();
    await page.evaluate((id) => {
      const panel = document.querySelector('strat-lobby-panel');
      const button = panel?.shadowRoot?.querySelector(`[data-role="enter"][data-instance-id="${id}"]`);
      button?.click();
    }, INSTANCE_B_ID);
    await page.waitForFunction(
      (id) => {
        const state = window.__srfApp?.snapshot?.();
        return state?.activeInstanceId === id;
      },
      INSTANCE_B_ID,
      { timeout: 60_000 },
    );
    const tBEntered = Date.now();

    // 页面内时间轴（页面时钟；与 navigation start 同一把尺）。
    const perf = await page.evaluate(() => {
      const collect = (type) =>
        performance.getEntriesByType(type).map((entry) => ({ name: entry.name, t: entry.startTime }));
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        marks: collect('mark'),
        paints: collect('paint'),
        dom: window.__perfDom ?? {},
        navigation: navigation
          ? {
              responseEnd: navigation.responseEnd,
              domContentLoaded: navigation.domContentLoadedEventStart,
              loadEventEnd: navigation.loadEventEnd,
            }
          : null,
      };
    });

    const markTimes = (name) => perf.marks.filter((mark) => mark.name === name).map((mark) => mark.t);
    const fcp = perf.paints.find((paint) => paint.name === 'first-contentful-paint');
    const sceneCreate = markTimes('srf:scene-create:battlefield');

    // service 侧的进副本时刻（墙钟；与上面的点击时刻同一把尺 ⇒ 可直接相减）。
    const changedEvents = service.output
      .filter((line) => line.includes('[perf-event] project.changed'))
      .map((line) => {
        const match = line.match(/t=(\d+)/);
        return match ? { line, t: Number(match[1]) } : null;
      })
      .filter(Boolean);
    const serviceChangedForSandbox = changedEvents.find((item) => item.line.includes(SANDBOX_ID));
    const serviceChangedForB = changedEvents.find((item) => item.line.includes(INSTANCE_B_ID));

    result.render = {
      fcpMs: fcp ? Math.round(fcp.t) : null,
      firstScreenMs: perf.dom['strat-lobby-panel'] != null ? Math.round(perf.dom['strat-lobby-panel']) : null,
      statusScreenMs:
        perf.dom['strat-status-screen'] != null ? Math.round(perf.dom['strat-status-screen']) : null,
      canvasMs: perf.dom['canvas'] != null ? Math.round(perf.dom['canvas']) : null,
      sceneCreateMarksMs: sceneCreate.map((t) => Math.round(t)),
      sceneCreateFirstMs: sceneCreate.length ? Math.round(sceneCreate[0]) : null,
      sceneCreateAfterEnterMs: sceneCreate.length > 1 ? Math.round(sceneCreate[sceneCreate.length - 1]) : null,
      lobbySceneCreateMs: markTimes('srf:scene-create:lobby').map((t) => Math.round(t)),
      fxSceneCreateMs: markTimes('srf:scene-create:fx-asset').map((t) => Math.round(t)),
      navigation: perf.navigation,
      pageErrors,
    };
    result.e2e = {
      ...result.e2e,
      navToLobbyMs: tLobby - tNav,
      domContentLoadedMs: tDomContentLoaded - tNav,
      onboardingAppeared,
      onboardingDismissed,
      onboardingMs: tOnboardingDone - onboardingStart,
      clickToEnteredMs: tEntered - tClick,
      totalMs: tEntered - tSpawn,
      spawnToHealthOkMs: tHealthOk - tSpawn,
      spawnToLobbyMs: tLobby - tSpawn,
      spawnToViteReadyMs: tViteReady - tSpawn,
      browserLaunchMs: tBrowserReady - tViteReady,
      viteReadyToEnteredMs: tEntered - tViteReady,
      navToEnteredMs: tEntered - tNav,
      // service 侧：点击 → core 裁决完（project.changed 广播）⇒ 含 roster 物化。
      serviceEnterSandboxMs: serviceChangedForSandbox ? serviceChangedForSandbox.t - tClick : null,
      // 进第二个副本（**带名册** ⇒ 这里真的发生了 roster 物化）。
      instanceBEnterRoundTripMs: tBEntered - tBClick,
      instanceBServiceMs: serviceChangedForB ? serviceChangedForB.t - tBClick : null,
      exitToLobbyMs: tBackToLobby - tExitClick,
    };
    log(
      `  [run ${index + 1}] 渲染侧：FCP ${result.render.fcpMs}ms / 首屏 ${result.render.firstScreenMs}ms / ` +
        `scene create ${JSON.stringify(result.render.sceneCreateMarksMs)}；` +
        `端到端：spawn→进沙盒 ${result.e2e.totalMs}ms；` +
        `进副本(含物化) ${result.e2e.instanceBEnterRoundTripMs}ms（service 侧 ${result.e2e.instanceBServiceMs}ms）`,
    );

    // ===== ⓪' 生产 gateway 对照组（同一个 tsx、同一台机器、独立的临时 DATA_DIR）=====
    // why 要这一组：本单量的 service 是**验收口径的最小复刻**（world-sync + /health + 组合根），
    //   生产 gateway（src/stratix-gateway/index.ts）还多挂 MCP / dataStore / OpenClaw / 状态同步
    //   ⇒ 两者的冷启动差距就是「那些额外子系统值多少钱」。
    // why 放在**最后**量：它会占掉几秒 ⇒ 放在中间会污染端到端那一格的口径。
    // 纪律：端口同样在备用段里动态挑（**WS_PORT 也必须挑** —— 缺省是用户的 7525！）。
    const gwPort = await pickFreePort(SERVICE_PORT_RANGE, takenPorts);
    takenPorts.add(gwPort);
    const gwWsPort = await pickFreePort(SERVICE_PORT_RANGE, takenPorts);
    takenPorts.add(gwWsPort);
    const gwDataDir = path.join(workdir, 'gw-data');
    const tGwSpawn = Date.now();
    const gateway = launch(
      'perf-gateway',
      TSX,
      ['--tsconfig', TSCONFIG, path.join(REPO, 'src', 'stratix-gateway', 'index.ts')],
      {
        cwd: REPO,
        env: {
          PORT: String(gwPort),
          WS_PORT: String(gwWsPort),
          DATA_DIR: gwDataDir,
          BIND_ADDRESS: '127.0.0.1',
          NOCO_ENABLED: 'false',
        },
      },
    );
    let gwHealthOkMs = null;
    const gwDeadline = Date.now() + 120_000;
    while (Date.now() < gwDeadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${gwPort}/health`);
        if (response.ok) {
          const body = await response.json();
          if (body?.status === 'ok') {
            gwHealthOkMs = Date.now() - tGwSpawn;
            break;
          }
        }
      } catch {
        // 还没起来 —— 继续等
      }
      await sleep(20);
    }
    await killTree(gateway.pid, { label: 'perf-gateway' });
    result.service.gatewaySpawnToHealthOkMs = gwHealthOkMs;
    log(`  [run ${index + 1}] 生产 gateway：spawn→/health ok ${gwHealthOkMs ?? '超时'}ms`);
    return result;
  } finally {
    await browser?.close().catch(() => undefined);
    if (vite) await killTree(vite.pid, { label: 'perf-vite' });
    if (service) await killTree(service.pid, { label: 'perf-service' });
    if (!keepTmp) {
      fs.rmSync(workdir, { recursive: true, force: true });
    } else {
      log(`临时目录保留：${workdir}`);
    }
  }
}

/** 中位数（奇偶都取中间两个的平均）。 */
function median(values) {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (list.length === 0) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2);
}

/** 取某个服务侧分段的中位数。 */
function stageMedian(runs, stage) {
  return median(runs.map((run) => run.service?.stages?.[stage]));
}

function fmt(value) {
  return value == null ? '—' : `${value}ms`;
}

/** 收集环境信息（写进基线文档的「环境」栏）。 */
function environment() {
  let head = 'unknown';
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    // 不是 git 仓就写 unknown
  }
  let cpu = 'unknown';
  try {
    cpu = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim();
  } catch {
    // 取不到就写 unknown
  }
  return {
    head,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    arch: process.arch,
    cpu,
    playwright: '1.58.2',
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const runsIndex = argv.indexOf('--runs');
  const outIndex = argv.indexOf('--out');
  const modeIndex = argv.indexOf('--mode');
  const keepTmp = argv.includes('--keep');
  const doBuild = argv.includes('--build');
  const runs = runsIndex >= 0 ? Number(argv[runsIndex + 1]) : 3;
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : 'dev';
  if (mode !== 'dev' && mode !== 'prod') {
    throw new Error(`--mode 只认 dev / prod（收到 ${mode}）`);
  }

  // ===== prod 模式：产物目录须存在（--build 则先构建一次）=====
  if (mode === 'prod') {
    const outDirAbs = path.join(REPO, PROD_OUT_DIR);
    if (doBuild) {
      log(`prod 模式：先构建生产产物（${PROD_OUT_DIR}）…`);
      const buildStarted = Date.now();
      execFileSync(TSX, ['--tsconfig', TSCONFIG, PERF_BUILD], {
        cwd: REPO,
        stdio: 'inherit',
        env: { ...process.env, SX_PERF_OUT_DIR: PROD_OUT_DIR },
      });
      log(`生产构建完成：${Date.now() - buildStarted}ms`);
    }
    if (!fs.existsSync(path.join(outDirAbs, 'index.html'))) {
      throw new Error(`prod 模式缺产物：${PROD_OUT_DIR}/index.html 不存在（先跑 --build）`);
    }
  }

  log(`PERF-01 冷启动基线：跑 ${runs} 轮（mode=${mode}，端口动态挑，临时 DATA_DIR）`);
  const collected = [];
  for (let index = 0; index < runs; index += 1) {
    log(`—— 第 ${index + 1}/${runs} 轮 ——`);
    collected.push(await runOnce(index, { keepTmp, mode }));
  }

  const env = environment();
  const stageNames = ['startup', 'branchProbe', 'dbInit', 'registry', 'bootService', 'listen', 'totalUptime'];
  const renderNames = [
    ['fcpMs', 'FCP（首次内容绘制）'],
    ['firstScreenMs', '首屏（大厅面板挂载）'],
    ['statusScreenMs', '主屏挂载'],
    ['canvasMs', '画布挂载'],
    ['sceneCreateFirstMs', '战场 scene create（开机那一次）'],
    ['sceneCreateAfterEnterMs', '战场 scene create（进沙盒那一次）'],
  ];

  console.log('\n────────── 冷启动基线（中位数） ──────────');
  console.log(
    `环境：HEAD=${env.head} node=${env.node} ${env.os}/${env.arch} cpu=${env.cpu} mode=${mode}`,
  );
  console.log('\n| 维度 | 分段 | 第1轮 | 第2轮 | 第3轮 | 中位数 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const push = (dimension, segment, values) => {
    const cells = values.map((value) => (value == null ? '—' : `${value}`)).join(' | ');
    console.log(`| ${dimension} | ${segment} | ${cells} | ${fmt(median(values))} |`);
  };
  push('service', 'spawn → /health ok（总）', collected.map((run) => run.service.spawnToHealthOkMs));
  push(
    'service',
    '生产 gateway（src/stratix-gateway/index.ts）spawn → /health ok',
    collected.map((run) => run.service.gatewaySpawnToHealthOkMs),
  );
  for (const stage of stageNames) {
    push('service', stage, collected.map((run) => run.service?.stages?.[stage]));
  }
  for (const [key, label] of renderNames) {
    push('渲染侧', label, collected.map((run) => run.render?.[key]));
  }
  push('端到端', 'spawn → 进沙盒成功（总，含浏览器起进程）', collected.map((run) => run.e2e.totalMs));
  push('端到端', 'spawn → vite READY', collected.map((run) => run.e2e.spawnToViteReadyMs));
  push('端到端', 'vite READY → 进沙盒成功（不含浏览器起进程）', collected.map((run) => run.e2e.viteReadyToEnteredMs));
  push('端到端', 'navigation → 进沙盒成功', collected.map((run) => run.e2e.navToEnteredMs));
  push('端到端', 'spawn → 大厅面板挂载', collected.map((run) => run.e2e.spawnToLobbyMs));
  push('端到端', '浏览器起进程（vite READY → 浏览器就绪）', collected.map((run) => run.e2e.browserLaunchMs));
  push('端到端', '点「进入」→ activeInstanceId 变更（沙盒）', collected.map((run) => run.e2e.clickToEnteredMs));
  push('端到端', '点「进入」→ 副本 B 生效（**含 roster 物化**）', collected.map((run) => run.e2e.instanceBEnterRoundTripMs));
  push('端到端', 'service 侧：点「进入」→ 裁决完（副本 B）', collected.map((run) => run.e2e.instanceBServiceMs));
  console.log('──────────────────────────────────────────\n');

  const payload = { env: { ...env, mode }, runs: collected };
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    log(`原始数据已写入 ${outPath}`);
  }
  log(`原始数据：${JSON.stringify(payload)}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log(`脚本中断：${message}`);
  process.exitCode = 1;
}
