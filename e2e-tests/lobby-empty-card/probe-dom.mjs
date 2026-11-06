/**
 * 探针：**渲染层 DOM 断言** —— 大厅卡片到底有没有画出来。
 *
 * 职责：渲染层 DOM 断言探针 —— 只回答「大厅卡片有没有画出来」：`strat-lobby-panel` 的
 *   shadow DOM 里有没有 `[data-role="card"]`、空态 `[data-role="empty"]` 有没有露脸；
 *   带 `--click` 时再点一次「进入」，验证卡片不是摆件。**只观测，不改任何状态**。
 *
 * why 需要 DOM 断言（而不是只看快照）：快照只证明「真相到位」，DOM 才证明**用户看得见**。
 *   组合根的判据是 `state.activeInstanceId === null` ⇒ 挂 `<strat-lobby-panel>`（src/app/main/main-entry.ts）。
 *   真相到位但判据不成立 ⇒ 面板不挂 ⇒ 大厅空卡（用户实机报的现象）。
 *
 * why 用 `addInitScript` 注入 world-sync 地址：渲染层的 world-sync 端点在 Electron 里来自
 *   preload 的 `window.electronAPI.env.STRATIX_WORLD_SYNC_URL`（src/app/main/dev-flags.ts）。
 *   纯浏览器没有 preload ⇒ 注入一个最小 stub ⇒ **同一个前端页面**可以对不同 service 说话
 *   ⇒ 「真相层」成为唯一变量（前 / 后端代码完全一致）。
 *
 * 用法：
 *   node e2e-tests/lobby-empty-card/probe-dom.mjs <worldSyncUrl> [appUrl] [waitMs] [--click]
 * 例：
 *   node e2e-tests/lobby-empty-card/probe-dom.mjs ws://127.0.0.1:7724/ws/world-sync
 *   node e2e-tests/lobby-empty-card/probe-dom.mjs ws://127.0.0.1:7726/ws/world-sync http://127.0.0.1:7523/ 12000 --click
 *
 * `--click` = 再点一次卡片上的「进入」按钮 ⇒ 断言面板**退场**（进副本 ⇒ 不再是大厅态）。
 *   这一步验证卡片不是摆件：点击真的把 `project.enter` 送到了 service 的 core 裁决。
 *
 * 输入：命令行参数与前置条件 —— 参数口径见上方『用法』段（`<worldSyncUrl>` / `[appUrl]` /
 *   `[waitMs]` / `[--click]`）；前置条件：appUrl 指的那份前端已在本机跑起来，且 world-sync
 *   服务在 worldSyncUrl 上可达（**探针自己不起任何服务**，只负责连与断言）。
 * 输出：stdout 一份『DOM 探针』报告（面板是否挂载 / 卡片数量与各卡的 instanceId / 卡片文本 /
 *   空态在场·hidden 属性·计算后 display / 页面正文前 400 字 / console.error 与未捕获异常各前 10 条 /
 *   --click 时的面板退场与 activeInstanceId），末行『结论：大厅有卡 ✅ / 大厅空卡 ❌』；
 *   退出码口径见下方『退出码』段。
 * 退出码：0 = 大厅有卡；1 = 大厅空卡（面板在场但没卡，或面板压根没挂）。
 * 禁止事项：
 *   1. 不许在探针里改 DOM / 改快照 / 点「进入」以外的任何交互 —— 本单的**唯一变量**是
 *      「真相层」；探针一旦自己动渲染层，「真相到位但没渲染」与「真相没到位」就再也分不开。
 *   2. 不许直接改 `window.__srfApp` 的快照值来「造一张卡」—— 快照是唯一事实源，
 *      探针自己造假 = 自己给自己发假绿。
 *   3. 不许把 waitMs 调成 0 或省略等待 —— 面板是异步挂上去的，没等到就判「空卡」= 假红。
 */
import { chromium } from 'playwright';

const worldSyncUrl = process.argv[2] ?? 'ws://127.0.0.1:7524/ws/world-sync';
const appUrl = process.argv[3] ?? 'http://127.0.0.1:7523/';
const args = process.argv.slice(4);
const waitMs = Number(args.find((a) => /^\d+$/.test(a)) ?? 12000);
const shouldClick = args.includes('--click');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript((url) => {
  window.electronAPI = { env: { STRATIX_WORLD_SYNC_URL: url } };
}, worldSyncUrl);
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));

await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

// 等大厅面板出现（最多 waitMs）—— 真相到位 + 判据成立 ⇒ 面板会被挂上。
let panelSeen = false;
const deadline = Date.now() + waitMs;
while (Date.now() < deadline) {
  panelSeen = await page.evaluate(() => Boolean(document.querySelector('strat-lobby-panel')));
  if (panelSeen) break;
  await page.waitForTimeout(250);
}

const dom = await page.evaluate(() => {
  const panel = document.querySelector('strat-lobby-panel');
  const root = panel?.shadowRoot ?? null;
  const cards = Array.from(root?.querySelectorAll('[data-role="card"]') ?? []);
  const empty = root?.querySelector('[data-role="empty"]') ?? null;
  return {
    panelMounted: Boolean(panel),
    cardCount: cards.length,
    cardInstanceIds: cards.map((el) => el.getAttribute('data-instance-id')),
    cardText: cards.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    emptyPresent: Boolean(empty),
    emptyHiddenAttr: empty?.hasAttribute('hidden') ?? null,
    // 关键：`.empty { display:flex }` 会盖掉 UA 的 `[hidden]{display:none}` ⇒ 有卡时空态也露脸。
    emptyComputedDisplay: empty ? getComputedStyle(empty).display : null,
    bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
  };
});

const emptyStateVisible = dom.emptyPresent && dom.emptyComputedDisplay !== 'none';
const hasCard = dom.cardCount > 0;

// 点「进入」：卡片必须真的把 project.enter 送到 service 的 core 裁决 ⇒ 面板退场。
let clickResult = null;
if (shouldClick && hasCard) {
  await page.evaluate(() => {
    const panel = document.querySelector('strat-lobby-panel');
    const btn = panel?.shadowRoot?.querySelector('[data-role="enter"]');
    btn?.click();
  });
  // 等 service 裁决 + 快照回推（面板退场）。
  const clickDeadline = Date.now() + 12000;
  let unmounted = false;
  while (Date.now() < clickDeadline) {
    unmounted = await page.evaluate(() => !document.querySelector('strat-lobby-panel'));
    if (unmounted) break;
    await page.waitForTimeout(250);
  }
  const activeId = await page.evaluate(() => window.__srfApp?.snapshot?.()?.activeInstanceId ?? null);
  clickResult = { panelUnmounted: unmounted, activeInstanceId: activeId };
}

console.log('================ DOM 探针 ================');
console.log('world-sync 端点 =', worldSyncUrl);
console.log('应用页面        =', appUrl);
console.log('--- 面板 ---');
console.log('面板已挂载      =', dom.panelMounted);
console.log('卡片数量        =', dom.cardCount, dom.cardInstanceIds);
console.log('卡片文本        =', JSON.stringify(dom.cardText, null, 2));
console.log('--- 空态 ---');
console.log('空态元素在场    =', dom.emptyPresent);
console.log('空态 hidden 属性=', dom.emptyHiddenAttr);
console.log('空态 计算后 display =', dom.emptyComputedDisplay);
console.log('空态**可见**    =', emptyStateVisible, emptyStateVisible ? '← 有卡却还在显示空态（自相矛盾）' : '');
console.log('--- 页面文本（前 400 字）---');
console.log(dom.bodyText);
console.log('--- 渲染层错误 ---');
console.log('console.error 数量 =', consoleErrors.length);
for (const line of consoleErrors.slice(0, 10)) console.log('  [console]', line.slice(0, 300));
console.log('未捕获异常数量      =', pageErrors.length);
for (const line of pageErrors.slice(0, 10)) console.log('  [pageerror]', line.slice(0, 300));
if (clickResult) {
  console.log('--- 点「进入」---');
  console.log('面板已退场（进副本）=', clickResult.panelUnmounted);
  console.log('activeInstanceId   =', JSON.stringify(clickResult.activeInstanceId));
}
console.log('==========================================');

const clickOk = !shouldClick || (clickResult?.panelUnmounted === true && clickResult?.activeInstanceId === 'wsp_sandbox');
const verdict = hasCard && !emptyStateVisible && clickOk ? '大厅有卡 ✅' : '大厅空卡 ❌';
console.log('结论：', verdict);

await browser.close();
process.exit(hasCard && !emptyStateVisible && clickOk ? 0 : 1);
