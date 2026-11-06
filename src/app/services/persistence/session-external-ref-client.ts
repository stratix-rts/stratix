/**
 * 文件职责：**外部会话引用端口的渲染侧实现**（@since v3.3，task_200 / M2-03 N4b-1）——
 *   把 `session_external_refs` 表的 IPC 面（preload 的 gameSave 段）包成 chat-service 的
 *   端口形状（`ChatExternalSessionRefPort`）。
 * 输入：preload 暴露的存档面（gameSave 的两条通道）+ 日志口。
 * 输出：chat-service 可注入的端口（读 = 联合匹配；写 = 落凭据）。
 * 禁止事项：
 *   1. import electron / sqlite —— 渲染层没有 Node 能力，一律经 IPC（与 game-save-coordinator 同纪律）；
 *   2. 在这里改口径 —— 联合键 / 副本维度的裁决在 DAO 与 design §3.4 R3，本文件只搬数据；
 *   3. 抛错打断对话 —— 引用读写是旁路：失败只降级（查不到 = 按首发处理）。
 *
 * why 单独成文件（而不是把 IPC 细节塞进 chat-service）：
 *   chat-service 是**渲染层服务**（不认识 Node / IPC）；本文件是**端口适配器**，
 *   组合根（main-entry）在这里把两者接上 —— 依赖方向保持 app → app，不让服务认识传输细节。
 *
 * @since v3.3（task_200 / M2-03 N4b-1）。
 */

import type { ChatExternalSessionRefPort } from '../chat-service';

import type { PersistedSessionExternalRef, SessionExternalRefInsert } from './session-external-ref-dao';

/**
 * preload 暴露的外部会话引用通道（形状；实现见 src/electron/preload.ts 的 gameSave 段）。
 */
export interface SessionExternalRefApi {
  /** 写一条凭据。 */
  saveSessionExternalRef(ref: SessionExternalRefInsert): Promise<{ ok: boolean; error?: string }>;
  /** 读某角色在某副本的凭据（查不到 ⇒ ok=true 且 ref 缺省）。 */
  loadSessionExternalRef(
    characterId: string,
    instanceId: string
  ): Promise<{ ok: boolean; ref?: PersistedSessionExternalRef; error?: string }>;
}

/**
 * 从 window.electronAPI 取外部会话引用面；非 Electron 环境（纯 vite dev）或旧 preload
 *   （没有这两条通道）⇒ 返回 null ⇒ 调用方不接端口（服务回落旧口径，不炸）。
 */
export function sessionExternalRefApi(): SessionExternalRefApi | null {
  const api = (window as unknown as { electronAPI?: { gameSave?: Partial<SessionExternalRefApi> } })
    .electronAPI;
  const face = api?.gameSave;
  if (!face) return null;
  if (typeof face.saveSessionExternalRef !== 'function') return null;
  if (typeof face.loadSessionExternalRef !== 'function') return null;
  return face as SessionExternalRefApi;
}

/**
 * 组装端口（组合根用）。
 *
 * 读失败 ⇒ null（= 按首发处理，不复用外部会话）——**不抛**：R3 的语义是「查不到就不 resume」，
 *   查失败与查不到同口径（宁可少续一次，也不跨副本续）。
 * 写失败 ⇒ 只记日志（凭据缺失只降级为「重启后按首发重建」，不绑架当前这轮对话）。
 */
export function createSessionExternalRefPort(
  api: SessionExternalRefApi,
  options: { readonly logger?: (line: string) => void } = {}
): ChatExternalSessionRefPort {
  const logger = options.logger ?? ((): void => { /* 缺省静默 */ });
  return {
    async resolve(characterId: string, instanceId: string): Promise<string | null> {
      try {
        const result = await api.loadSessionExternalRef(characterId, instanceId);
        if (!result.ok) {
          logger(`[session-external-ref] 读凭据被拒（${characterId}/${instanceId}）：${result.error ?? 'unknown'}`);
          return null;
        }
        const externalSessionId = result.ref?.externalSessionId;
        return typeof externalSessionId === 'string' && externalSessionId.length > 0
          ? externalSessionId
          : null;
      } catch (error) {
        logger(`[session-external-ref] 读凭据抛错（${characterId}/${instanceId}）：${String(error)}`);
        return null;
      }
    },
    record(ref: {
      readonly externalSessionId: string;
      readonly instanceId: string;
      readonly characterId: string;
      readonly sessionId: string | null;
    }): void {
      void api
        .saveSessionExternalRef({ ...ref, createdAt: Date.now() })
        .then((result) => {
          if (!result.ok) {
            logger(`[session-external-ref] 写凭据被拒（${ref.characterId}/${ref.instanceId}）：${result.error ?? 'unknown'}`);
          }
        })
        .catch((error) => {
          logger(`[session-external-ref] 写凭据抛错（${ref.characterId}/${ref.instanceId}）：${String(error)}`);
        });
    },
  };
}
