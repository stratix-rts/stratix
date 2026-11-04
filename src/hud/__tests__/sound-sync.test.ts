/**
 * 单测：声音偏好的**单键数据源 + 变更广播**（@since v3.8，task_139）。
 *
 * 背景：task_130 把声音偏好收敛到一对键（stratix.sound.enabled / .volume），
 *   但设置页与顶栏声音钮各写各的 —— 设了「音效 关」，顶栏图标还停在开的样子（eval r3 的 P3）。
 *   这里钉住两条口径：
 *   ① 写入走声音引擎的写入口（唯一真源）；
 *   ② 写完广播一声「有人改了」（载荷不带状态 —— 不留第二份真相），
 *      订阅方收到后重读 localStorage 即可（顶栏图标 / aria-pressed 立刻跟上）。
 *
 * @jest-environment jsdom
 */

import {
  notifySoundChanged,
  readSoundEnabled,
  SOUND_CHANGED_EVENT,
  SOUND_ENABLED_KEY,
  subscribeSoundChanges,
  writeSoundEnabled,
} from '../sound-engine';

describe('声音偏好：单键数据源 + 变更广播（task_139）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('写入走声音引擎的键（设置页与顶栏同一个真源）', () => {
    writeSoundEnabled(false);
    expect(window.localStorage.getItem(SOUND_ENABLED_KEY)).toBe('0');
    expect(readSoundEnabled()).toBe(false);

    writeSoundEnabled(true);
    expect(window.localStorage.getItem(SOUND_ENABLED_KEY)).toBe('1');
    expect(readSoundEnabled()).toBe(true);
  });

  test('写完广播一声「有人改了」；订阅方能收到也能退订', () => {
    const seen = jest.fn();
    const off = subscribeSoundChanges(seen);

    writeSoundEnabled(false);
    expect(seen).toHaveBeenCalledTimes(1);

    off();
    writeSoundEnabled(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('广播事件名固定（订阅方按名字挂，不会互相踩）', () => {
    expect(SOUND_CHANGED_EVENT).toBe('stratix:sound-changed');
    const handler = jest.fn();
    globalThis.addEventListener(SOUND_CHANGED_EVENT, handler);
    notifySoundChanged();
    globalThis.removeEventListener(SOUND_CHANGED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
