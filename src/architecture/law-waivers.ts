/**
 * 文件职责：**架构铁律的豁免账本**（@since v3.3，task_222 / QA-02）。
 *
 *   账本是什么：扫描器（law-scanner.ts）跑出来的**现存历史债**逐条登记在这里。
 *   账本怎么用：
 *     - 账本里有、扫描器也扫到 ⇒ 记为「已豁免」，报告里照实打出来，但不红；
 *     - 扫描器扫到、账本里没有 ⇒ **未豁免违规** ⇒ 测试失败、CI 红（棘轮：只许变少不许变多）；
 *     - 账本里有、扫描器扫不到 ⇒ 过期豁免 ⇒ 报告里提示可清理（不阻断，避免别的单修完债后 CI 假红）。
 *   禁止事项：
 *     1. 把豁免当「顺手放过」—— 每条必须写清理由与后续处置（followUp）；
 *     2. 悄悄扩大豁免范围 —— 键是（铁律 + 文件 + 符号），多一个字符都不匹配；
 *     3. 在这里改产品代码 —— 修债是别的单的事，本单只记账。
 */

/** 一条豁免。 */
export interface LawWaiver {
  /** 稳定编号（W-01 …），报告里直接引用。 */
  readonly id: string;
  /** 所属铁律。 */
  readonly lawId: 'LAW-1' | 'LAW-2' | 'LAW-3' | 'LAW-4' | 'LAW-5';
  /** 违规所在文件（仓库相对 posix 路径）。 */
  readonly file: string;
  /** 违规符号（与扫描器 finding.symbol 对齐）。 */
  readonly symbol: string;
  /** 为什么豁免（人读）。 */
  readonly reason: string;
  /** 后续处置（另开单修 / 随某次重构消失）。 */
  readonly followUp: string;
}

/** 豁免账本（首跑时的现存历史债，9 条）。 */
export const LAW_WAIVERS: readonly LawWaiver[] = [
  {
    id: 'W-01',
    lawId: 'LAW-2',
    file: 'src/core/agent-link/gateway-transport.ts',
    symbol: 'globalThis.fetch',
    reason:
      'agent-link 的 transport **端口实现**放在了 core 里，默认直接用全局 fetch 打网关（options.fetchImpl 缺省时回落 globalThis.fetch）。' +
      '按铁律这条 IO 该留在 app 层、core 只留端口 + 协议，由组合根注入；属产品代码改动，本单只记账。',
    followUp: '另开单：把 gateway transport 的真实实现下沉到 app 层（core 只留 AgentLinkTransport 端口与 protocol 形状）。',
  },
  {
    id: 'W-02',
    lawId: 'LAW-2',
    file: 'src/core/agent-link/gateway-transport.ts',
    symbol: 'globalThis.WebSocket',
    reason:
      '同 W-01：WS 通道工厂的默认实现同样落在 core（options.WebSocketImpl 缺省时回落 globalThis.WebSocket），属 core 里的网络出口。',
    followUp: '另开单：WS 通道工厂随 W-01 一起下沉到 app 层。',
  },
  {
    id: 'W-03',
    lawId: 'LAW-3',
    file: 'src/core/theme/visual-spec.ts',
    symbol: 'pixelfx',
    reason:
      '仅**注释**里提到 pixelfx（二期代码路由的逐像素成本实测出处：docs/research/pixelfx-runtime-poc.md），不是依赖泄漏 —— ' +
      'core 里没有 import 任何 pixelfx 符号。铁律按「名字出现」的字面口径记一条。',
    followUp: '另开单：把该注释里的库名改成中性表述（如「代码路由」），core 里不留第三方库名。',
  },
  {
    id: 'W-04',
    lawId: 'LAW-5',
    file: 'src/stratix-core/agent/types.ts',
    symbol: 'TaskStatus',
    reason:
      '遗留包 src/stratix-core（已 deprecated）自带的 agent 任务状态，与 core/types.ts 的 HUD 任务状态同名不同义；不在 v3 总线契约域内。',
    followUp: '随 legacy 退役删除 src/stratix-core（v3 计划内），豁免自动消失。',
  },
  {
    id: 'W-05',
    lawId: 'LAW-5',
    file: 'src/stratix-agent/types.ts',
    symbol: 'AgentProfile',
    reason: '遗留包 src/stratix-agent（已 deprecated）自己的 agent 档案形状，与 core/types.ts 的 AgentProfile 同名不同义。',
    followUp: '随 legacy 退役删除 src/stratix-agent，豁免自动消失。',
  },
  {
    id: 'W-06',
    lawId: 'LAW-5',
    file: 'src/stratix-agent/core/SessionManager.ts',
    symbol: 'SessionManager',
    reason: '遗留包 src/stratix-agent 的会话管理器类，与 core/session/manager.ts 的 SessionManager 同名不同义。',
    followUp: '随 legacy 退役删除 src/stratix-agent，豁免自动消失。',
  },
  {
    id: 'W-07',
    lawId: 'LAW-5',
    file: 'src/hud/screens/onboarding-catalog.ts',
    symbol: 'PersonaErrorCode',
    reason:
      '**真漂移风险**：HUD 预览侧自有一套人设校验码表（\'persona-too-long\'），与 core/character/persona.ts 的写入拒绝码' +
      '（empty / not-a-string / too-long）同名不同义 —— 改一边忘另一边就出事。',
    followUp: '另开单：HUD 侧复用 core 的 PersonaErrorCode（或改名区分），消掉同名。',
  },
  {
    id: 'W-08',
    lawId: 'LAW-5',
    file: 'src/app/services/persistence/session-event-dao.ts',
    symbol: 'appendSessionEvent',
    reason:
      '落库 DAO 的写事件函数与 core/session/machine.ts 的纯状态机函数同名不同义（一个写 SQLite、一个做状态迁移）。',
    followUp: '另开单：DAO 侧改名（如 appendSessionEventRow）或统一到 core 的契约命名。',
  },
  {
    id: 'W-09',
    lawId: 'LAW-5',
    file: 'src/stratix-gateway/api/routes/session-storage.ts',
    symbol: 'SessionReadPort',
    reason:
      '网关 HTTP 段**自己声明**了一份 SessionReadPort 端口，没复用 core/session/types.ts 的契约 —— 契约出现了第二个事实源（真漂移）。',
    followUp: '另开单：网关路由改 import core/session/types.ts 的 SessionReadPort。',
  },
];
