/**
 * 文件职责：**@会话引用解析服务**（task_107 / v3.2b-B8）—— 把输入里的 `@session_<id>`
 *   翻译成「被引用的会话」：校验会话存在 → 读它的近期事件 → 拼出注入 agent 上下文的块。
 * 方案来源：docs/SESSION-PLAN.md §8「@会话引用」。
 * 输入：一段自由文本（互聊议题 / 任务指令）+ 两个读口（会话摘要 / 会话事件）。
 * 输出：解析结果（注入块 + 被引用的会话 id + 失败原因）。
 * 禁止事项：
 *   1. 碰存储实现 —— 只认读口（core 零 IO 的同一纪律：service 也不认 DAO，只认契约）；
 *   2. 自己解析 `@session_` —— 语法口径在 core/session/reference.ts（两个入口共用一份）；
 *   3. 引用不存在的会话还照样注入 —— **如实报错**（见下方「不存在即报错」口径）；
 *   4. 抛异常 —— 解析失败是**用户输入问题**，不是程序故障：一律转成「ok=false + 人话原因」。
 *
 * ============ 读取口径（「摘要 + 近期原文」）============
 * 目标会话的近期内容按压缩读取路由的口径取：**有压缩摘要就带上摘要，没有就取最近若干条原文**。
 *
 * TODO(task_106 合入后接压缩路由）：core/session/compress.ts 的 routeSessionEvents
 *   是这条路由的**统一实现**（摘要盖住被折叠区间 → 返回「摘要 + 近期原文」）。
 *   本服务当前**自建**同一口径（读最近几页 → 找压缩摘要 → 取近期原文），
 *   因为 task_106 尚未合入；合入后把 readRecentEvents 换成 routeSessionEvents 即可，
 *   口径不变（上限常量也一并搬过去）。
 *
 * ============ 不存在即报错（不静默降级）============
 * 引用了不存在的会话 → **报错、不注入**。why 不"跳过它继续跑"：
 *   用户明确说了"参考那场会话"，悄悄跳过就等于**答非所问**（agent 拿着残缺的上下文
 *   给出一个看似合理的答案，用户无从察觉哪里不对）。宁可当场报错让用户改。
 *
 * @since v3.49（task_107 / v3.2b-B8）。
 */

import {
  buildSessionReferenceBlock,
  parseSessionReferences,
  SESSION_REFERENCE_MAX_TARGETS,
  SESSION_REFERENCE_PREFIX,
  type SessionReferenceSource,
} from '../../core/session';
import type { SessionEventView, SessionRecord } from '../../core/session/types';

/**
 * 读一页事件的条数（与存储层 DAO 的单页上限同值 —— 一次要满，省得反复翻页）。
 */
export const SESSION_REFERENCE_PAGE_SIZE = 200;

/**
 * 最多向前翻几页找压缩摘要（**有界**：读事件不许无界翻页 —— 长会话几千条事件，
 *   一口气读完会把主线程堵住；性能铁律：读也要有上限）。
 */
export const SESSION_REFERENCE_MAX_PAGES = 3;

/** 解析结果。 */
export interface SessionReferenceResolution {
  /** 是否解析成功（失败 = 有引用但解析不出来 → **不注入**）。 */
  readonly ok: boolean;
  /** 注入块（失败 = 空串 —— 调用方据此不拼前缀）。 */
  readonly block: string;
  /** 被引用的会话 id（保序去重；失败时也有 —— 便于回话给用户说清是哪几个）。 */
  readonly targetIds: readonly string[];
  /** 非法 token（写法不对的引用；空 = 语法没问题）。 */
  readonly invalid: readonly string[];
  /** 失败原因（人话；ok=false 时必有）。 */
  readonly reason?: string;
}

/** 解析服务的端口（读口由组合根注入 —— service 不认存储实现）。 */
export interface SessionReferenceServiceDeps {
  /** 读会话摘要（存在性 + 标题）；没有这条会话 → null（**不编造**）。 */
  readonly readSession: (sessionId: string) => SessionRecord | null;
  /**
   * 读会话事件的一段（seq 正序；缺省 beforeSeq = 最新 limit 条，给了 = 该游标之前的 limit 条）。
   * 口径与存储层 DAO 一致（core/session 的 manager 读事件也是这条口径）。
   */
  readonly readSessionEvents: (
    sessionId: string,
    options: { readonly beforeSeq?: number; readonly limit: number }
  ) => readonly SessionEventView[];
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

/** 解析服务（对外形状）。 */
export interface SessionReferenceService {
  /** 解析一段输入里的 @会话引用 → 注入块。 */
  resolve(input: string): SessionReferenceResolution;
}

/**
 * 造解析服务。
 *
 * @param deps 读口（组合根注入：会话摘要在会话域的 store，事件在进程内事件日志 / 库）。
 */
export function createSessionReferenceService(deps: SessionReferenceServiceDeps): SessionReferenceService {
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });

  /**
   * 读目标会话的近期事件（**向前翻页找压缩摘要**，有界）。
   *
   * why 要向前翻：压缩摘要是**折叠那一刻**追加的事件，它可能落在"最近一页"之外
   *   （长会话折叠过之后又聊了很久）。只看最后一页就找不到摘要 → 明明有摘要却只给原文。
   * why 有界：最多 SESSION_REFERENCE_MAX_PAGES 页（翻完即止）—— 读也要有上限。
   */
  const readRecentEvents = (sessionId: string): readonly SessionEventView[] => {
    const pages: SessionEventView[][] = [];
    let beforeSeq: number | undefined;
    for (let page = 0; page < SESSION_REFERENCE_MAX_PAGES; page += 1) {
      let chunk: readonly SessionEventView[];
      try {
        chunk =
          beforeSeq === undefined
            ? deps.readSessionEvents(sessionId, { limit: SESSION_REFERENCE_PAGE_SIZE })
            : deps.readSessionEvents(sessionId, {
                beforeSeq,
                limit: SESSION_REFERENCE_PAGE_SIZE,
              });
      } catch (error) {
        // 读事件失败 = 拿不到这段上下文：如实降级成"没有内容"，不编造，也不炸掉整个流程。
        logger(`[session-reference] 读会话事件失败（${sessionId}）：${describe(error)}`);
        break;
      }
      if (chunk.length === 0) break;
      pages.unshift([...chunk]);
      const first = chunk[0]!.seq;
      // 无进展护栏：读口若忽略游标会永远返回同一段 —— 停（最坏是少读，不是死循环）。
      if (beforeSeq !== undefined && first >= beforeSeq) break;
      if (chunk.length < SESSION_REFERENCE_PAGE_SIZE) break; // 这一页没读满 = 后面没有了
      beforeSeq = first;
    }
    return pages.flat();
  };

  return {
    resolve(input: string): SessionReferenceResolution {
      const parsed = parseSessionReferences(input);
      if (parsed.ids.length === 0 && parsed.invalid.length === 0) {
        // 没有引用：不是错误（绝大多数输入都走这条）。
        return { ok: true, block: '', targetIds: [], invalid: [] };
      }
      if (parsed.invalid.length > 0) {
        return {
          ok: false,
          block: '',
          targetIds: parsed.ids,
          invalid: parsed.invalid,
          reason: `引用写法不合法：${parsed.invalid.join('、')}（正确写法：${SESSION_REFERENCE_PREFIX}<会话 id>）`,
        };
      }
      if (parsed.ids.length > SESSION_REFERENCE_MAX_TARGETS) {
        return {
          ok: false,
          block: '',
          targetIds: parsed.ids,
          invalid: [],
          reason: `一次最多引用 ${SESSION_REFERENCE_MAX_TARGETS} 个会话（当前 ${parsed.ids.length} 个）`,
        };
      }

      const sources: SessionReferenceSource[] = [];
      for (const sessionId of parsed.ids) {
        let session: SessionRecord | null = null;
        try {
          session = deps.readSession(sessionId);
        } catch (error) {
          logger(`[session-reference] 读会话摘要失败（${sessionId}）：${describe(error)}`);
          session = null;
        }
        if (!session) {
          // 不存在即报错（不编造、不降级）。
          return {
            ok: false,
            block: '',
            targetIds: parsed.ids,
            invalid: [],
            reason: `引用的会话「${sessionId}」不存在`,
          };
        }
        sources.push({ session, events: readRecentEvents(sessionId) });
      }

      const block = buildSessionReferenceBlock(sources);
      const hasContent = sources.some((source) => source.events.length > 0);
      if (!hasContent) {
        // 会话存在但**读不到任何事件**（事件源没附着 / 这场会话没有事件）：
        // 如实说明（不是"不存在"，是"没有内容"）—— 两者对用户的处置不同。
        return {
          ok: false,
          block: '',
          targetIds: parsed.ids,
          invalid: [],
          reason: `引用的会话「${parsed.ids[0]}」没有可注入的内容（会话历史未接入）`,
        };
      }
      return { ok: true, block, targetIds: parsed.ids, invalid: [] };
    },
  };
}

/**
 * 解析一段输入里的 @会话引用（**没有解析器时也如实报错**）。
 *
 * why 单独包一层：两个入口（互聊 / 任务）都要处理"会话域没接"这件事 ——
 *   用户写了 `@session_xxx` 却什么都没发生，是最坏的一种体验（他以为引用上了）。
 *   没有解析器 = 会话域不可用（远程模式 / 未接线）→ **明说**。
 *
 * @param input 自由文本。
 * @param service 解析服务；缺省 = 会话域不可用。
 */
export function resolveSessionReferences(
  input: string,
  service: SessionReferenceService | undefined
): SessionReferenceResolution {
  if (service) return service.resolve(input);
  const parsed = parseSessionReferences(input);
  if (parsed.ids.length === 0 && parsed.invalid.length === 0) {
    return { ok: true, block: '', targetIds: [], invalid: [] };
  }
  return {
    ok: false,
    block: '',
    targetIds: parsed.ids,
    invalid: parsed.invalid,
    reason: `会话引用未接入（会话域不可用），无法解析 ${SESSION_REFERENCE_PREFIX}<会话 id>`,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
