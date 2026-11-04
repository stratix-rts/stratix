/**
 * 文件职责：**网关连通性的三级状态契约**（@since v3.7，task_127）——
 *   网关连通性不再是「连上 / 没连」二值，而是三级：
 *     online   —— HTTP 与实时通道（WS）都通：一切正常。
 *     degraded —— HTTP 通、实时通道断：**数据可用，实时更新不可用**（半连接态）。
 *     offline  —— HTTP 不通：网关整体不可达，功能没有数据。
 *   why 必须三级（task_127 的复测证据：reports/2026-11-04-stratix-ui-review.md 新发现 #2）：
 *     二值模型下「HTTP 通、WS 断」只能落进「没连」——于是态势屏恒显「未连接」，
 *     而回放照样读得出真数据，界面自相矛盾，用户没法判断「现在到底能不能用」。
 *   契约与文案都放 HUD 的一处（横幅与状态屏共用同一份形状 + 同一套词 —— 单一真相源）：
 *     app 层照形状实现判定（app/services/gateway-link.ts 探 /health + 探 WS）。
 * 禁止事项：
 *   1. 在 HUD 侧自己探活 —— 连通性判定归 app 层（单一判定方），HUD 只呈现；
 *   2. 各处各写一份文案 —— 三态词表在本文件一处，横幅与状态行都从这里取，
 *      否则两处迟早漂移成两个矛盾的答案（这正是 task_127 要修的病根）。
 */

/** 网关连通性三级态。 */
export type GatewayConnectionState = 'online' | 'degraded' | 'offline';

/**
 * 连通性端口（HUD 侧的**契约**；app 层实现它）。
 * 形状与 task_114 的二值端口同源，只是把 `online: boolean` 升级为三级态 ——
 *   调用方（HUD 横幅 / 状态屏）读的都是同一个真相源，不各判各的。
 */
export interface GatewayLinkPort {
  /** 同步读当前三级态。初始按「在线」处理 —— 别在首帧闪一条横幅。 */
  readonly state: GatewayConnectionState;
  /** 订阅三级态变化（注册后立刻推一次当前值）；返回退订闭包。 */
  subscribe(handler: (state: GatewayConnectionState) => void): () => void;
  /** 立刻探一次（重试按钮用）；返回探测后的三级态。 */
  refresh(): Promise<GatewayConnectionState>;
}

/** 三态的共享文案（横幅与状态行共用 —— 同一套词，不各写一份）。 */
export interface GatewayStateText {
  /** 状态行的取值（态势屏「网关连接」那一行的值列）。 */
  readonly label: string;
  /** 说明句：说清「现在能不能用」。横幅与状态行共用同一句。 */
  readonly detail: string;
  /** 全局横幅的标题（离线态沿用 task_114 原文案，语义不变）。 */
  readonly bannerTitle: string;
}

/**
 * 三态词表（唯一事实源）。
 * 离线态的标题/说明**逐字沿用 task_114**（「网关未连接 · 多数功能暂时没有数据」）——
 *   这次只补中间那一级，不动两头的既有语义（验收 4：114 横幅行为不回退）。
 */
export const GATEWAY_STATE_TEXT: Readonly<Record<GatewayConnectionState, GatewayStateText>> = {
  online: {
    label: '已连接',
    detail: '数据和实时消息都正常',
    bannerTitle: '服务已连接',
  },
  degraded: {
    label: '连接降级',
    detail: '数据能看，实时更新断了',
    bannerTitle: '连接降级',
  },
  offline: {
    label: '未连接',
    detail: '多数功能暂时没有数据',
    bannerTitle: '服务未连接',
  },
};
