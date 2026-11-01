/**
 * 文件职责：远程 store 模块的**公开出口**（前后端分离 B3 / task_083）。
 * 输入：remote-store.ts 的实现与契约类型。
 * 输出：`createRemoteStore` / `RemoteStore` / `RemoteStoreOptions` / `RemoteSocket` /
 *   `RemoteCommandResult` / `DEFAULT_WORLD_SYNC_URL` 等对外面。
 * 禁止事项：
 *   1. 在这里写逻辑 —— 本文件只做再导出（出口单一，避免调用方摸到内部实现）；
 *   2. 导出协议层内部细节 —— world-sync 的协议类型由 protocol.ts 自己负责。
 *
 * 配套契约：docs/WORLD-SYNC.md｜remote-store.ts（本模块实现）
 */

export {
  DEFAULT_WORLD_SYNC_PORT,
  DEFAULT_WORLD_SYNC_URL,
  createRemoteStore,
  type RemoteCommandResult,
  type RemoteSocket,
  type RemoteStore,
  type RemoteStoreOptions,
} from './remote-store';
