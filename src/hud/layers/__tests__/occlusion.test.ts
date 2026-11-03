/**
 * 集成测试：遮挡规则机制层（hud/layers/occlusion.ts，@since v3.5，task_099）。
 * @jest-environment jsdom
 *
 * 覆盖方案 docs/interaction-reduction-v3.5.md §二 的三条规则：
 *   R1 全屏弹窗 = 模态：登记 → 四角常驻件降对比（**复用 096 的 L1 通道**）+ 禁点 → 关闭全恢复；
 *   R2 侧滑抽屉 = 半模态：只报状态，**不降对比、不禁点**（四角照常可点）；
 *   R4 统一关闭途径：ESC 关栈顶 + 点遮罩关（双途径各自成一路）。
 *
 * 断言口径：降对比看**通道变量**（--srf-layer-l1-opacity，jsdom 不解析 var()，
 *   所以不拿 getComputedStyle 的 opacity 当证据）；禁点看 getComputedStyle 的 pointer-events
 *   （jsdom 的层叠支持属性选择器 + 特异度，已验证）。
 */

import { HUD_LAYER_METRICS } from '../../../core/theme/visual-spec';
import {
  INFO_LAYER_CSS_VARS,
  createInfoLayerController,
  type InfoLayerController,
} from '../info-layer';
import {
  MODAL_DIM_SOURCE,
  OCCLUSION_CORNER_REGIONS,
  OCCLUSION_DRAWER_ATTRIBUTE,
  OCCLUSION_MODAL_ATTRIBUTE,
  OCCLUSION_STYLE_ID,
  buildOcclusionCss,
  createOcclusionController,
  mountModalShell,
  type OcclusionController,
} from '../occlusion';

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

/** 假 L1 通道写入口：记录触发源的登记 / 撤掉（证明「复用通道」而不是另造变量）。 */
function makeDimSpy(): {
  readonly calls: { source: string; opacity: number | null }[];
  setDimSource(source: string, opacity: number | null): void;
} {
  const calls: { source: string; opacity: number | null }[] = [];
  return {
    calls,
    setDimSource: (source, opacity) => {
      calls.push({ source, opacity });
    },
  };
}

describe('hud/layers/occlusion：R1 全屏弹窗 = 模态', () => {
  let layer: InfoLayerController;
  let occlusion: OcclusionController;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute(OCCLUSION_MODAL_ATTRIBUTE);
    document.documentElement.removeAttribute(OCCLUSION_DRAWER_ATTRIBUTE);
    layer = createInfoLayerController();
    occlusion = createOcclusionController({ l1Dim: layer });
  });

  afterEach(() => {
    occlusion.destroy();
    layer.destroy();
  });

  test('初始态：没有弹窗 → 标记属性为 false，L1 通道保持满对比', () => {
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
  });

  test('登记全屏弹窗：四角降对比走的是 096 那条 L1 通道（没另造变量）', () => {
    occlusion.openModal('settings');
    // 通道变量被写成降对比值 —— 复用 --srf-layer-l1-opacity，不是新变量。
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('true');
  });

  test('关闭弹窗：全恢复（通道回满对比、标记回 false）', () => {
    occlusion.openModal('settings');
    occlusion.closeModal('settings');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');
  });

  test('弹窗与 L3 演出叠加：取最暗的那个；演出退、弹窗还在 → 仍是弹窗那档', () => {
    layer.apply('L3');
    occlusion.openModal('settings');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    // 演出退场（L3 → L1）：弹窗还开着 → L1 仍是暗的（弹窗的触发源独立存在）。
    layer.apply('L1');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    // 弹窗关 → 回到层级口径（L1 = 满对比）。
    occlusion.closeModal('settings');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
  });

  test('触发源登记口：开 → 登记一个源；关 → 撤掉同一个源', () => {
    const dim = makeDimSpy();
    const controller = createOcclusionController({ l1Dim: dim });
    controller.openModal('settings');
    expect(dim.calls).toEqual([
      { source: MODAL_DIM_SOURCE, opacity: HUD_LAYER_METRICS.l1DimOpacity },
    ]);
    controller.closeModal('settings');
    expect(dim.calls[1]).toEqual({ source: MODAL_DIM_SOURCE, opacity: null });
    controller.destroy();
  });

  test('样式表：四个角件统一降对比 + 禁点（规则只读通道变量）', () => {
    const css = buildOcclusionCss();
    for (const selector of OCCLUSION_CORNER_REGIONS) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('pointer-events: none');
    // 降对比读的是 L1 通道变量 —— 另一个通道都没有。
    expect(css).toContain(`var(${INFO_LAYER_CSS_VARS.l1Opacity}`);
    expect(css).not.toContain('--srf-modal');
    expect(document.getElementById(OCCLUSION_STYLE_ID)).not.toBeNull();
  });

  test('四角件在弹窗开着时真的 pointer-events:none，关掉后恢复可点', () => {
    const corners = OCCLUSION_CORNER_REGIONS.map((selector) => {
      // 用标签名对上选择器（strat-minimap / strat-marquee 是自定义元素名）。
      const el = selector.startsWith('.')
        ? document.createElement('div')
        : document.createElement(selector);
      if (selector.startsWith('.')) el.className = selector.slice(1);
      document.body.appendChild(el);
      return el;
    });

    expect(getComputedStyle(corners[0]!).pointerEvents).not.toBe('none');
    occlusion.openModal('settings');
    for (const corner of corners) {
      expect(getComputedStyle(corner).pointerEvents).toBe('none');
    }
    occlusion.closeModal('settings');
    for (const corner of corners) {
      expect(getComputedStyle(corner).pointerEvents).not.toBe('none');
    }
    for (const corner of corners) corner.remove();
  });

  test('同一时刻至多一个全屏弹窗：后来者顶掉前者（栈顶即当前模态）', () => {
    occlusion.openModal('settings');
    occlusion.openModal('character');
    expect(occlusion.state.modals).toEqual(['settings', 'character']);
    expect(occlusion.state.activeModal).toBe('character');
    // 重复登记同一个 id 不重复入栈。
    occlusion.openModal('character');
    expect(occlusion.state.modals).toEqual(['settings', 'character']);
  });

  test('ESC 只关最上层的那个弹窗（统一关闭途径 R4 的路由）', () => {
    const closed: string[] = [];
    occlusion.openModal('settings', () => closed.push('settings'));
    occlusion.openModal('character', () => closed.push('character'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual(['character']);
    expect(occlusion.state.activeModal).toBe('settings');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual(['character', 'settings']);
    expect(occlusion.state.activeModal).toBeNull();
  });

  test('没有弹窗时 ESC 不做任何事（别去动抽屉）', () => {
    const closed: string[] = [];
    occlusion.openModal('settings', () => closed.push('settings'));
    occlusion.closeModal('settings');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual([]);
  });

  test('卸载：撤属性、撤 ESC 监听、撤通道上的降对比触发源', () => {
    const dim = makeDimSpy();
    const controller = createOcclusionController({ l1Dim: dim });
    controller.openModal('settings', () => undefined);
    controller.destroy();
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBeNull();
    expect(document.getElementById(OCCLUSION_STYLE_ID)).toBeNull();
    // 触发源被撤掉（L1 不会留在暗处）。
    expect(dim.calls[dim.calls.length - 1]).toEqual({ source: MODAL_DIM_SOURCE, opacity: null });
  });
});

describe('hud/layers/occlusion：R2 侧滑抽屉 = 半模态', () => {
  let layer: InfoLayerController;
  let occlusion: OcclusionController;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
    layer = createInfoLayerController();
    occlusion = createOcclusionController({ l1Dim: layer });
  });

  afterEach(() => {
    occlusion.destroy();
    layer.destroy();
  });

  test('抽屉开着：只报状态 —— 四角既不降对比也不禁点', () => {
    const topbar = document.createElement('div');
    topbar.className = 'hud-topbar';
    document.body.appendChild(topbar);

    occlusion.setDrawer('chat-drawer');
    expect(document.documentElement.getAttribute(OCCLUSION_DRAWER_ATTRIBUTE)).toBe('true');
    // 关键断言：抽屉**不碰** L1 通道（不降对比）。
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    // 关键断言：抽屉**不锁**四角（角件照常可点）。
    expect(getComputedStyle(topbar).pointerEvents).not.toBe('none');
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');

    topbar.remove();
  });

  test('抽屉关掉：状态复位', () => {
    occlusion.setDrawer('chat-drawer');
    occlusion.setDrawer(null);
    expect(document.documentElement.getAttribute(OCCLUSION_DRAWER_ATTRIBUTE)).toBe('false');
  });

  test('抽屉开着时弹窗仍能开：弹窗是模态（压得住抽屉）', () => {
    occlusion.setDrawer('chat-drawer');
    occlusion.openModal('settings');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    expect(occlusion.state.drawer).toBe('chat-drawer');
    expect(occlusion.state.activeModal).toBe('settings');
  });
});

describe('hud/layers/occlusion：R4 全屏弹窗壳（遮罩 + 面板 + 双关闭）', () => {
  let layer: InfoLayerController;
  let occlusion: OcclusionController;
  let host: HTMLElement;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
    layer = createInfoLayerController();
    occlusion = createOcclusionController({ l1Dim: layer });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    occlusion.destroy();
    layer.destroy();
  });

  test('弹窗壳：遮罩与面板各就各位，登记进遮挡栈', () => {
    const shell = mountModalShell({ id: 'settings', onClose: () => undefined, occlusion }, host);
    expect(host.querySelector('[data-role="modal-mask"]')).not.toBeNull();
    expect(host.querySelector('[data-role="modal-panel"]')).not.toBeNull();
    expect(occlusion.state.activeModal).toBe('settings');
    shell.unmount();
  });

  test('关闭途径一：点遮罩 → 关（点面板内容不算）', () => {
    const closed: string[] = [];
    const shell = mountModalShell(
      { id: 'settings', onClose: () => closed.push('settings'), occlusion },
      host
    );
    shell.mask.click();
    expect(closed).toEqual(['settings']);
    // 点面板不冒泡到遮罩（两者是兄弟节点）。
    shell.panel.click();
    expect(closed).toEqual(['settings']);
    shell.unmount();
  });

  test('关闭途径二：ESC → 关（经控制器路由到栈顶）', () => {
    const closed: string[] = [];
    const shell = mountModalShell(
      { id: 'settings', onClose: () => closed.push('settings'), occlusion },
      host
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual(['settings']);
    shell.unmount();
  });

  test('弹窗关掉：四角全恢复（通道回满对比、标记回 false、角件可点）', () => {
    const topbar = document.createElement('div');
    topbar.className = 'hud-topbar';
    document.body.appendChild(topbar);

    const shell = mountModalShell({ id: 'settings', onClose: () => undefined, occlusion }, host);
    expect(getComputedStyle(topbar).pointerEvents).toBe('none');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));

    shell.unmount();
    expect(getComputedStyle(topbar).pointerEvents).not.toBe('none');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');
    topbar.remove();
  });
});
