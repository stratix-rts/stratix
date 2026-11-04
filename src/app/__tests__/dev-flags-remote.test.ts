/**
 * 单测：远程模式（= world-sync 连接）开关的取值口径 —— @since v3.10，task_153。
 *
 * 覆盖 task_153 的产品语义反转：**连本地网关是默认**（缺省即开），
 * 显式 `0` / `off` / `false` / `no` 才关（测试口 / 本地直连回退口）；
 * URL 覆盖（`?stratix-remote=0`）优先级最高 —— 同一台 dev server 上按 URL 切模式。
 *
 * why 单测它：默认值是「用户看不到 agent」这类故障的根因（task_153 的实测反馈），
 *   这条口径必须锁死 —— 改错了就是「战场恒空」复发。
 *
 * @jest-environment jsdom
 */

import { isRemoteModeEnabled } from '../main/dev-flags';

describe('远程模式开关（STRATIX_REMOTE / ?stratix-remote）', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    window.history.replaceState({}, '', '/');
  });

  test('缺省即开（两路来源都没给）—— 连本地网关是默认', () => {
    expect(isRemoteModeEnabled()).toBe(true);
  });

  test('运行时环境变量为 0 / off / false / no → 关（本地直连回退口）', () => {
    for (const raw of ['0', 'off', 'OFF', 'false', 'no']) {
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        env: { STRATIX_REMOTE: raw },
      };
      expect(isRemoteModeEnabled()).toBe(false);
    }
  });

  test('运行时环境变量为 1 → 开（显式开）', () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      env: { STRATIX_REMOTE: '1' },
    };
    expect(isRemoteModeEnabled()).toBe(true);
  });

  test('URL 覆盖优先于运行时环境变量（?stratix-remote=0 → 关）', () => {
    window.history.replaceState({}, '', '/?stratix-remote=0');
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      env: { STRATIX_REMOTE: '1' },
    };
    expect(isRemoteModeEnabled()).toBe(false);

    window.history.replaceState({}, '', '/?stratix-remote=1');
    expect(isRemoteModeEnabled()).toBe(true);
  });
});
