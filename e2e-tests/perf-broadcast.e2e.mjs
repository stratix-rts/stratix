#!/usr/bin/env node
/**
 * 文件职责：**PERF-03 world-sync 广播体积基线测量脚本**（@since v3.3，task_232 / PERF-03）。
 *
 * ============ 这一单量什么（优化循环第 3 链 · 测量单）============
 *   PERF-02 已把「点进入 → 生效」的延迟压到 24~35ms（docs/PERF-baselines.md §9）⇒
 *   **时延这条线已经达标**；下一刀看**带宽** —— 25ms 一拍的快照，60 秒典型交互发多少字节。
 *
 *   两个场景（同口径对照）：
 *   · **场景 A · 静默挂机 60s**：进副本后**无任何操作** ⇒ 纯背景广播量（有没有在偷偷广播）。
 *   · **场景 B · 高频交互 60s**：模拟「点击 / 框选 / 右击移动 / 任务记账 / 轮询拉全量」⇒ 交互态广播量。
 *
 *   每个场景量四组数：
 *   ① **总字节 / 帧数 / 平均帧大小**（帧 = 一条下行 WS 消息）。
 *   ② **按事件类别拆体积占比**（按实际 payload 结构归类）：
 *      · 消息型：snapshot（全量状态）/ event.push（单位位置**增量**）/ command.ack（回执）。
 *      · snapshot 内部：按 `state` 的顶层字段拆（units / notices / missions / selection …）。
 *   ③ **按操作归因**：每次交互各自引发多少下行字节（算「一次点击值多少字节」）。
 *   ④ **相邻两帧 payload 相同字段比例**（粗粒度 delta / 压缩潜力评估）。
 *
 * ============ 口径纪律（与 PERF-01/02 同一套）============
 *   ① **不碰用户实例**：端口在备用段里动态挑（service 7800-7899，显式避开 7523/7524/7525/9222），
 *      DATA_DIR 与副本根全在 `os.tmpdir()` 下 ⇒ 一个字节都不写进用户的仓 / 库。
 *   ② **不碰产品码**：脚本只读协议、只发协议消息（hello / command.forward / event.forward），
 *      仓库里的 `src/**` 一个字节都没改（`npx tsc --noEmit` 绿）。
 *   ③ **只测量不优化**：本单不实现任何优化，产物是 docs/PERF-baselines.md §10。
 *   ④ **可重跑**：每次跑都新建临时目录 + 新端口探测 + 收尾按 pid 精确回收。
 *
 * ============ 为什么用「裸 WS 客户端」而不是浏览器 ============
 *   要量的是**广播体积**（服务端发出多少字节）—— 那是服务端行为，与客户端怎么渲染无关。
 *   裸 WS 客户端收到的字节与浏览器收到的字节**逐字节相同**（同一份 `JSON.stringify` 产物），
 *   但省掉浏览器起进程与渲染抖动 ⇒ 更短、更稳、可重跑。
 *   口径：字节 = **载荷字节**（UTF-8 JSON 文本长度），**不含** WS 帧头（2~14 B/帧，
 *   本单量级下可忽略；要算总带宽请加回）。
 *
 * 输入：命令行开关
 *   `--seconds <n>`  每个场景的时长（缺省 60）
 *   `--out <file>`    把原始 JSON 结果写到文件（缺省只打 stdout）
 *   `--keep`          保留临时目录（排障用）
 * 输出：stdout 的 markdown 表（两场景 × 四组数）+ 一段 JSON。
 *   退出码：0 = 两个场景都量完；1 = 中途失败（已量到的数据照打）。
 *
 * 跑法：node e2e-tests/perf-broadcast.e2e.mjs [--seconds 60] [--out /tmp/perf-broadcast.json]
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 只用 node 内建（WebSocket / fetch / fs / child_process）+ 仓内已有的 tsx；
 *   2. 碰用户的端口 / 库 / 数据；
 *   3. 把测量结果**写进产品码**（本单的产物是 docs/PERF-baselines.md，不是优化）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { killTree, launch, log, portFree, sleep, waitFor } from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓内 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
/** 仓库根 tsconfig（`@/*` 路径别名）。 */
const TSCONFIG = path.join(REPO, 'tsconfig.json');
/**
 * 被测 service 进程 —— **复用 PERF-01 的那一份**（`perf-baseline/perf-service-process.ts`）。
 * why 复用：它是「生产装配口径的最小复刻」（生产组合根 `bootStratixService` + 生产 world-sync
 *   端点 + 生产实例注册表），与 PERF-01/02 的数据同源 ⇒ 三链可对照。
 *   本单**只加不改**（复制了一份名册夹具在下面，不动 PERF-01 的脚本与进程文件）。
 */
const SERVICE_PROCESS = path.join(HERE, 'perf-baseline', 'perf-service-process.ts');

/** 端口段：**绝不**是 7523 / 7524 / 7525 / 9222（用户实例）。 */
const SERVICE_PORT_RANGE = [7800, 7899];
const USER_PORTS = [7523, 7524, 7525, 9222];

/** 第二个副本的实例 id（**带名册** ⇒ 进副本时会发生 roster 物化 ⇒ 战场上有单位）。 */
const INSTANCE_B_ID = 'wsp_instance_b';
/** 世界同步协议版本（与 src/stratix-gateway/.../protocol.ts 的 WORLD_SYNC_PROTOCOL_VERSION 同值）。 */
const PROTOCOL_VERSION = 3;
/** 目标单位数（战场规模：太小则快照代表性不足）。 */
const UNIT_TARGET = 8;
/** 交互环频率（Hz）—— 10Hz 是**压力口径**（远超真人手速），折算到真人速率见输出表。 */
const INTERACTION_HZ = 10;
/** 任务 / 轮询环频率（Hz）—— 1Hz。 */
const AUX_HZ = 1;

// ============================================================================
// 小工具
// ============================================================================

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
 * why 要名册：**进副本时 roster 会被物化成角色 + 战场单位**
 *   （步 N6 物化，见 src/app/services/persistence/instance-loader-node.ts）——
 *   没有名册 ⇒ 空战场 ⇒ 快照里没有 units ⇒ 量出来的带宽没有代表性。
 *
 * why 这里复制了一份而没有从 perf-baseline.e2e.mjs 复用：PERF-01 的脚本是**已归档的基线**，
 *   改动它会让「基线可复跑性」与本单纠缠；两份夹具都很短，重复的代价小于耦合的代价。
 */
function writeInstanceFixture(root, roleIds) {
  const rosterDir = path.join(root, '.stratix', 'roster');
  fs.mkdirSync(rosterDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.stratix', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(rosterDir, '_index.json'),
    `${JSON.stringify(
      {
        formatVersion: 1,
        defaultRoleId: roleIds[0],
        roles: roleIds.map((id) => ({ id, name: id, agentKind: 'claude-code' })),
      },
      null,
      2,
    )}\n`,
  );
  for (const id of roleIds) {
    fs.writeFileSync(
      path.join(rosterDir, `${id}.json`),
      `${JSON.stringify(
        {
          id,
          name: id,
          persona: '你负责在副本里站岗，等派单。',
          bindings: { agentKind: 'claude-code', model: null },
          capabilities: { tools: ['stratix_world_snapshot', 'read'], commands: [], skills: [], systemPrompt: '' },
          state: { level: 1, experience: 0, contextEnabled: true },
        },
        null,
        2,
      )}\n`,
    );
  }
  fs.writeFileSync(
    path.join(root, '.stratix', 'project.json'),
    `${JSON.stringify(
      {
        $schema: 'https://stratix.dev/schemas/project/v1.json',
        formatVersion: 1,
        id: 'spx_perf_broadcast_7e2d9c4a10b85f36d47a1c92',
        name: '赤岩前哨',
        description: 'PERF-03 广播体积基线用的副本（临时目录）。',
        createdAt: new Date().toISOString(),
        agents: { defaultRoleId: roleIds[0], defaultProfile: 'stratix-default' },
        engines: { stratix: '>=3.3.0' },
      },
      null,
      2,
    )}\n`,
  );
}

/** UTF-8 字节数。 */
const byteLength = (text) => Buffer.byteLength(text, 'utf8');

/**
 * 把一个 JSON 值摊平成「路径 → 值文本」的表（叶子口径）。
 * why 摊平：粗粒度 delta 潜力要看的是「**叶子字段**里有多少没变」，
 *   只比顶层 key 会高估（顶层引用变了但内容没变的情况）。
 */
function flatten(value, prefix, out) {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, JSON.stringify(value) ?? 'null');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(prefix, '[]');
      return;
    }
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    out.set(prefix, '{}');
    return;
  }
  for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
}

/** 顶层字段各自的字节数（含字段名与冒号；值是 undefined 时计 0 —— JSON 里会被丢掉）。 */
function topLevelSizes(state) {
  const sizes = new Map();
  for (const [key, value] of Object.entries(state)) {
    const json = value === undefined ? '' : JSON.stringify(value);
    sizes.set(key, byteLength(key) + 1 + byteLength(json));
  }
  return sizes;
}

/** 顶层字段各自的「值文本」（用于判断某个顶层字段这一帧是否没变）。 */
function topLevelValues(state) {
  const values = new Map();
  for (const [key, value] of Object.entries(state)) {
    values.set(key, value === undefined ? 'undefined' : JSON.stringify(value));
  }
  return values;
}

/** 百分比（一位小数）。 */
function pct(part, total) {
  if (part == null || Number.isNaN(part)) return '—';
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** 千分位。 */
const comma = (value) => Number(value ?? 0).toLocaleString('en-US');

// ============================================================================
// 计量器
// ============================================================================

/**
 * 下行广播计量器。
 *
 * why 逐帧记账而不是留原始报文：60 秒 × 40 帧/s ≈ 2400 帧，留全文会占几十 MB；
 *   本单要的数（总量 / 分类 / 相邻帧重复率）都能**流式**算出来 ⇒ 只留聚合 + 少量样本。
 */
class Meter {
  constructor() {
    this.t0 = 0;
    this.currentOp = '(setup)';
    this.frames = [];
    this.typeTotals = new Map();
    this.snapshotKeyTotals = new Map();
    this.snapshotKeyFrames = 0;
    this.snapshotEnvelopeBytes = 0;
    this.opTotals = new Map();
    this.pairs = [];
    this.prevFlat = null;
    this.prevTopValues = null;
    this.prevTopSizes = null;
    this.samples = [];
    this.upstream = { bytes: 0, ops: 0, byOp: new Map() };
  }

  /** 清零（场景开始前调用 —— setup 阶段的帧不计入）。 */
  reset(now) {
    this.t0 = now;
    this.currentOp = '(idle)';
    this.frames = [];
    this.typeTotals = new Map();
    this.snapshotKeyTotals = new Map();
    this.snapshotKeyFrames = 0;
    this.snapshotEnvelopeBytes = 0;
    this.opTotals = new Map();
    this.pairs = [];
    this.prevFlat = null;
    this.prevTopValues = null;
    this.prevTopSizes = null;
    this.samples = [];
    this.upstream = { bytes: 0, ops: 0, byOp: new Map() };
  }

  /** 记一次上行（客户端 → service）。 */
  recordUpstream(op, bytes) {
    this.upstream.bytes += bytes;
    this.upstream.ops += 1;
    const entry = this.upstream.byOp.get(op) ?? { ops: 0, bytes: 0 };
    entry.ops += 1;
    entry.bytes += bytes;
    this.upstream.byOp.set(op, entry);
  }

  /** 记一帧下行（service → 客户端）。 */
  recordDownstream(type, bytes, state) {
    const t = Date.now() - this.t0;
    this.frames.push({ t, type, bytes, op: this.currentOp });

    const typeEntry = this.typeTotals.get(type) ?? { count: 0, bytes: 0 };
    typeEntry.count += 1;
    typeEntry.bytes += bytes;
    this.typeTotals.set(type, typeEntry);

    const opEntry = this.opTotals.get(this.currentOp) ?? { frames: 0, bytes: 0, types: new Map() };
    opEntry.frames += 1;
    opEntry.bytes += bytes;
    const opType = opEntry.types.get(type) ?? { count: 0, bytes: 0 };
    opType.count += 1;
    opType.bytes += bytes;
    opEntry.types.set(type, opType);
    this.opTotals.set(this.currentOp, opEntry);

    if (type !== 'snapshot' || !state) return;

    // —— snapshot 内部：按顶层字段拆体积 ——
    const sizes = topLevelSizes(state);
    for (const [key, size] of sizes) {
      this.snapshotKeyTotals.set(key, (this.snapshotKeyTotals.get(key) ?? 0) + size);
    }
    this.snapshotKeyFrames += 1;
    const stateBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    this.snapshotEnvelopeBytes += bytes - stateBytes;

    // —— 相邻两帧：相同字段比例（粗粒度 delta 潜力）——
    const flat = new Map();
    flatten(state, '', flat);
    const topValues = topLevelValues(state);
    if (this.prevFlat) {
      const union = new Set([...this.prevFlat.keys(), ...flat.keys()]);
      let identicalLeaves = 0;
      for (const key of union) {
        if (this.prevFlat.has(key) && flat.has(key) && this.prevFlat.get(key) === flat.get(key)) {
          identicalLeaves += 1;
        }
      }
      const topUnion = new Set([...this.prevTopValues.keys(), ...topValues.keys()]);
      let identicalTop = 0;
      const changedTopKeys = [];
      let changedBytes = 0;
      for (const key of topUnion) {
        const same =
          this.prevTopValues.has(key) &&
          topValues.has(key) &&
          this.prevTopValues.get(key) === topValues.get(key);
        if (same) identicalTop += 1;
        else {
          changedTopKeys.push(key);
          changedBytes += sizes.get(key) ?? 0;
        }
      }
      this.pairs.push({
        identicalLeafRatio: union.size === 0 ? 1 : identicalLeaves / union.size,
        identicalTopRatio: topUnion.size === 0 ? 1 : identicalTop / topUnion.size,
        leafCount: union.size,
        identicalLeaves,
        changedTopKeys,
        changedBytes,
        frameBytes: bytes,
      });
    }
    this.prevFlat = flat;
    this.prevTopValues = topValues;
    this.prevTopSizes = sizes;

    if (this.samples.length < 2) {
      this.samples.push({ t, bytes, keySizes: Object.fromEntries(sizes) });
    }
  }

  /** 汇总（场景结束时调用）。 */
  summarize(durationMs) {
    const totalBytes = this.frames.reduce((sum, frame) => sum + frame.bytes, 0);
    const totalFrames = this.frames.length;
    const snapshotBytes = this.typeTotals.get('snapshot')?.bytes ?? 0;
    const snapshotFrames = this.typeTotals.get('snapshot')?.count ?? 0;
    const leafRatios = this.pairs.map((pair) => pair.identicalLeafRatio);
    const topRatios = this.pairs.map((pair) => pair.identicalTopRatio);
    const mean = (list) =>
      list.length === 0 ? null : list.reduce((sum, value) => sum + value, 0) / list.length;
    const min = (list) => (list.length === 0 ? null : Math.min(...list));
    const changedBytesTotal = this.pairs.reduce((sum, pair) => sum + pair.changedBytes, 0);

    return {
      durationMs,
      totalBytes,
      totalFrames,
      avgFrameBytes: totalFrames === 0 ? 0 : totalBytes / totalFrames,
      bytesPerSecond: durationMs === 0 ? 0 : (totalBytes / durationMs) * 1000,
      framesPerSecond: durationMs === 0 ? 0 : (totalFrames / durationMs) * 1000,
      byType: Object.fromEntries(
        [...this.typeTotals.entries()].map(([type, entry]) => [
          type,
          {
            count: entry.count,
            bytes: entry.bytes,
            share: pct(entry.bytes, totalBytes),
            avgBytes: entry.count === 0 ? 0 : entry.bytes / entry.count,
          },
        ]),
      ),
      snapshotInner: {
        frames: snapshotFrames,
        avgBytes: snapshotFrames === 0 ? 0 : snapshotBytes / snapshotFrames,
        envelopeAvgBytes:
          snapshotFrames === 0 ? 0 : this.snapshotEnvelopeBytes / snapshotFrames,
        byKey: Object.fromEntries(
          [...this.snapshotKeyTotals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key, bytes]) => [
              key,
              {
                bytes,
                avgBytesPerFrame: snapshotFrames === 0 ? 0 : bytes / snapshotFrames,
                share: pct(bytes, snapshotKeyTotalsTotal(this.snapshotKeyTotals)),
              },
            ]),
        ),
      },
      adjacency: {
        pairs: this.pairs.length,
        meanIdenticalLeafRatio: mean(leafRatios),
        minIdenticalLeafRatio: min(leafRatios),
        meanIdenticalTopRatio: mean(topRatios),
        minIdenticalTopRatio: min(topRatios),
        /** 若只发「变化了的顶层字段」，理论上需要的字节（对比全量帧）。 */
        changedBytesTotal,
        changedShareOfFrames: pct(
          changedBytesTotal,
          this.pairs.reduce((sum, pair) => sum + pair.frameBytes, 0),
        ),
      },
      byOp: Object.fromEntries(
        [...this.opTotals.entries()].map(([op, entry]) => [
          op,
          {
            frames: entry.frames,
            bytes: entry.bytes,
            types: Object.fromEntries(
              [...entry.types.entries()].map(([type, typeEntry]) => [
                type,
                { count: typeEntry.count, bytes: typeEntry.bytes },
              ]),
            ),
          },
        ]),
      ),
      upstream: {
        bytes: this.upstream.bytes,
        ops: this.upstream.ops,
        byOp: Object.fromEntries(this.upstream.byOp.entries()),
      },
      frames: this.frames,
      samples: this.samples,
    };
  }
}

/** 所有顶层字段的字节总和（份额的分母）。 */
function snapshotKeyTotalsTotal(totals) {
  let sum = 0;
  for (const value of totals.values()) sum += value;
  return sum;
}

// ============================================================================
// WS 客户端
// ============================================================================

/**
 * 一个 world-sync 观察客户端（裸协议，不依赖前端）。
 *
 * why 自己写而不是用 harness 的 `createObserver`：本单要**逐帧字节数**与**逐帧 payload 结构**
 *   （相邻帧字段对比），通用观察器不保留这些。
 */
function createClient(url, clientId, onFrame, onSend) {
  const ws = new WebSocket(url);
  const state = {
    ws,
    clientId,
    lastSnapshot: null,
    lastSeq: 0,
    acks: new Map(),
    closed: false,
    upstreamBytes: 0,
    lastFrameAt: 0,
  };
  let seq = 0;

  ws.addEventListener('message', (event) => {
    const text =
      typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);
    const bytes = byteLength(text);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    state.lastFrameAt = Date.now();
    if (parsed?.type === 'snapshot') {
      state.lastSnapshot = parsed.state;
      state.lastSeq = parsed.seq;
    }
    if (parsed?.type === 'command.ack') {
      const resolver = state.acks.get(parsed.commandId);
      if (resolver) {
        state.acks.delete(parsed.commandId);
        clearTimeout(resolver.timer);
        resolver.resolve(parsed);
      }
    }
    onFrame({ type: parsed?.type ?? '(unparsable)', bytes, parsed });
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`world-sync 连接失败：${url}`)));
    ws.addEventListener('close', () => {
      state.closed = true;
    });
  });

  return {
    state,
    opened,
    /** 发一条客户端 → service 的消息（记上行字节）。 */
    send(message) {
      const text = JSON.stringify(message);
      const bytes = byteLength(text);
      state.upstreamBytes += bytes;
      onSend?.(message, bytes);
      ws.send(text);
      return bytes;
    },
    /** 发一条命令，等回执。 */
    async sendCommand(command, { timeoutMs = 15_000 } = {}) {
      await opened;
      const commandId = `perf-broadcast-${Date.now()}-${++seq}`;
      const ack = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.acks.delete(commandId);
          reject(new Error(`命令回执超时：${command.type}`));
        }, timeoutMs);
        state.acks.set(commandId, { resolve, reject, timer });
      });
      this.send({ type: 'command.forward', commandId, command });
      return ack;
    },
    /** 重发 hello（协议里唯一的「拉一份全量」手段；也是本单的「轮询」操作）。 */
    hello() {
      return this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId });
    },
    close() {
      try {
        ws.close();
      } catch {
        // 已经关了
      }
    },
  };
}

// ============================================================================
// 场景准备
// ============================================================================

/** 等到最新快照满足条件。 */
async function waitForState(client, predicate, label, { timeoutMs = 60_000 } = {}) {
  return waitFor(
    label,
    () => {
      const snapshot = client.state.lastSnapshot;
      return snapshot && predicate(snapshot) ? snapshot : false;
    },
    { timeoutMs, intervalMs: 50 },
  );
}

/**
 * 把场景的「起始状态」准备好（**两个场景完全一致** ⇒ 两组数可直接对照）。
 *
 * 做什么：进副本（roster 物化 ⇒ 战场有单位）→ 补足到 UNIT_TARGET 个单位 → 立一条任务。
 * why 补单位：只有 1 个单位时 units 字段太小，体积占比会被其它字段淹没 ⇒ 不可外推。
 * why 立任务：missions / 任务相位是本单要归类的体积类别之一，空数组量不出东西。
 */
async function prepareScenario(client, { log: logFn }) {
  const enterAck = await client.sendCommand({ type: 'project.enter', instanceId: INSTANCE_B_ID });
  if (!enterAck.ok) {
    throw new Error(`进副本被拒：${JSON.stringify(enterAck.error ?? {})}`);
  }
  await waitForState(
    client,
    (state) => state.activeInstanceId === INSTANCE_B_ID,
    '进副本生效（activeInstanceId）',
  );
  await waitForState(
    client,
    (state) => Array.isArray(state.units) && state.units.length > 0,
    'roster 物化出单位',
  );

  const unitCount = () => client.state.lastSnapshot?.units?.length ?? 0;
  let created = 0;
  while (unitCount() < UNIT_TARGET) {
    created += 1;
    const ack = await client.sendCommand({
      type: 'character.create',
      name: `角色${String(created).padStart(2, '0')}`,
      agentKind: 'claude-code',
      skinId: 'default',
      persona: '你负责在副本里待命，等派单。',
    });
    if (!ack.ok) {
      throw new Error(`建角色被拒：${JSON.stringify(ack.error ?? {})}`);
    }
    await waitForState(client, () => unitCount() >= created + 1, `第 ${created} 个角色建档`);
  }

  const units = client.state.lastSnapshot?.units ?? [];
  const missionAck = await client.sendCommand({
    type: 'mission.create',
    title: '赤岩前哨 · 巡逻',
    unitIds: units.slice(0, 2).map((unit) => unit.id),
  });
  if (!missionAck.ok) {
    throw new Error(`立任务被拒：${JSON.stringify(missionAck.error ?? {})}`);
  }
  await waitForState(
    client,
    (state) => Array.isArray(state.missions) && state.missions.length > 0,
    '任务已立（missions 非空）',
  );

  const snapshot = client.state.lastSnapshot;
  logFn(
    `准备完成：单位 ${snapshot.units.length} 个 / 角色 ${snapshot.characters.length} 个 / ` +
      `任务 ${snapshot.missions.length} 条（相位 ${snapshot.missions.map((m) => m.phase).join(',')}）`,
  );
  return {
    unitIds: snapshot.units.map((unit) => unit.id),
    missionId: snapshot.missions[0]?.id ?? null,
  };
}

/**
 * 静默期（settle）：等后台噪声落定后再开测量窗口。
 *
 * why 需要：准备阶段会触发**异步的 agent 探测**（`detectedAgents` 逐个填进来）⇒
 *   准备刚结束时还有几帧在路上。若不静默就开窗，这几帧会被算进「静默挂机」的口径
 *   ⇒ 场景 A 就不再是「静默」了。
 * 口径：连续 `quietMs` 没有下行帧即认为落定（最多等 `maxMs`）。
 */
async function settle(client, { quietMs = 1500, maxMs = 8000 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const quietFor = Date.now() - (client.state.lastFrameAt || Date.now());
    if (quietFor >= quietMs) return;
    await sleep(100);
  }
}

// ============================================================================
// 场景 A · 静默挂机
// ============================================================================

/** 场景 A：进副本后什么都不做，静默挂机 durationMs。 */
async function runIdleScenario(client, meter, durationMs) {
  meter.reset(Date.now());
  meter.currentOp = '(idle)';
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(200, Math.max(0, deadline - Date.now())));
  }
}

// ============================================================================
// 场景 B · 高频交互
// ============================================================================

/**
 * 场景 B：两环并行（都在 world-sync 协议上打，**不改任何产品码**）。
 *
 * · **交互环 10Hz**（压力口径）：点击 / 右击移动 / 框选 / HUD 选中 —— 全是**用户手上的动作**。
 * · **辅助环 1Hz**：任务记账（任务相位类）/ 轮询拉全量（重发 hello）/ 导演开关（状态面字段）。
 *
 * why 导演开关也放进来：它只改 `directorEnabled` 一个布尔 ⇒ 用来看「单字段变化要付多少全量帧的钱」。
 */
async function runInteractionScenario(client, meter, durationMs, context) {
  const { unitIds, missionId } = context;
  meter.reset(Date.now());
  const deadline = Date.now() + durationMs;

  let interactionTick = 0;
  let auxTick = 0;
  let directorEnabled = false;

  const nextInteraction = () => INTERACTION_HZ;
  const nextAux = () => AUX_HZ;

  let nextInteractionAt = Date.now() + 1000 / nextInteraction();
  let nextAuxAt = Date.now() + 1000 / nextAux();

  while (Date.now() < deadline) {
    const now = Date.now();
    if (now >= nextInteractionAt) {
      const step = interactionTick % 6;
      const unit = unitIds[interactionTick % unitIds.length];
      const other = unitIds[(interactionTick + 1) % unitIds.length];
      interactionTick += 1;
      const x = 200 + ((interactionTick * 37) % 800);
      const y = 150 + ((interactionTick * 53) % 600);
      switch (step) {
        case 0:
          meter.currentOp = 'click.set';
          client.send({
            type: 'event.forward',
            event: { type: 'unit.click', unitId: unit, mods: { shift: false, ctrl: false, meta: false, alt: false } },
          });
          break;
        case 1:
          meter.currentOp = 'move.one';
          client.send({ type: 'event.forward', event: { type: 'unit.move', unitIds: [unit], x, y } });
          break;
        case 2:
          meter.currentOp = 'box.select';
          client.send({
            type: 'event.forward',
            event: {
              type: 'selection.box',
              bounds: { x, y, width: 320, height: 240 },
              unitIds: [unit, other],
            },
          });
          break;
        case 3:
          meter.currentOp = 'hud.select';
          client
            .sendCommand({ type: 'unit.select', unitIds: [unit], mode: 'toggle' })
            .catch(() => undefined);
          break;
        case 4:
          meter.currentOp = 'click.add';
          client.send({
            type: 'event.forward',
            event: { type: 'unit.click', unitId: other, mods: { shift: true, ctrl: false, meta: false, alt: false } },
          });
          break;
        default:
          meter.currentOp = 'move.formation';
          client.send({ type: 'event.forward', event: { type: 'unit.move', unitIds: [unit, other], x, y } });
          break;
      }
      nextInteractionAt = Date.now() + 1000 / nextInteraction();
    }
    if (now >= nextAuxAt) {
      const step = auxTick % 3;
      auxTick += 1;
      switch (step) {
        case 0:
          meter.currentOp = 'mission.checkpoint';
          client
            .sendCommand({
              type: 'mission.checkpoint',
              missionId: missionId ?? '',
              note: `巡逻检查点 ${auxTick}`,
            })
            .catch(() => undefined);
          break;
        case 1:
          meter.currentOp = 'poll.hello';
          client.hello();
          break;
        default:
          meter.currentOp = 'director.toggle';
          directorEnabled = !directorEnabled;
          client.send({
            type: 'event.forward',
            event: { type: 'camera.director', enabled: directorEnabled },
          });
          break;
      }
      nextAuxAt = Date.now() + 1000 / nextAux();
    }
    await sleep(5);
  }
}

// ============================================================================
// 一个场景的完整跑法（起 service → 准备 → 量 → 收尾）
// ============================================================================

async function runScenario(name, { seconds, keepTmp }) {
  const takenPorts = new Set();
  const servicePort = await pickFreePort(SERVICE_PORT_RANGE, takenPorts);
  if (USER_PORTS.includes(servicePort)) throw new Error('端口纪律破了：挑到了用户端口');

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `stratix-perf-broadcast-${name}-`));
  const sandboxRoot = path.join(workdir, 'sandbox');
  const instanceBRoot = path.join(workdir, 'instance-b');
  const dataDir = path.join(workdir, 'data');
  fs.mkdirSync(sandboxRoot, { recursive: true });
  fs.mkdirSync(instanceBRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  writeInstanceFixture(instanceBRoot, ['sentry']);

  let service = null;
  let client = null;
  const meter = new Meter();
  const result = { scenario: name, servicePort, workdir };

  try {
    service = launch(
      `perf-broadcast-service-${name}`,
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

    await waitFor(
      'service READY',
      () => service.output.some((line) => line.includes('SX_PERF_SERVICE_READY')),
      { timeoutMs: 120_000, intervalMs: 100 },
    );
    await waitFor(
      'service /health ok',
      async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${servicePort}/health`);
          const body = await response.json();
          return body?.status === 'ok';
        } catch {
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 50 },
    );

    client = createClient(
      `ws://127.0.0.1:${servicePort}/ws/world-sync`,
      `perf-broadcast-${name}`,
      (frame) => {
        meter.recordDownstream(frame.type, frame.bytes, frame.parsed?.state);
      },
      (message, bytes) => {
        meter.recordUpstream(meter.currentOp, bytes);
      },
    );
    await client.opened;
    client.hello();
    await waitForState(client, () => true, '首份快照');

    const context = await prepareScenario(client, { log: (line) => log(`  [场景 ${name}] ${line}`) });

    // 静默期：把准备阶段的余波（异步 agent 探测）排干净，再开测量窗口。
    await settle(client);
    log(`  [场景 ${name}] 静默期结束，开始测量 ${seconds}s`);

    if (name === 'A') {
      await runIdleScenario(client, meter, seconds * 1000);
    } else {
      await runInteractionScenario(client, meter, seconds * 1000, context);
    }

    result.summary = meter.summarize(seconds * 1000);
    result.upstreamBytesTotal = client.state.upstreamBytes;
    result.context = {
      unitCount: context.unitIds.length,
      missionId: context.missionId,
    };
    log(
      `  [场景 ${name}] 下行 ${comma(result.summary.totalBytes)} B / ${comma(result.summary.totalFrames)} 帧 / ` +
        `均帧 ${Math.round(result.summary.avgFrameBytes)} B / ${(result.summary.bytesPerSecond / 1024).toFixed(1)} KB/s`,
    );
    return result;
  } finally {
    client?.close();
    if (service) await killTree(service.pid, { label: `perf-broadcast-service-${name}` });
    if (!keepTmp) {
      fs.rmSync(workdir, { recursive: true, force: true });
    } else {
      log(`临时目录保留：${workdir}`);
    }
  }
}

// ============================================================================
// 输出
// ============================================================================

/** 打印一个场景的表。 */
function printScenario(result) {
  const summary = result.summary;
  console.log(`\n────────── 场景 ${result.scenario} ──────────`);
  console.log(
    `时长 ${(summary.durationMs / 1000).toFixed(0)}s｜下行总字节 ${comma(summary.totalBytes)} B｜` +
      `帧数 ${comma(summary.totalFrames)}｜均帧 ${
        summary.totalFrames === 0 ? '—（无帧）' : `${Math.round(summary.avgFrameBytes)} B`
      }｜` +
      `${(summary.bytesPerSecond / 1024).toFixed(2)} KB/s｜帧率 ${summary.framesPerSecond.toFixed(1)}/s`,
  );

  console.log('\n**按消息类别（下行）**');
  console.log('| 消息型 | 帧数 | 字节 | 占比 | 均帧 |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const [type, entry] of Object.entries(summary.byType).sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(
      `| ${type} | ${comma(entry.count)} | ${comma(entry.bytes)} | ${entry.share} | ${Math.round(entry.avgBytes)} B |`,
    );
  }

  if (summary.snapshotInner.frames > 0) {
    console.log('\n**snapshot 内部 · 按顶层字段**（单位 = 字节；均帧 = 每帧平均占用）');
    console.log('| 字段 | 累计字节 | 均帧字节 | 帧内占比 |');
    console.log('| --- | --- | --- | --- |');
    for (const [key, entry] of Object.entries(summary.snapshotInner.byKey)) {
      console.log(
        `| ${key} | ${comma(entry.bytes)} | ${Math.round(entry.avgBytesPerFrame)} | ${entry.share} |`,
      );
    }
    console.log(
      `| （信封：type/seq/delta） | — | ${Math.round(summary.snapshotInner.envelopeAvgBytes)} | — |`,
    );
  }

  console.log('\n**相邻两帧重复率**（粗粒度 delta 潜力）');
  console.log(
    `可比对帧对 ${summary.adjacency.pairs}｜叶子字段平均相同比例 ` +
      `${pct(summary.adjacency.meanIdenticalLeafRatio, 1)}（最低 ${pct(summary.adjacency.minIdenticalLeafRatio, 1)}）｜` +
      `顶层字段平均相同比例 ${pct(summary.adjacency.meanIdenticalTopRatio, 1)}` +
      `（最低 ${pct(summary.adjacency.minIdenticalTopRatio, 1)}）｜` +
      `「只发改动字段」的字节占全量帧 ${summary.adjacency.changedShareOfFrames}`,
  );

  console.log('\n**按操作归因**（到达时刻所属操作 ⇒ 下行字节）');
  console.log('| 操作 | 下行帧 | 下行字节 | 明细 |');
  console.log('| --- | --- | --- | --- |');
  for (const [op, entry] of Object.entries(summary.byOp).sort((a, b) => b[1].bytes - a[1].bytes)) {
    const detail = Object.entries(entry.types)
      .map(([type, typeEntry]) => `${type}×${typeEntry.count}`)
      .join(' / ');
    console.log(`| ${op} | ${entry.frames} | ${comma(entry.bytes)} | ${detail || '—'} |`);
  }

  console.log(
    `\n上行（客户端 → service）：${comma(summary.upstream.bytes)} B / ${comma(summary.upstream.ops)} 条`,
  );
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
    units: UNIT_TARGET,
    interactionHz: INTERACTION_HZ,
    auxHz: AUX_HZ,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const secondsIndex = argv.indexOf('--seconds');
  const outIndex = argv.indexOf('--out');
  const keepTmp = argv.includes('--keep');
  const seconds = secondsIndex >= 0 ? Number(argv[secondsIndex + 1]) : 60;

  log(
    `PERF-03 world-sync 广播体积基线：每场景 ${seconds}s（service 端口动态挑，临时 DATA_DIR，裸 WS 客户端）`,
  );

  const scenarioA = await runScenario('A', { seconds, keepTmp });
  const scenarioB = await runScenario('B', { seconds, keepTmp });

  const env = environment();
  console.log('\n────────── world-sync 广播体积基线 ──────────');
  console.log(`环境：HEAD=${env.head} node=${env.node} ${env.os}/${env.arch} cpu=${env.cpu}`);
  console.log(
    `口径：裸 WS 客户端（与浏览器收到的是同一份 JSON 载荷）；字节 = UTF-8 载荷字节（不含 WS 帧头）；` +
      `场景 A = 进副本后静默挂机；场景 B = ${INTERACTION_HZ}Hz 交互环 + ${AUX_HZ}Hz 辅助环；战场 ${UNIT_TARGET} 个单位`,
  );
  printScenario(scenarioA);
  printScenario(scenarioB);
  console.log('\n────────────────────────────────────────────\n');

  const payload = {
    env,
    seconds,
    scenarioA: { ...scenarioA, summary: { ...scenarioA.summary, frames: undefined } },
    scenarioB: { ...scenarioB, summary: { ...scenarioB.summary, frames: undefined } },
  };
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    log(`原始数据已写入 ${outPath}`);
  }
  log(
    `汇总：A ${comma(scenarioA.summary.totalBytes)} B / ${comma(scenarioA.summary.totalFrames)} 帧；` +
      `B ${comma(scenarioB.summary.totalBytes)} B / ${comma(scenarioB.summary.totalFrames)} 帧`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log(`脚本中断：${message}`);
  process.exitCode = 1;
}
