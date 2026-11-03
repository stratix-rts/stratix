/**
 * 文件职责：**service 进程的世界态落盘**（防抖 + 原子写）—— 把 store 里的
 *   missions / characters 写成一份快照文件，让重启后的进程能把世界态恢复回来。
 * 输入：core 的 CoreStore（状态真相）+ 快照文件路径。
 * 输出：磁盘上的快照文件（写完即可被下一个进程读回）。
 * 禁止事项：
 *   1. 在这里改状态 —— 本模块只**读**状态并落盘，状态的真相在 core；
 *   2. 每次状态变化都同步写盘 —— 写侧必须防抖（默认 500ms 合并）：
 *      一次 checkpoint 记账不该换来一次磁盘 IO（perf：高频后台动作不能压磁盘）；
 *   3. 直接覆盖写目标文件 —— 必须**先写临时文件再 rename**（原子替换）：
 *      写到一半掉电 / 进程被杀，目标档不能变成半截 JSON（那会让整个世界态读不回来）；
 *   4. 写失败就抛出去打断进程 —— 落盘失败降级成一行警告，进程照常服务
 *      （存盘不是服务的前置条件）；
 *   5. 认识 MCP / HTTP —— 本模块是纯 node 侧的世界态持久化。
 *
 * why 脏检查只看两个引用：WorldState 是不可变结构，missions / characters 两个数组的**引用**
 *   只有在它们真变了时才会换新（core 的写入面一律造新数组）。
 *   引用没变 = 这两个集合没变 = 不必重算快照 —— 于是高频的其它状态变化（通知、聊天）
 *   不会白算一遍 JSON。
 *
 * @since v3.7（task_133）missions + characters 持久化落盘（重启可恢复）。
 */

import fs from 'fs';
import path from 'path';

import type { CoreStore } from '../../core/store';

import { buildWorldSnapshot, parseWorldSnapshot, type WorldSnapshot } from './world-snapshot';

/** 写侧防抖窗口（毫秒）：这段时间内的多次变化合并成一次落盘。 */
export const DEFAULT_DEBOUNCE_MS = 500;

/** 落盘件的参数。 */
export interface WorldPersisterOptions {
  /** 状态真相（只读）。 */
  readonly store: CoreStore;
  /** 快照文件路径（gateway 的 dataDir 下）。 */
  readonly filePath: string;
  /** 防抖窗口（毫秒）；缺省 500。 */
  readonly debounceMs?: number;
  /** 时钟（缺省 Date.now）—— 单测可注入假时钟。 */
  readonly now?: () => number;
  /** 日志口（缺省 console.warn）。 */
  readonly logger?: (line: string) => void;
  /** 写文件（缺省 = 原子写：临时文件 + rename）；单测可注入假写。 */
  readonly writeSnapshot?: (filePath: string, contents: string) => void;
}

/** 落盘件句柄。 */
export interface WorldPersister {
  /** 开始盯状态（订阅 store）。 */
  start(): void;
  /** 立刻把当前状态落盘（不等防抖）—— 进程退出前调它。 */
  flush(): void;
  /** 收干净：退订 + 落一次盘（幂等）。 */
  stop(): void;
  /** 当前是否有待落盘的变更（测试 / 诊断用）。 */
  readonly pending: boolean;
}

/**
 * 原子写：先写同目录下的临时文件，再 rename 覆盖目标。
 *
 * why 同目录：rename 是同分区的原子操作，跨分区会失败（那就退化成非原子写，不如报错）。
 * why 要原子：目标档是「重启后世界态的唯一事实」，半截 JSON = 整个世界态读不回来。
 */
function writeFileAtomic(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, contents, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * 造一个落盘件。
 *
 * 角色建档时刻（createdAt）：CharacterView 里没有这个字段，但名册顺序（loadCharacters 按
 *   created_at 升序）依赖它 —— 所以落盘件自己记着每个角色**第一次被看到**的时刻，
 *   后续重写沿用同一个值（不然每次落盘都把名册顺序打乱成「本次写入顺序」）。
 */
export function createWorldPersister(options: WorldPersisterOptions): WorldPersister {
  const { store, filePath } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = options.now ?? ((): number => Date.now());
  const logger = options.logger ?? ((line: string): void => console.warn(line));
  const writeSnapshot = options.writeSnapshot ?? writeFileAtomic;

  const characterCreatedAt = new Map<string, number>();
  /** 上一次写进文件的快照内容（判「有没有实质变化」）。 */
  let lastWritten: string | null = null;
  /** 上一次见到的两个集合的引用（判「有没有必要重算」）。 */
  let lastMissions: unknown = store.getState().missions;
  let lastCharacters: unknown = store.getState().characters;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  const snapshotSignature = (): string => {
    const state = store.getState();
    // 第一次见到某个角色 → 记下它的建档时刻（之后沿用）。
    for (const character of state.characters) {
      if (!characterCreatedAt.has(character.id)) {
        characterCreatedAt.set(character.id, now());
      }
    }
    const snapshot: WorldSnapshot = buildWorldSnapshot({
      state,
      now: now(),
      characterCreatedAt: (id) => characterCreatedAt.get(id) ?? now(),
    });
    return JSON.stringify(snapshot);
  };

  const writeNow = (): void => {
    let contents: string;
    try {
      contents = snapshotSignature();
    } catch (error) {
      logger(`[service] 世界态快照构造失败，跳过本次落盘：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (contents === lastWritten) return; // 没实质变化 → 不写
    try {
      writeSnapshot(filePath, contents);
      lastWritten = contents;
    } catch (error) {
      logger(`[service] 世界态快照落盘失败（不影响服务）：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const handle = setTimeout(() => {
      timer = null;
      writeNow();
    }, debounceMs);
    // 不吊住进程（停服务时要能自然退出；单测里也不该留着一个活动定时器）。
    (handle as unknown as { unref?: () => void }).unref?.();
    timer = handle;
  };

  const onStateChange = (): void => {
    if (stopped) return;
    const state = store.getState();
    // 引用没变 = missions / characters 这两个集合没动 → 不必重算（高频其它变化不打扰落盘）。
    if (state.missions === lastMissions && state.characters === lastCharacters) return;
    lastMissions = state.missions;
    lastCharacters = state.characters;
    schedule();
  };

  return {
    start(): void {
      if (unsubscribe) return;
      unsubscribe = store.subscribe(onStateChange);
    },
    flush(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      writeNow();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      writeNow();
      unsubscribe?.();
      unsubscribe = null;
    },
    get pending(): boolean {
      return timer !== null;
    },
  };
}

/**
 * 读快照文件（untrusted）。
 *
 * 返回 null = 没有档 / 读不出来 / 档坏了 —— 调用方降级成空世界 + 一行警告，**不抛**。
 */
export function readWorldSnapshotFile(
  filePath: string,
  logger: (line: string) => void = (line) => console.warn(line)
): WorldSnapshot | null {
  let raw: string;
  try {
    if (!fs.existsSync(filePath)) return null;
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    logger(`[service] 世界态快照读取失败，降级为空世界：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger(
      `[service] 世界态快照损坏（JSON 解析失败），降级为空世界：${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
  // 解析在 world-snapshot 里（宽容解析：单条脏数据只丢那一条；整档坏掉才返回 null）。
  const snapshot = parseWorldSnapshot(parsed);
  if (!snapshot) {
    logger('[service] 世界态快照结构不认识，降级为空世界');
    return null;
  }
  return snapshot;
}
