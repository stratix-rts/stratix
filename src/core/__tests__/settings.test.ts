/**
 * 单测：用户偏好落库（core/store.ts 的 setPreference / applyPreference + core/types.ts 的契约增补，@since v3.5）。
 * 覆盖：默认值起步、写入广播、值未变不广播（引用不变）、WorldState.settings 缺省时回落 DEFAULT_SETTINGS。
 * 这里不打桩：偏好写入的唯一语义就是"换掉一个字段再广播"，桩掉就等于没测。
 */

import { applyPreference, createStore } from '../store';
import { DEFAULT_SETTINGS } from '../types';

describe('偏好契约（@since v3.5）', () => {
  test('初始状态按契约默认值起步（两侧读到的第一份偏好是同一个值）', () => {
    const store = createStore();
    expect(store.getState().settings).toBe(DEFAULT_SETTINGS);
  });

  test('applyPreference：写一个键不影响另一个键', () => {
    const next = applyPreference(DEFAULT_SETTINGS, 'soundEnabled', false);
    expect(next).toEqual({ soundEnabled: false, notificationsEnabled: true });
  });

  test('applyPreference：settings 缺省时从契约默认值起算（不编造默认值）', () => {
    expect(applyPreference(undefined, 'notificationsEnabled', false))
      .toEqual({ soundEnabled: true, notificationsEnabled: false });
  });

  test('applyPreference：值没变就返回同一引用（无实质变化不制造新对象）', () => {
    expect(applyPreference(DEFAULT_SETTINGS, 'soundEnabled', true)).toBe(DEFAULT_SETTINGS);
  });
});

describe('CoreStore.setPreference', () => {
  test('写入即广播，订阅者拿到的是新偏好', () => {
    const store = createStore();
    const seen: boolean[] = [];
    store.subscribe((state) => seen.push(state.settings?.soundEnabled ?? false));

    store.setPreference('soundEnabled', false);

    expect(store.getState().settings?.soundEnabled).toBe(false);
    expect(seen).toEqual([false]);
  });

  test('写同一个值两次：第二次不改引用也不广播（core 每次广播都有成本）', () => {
    const store = createStore();
    store.setPreference('soundEnabled', false);
    const afterFirst = store.getState().settings;

    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    const returned = store.setPreference('soundEnabled', false);

    expect(returned).toBe(store.getState());
    expect(store.getState().settings).toBe(afterFirst);
    expect(broadcasts).toBe(0);
  });
});