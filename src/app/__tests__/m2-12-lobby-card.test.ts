/**
 * 回归测试：**大厅空卡**（@since v3.3，task_213 / M2-12）。
 *
 * 现象（用户 15:50-15:53 实机报告）：Electron 起来后大厅里啥也没有、没有默认沙盒卡片
 *   ⇒ 用户进不去任何副本（大厅卡片是**唯一**的入口 —— design §2.4「默认沙盒是唯一的入口」口径）。
 *
 * 根因（**真相层**，不是渲染层 / 不是数据源 / 不是过滤层）：
 *   `WorldState.activeInstanceId` 开机时**从未被写过** —— core 的初始态里它缺省（undefined），
 *   而 HUD 的大厅层只认**显式 null**（缺省 = 未知，见 `src/app/main/main-entry.ts` 的判据注释）
 *   ⇒ `<strat-lobby-panel>` 永不挂载。
 *   叠加序列化：`undefined` 会被 `JSON.stringify` 丢掉 ⇒ world-sync 快照里连字段都没有
 *   ⇒ 前端拿到的永远是 undefined ⇒ 大厅面板永远不在场。
 *   修在**真相持有者**（service 进程）：开机显式写 `activeInstanceId = null`（＝大厅态）。
 *
 * ★ 为什么这个测试放在 app 层（组合根层）：它验的是**跨三层**的链
 *   （真相 service → 大厅模型 hud → 面板 DOM），组合根是唯一同时认识这三层的层。
 *
 * 覆盖 task_213 的验收口径（每条都对着本缺陷的一个**必要条件**）：
 *   ① 前提层：core 初始态里 activeInstanceId **缺省**（=「真相缺省 ≠ 大厅」这条前提本身）；
 *   ② 传输层：`undefined` 过不了 JSON（字段被丢），`null` 才活得下来（= 为什么必须显式写 null）；
 *   ③ 真相层：boot 后 `activeInstanceId === null`（**显式 null**，不是 undefined）；
 *   ④ 大厅模型：同一份真相 ⇒ 卡片**非空**（默认沙盒卡 + 「默认沙盒」角标 + 不画空态）；
 *   ⑤ DOM：`<strat-lobby-panel>` 里真的画出了那张卡（大厅不再是空卡）；
 *   ⑥ CSS：有卡时空态**不可见**（`.empty{display:flex}` 会盖掉 UA 的 `[hidden]{display:none}`）。
 *
 * 禁止事项：
 *   1. mock 数据 —— 真相来自**真的** service boot（真的注册表 / 真的发布口）；
 *   2. 造一份「假的 boot 态」塞进去 —— 断言的必须是 boot **自己**写出来的那份。
 *
 * @jest-environment jsdom
 */

import { resetBus } from '../../core/bus';
import { createInitialState, createStore } from '../../core/store';
import { DEFAULT_INSTANCE_ID, type HudCommand, type WorldState } from '../../core/types';
import { LOBBY_SANDBOX_BADGE, resolveLobbyPanel } from '../../hud/screens/lobby-catalog';
import { LOBBY_PANEL_TAG, mountLobbyPanel } from '../../hud/screens/lobby-panel';
import {
  createSnapshotMessage,
  encodeMessage,
  fromWireState,
} from '../../stratix-gateway/api/websocket/world-sync/protocol';
import { bootStratixService } from '../../stratix-gateway/service/boot';

import { createInstanceRegistryWithDefaultSandbox } from '../services/persistence/default-sandbox';

/**
 * 造一个**确定的**注册表（默认沙盒 + 一个分支名）。
 *
 * why 自己造而不吃缺省：缺省注册表会去问进程 cwd / git（node 侧适配）——
 *   那让本测试依赖「跑测试时人在哪个目录、哪个分支」⇒ 断言不稳。
 */
function makeRegistry(): ReturnType<typeof createInstanceRegistryWithDefaultSandbox> {
  return createInstanceRegistryWithDefaultSandbox({
    cwd: '/Users/kingj/code/Stratix-demo',
    branch: 'demo/v3.3',
  });
}

/** 起一份真的 service（真相持有者），返回它的 store。 */
function bootTruth(): { store: ReturnType<typeof createStore>; stop: () => void } {
  const store = createStore();
  const booted = bootStratixService({
    store,
    instanceRegistry: makeRegistry(),
    detectAgents: false,
  });
  return { store, stop: booted.stop };
}

describe('大厅空卡回归（task_213 / M2-12）', () => {
  afterEach(() => {
    resetBus();
  });

  // --------------------------------------------------------------------------
  // ① 前提层：本缺陷成立的前提 —— 真相缺省时，「大厅」这件事根本说不清
  // --------------------------------------------------------------------------
  it('前提：core 初始态里 activeInstanceId 缺省（undefined）—— 缺省 ≠ 大厅', () => {
    const initial = createInitialState();
    expect(initial.activeInstanceId).toBeUndefined();
    // why 断言「字段压根不在」而不是只断言值是 undefined：
    //   缺省这件事会一路传到 JSON（字段被丢）⇒ 收端连「有这个词」都看不到。
    expect('activeInstanceId' in initial).toBe(false);
  });

  // --------------------------------------------------------------------------
  // ② 传输层：为什么「显式 null」是唯一能活过大厅判据 + 序列化两关的写法
  // --------------------------------------------------------------------------
  it('传输：undefined 过不了 JSON（字段被丢），显式 null 才活得下来', () => {
    const missing = encodeMessage(createSnapshotMessage(1, createInitialState()));
    expect(missing).not.toBeNull();
    const missingState = JSON.parse(missing as string).state as Record<string, unknown>;
    expect('activeInstanceId' in missingState).toBe(false);

    const explicit = encodeMessage(
      createSnapshotMessage(2, { ...createInitialState(), activeInstanceId: null }),
    );
    const explicitState = JSON.parse(explicit as string).state as Record<string, unknown>;
    expect(explicitState.activeInstanceId).toBeNull();
    // 收端拿到的必须是**显式 null**（HUD 的大厅判据只认它）。
    expect(fromWireState(explicitState as never).activeInstanceId).toBeNull();
  });

  // --------------------------------------------------------------------------
  // ③ 真相层：service boot 显式说「大厅态」
  // --------------------------------------------------------------------------
  it('boot：真相显式说「大厅态」（activeInstanceId = null，不是 undefined）', () => {
    const { store, stop } = bootTruth();
    // why 断言的是「显式 null」而不是「不是某个实例」：
    //   HUD 大厅层只认**显式 null**（缺省 = 未知）—— undefined 会让面板永不挂载。
    expect(store.getState().activeInstanceId).toBeNull();
    expect('activeInstanceId' in store.getState()).toBe(true);
    stop();
  });

  it('boot：清单先发布、大厅态后宣布（谁看见 null，谁就看得见卡片）', () => {
    const { store, stop } = bootTruth();
    const state = store.getState();
    // 不变量：activeInstanceId === null ⇒ projectInstances 已有内容（不会有「空面板」的一帧）。
    expect(state.activeInstanceId).toBeNull();
    expect((state.projectInstances ?? []).length).toBeGreaterThan(0);
    stop();
  });

  // --------------------------------------------------------------------------
  // ④ 大厅模型层
  // --------------------------------------------------------------------------
  it('boot 真相 ⇒ 大厅卡片非空：默认沙盒卡在、角标在、不画空态', () => {
    const { store, stop } = bootTruth();
    const state = store.getState();
    // 卡片的数据源：默认沙盒被**真的**发布了（不是测试塞的）。
    expect((state.projectInstances ?? []).map((view) => view.instanceId)).toContain(DEFAULT_INSTANCE_ID);

    const model = resolveLobbyPanel(state);
    expect(model.empty).toBe(false);
    expect(model.cards.length).toBeGreaterThanOrEqual(1);

    const sandbox = model.cards.find((card) => card.instanceId === DEFAULT_INSTANCE_ID);
    expect(sandbox).toBeDefined();
    expect(sandbox?.sandbox).toBe(true);
    expect(sandbox?.enterable).toBe(true);
    // 派单入口有目标（默认沙盒恒存）⇒ 用户不会被锁死。
    expect(model.dispatchEnabled).toBe(true);
    expect(model.dispatchTargetId).toBe(DEFAULT_INSTANCE_ID);
    stop();
  });

  // --------------------------------------------------------------------------
  // ⑤ DOM 层：面板里真的有那张卡
  // --------------------------------------------------------------------------
  it('boot 真相 ⇒ 面板 DOM 里真的有那张卡（大厅不再是空卡）', () => {
    const { store, stop } = bootTruth();
    const state = store.getState();

    // 面板按组合根的判据挂起：`activeInstanceId === null` ⇒ 大厅在场（src/app/main/main-entry.ts）。
    expect(state.activeInstanceId).toBeNull();

    const commands: HudCommand[] = [];
    const subs = new Set<(s: WorldState) => void>();
    const deps = {
      dispatch: (command: HudCommand) => { commands.push(command); },
      subscribe: (handler: (s: WorldState) => void) => {
        subs.add(handler);
        handler(state);
        return () => { subs.delete(handler); };
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountLobbyPanel(deps, host);
    const panel = host.querySelector(LOBBY_PANEL_TAG);
    const shadow = panel?.shadowRoot ?? null;

    // 卡片在（大厅不再是空卡）。
    const card = shadow?.querySelector(`[data-role="card"][data-instance-id="${DEFAULT_INSTANCE_ID}"]`);
    expect(card).not.toBeNull();
    // 角标在（默认沙盒卡标「默认沙盒」—— design §7.1 M1-14 行验收②）。
    expect(shadow?.textContent ?? '').toContain(LOBBY_SANDBOX_BADGE);
    // 进入按钮在（卡片不是摆件 —— 点它会派 project.enter）。
    const enter = shadow?.querySelector(`[data-role="enter"][data-instance-id="${DEFAULT_INSTANCE_ID}"]`);
    expect(enter).not.toBeNull();
    expect((enter as HTMLButtonElement).disabled).toBe(false);

    // 点卡片 ⇒ 派 project.enter（core 裁决）。
    (enter as HTMLButtonElement).click();
    expect(commands).toEqual([{ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID }]);

    mounted.unmount();
    host.remove();
    stop();
  });

  // --------------------------------------------------------------------------
  // ⑥ CSS 层：有卡时空态必须**不可见**
  // --------------------------------------------------------------------------
  it('CSS：有卡时空态不可见（.empty 的 display:flex 会盖掉 UA 的 [hidden]{display:none}）', () => {
    const { store, stop } = bootTruth();
    const state = store.getState();
    const deps = {
      dispatch: (command: HudCommand) => { void command; },
      subscribe: (handler: (s: WorldState) => void) => {
        handler(state);
        return () => undefined;
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountLobbyPanel(deps, host);
    const panel = host.querySelector(LOBBY_PANEL_TAG);
    const shadow = panel?.shadowRoot ?? null;
    const empty = shadow?.querySelector('[data-role="empty"]') as HTMLElement | null;

    // 组件用 hidden 属性表达「此刻不画空态」。
    expect(empty?.hasAttribute('hidden')).toBe(true);

    // why 把组件的**真实**样式表搬到文档级再算一次级联：
    //   jsdom **不应用 shadow 样式表**（style.sheet 为 null）⇒ 直接 getComputedStyle
    //   只会看到 UA 的 [hidden]{display:none}，测不出「作者样式盖掉 UA」这件事；
    //   搬到文档级后 jsdom 会真的跑级联（作者样式 > UA 样式）⇒ 这条断言才有判别力。
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    expect(styleText.length).toBeGreaterThan(0);
    const probeStyle = document.createElement('style');
    probeStyle.textContent = styleText;
    document.head.appendChild(probeStyle);
    try {
      const probe = document.createElement('div');
      probe.className = 'empty';
      probe.setAttribute('hidden', '');
      document.body.appendChild(probe);
      // 没有 `.empty[hidden]{display:none}` 这一条时，作者的 `.empty{display:flex}` 会赢
      //   ⇒ 有卡时空态照样露脸（一张卡 + 「没有可用副本」同屏 = 自相矛盾）。
      expect(window.getComputedStyle(probe).display).toBe('none');
      probe.remove();
    } finally {
      probeStyle.remove();
    }

    mounted.unmount();
    host.remove();
    stop();
  });
});
