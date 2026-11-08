#!/usr/bin/env node
/**
 * 文件职责：**新建角色流程的真浏览器回归**（@since v3.3，task_228 · CC-03）。
 *
 * ============ 这单验什么 ============
 *   权威定义：docs/DESIGN-character-creation.md §4「验收矩阵 V1-V12」。
 *   组件级 jest 套件（src/app/__tests__/character-creation-regression-entry.test.ts +
 *   src/hud/__tests__/character-creation-regression-wizard.test.ts）已覆盖 V1-V12 全矩阵；
 *   本文件补**真浏览器那三条** —— 只有在真 DOM / 真 shadow DOM / 真事件链里才验得出来的三条：
 *
 *     - **V1** · 战场空态「新建角色」→ 向导必挂（真浏览器里点得到、真挂得上）；
 *     - **V3** · 角色中心空态 CTA「新建角色」→ 点它开向导（真浏览器里走的是「更多 → 看角色」那条真路）；
 *     - **V8** · 人设步点「用默认模板」→ 主按钮解锁（真向导里那一下真点击）。
 *
 *   为什么只这三条：矩阵里其余几条要么是纯屏内状态机（组件级 jest 更快更全），
 *   要么依赖组合根 / Electron（jest 里起不来，见 V11 的源码契约断言）。
 *
 * ============ 探针转正（②）============
 *   - `e2e-tests/lib/wizard-probe.mjs` —— `/tmp/cc-flow-probe3.mjs` 的仓内转正：
 *     `window.__wizClick` / `__wizDump` / `__wizFillName`（含 strat-button 的 shadow DOM 穿透）；
 *   - `e2e-tests/lib/shadow-dom.mjs` —— 通用深钻点击（点战场空态 / 顶栏菜单 / 角色中心 CTA）。
 *   两边都只点**内部那个真按钮**（真用户等价）—— 不穿透就"点不动"，很容易被误判成产品坏了。
 *
 * ============ 链路 ============
 *   真浏览器 + 真 vite dev server + 真 service（world-sync 真协议）+ 真 core 裁决。
 *   唯一替身：PATH 首位的**假 claude**（派单链末端那一跳，与 qa-full-flow 同款）——
 *   why 要它：探测要确定性（认得出「claude-code 已安装」）。
 *
 * ============ 已知缺口（**不在 V1-V12 矩阵内**，只记录不修）============
 *   浏览器（远程模式）下**首启自动弹向导**没出现过：service 的第一份快照在页面启动
 *   ~0.6s 就到了，而组合根的 `onState(...)` 订阅（src/app/main/main-entry.ts）在那之后才注册；
 *   远程模式又**不补发**首帧（POST_RENDER 的补发带 `if (!remote)` 守卫）⇒ 那一次广播被漏掉，
 *   service 侧此后无变更也就没有第二份快照 ⇒ 首启判定永远没机会跑。
 *   （本单不依赖这条路径：V1/V3 都走**用户主动**入口，入口走 `reopen({ force: true })` ⇒ 必挂。）
 *
 * ============ 端口 / 数据纪律 ============
 *   端口动态挑（7600-7699 / 7800-7899，**绝不**碰 7523 / 7524 / 7525 / 9222）；
 *   DATA_DIR / 沙盒根 / 副本 B 根全在 `os.tmpdir()` 下的临时目录 ⇒ **不碰用户的库**。
 *
 * 跑法：node e2e-tests/character-creation-flow.e2e.mjs
 * 退出码：0 = 三条断言全过；1 = 有断言失败或脚本报错。
 */

/* eslint-env browser */
// 页面内代码跑在浏览器里（page.evaluate 的回调体在页面上下文执行）⇒ 浏览器全局是合法的。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import {
  killTree,
  launch,
  log,
  must,
  portFree,
  printSummary,
  waitFor,
} from './lib/service-harness.mjs';
import { deepClick, deepFind } from './lib/shadow-dom.mjs';
import {
  installWizardProbe,
  wizardClick,
  wizardDump,
  wizardPresent,
  wizardSelectOnly,
} from './lib/wizard-probe.mjs';

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
/** 假 claude CLI（探测链末端那一跳的桩进程）。 */
const FAKE_CLAUDE_SRC = path.join(HERE, 'demo-flow', 'fake-claude.mjs');
/** 第二个副本的夹具（service 进程要求这个环境变量非空；本单不验副本，只借它的目录）。 */
const INSTANCE_B_FIXTURE = path.join(HERE, 'fixtures', 'm2-instance-b');

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

/** 页面侧的世界态快照（走组合根暴露的 dev 调试句柄 `window.__srfApp`）。 */
async function snapshot(page) {
  return page.evaluate(() => window.__srfApp?.snapshot?.() ?? null);
}

/**
 * 页面诊断快照（失败时打出来用）。
 * why 需要：这一单跨了「service → world-sync → 组合根 → HUD」四层，
 *   一旦"向导没挂上"，光看断言只知道结果、不知道现场 —— 诊断快照把现场留下。
 */
async function diagnose(page) {
  return page.evaluate(async () => {
    const state = window.__srfApp?.snapshot?.() ?? null;
    const host = document.querySelector('#onboarding-host');
    const bootError = document.querySelector('#boot-error');
    let shouldStart = null;
    try {
      // eslint-disable-next-line import/no-unresolved -- 运行时 URL（vite dev server 提供），不是仓内路径
      const trigger = await import('/src/app/main/onboarding-trigger.ts');
      shouldStart = trigger.shouldStartOnboarding({
        characters: state?.characters ?? [],
        detectedAgents: state?.detectedAgents ?? [],
      });
    } catch (error) {
      shouldStart = `probe-failed: ${String(error)}`;
    }
    return {
      hasOnboardingHost: Boolean(host),
      onboardingHostChildren: host ? host.children.length : -1,
      onboardingScreens: document.querySelectorAll('strat-onboarding-screen').length,
      characters: state?.characters?.length ?? null,
      shouldStart,
      stateBroadcasts: (window.__ccStates ?? []).slice(0, 12),
      detectedAgents:
        state?.detectedAgents?.map((agent) => `${agent.kind}:${agent.installed}:${agent.status}`) ?? [],
      bootError: bootError && !bootError.hasAttribute('hidden') ? bootError.textContent?.slice(0, 300) : '',
    };
  });
}

async function main() {
  const taken = new Set();
  const vitePort = await pickFreePort(VITE_PORT_RANGE, taken);
  taken.add(vitePort);
  const servicePort = await pickFreePort(SERVICE_PORT_RANGE, taken);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-cc-e2e-'));
  const sandboxRoot = path.join(workdir, 'sandbox');
  const instanceBRoot = path.join(workdir, 'instance-b');
  const dataDir = path.join(workdir, 'data');
  const fakeBin = path.join(workdir, 'bin');
  fs.mkdirSync(sandboxRoot, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.cpSync(INSTANCE_B_FIXTURE, instanceBRoot, { recursive: true });
  // 假 claude：真 spawn 一个子进程，但那个子进程不是真 claude（只替最末端那一跳）。
  const fakeClaude = path.join(fakeBin, 'claude');
  fs.copyFileSync(FAKE_CLAUDE_SRC, fakeClaude);
  fs.chmodSync(fakeClaude, 0o755);
  // 沙盒根**故意不铺名册** ⇒ 0 角色（V1 / V3 的前置：角色中心是空态）。
  log(`临时工作目录 ${workdir}（沙盒无名册 ⇒ 0 角色）`);

  let service = null;
  let vite = null;
  let browser = null;

  try {
    // ===== 起 service（自己的端口 + 临时 DATA_DIR + 临时实例根）=====
    service = launch('cc-service', TSX, ['--tsconfig', TSCONFIG, SERVICE_PROCESS], {
      cwd: sandboxRoot,
      env: {
        PORT: String(servicePort),
        WS_PORT: String(servicePort),
        DATA_DIR: dataDir,
        BIND_ADDRESS: '127.0.0.1',
        NOCO_ENABLED: 'false',
        SX_QA_PORT: String(servicePort),
        SX_QA_DATA_DIR: dataDir,
        SX_QA_SANDBOX_ROOT: sandboxRoot,
        SX_QA_INSTANCE_B_ROOT: instanceBRoot,
        // PATH 首位放假 claude ⇒ 探测器认得出「claude-code 已安装」。
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });
    await waitFor(
      'service 进程就绪',
      () => service.output.some((line) => line.includes('SX_QA_SERVICE_READY')),
      { timeoutMs: 90_000, intervalMs: 200 },
    );

    // ===== 起渲染层（自己的 vite；相对 URL 代理到自己的 service）=====
    vite = launch('cc-vite', TSX, ['--tsconfig', TSCONFIG, VITE_SERVER], {
      cwd: REPO,
      env: {
        SX_QA_VITE_PORT: String(vitePort),
        SX_QA_SERVICE_PORT: String(servicePort),
      },
    });
    await waitFor(
      'vite dev server 就绪',
      () => vite.output.some((line) => line.includes('SX_QA_VITE_READY')),
      { timeoutMs: 120_000, intervalMs: 250 },
    );

    // ===== 真浏览器 =====
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // 纯浏览器没有 preload ⇒ 注入最小 electronAPI stub（world-sync 地址）。
    await context.addInitScript((url) => {
      window.electronAPI = { env: { STRATIX_WORLD_SYNC_URL: url } };
      // 诊断：记录每一次 core 状态广播（首启判定跟着广播走 ⇒ 广播没来 = 向导不挂）。
      window.__ccStates = [];
      // eslint-disable-next-line import/no-unresolved -- 运行时 URL（vite dev server 提供），不是仓内路径
      import('/src/core/bus.ts')
        .then((mod) => {
          mod.onState((state) => {
            window.__ccStates.push({
              at: Math.round(performance.now()),
              characters: state?.characters?.length ?? null,
              detected: state?.detectedAgents?.length ?? null,
              installed: (state?.detectedAgents ?? []).filter((a) => a.installed).length,
            });
          });
        })
        .catch(() => undefined);
    }, `ws://127.0.0.1:${servicePort}/ws/world-sync`);
    // 探针装进上下文（向导专用）：window.__wizClick / __wizDump / __wizFillName。
    await installWizardProbe(context);

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${vitePort}/`, { waitUntil: 'domcontentloaded' });

    // ===== 前置：组合根就绪 + 探测器认出 claude-code + 0 角色 =====
    await waitFor(
      '组合根就绪（window.__srfApp）',
      async () => Boolean(await snapshot(page)),
      { timeoutMs: 60_000, intervalMs: 300 },
    );
    const detected = await waitFor(
      '探测器认出 claude-code 已安装（桩进程在 PATH 上）',
      async () => {
        const state = await snapshot(page);
        const claude = state?.detectedAgents?.find((agent) => agent.kind === 'claude-code');
        return claude && claude.installed ? claude : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 },
    ).catch(() => null);
    must('探测到 claude-code 已安装（首启向导的触发前提）', Boolean(detected), detected ? `status=${detected.status}` : '没探到');

    const before = await snapshot(page);
    must('前置：0 角色（V1 / V3 的空态前提）', (before?.characters ?? []).length === 0, `characters=${(before?.characters ?? []).length}`);

    // ========================================================================
    // V1 · 战场空态「新建角色」→ 向导必挂
    // ========================================================================
    // 先把可能挂着的首启向导收掉（0 角色 + 已装 agent ⇒ 首启判定可能挂上）——
    //   不收掉的话，下面"点 CTA 之后向导在"就成了一句废话（向导本来就在）。
    log(`页面诊断 ${JSON.stringify(await diagnose(page))}`);
    if (await wizardPresent(page)) {
      await wizardClick(page, 'skip');
      await waitFor('向导已收起（先把首启向导清干净）', async () => !(await wizardPresent(page)), {
        timeoutMs: 15_000,
        intervalMs: 200,
      });
    }

    const emptyVisible = await page.evaluate(() => {
      const node = document.querySelector('strat-battlefield-empty');
      return node ? node.hidden === false : null;
    });
    must('战场空态覆盖层亮着（0 单位）', emptyVisible === true, `可见=${String(emptyVisible)}`);

    const v1Click = await deepClick(page, ['strat-battlefield-empty', '[data-role="action-create"]']);
    must('V1 · 点战场空态「新建角色」', v1Click.status === 'clicked', JSON.stringify(v1Click));
    await waitFor('V1 · 向导挂上', async () => wizardPresent(page), {
      timeoutMs: 15_000,
      intervalMs: 200,
    });
    must('V1 · 战场空态 CTA 真的把向导挂上来了', await wizardPresent(page));

    // ========================================================================
    // V8 · 人设步「用默认模板」→ 主按钮解锁，可进确认步
    // ========================================================================
    // 就在 V1 挂上的这个向导里走（真向导、真点击）。
    // 只勾 claude-code：开发机上可能还装着别的 CLI ⇒ 勾选面收窄，断言才有判别力。
    must(
      '扫描步只勾 claude-code（收窄勾选面，断言才有判别力）',
      (await wizardSelectOnly(page, 'claude-code')) === 'selected:claude-code'
    );

    // 扫描步 → 起名步。
    must('扫描步主按钮可点', (await wizardClick(page, 'next')) === 'clicked:next');
    await waitFor('走到起名步', async () => (await wizardDump(page))?.step === 'identity', {
      timeoutMs: 15_000,
      intervalMs: 200,
    });
    // 起名步 → 人设步。
    must('起名步主按钮可点', (await wizardClick(page, 'next')) === 'clicked:next');
    await waitFor('走到人设步', async () => (await wizardDump(page))?.step === 'persona', {
      timeoutMs: 15_000,
      intervalMs: 200,
    });

    // 人设未配置 → 主按钮禁用 + 页脚说清还差几题（V7 的口径，V8 的前置）。
    const personaBefore = await wizardDump(page);
    const nextBefore = personaBefore?.actions?.find((item) => item.action === 'next');
    must(
      '人设未配置时主按钮是禁用的',
      nextBefore?.disabled === true,
      `next.disabled=${String(nextBefore?.disabled)}`
    );
    must(
      '禁用带原因（页脚说明还差几题）',
      typeof personaBefore?.footerReason === 'string' &&
        personaBefore.footerReason.includes('人设还没配好') &&
        /还差 \d+ 题/.test(personaBefore.footerReason),
      personaBefore?.footerReason ?? '(页脚原因为空)'
    );

    // 点「用默认模板」→ 解锁。
    must('点「用默认模板」', (await wizardClick(page, 'use-default-template')) === 'clicked:use-default-template');
    const personaAfter = await wizardDump(page);
    const nextAfter = personaAfter?.actions?.find((item) => item.action === 'next');
    must(
      'V8 · 「用默认模板」后主按钮解锁',
      nextAfter?.disabled === false,
      `next.disabled=${String(nextAfter?.disabled)}`
    );
    must(
      'V8 · 解锁后页脚原因撤掉（不再拦）',
      personaAfter?.footerReason === '',
      `footerReason=${JSON.stringify(personaAfter?.footerReason)}`
    );
    must(
      'V8 · 按钮换成状态说明（不给"再点一次没反应"的死按钮）',
      (personaAfter?.defaultTemplateState ?? '').includes('已用默认模板'),
      personaAfter?.defaultTemplateState ?? '(没有状态说明)'
    );

    // 能进确认步。
    must('解锁后「下一步」可点', (await wizardClick(page, 'next')) === 'clicked:next');
    await waitFor('V8 · 走到确认步', async () => (await wizardDump(page))?.step === 'confirm', {
      timeoutMs: 15_000,
      intervalMs: 200,
    });
    must('V8 · 人设步走到底能进确认步', (await wizardDump(page))?.step === 'confirm');

    // 收掉向导（走产品自己的「跳过引导」—— 不走后门）。
    await wizardClick(page, 'skip');
    await waitFor('向导已收起（准备走角色中心）', async () => !(await wizardPresent(page)), {
      timeoutMs: 15_000,
      intervalMs: 200,
    });

    // ========================================================================
    // V3 · 角色中心空态 CTA → 点它开向导
    // ========================================================================
    // 真路：顶栏「更多」菜单 → 「看角色」。
    const overflow = await deepClick(page, ['[data-role="overflow"]']);
    must('顶栏「更多」菜单可开', overflow.status === 'clicked', JSON.stringify(overflow));
    const goCharacter = await deepClick(page, ['[data-role="character"]']);
    must('进角色中心（点「看角色」）', goCharacter.status === 'clicked', JSON.stringify(goCharacter));
    await waitFor(
      '角色中心挂上',
      async () => (await deepFind(page, ['strat-character-screen'])).found,
      { timeoutMs: 15_000, intervalMs: 200 },
    );

    const ctaPath = [
      'strat-character-screen',
      'strat-empty-state[data-role="cards-empty"]',
      '[data-role="create-character-empty"]',
    ];
    const ctaFound = await deepFind(page, ctaPath);
    must('V3 · 角色中心空态带「新建角色」CTA', ctaFound.found, JSON.stringify(ctaFound));

    const v3Click = await deepClick(page, ctaPath);
    must('V3 · 点角色中心空态 CTA', v3Click.status === 'clicked', JSON.stringify(v3Click));
    await waitFor('V3 · 向导挂上', async () => wizardPresent(page), {
      timeoutMs: 15_000,
      intervalMs: 200,
    });
    must('V3 · 角色中心空态 CTA 真的把向导挂上来了', await wizardPresent(page));

    printSummary('PASS — V1 / V3 / V8 真浏览器回归全过');
  } finally {
    // 收干净：先浏览器，再 vite / service（killTree 收整棵进程树）。
    if (browser) await browser.close().catch(() => undefined);
    if (vite) await killTree(vite.pid, { label: 'cc-vite' }).catch(() => undefined);
    if (service) await killTree(service.pid, { label: 'cc-service' }).catch(() => undefined);
    if (!process.env.SX_CC_KEEP) fs.rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  printSummary('FAIL');
  process.stderr.write(
    `[cc-e2e] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
