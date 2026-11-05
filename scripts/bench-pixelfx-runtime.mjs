#!/usr/bin/env node
/**
 * 文件职责：**pixelfx 代码路由的 CPU 成本基准**（@since v3.3，task_162）。
 *   测的就是 Stratix 运行时真正会走的那条链：
 *     fx.update(dt)        —— 120Hz 粒子步进（createFx 内部把 dt 拆成 120Hz 子步）
 *     fx.draw(frame)       —— Painter 逐像素写进两个 Uint32Array 缓冲
 *     composite(frame,out) —— 两个缓冲合成 RGBA（浏览器里紧跟着 putImageData）
 *   ★ 不测 GPU 上传与 Phaser 渲染：那部分由浏览器内基准（src/world/dev/fx-bench.html）测，
 *     本脚本只负责把「纯 JS 逐像素」这一段单独量出来 —— 两者相加才是真成本。
 *
 * 用法：
 *   node scripts/bench-pixelfx-runtime.mjs
 *   PIXELFX_DIR=/path/to/pixelfx node scripts/bench-pixelfx-runtime.mjs
 *
 * 禁止事项：
 *   1. 造 mock 数字 —— 本脚本只报实测值；
 *   2. 改 pixelfx 库 —— 只读它的公开 API；
 *   3. 把结果写进代码里的常量 —— 结论由 docs/research/pixelfx-runtime-poc.md 收口。
 */

import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PIXELFX_DIR = path.resolve(process.env.PIXELFX_DIR ?? path.join(ROOT, '..', 'pixelfx'));

/** 渲染帧率：Stratix 战场按 60fps 走（Phaser 默认 60）。 */
const FPS = 60;
/** 每种并发数跑多少帧（取样窗口；越长越稳，但别太长 —— 这是 CPU 密集型脚本）。 */
const FRAMES = 180;
/** 预热帧数（不计入统计）：JIT 还没热起来的前几帧不代表稳态。 */
const WARMUP = 30;
/** 并发档位：1 / 2 / 4 / 8 —— 4 = 一期 sheet 路由的并发上限（core SPRITE_FX_METRICS.maxConcurrent）。 */
const CONCURRENCY = [1, 2, 4, 8];

/** 被测效果（挑的都是**没有 actor 替身**的 —— 与一期选材同一条硬约束）。 */
const EFFECTS = [
  { id: 'impacts/hit-spark', label: 'hit-spark（136×80，方向性）' },
  { id: 'spawn/poof', label: 'poof（112×92）' },
  { id: 'scifi/emp-blast', label: 'emp-blast（152×116）' },
  { id: 'holy/heal-aoe', label: 'heal-aoe（256×136）' },
  { id: 'ui/confetti', label: 'confetti（200×140）' },
];

const core = await import(pathToFileURL(path.join(PIXELFX_DIR, 'src/core/index.js')).href);
const { createFrame, clearFrame, createFx, composite } = core;

/** 载入一个效果模块（与 pixelfx 自己的 render.mjs 同款：按需 import）。 */
async function loadEffect(id) {
  const mod = await import(pathToFileURL(path.join(PIXELFX_DIR, 'src/fx', `${id}.js`)).href);
  if (!mod.meta) throw new Error(`${id}: 没有 meta 导出`);
  return mod;
}

/** 建一个效果实例 + 它自己的帧缓冲（一个实例一块画布 —— 与运行时的 per-effect 离屏画布同构）。 */
function makeInstance(mod, seed) {
  const [w, h] = mod.meta.size;
  const frame = createFrame(w, h, mod.meta.origin[0], mod.meta.origin[1]);
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = createFx(mod, { x: mod.meta.origin[0], y: mod.meta.origin[1], seed });
  return { fx, frame, out, w, h };
}

/** 跑一帧：步进 → 画 → 合成（= 浏览器里 putImageData 之前的那一段）。 */
function stepFrame(inst, dt) {
  inst.fx.update(dt);
  clearFrame(inst.frame);
  inst.fx.draw(inst.frame);
  composite(inst.frame, inst.out, null);
}

/**
 * 分段计时：把一帧拆成「步进 / 画 / 合成」三段分别量。
 * why 分段：护栏要定的不是「特效多贵」，而是「**贵在哪**」——
 *   若成本几乎全在合成（按画布面积走），那分辨率上限就是主旋钮；
 *   若成本在步进（粒子数），那并发上限才是主旋钮。两者的护栏形状完全不同。
 */
function measurePhases(instances, frames, warmup) {
  const dt = 1 / FPS;
  const update = [];
  const draw = [];
  const comp = [];
  for (let f = 0; f < frames + warmup; f += 1) {
    let t0 = process.hrtime.bigint();
    for (const inst of instances) inst.fx.update(dt);
    let t1 = process.hrtime.bigint();
    for (const inst of instances) {
      clearFrame(inst.frame);
      inst.fx.draw(inst.frame);
    }
    let t2 = process.hrtime.bigint();
    for (const inst of instances) composite(inst.frame, inst.out, null);
    let t3 = process.hrtime.bigint();
    if (f >= warmup) {
      update.push(Number(t1 - t0) / 1e6);
      draw.push(Number(t2 - t1) / 1e6);
      comp.push(Number(t3 - t2) / 1e6);
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { update: avg(update), draw: avg(draw), composite: avg(comp) };
}

/** 百分位（p50 / p95 / max）—— 帧预算看的是尾部，不是均值。 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function measure(instances, frames, warmup) {
  const dt = 1 / FPS;
  const perFrame = [];
  for (let f = 0; f < frames + warmup; f += 1) {
    const t0 = process.hrtime.bigint();
    for (const inst of instances) stepFrame(inst, dt);
    const t1 = process.hrtime.bigint();
    if (f >= warmup) perFrame.push(Number(t1 - t0) / 1e6);
  }
  perFrame.sort((a, b) => a - b);
  const total = perFrame.reduce((a, b) => a + b, 0);
  return {
    mean: total / perFrame.length,
    p50: percentile(perFrame, 50),
    p95: percentile(perFrame, 95),
    max: perFrame[perFrame.length - 1],
  };
}

const rows = [];
for (const effect of EFFECTS) {
  const mod = await loadEffect(effect.id);
  for (const n of CONCURRENCY) {
    const instances = [];
    for (let i = 0; i < n; i += 1) instances.push(makeInstance(mod, 11 + i));
    // 预热阶段把效果推过爆发期（粒子最多的时候），别只量到"刚起步"的轻负载。
    for (const inst of instances) for (let f = 0; f < 60; f += 1) stepFrame(inst, 1 / FPS);
    const m = measure(instances, FRAMES, WARMUP);
    const ph = measurePhases(instances, FRAMES, WARMUP);
    rows.push({
      effect: effect.id,
      label: effect.label,
      px: mod.meta.size[0] * mod.meta.size[1],
      n,
      perInstance: m.p95 / n,
      p50: m.p50,
      p95: m.p95,
      max: m.max,
      budgetPct: (m.p95 / 16.667) * 100,
      updateMs: ph.update,
      drawMs: ph.draw,
      compositeMs: ph.composite,
    });
  }
}

const pad = (s, w) => String(s).padEnd(w);
const num = (v, d = 2) => String(v.toFixed(d)).padStart(d + 5);

console.log(`# pixelfx 代码路由 CPU 基准（task_162）`);
console.log(`# node ${process.version} · ${os.platform()}/${os.arch()} · ${os.cpus()[0]?.model ?? 'unknown cpu'}`);
console.log(`# 渲染帧率 ${FPS}fps · 采样 ${FRAMES} 帧（预热 ${WARMUP} 帧）· 帧预算 16.67ms（60fps）`);
console.log('');
console.log(
  `${pad('effect', 20)}${pad('px', 8)}${pad('并发', 6)}${pad('单实例ms', 11)}${pad('p50ms', 9)}${pad('p95ms', 9)}${pad('maxms', 9)}${pad('占预算%', 10)}`,
);
console.log('-'.repeat(84));
for (const r of rows) {
  console.log(
    `${pad(r.effect, 20)}${pad(r.px, 8)}${pad(r.n, 6)}${num(r.perInstance, 3)}${num(r.p50)}${num(r.p95)}${num(r.max)}${num(r.budgetPct, 1)}`,
  );
}

console.log('');
console.log('# 分段（单实例平均 ms/帧：步进 / 画 / 合成）');
console.log(`${pad('effect', 20)}${pad('px', 8)}${pad('步进', 10)}${pad('画', 10)}${pad('合成', 10)}${pad('画布px/µs', 14)}`);
console.log('-'.repeat(84));
for (const r of rows.filter((row) => row.n === 1)) {
  const total = r.updateMs + r.drawMs + r.compositeMs;
  const perPx = total > 0 ? (r.px / total) * 1000 : 0;
  console.log(
    `${pad(r.effect, 20)}${pad(r.px, 8)}${num(r.updateMs, 3)}${num(r.drawMs, 3)}${num(r.compositeMs, 3)}${num(perPx, 1)}`,
  );
}
console.log('');

// 机器可读副本：给文档 / 断言用。
console.log(JSON.stringify({ fps: FPS, frames: FRAMES, warmup: WARMUP, rows }, null, 2));
