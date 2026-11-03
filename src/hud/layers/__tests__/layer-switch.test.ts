/**
 * 集成测试：信息层级三档开关（hud/layers/layer-switch.ts，@since v3.4，task_096）。
 * @jest-environment jsdom
 *
 * 覆盖：三枚按钮渲染、点按钮 → 发 HudCommand `hud.layer.set`（HUD 不自己改状态 ——
 *   真相在 core）、当前档回显（aria-pressed）、样例区的层级标记、卸载清理。
 */

import type { HudCommand } from '../../../core/types';
import { createInfoLayerController, type InfoLayerController } from '../info-layer';
import { LAYER_SWITCH_BUTTON_ROLE, LAYER_SWITCH_SAMPLE_ROLE, mountLayerSwitch } from '../layer-switch';

describe('hud/layers/layer-switch：三档开关', () => {
  let controller: InfoLayerController;
  let host: HTMLElement;
  let dispatched: HudCommand[];

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    controller = createInfoLayerController();
    host = document.createElement('div');
    document.body.appendChild(host);
    dispatched = [];
  });

  afterEach(() => {
    controller.destroy();
  });

  function mount(): { element: HTMLElement; unmount: () => void } {
    return mountLayerSwitch(
      { controller, dispatch: (command) => dispatched.push(command) },
      host,
    );
  }

  test('渲染三枚按钮（按层级词表次序）', () => {
    const { element } = mount();
    const buttons = element.querySelectorAll(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`);
    expect(buttons).toHaveLength(3);
    expect(Array.from(buttons).map((b) => (b as HTMLElement).dataset.layer)).toEqual([
      'L1',
      'L2',
      'L3',
    ]);
  });

  test('点按钮发 hud.layer.set 命令（HUD 不自己改状态）', () => {
    const { element } = mount();
    const l3 = element.querySelector<HTMLElement>('[data-layer="L3"]');
    l3?.click();
    expect(dispatched).toEqual([{ type: 'hud.layer.set', layer: 'L3' }]);
  });

  test('当前档回显（aria-pressed）随层级变化', () => {
    const { element } = mount();
    const pressed = (layer: string): string | null =>
      element.querySelector<HTMLElement>(`[data-layer="${layer}"]`)?.getAttribute('aria-pressed') ?? null;
    expect(pressed('L1')).toBe('true');
    controller.apply('L3');
    expect(pressed('L3')).toBe('true');
    expect(pressed('L1')).toBe('false');
  });

  test('样例区带层级标记（L1 / L2 各一个）—— 机制当场可见', () => {
    const { element } = mount();
    const samples = element.querySelectorAll(`[data-role="${LAYER_SWITCH_SAMPLE_ROLE}"]`);
    expect(samples).toHaveLength(2);
    expect(Array.from(samples).map((s) => (s as HTMLElement).dataset.srfLayer)).toEqual(['L1', 'L2']);
  });

  test('卸载：撤 DOM 与订阅（撤后点击不再发命令）', () => {
    const { element, unmount } = mount();
    unmount();
    expect(host.contains(element)).toBe(false);
    element.querySelector<HTMLElement>('[data-layer="L2"]')?.click();
    expect(dispatched).toEqual([]);
  });
});
