#!/usr/bin/env node
/**
 * 最小碰撞断言脚本（@since v3.4，task_090；@since v3.4，task_093 加 Z3 hover / Z5 角标两条；
 *   @since v3.4，task_095 加「四角件成对零重叠矩阵」）：
 * HUD 控制岛（Z4）与两个下角件、以及左上角标（Z5）与顶栏（Z1）的版面关系。
 *
 * 断言口径（与 task_090 / task_093 / task_095 的验收标准逐条对应）：
 *   ① 控制岛高度 ≤ CONTROL_ISLAND_METRICS.maxHeightPx（100px），且**内容自适应**（不是写死的 34cqh）；
 *   ② 控制岛 ∩ 左下事件轨 = ∅，水平间距 ≥ 40px；
 *   ③ 控制岛 ∩ 右下小地图 = ∅，水平间距 ≥ 40px；
 *   ④ 720p 下中轴可用高度（视口高 − 顶栏高 − 控制岛高）≥ 视口高的 85%；
 *   ⑤ 小地图 hover 提亮（computed filter 的 brightness > 1）且声明了 filter 过渡；
 *   ⑥ 时间戳角标 ∩ 顶栏 = ∅（角标顶部 inset 56px > 顶栏 40px）；
 *   ⑦ **成对零重叠矩阵**（task_095）：顶栏 / 事件轨 / 小地图 / 控制岛 / 时间戳角标
 *      五个盒子两两之间包围盒交集面积恒为 0 —— 「四角碰撞复验」的总口径。
 *
 * why 跑真浏览器而不是 jsdom：jsdom 没有排版引擎，bounding box 全是 0 —— 碰撞与间距
 *   这类断言只能在真排版里量（本仓库的 e2e 也是这个口径）。
 *
 * 用法：
 *   node scripts/check-hud-island-layout.mjs [url]
 *   URL 默认取环境变量 HUD_URL，否则 http://127.0.0.1:7523/src/app/main/index.html
 *   （7523 是本仓 vite dev 的端口，见 vite.config.ts 的 server.port；实际端口以启动日志为准）。
 */

import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? process.env.HUD_URL ?? 'http://127.0.0.1:7523/src/app/main/index.html';

/** 断言阈值（与 core/theme/visual-spec.ts 的 CONTROL_ISLAND_METRICS 同一口径）。 */
const MAX_ISLAND_HEIGHT_PX = 100;
const MIN_CORNER_CLEARANCE_PX = 40;
const MIN_AXIS_RATIO = 0.85;

/** 参与测量的分辨率 —— 720p 是验收基准，1080p 是投影常见档，1024p 是窄屏下界。 */
const VIEWPORTS = [
  { width: 1280, height: 720, label: '1280×720 (720p)' },
  { width: 1920, height: 1080, label: '1920×1080 (1080p)' },
  { width: 1024, height: 768, label: '1024×768 (窄屏)' },
];

/** 两个盒子在水平方向上的间距（不重叠时为正数；重叠为负）。 */
function horizontalGap(a, b) {
  if (a.right <= b.left) return b.left - a.right;
  if (b.right <= a.left) return a.left - b.right;
  return -Math.min(a.right, b.right) + Math.max(a.left, b.left);
}

/** 两个盒子是否相交（面积 > 0 才算撞 —— 边缘擦过不算）。 */
function overlaps(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const box = (selector) => rect(document.querySelector(selector));
    /** 事件轨的实际占位 = 阴影里的条目栈 + 折叠按钮的并集（宿主本身是 inline 盒子，量不准）。 */
    const union = (nodes) => {
      const list = nodes.filter(Boolean).map(rect);
      if (list.length === 0) return null;
      return {
        left: Math.min(...list.map((b) => b.left)),
        top: Math.min(...list.map((b) => b.top)),
        right: Math.max(...list.map((b) => b.right)),
        bottom: Math.max(...list.map((b) => b.bottom)),
        width: 0,
        height: 0,
      };
    };
    const marqueeEl = document.querySelector('strat-marquee');
    const marqueeShadow = marqueeEl?.shadowRoot;
    const minimapEl = document.querySelector('strat-minimap');
    const minimapShadow = minimapEl?.shadowRoot;
    return {
      island: box('.hud-bottom-bar'),
      topbar: box('.hud-topbar'),
      marquee: union([
        marqueeShadow?.querySelector('.stack'),
        marqueeShadow?.querySelector('.toggle'),
      ]) ?? rect(marqueeEl),
      minimap: rect(minimapShadow?.querySelector('.frame')) ?? rect(minimapEl),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      /** 岛内两层的实际高度（回放条 / 命令条）—— 验证「内容自适应」而不是写死。 */
      layers: {
        replay: box('.hud-replay-slot'),
        command: box('.hud-bottom-bar > .hud-surface'),
      },
      /** 回放条确实在岛里（不是还在老底栏上）且组件已挂载。 */
      replayInIsland: !!document.querySelector('.hud-bottom-bar strat-day-replay'),
      replayMounted: !!document.querySelector('strat-day-replay')?.shadowRoot?.querySelector('[data-role="play"]'),
      /** 命令条里一屏能看到的命令数（Z4 规格「1 行 6 条」）。 */
      visibleCommands: [...(document.querySelector('strat-command-panel')?.shadowRoot?.querySelectorAll('button.command') ?? [])]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const s = document.querySelector('strat-command-panel')?.shadowRoot?.querySelector('.sections');
          if (!s) return false;
          const sr = s.getBoundingClientRect();
          return r.left >= sr.left - 0.5 && r.right <= sr.right + 0.5;
        }).length,
      /** 命令总数（一条不减：6 全局 + 6 选中组 = 12；有选中时才是 12）。 */
      totalCommands: document.querySelector('strat-command-panel')?.shadowRoot?.querySelectorAll('button.command').length ?? 0,
      /** 命令行是否可横向滚动（其余命令的收纳方式）。 */
      commandScrollable: (() => {
        const s = document.querySelector('strat-command-panel')?.shadowRoot?.querySelector('.sections');
        return s ? s.scrollWidth > s.clientWidth + 0.5 : false;
      })(),
      /** 小地图外框的 computed filter（hover 提亮用）+ 过渡声明。 */
      minimapFilter: (() => {
        const frame = document.querySelector('strat-minimap')?.shadowRoot?.querySelector('.frame');
        if (!frame) return null;
        const cs = getComputedStyle(frame);
        return { filter: cs.filter, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration };
      })(),
      /**
       * 时间戳角标（Z5）与顶栏（Z1）的盒子。
       * why 要「强制显示」：角标只在回放激活时可见（display:none → 量不到盒子），
       *   但「它出现时会压住顶栏吗」是版面问题 —— 强制点亮再量，才是这条规则的真面目。
       */
      clock: (() => {
        const badge = document.querySelector('strat-replay-clock')?.shadowRoot?.querySelector('[data-role="badge"]');
        if (!badge) return null;
        badge.dataset.on = '1';
        const r = badge.getBoundingClientRect();
        const t = document.querySelector('.hud-topbar')?.getBoundingClientRect();
        return {
          badge: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
          topbar: t ? { top: t.top, bottom: t.bottom, left: t.left, right: t.right } : null,
        };
      })(),
    };
  });
}

/** 从 computed filter 里读出 brightness 倍数（没写就是 1）。 */
function brightnessOf(filter) {
  const m = /brightness\(([\d.]+)\)/.exec(filter ?? '');
  return m ? Number.parseFloat(m[1]) : 1;
}

const failures = [];
const rows = [];
/** 成对零重叠矩阵的逐分辨率记录（打印用）。 */
const matrixRows = [];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  // 等 HUD 三件套就位（主屏 + 事件轨 + 小地图都是异步挂的）。
  await page.waitForSelector('.hud-bottom-bar', { timeout: 15000 });
  // 事件轨 / 小地图：只等「已挂载」（attached）—— 空轨道没有高度，等 visible 会超时。
  await page.waitForSelector('strat-marquee', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('strat-minimap', { state: 'attached', timeout: 15000 });
  // 给事件轨灌 5 条：空轨道没有高度，碰撞断言会测到「一个不存在的盒子」。
  // （只喂布局用的假条目 —— 本脚本只量版面，不碰业务态。）
  await page.evaluate(() => {
    const marquee = document.querySelector('strat-marquee');
    const at = Date.now();
    for (let i = 0; i < 5; i += 1) {
      marquee?.push({ kind: 'dispatch', icon: '📋', text: `布局碰撞实测条目 ${i + 1}`, at: at - i * 1000 });
    }
  });
  await page.waitForTimeout(600); // 让字体 / 布局稳定一帧

  const m = await measure(page);
  const check = (ok, msg) => {
    if (!ok) failures.push(`[${vp.label}] ${msg}`);
    return ok;
  };

  check(!!m.island && !!m.topbar && !!m.marquee && !!m.minimap, 'HUD 三件套（岛 / 顶栏 / 事件轨 / 小地图）没量到');
  if (!m.island || !m.topbar || !m.marquee || !m.minimap) {
    await context.close();
    continue;
  }

  // ① 岛高 ≤ 100px（内容自适应）
  check(m.island.height <= MAX_ISLAND_HEIGHT_PX + 0.5, `岛高 ${m.island.height.toFixed(1)}px > ${MAX_ISLAND_HEIGHT_PX}px`);
  // ② 与事件轨零重叠 + ≥40px
  const marqueeArea = overlaps(m.island, m.marquee);
  const marqueeGap = horizontalGap(m.island, m.marquee);
  check(marqueeArea === 0, `岛与事件轨重叠 ${marqueeArea.toFixed(0)}px²`);
  check(marqueeGap >= MIN_CORNER_CLEARANCE_PX, `岛与事件轨水平间距 ${marqueeGap.toFixed(1)}px < ${MIN_CORNER_CLEARANCE_PX}px`);
  // ③ 与小地图零重叠 + ≥40px
  const minimapArea = overlaps(m.island, m.minimap);
  const minimapGap = horizontalGap(m.island, m.minimap);
  check(minimapArea === 0, `岛与小地图重叠 ${minimapArea.toFixed(0)}px²`);
  check(minimapGap >= MIN_CORNER_CLEARANCE_PX, `岛与小地图水平间距 ${minimapGap.toFixed(1)}px < ${MIN_CORNER_CLEARANCE_PX}px`);
  // ④ 中轴可用高度 ≥ 85%
  const axis = m.viewport.height - m.topbar.height - m.island.height;
  const ratio = axis / m.viewport.height;
  check(ratio >= MIN_AXIS_RATIO, `中轴可用高度 ${axis.toFixed(1)}px（${(ratio * 100).toFixed(1)}%）< ${MIN_AXIS_RATIO * 100}%`);
  check(errors.length === 0, `页面报错：${errors.join(' | ')}`);
  // ⑤ 命令条：一条不减（无选中时 6 条全局命令），且命令流可横向滚动收纳其余命令。
  check(m.totalCommands >= 6, `命令条里只有 ${m.totalCommands} 条命令（至少要有 6 条全局命令）`);
  // ⑥ 回放条与命令条同岛：回放组件挂在控制岛里，且已 upgrade（功能不因改版而脱落）。
  check(m.replayInIsland, '回放条不在控制岛内（应与命令条同岛、上下分层）');
  check(m.replayMounted, '回放组件未挂载（▶ 60 秒看完今天 按钮缺失）');
  // 「1 行 6 条」只在岛拿到 56% 屏宽时成立 —— 窄屏下岛宽被「与角件 ≥40px 间距」钳到
  // 392px，一屏放不下 6 条是**预期**（其余靠横向滚动，不删命令）。
  const islandAtFullWidth = m.island.width >= m.viewport.width * 0.56 - 1;
  if (islandAtFullWidth) {
    check(m.visibleCommands === 6, `命令条一屏可见 ${m.visibleCommands} 条 ≠ 6 条`);
  } else {
    // 岛宽被「与角件 ≥40px 间距」钳窄时，一屏放不下 6 条是预期的 ——
    // 但放不下的那些必须**横向滚动可达**（不许消失）。
    check(m.visibleCommands <= 6, `命令条一屏可见 ${m.visibleCommands} 条 > 6 条`);
    if (m.totalCommands > m.visibleCommands) {
      check(m.commandScrollable, `岛宽被钳到 ${m.island.width.toFixed(0)}px，命令行却不可横向滚动`);
    }
  }

  // ⑦ 小地图 hover 提亮（@since v3.4，task_093）：静止时亮度 1，hover 后 > 1，且声明了 filter 过渡。
  const readFilter = () =>
    page.evaluate(() => {
      const frame = document.querySelector('strat-minimap')?.shadowRoot?.querySelector('.frame');
      if (!frame) return null;
      const cs = getComputedStyle(frame);
      return { filter: cs.filter, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration };
    });
  const restFilter = await readFilter();
  check(!!restFilter, '小地图外框没量到（hover 断言无从谈起）');
  if (restFilter) {
    check(String(restFilter.transitionProperty).includes('filter'),
      `小地图没声明 filter 过渡（transition-property=${restFilter.transitionProperty}）`);
    check(brightnessOf(restFilter.filter) === 1,
      `静止态小地图不该是提亮的（filter=${restFilter.filter}）`);
    await page.hover('strat-minimap .frame');
    await page.waitForTimeout(400); // 等过渡走完（180ms 过渡 + 余量）
    const hoverFilter = await readFilter();
    check(brightnessOf(hoverFilter?.filter) > 1,
      `hover 小地图没提亮（filter=${hoverFilter?.filter}）`);
    await page.mouse.move(0, 0); // 移开鼠标，回到静止态
  }
  // ⑧ 时间戳角标（Z5）不压顶栏（Z1）：角标盒子的上沿要在顶栏下沿之下。
  check(!!m.clock?.badge && !!m.clock?.topbar, '回放角标 / 顶栏没量到（角标断言无从谈起）');
  if (m.clock?.badge && m.clock?.topbar) {
    const clockArea = overlaps(m.clock.badge, m.clock.topbar);
    check(clockArea === 0, `角标与顶栏重叠 ${clockArea.toFixed(0)}px²`);
    check(m.clock.badge.top >= m.clock.topbar.bottom,
      `角标上沿 ${m.clock.badge.top.toFixed(1)}px 压在顶栏下沿 ${m.clock.topbar.bottom.toFixed(1)}px 之上`);
  }

  // ⑨ 成对零重叠矩阵（@since v3.4，task_095）：顶栏 / 事件轨 / 小地图 / 控制岛 / 角标
  //   五个盒子两两之间包围盒交集面积必须恒为 0 —— 「四角碰撞复验」的总口径。
  //   why 做成矩阵而不是逐条写死：新增一个边角件时，它与已有件的碰撞**自动**进网，
  //   不用记得补一条断言（漏一条 = 漏一个碰撞位）。
  const boxes = [
    ['顶栏', m.topbar],
    ['事件轨', m.marquee],
    ['小地图', m.minimap],
    ['控制岛', m.island],
    ['角标', m.clock?.badge ?? null],
  ].filter((entry) => Boolean(entry[1]));
  const matrix = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [nameA, boxA] = boxes[i];
      const [nameB, boxB] = boxes[j];
      const area = overlaps(boxA, boxB);
      check(area === 0, `${nameA} ∩ ${nameB} 重叠 ${area.toFixed(0)}px²（成对零重叠要求）`);
      matrix.push(`${nameA}×${nameB}=${area === 0 ? '∅' : `${area.toFixed(0)}px²`}`);
    }
  }
  matrixRows.push(`[${vp.label}] ${matrix.join(' ')}`);

  rows.push(
    [
      vp.label,
      `岛 ${m.island.width.toFixed(0)}×${m.island.height.toFixed(0)}`,
      `顶栏 ${m.topbar.height.toFixed(0)}`,
      `事件轨 x[${m.marquee.left.toFixed(0)},${m.marquee.right.toFixed(0)}] 间距 ${marqueeGap.toFixed(1)}`,
      `小地图 x[${m.minimap.left.toFixed(0)},${m.minimap.right.toFixed(0)}] 间距 ${minimapGap.toFixed(1)}`,
      `中轴 ${axis.toFixed(0)}px (${(ratio * 100).toFixed(1)}%)`,
      `回放层 ${m.layers.replay ? m.layers.replay.height.toFixed(0) : '?'} / 命令层 ${m.layers.command ? m.layers.command.height.toFixed(0) : '?'}`,
      `可见命令 ${m.visibleCommands} 条`,
      `角标 top ${m.clock?.badge ? m.clock.badge.top.toFixed(0) : '?'} / 顶栏底 ${m.clock?.topbar ? m.clock.topbar.bottom.toFixed(0) : '?'}`,
    ].join(' | ')
  );
  await context.close();
}
await browser.close();

console.log(`URL: ${URL}`);
console.log('分辨率 | 控制岛 | 顶栏 | 左下事件轨 | 右下小地图 | 中轴可用高度 | 岛内分层 | 命令条');
for (const r of rows) console.log(r);
console.log('');
console.log('成对零重叠矩阵（顶栏 / 事件轨 / 小地图 / 控制岛 / 角标）：');
for (const r of matrixRows) console.log(r);
console.log('');
if (failures.length > 0) {
  console.error(`✗ 碰撞断言失败（${failures.length} 条）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 碰撞断言全过：岛高 ≤${MAX_ISLAND_HEIGHT_PX}px、事件轨 / 小地图零重叠且间距 ≥${MIN_CORNER_CLEARANCE_PX}px、中轴可用高度 ≥${MIN_AXIS_RATIO * 100}%、小地图 hover 提亮有过滤渡、角标不压顶栏、五个盒子成对零重叠`);

