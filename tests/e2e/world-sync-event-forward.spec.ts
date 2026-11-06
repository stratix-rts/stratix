/**
 * e2e：远程模式的**世界事件转发通道**（@since v3.3，task_156）。
 *
 * 起因（task_156 任务书）：153（0112d70）把远程模式翻成默认后，**画布交互全哑** ——
 *   点单位无选中环、框选无反应、右键移动无反应，业务态面板恒「未选中单位」。
 *   根因（任务书已确诊，勿重复诊断）：world-sync 协议此前只有 hello / command.forward
 *   两种**客户端→service** 消息型；画布交互走的是 WorldEvent（unit.click / selection.box /
 *   unit.move），进了本地总线却**零消费者**（远程模式不启本地 core runtime）→ 静默丢弃。
 *   修复：协议新增 `event.forward`（载荷 = WorldEvent），service 侧投到自己的 core 总线裁决。
 *
 * ★ 本剧本是**修复后的验收**，且必须是**远程模式真实点击**（B 轮只跑本地模式的教训：
 *   验收环境 ≠ 使用环境）。本文件全部走真实浏览器 + 真实网关 + 真实单位。
 *
 * 场景：
 *   ① 远程模式（缺省直开 7523）真实点击单位 → **选中环像素可见** + 业务态面板更新 + revision 递增；
 *      同时抓线上帧：客户端上行的是 `event.forward`（白名单通道），不是 command.forward。
 *   ② 远程模式：点空地清选 + 框选多单位 → 选择集与面板同步（selection.box 也走转发）。
 *   ③ 远程模式：纯视图事件（camera.moved）**不上行**（本地平移镜头，线上没有对应 event.forward）。
 *   ④ 远程模式：HUD 命令（command.forward 既有路径）不受影响 —— 建角色 → service 落库 → 快照回推 → 删掉。
 *   ⑤ 协议面（真 socket）：客户端发 service→客户端方向的消息型（snapshot）仍被拒；
 *      白名单外的事件（camera.moved）仍被拒（malformed_message）。
 *   ⑥ 本地模式（?stratix-remote=0）画布交互回归：本地建角色 → 真实点击 → 本地选中生效
 *      （且线上**没有** event.forward —— 本地模式零改动）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.world-sync-event.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

/** 远程模式（缺省即开 —— dev-flags 的 URL 覆盖口，见 src/app/main/dev-flags.ts）。 */
const APP_URL = '/';
/** 本地直连模式（回归用）。 */
const LOCAL_URL = '/?stratix-remote=0';
/** world-sync 通道（WS）。 */
const WS_PATTERN = '**/ws/world-sync';
/** 截图目录。 */
const SHOTS = 'reports/shots';
/** 选中环的颜色（WORLD_PALETTE.unit = #4fc3f7，见 src/core/theme/visual-spec.ts）。 */
const RING_RGB = { r: 79, g: 195, b: 247 };
/** 环色容差（抗锯齿 / 主题微调）。 */
const RING_TOLERANCE = 45;

/** 世界态的最小读数面（走既有 dev 观测句柄，不开后门）。 */
interface Snapshot {
  readonly characters: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly units: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly selection: { readonly unitIds: readonly string[]; readonly revision: number };
}

/** 线上帧（客户端 → service 方向）。 */
interface Frame {
  readonly type: string;
  readonly event?: { readonly type?: string; readonly unitId?: string };
  readonly command?: { readonly type?: string };
}

/** 读当前世界态快照。 */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __srfApp?: { snapshot: () => unknown } }).__srfApp;
    return handle?.snapshot() as Snapshot;
  });
}

/**
 * 起页面并等 HUD 就位。
 *
 * @param options.url 入口（缺省 = 远程模式）；expectUnits 是否等战场上出现单位
 *   （远程模式：等 service 的快照把单位推过来；本地模式：空战场，要等剧本自己建角色）。
 */
async function boot(
  page: Page,
  options: { readonly url?: string; readonly expectUnits?: boolean } = {},
): Promise<void> {
  const url = options.url ?? APP_URL;
  const expectUnits = options.expectUnits ?? true;
  await page.goto(url);
  await page.waitForSelector('strat-status-screen', { timeout: 30_000 });
  // 首启向导（本地模式会出现；远程模式的角色来自 service 名册，向导不会拦路）。
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
  if (expectUnits) {
    await page.waitForFunction(
      () => {
        const handle = (window as unknown as { __srfApp?: { snapshot: () => Snapshot | null } }).__srfApp;
        const state = handle?.snapshot();
        return !!state && state.units.length > 0;
      },
      undefined,
      { timeout: 30_000 },
    );
  }
  // 等单位真的落到战场上（画面同步是异步的一帧）。
  await page.waitForTimeout(600);
}

/**
 * 抓客户端 → service 的线上帧（真 socket 旁路：转发到真网关，不改内容）。
 * why 需要它：光看 UI 变没变，分不清「事件上了行」与「本地自己消化了」。
 */
async function captureClientFrames(page: Page): Promise<Frame[]> {
  const frames: Frame[] = [];
  await page.routeWebSocket(WS_PATTERN, (ws) => {
    const server = ws.connectToServer();
    // ws.onMessage 收到的是**页面发出**的帧（客户端 → service 方向）。
    ws.onMessage((message) => {
      try {
        frames.push(JSON.parse(message.toString()) as Frame);
      } catch {
        // 非 JSON 帧不计（协议层只发 JSON）。
      }
      server.send(message); // 原样转发给真网关（旁路不改内容）。
    });
  });
  return frames;
}

/**
 * 画面中心附近「环色像素」的个数（选中环是 Phaser Graphics，DOM 看不见 —— 用像素验它真的画出来了）。
 *
 * why 取**差值**而不是绝对值：单位**本体**也是青色调（WORLD_PALETTE.unit），未选中时中心附近
 *   本来就有上百个同色像素（本体 + 推进器辉光）—— 绝对值判不出「环有没有出现」。
 *   故：点前采一次基线，点后再采一次，看**增量**（选中环 = 直径 64px 的虚线环，稳态常驻）。
 * 坐标口径：canvas 的取样坐标是**设备像素**（canvas.width/height），点击坐标是 CSS 像素 ——
 *   两者按 clientWidth/clientHeight 的比例换算（devicePixelRatio ≠ 1 时才不会取偏）。
 */
async function ringPixelCount(page: Page): Promise<number> {
  return page.evaluate(
    ({ rgb, tolerance }) => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const scaleX = canvas.width / Math.max(1, canvas.clientWidth);
      const scaleY = canvas.height / Math.max(1, canvas.clientHeight);
      const cx = Math.round(canvas.clientWidth / 2 * scaleX);
      const cy = Math.round(canvas.clientHeight / 2 * scaleY);
      const box = 60; // 选中环直径 64px（半径 32px）→ ±60px 足够罩住整枚环
      const left = Math.max(0, cx - box);
      const top = Math.max(0, cy - box);
      const width = Math.min(canvas.width - left, box * 2);
      const height = Math.min(canvas.height - top, box * 2);
      const data = ctx.getImageData(left, top, width, height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        if (
          Math.abs(data[i] - rgb.r) < tolerance &&
          Math.abs(data[i + 1] - rgb.g) < tolerance &&
          Math.abs(data[i + 2] - rgb.b) < tolerance
        ) {
          count += 1;
        }
      }
      return count;
    },
    { rgb: RING_RGB, tolerance: RING_TOLERANCE },
  );
}

/** 画布上某个小区域的像素指纹（用来证明镜头真的动了 —— 否则「没上行」是空断言）。 */
async function regionFingerprint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    // 左上角一块空地（远离中心单位）：镜头一动这块的网格就换形。
    const data = ctx.getImageData(20, 20, 80, 80).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7;
    return sum;
  });
}

test.describe('远程模式世界事件转发（task_156）', () => {
  test('① 真实点击单位 → 选中环出现 + 业务态面板更新（走 event.forward 上行）', async ({ page }) => {
    const frames = await captureClientFrames(page);
    await boot(page);

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas).not.toBeNull();
    const cx = canvas!.x + canvas!.width / 2;
    const cy = canvas!.y + canvas!.height / 2;

    // —— 前置：先清掉**上一轮遗留**的选择集 ——
    //   why：service 侧的真相跨会话持久（同一份 store），上一轮点选留下的选中集会让
    //   「点之前没选中」的前提失真。清选用**点空地**（selection.box{unitIds:[]} 走转发）——
    //   不走 HUD 命令，免得把「命令面」掺进本剧本要验的「事件面」口径。
    await page.mouse.click(cx + 260, cy + 200);
    await expect
      .poll(async () => (await readSnapshot(page)).selection.unitIds, { timeout: 10_000 })
      .toEqual([]);
    //   等「选择波纹」（一次性 280ms 的青色弹环）散尽再采基线 —— 否则基线里混着上一轮的弹环像素。
    await page.waitForTimeout(800);

    const before = await readSnapshot(page);
    expect(before.units.length).toBeGreaterThan(0);
    // 点之前：没选中；环色像素取基线（单位本体也是青色调，只能看增量）。
    expect(before.selection.unitIds).toEqual([]);
    const ringBaseline = await ringPixelCount(page);

    // —— 真实点击（战场中心 = 单位脚下）——
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(200);
    await page.mouse.click(cx, cy);

    // —— 断言 1：service 裁决后的选择集回到客户端（一次 WS 往返内）——
    await expect
      .poll(async () => (await readSnapshot(page)).selection.unitIds.length, { timeout: 10_000 })
      .toBe(1);
    const after = await readSnapshot(page);
    // 断言的是**实际被点到的那一个**（不预设它是 units[0] —— 战场上谁在中心由数据说了算）。
    const selectedId = after.selection.unitIds[0];
    const selected = after.units.find((unit) => unit.id === selectedId);
    expect(selected).toBeDefined();
    expect(after.selection.revision).toBeGreaterThan(before.selection.revision);

    // —— 断言 2：选中环真的画出来了（像素可见，不只看状态）——
    //   等弹环（一次性 280ms 的选择波纹）散尽再采 —— 要的是**稳态常驻**的虚线选中环。
    await page.waitForTimeout(800);
    expect(await ringPixelCount(page)).toBeGreaterThan(ringBaseline + 25);

    // —— 断言 3：业务态面板更新（不再恒「未选中单位」）——
    const summary = page.locator('strat-agent-panel [data-role="summary"]');
    await expect(summary).toHaveText(selected!.name, { timeout: 10_000 });
    await expect(page.locator('strat-command-panel [data-role="selection"]')).toContainText(selected!.name);

    // —— 断言 4：线上确实是 event.forward（白名单通道），不是命令面 ——
    const forwards = frames.filter((frame) => frame.type === 'event.forward');
    expect(forwards.length).toBeGreaterThan(0);
    const clickFrame = forwards.find(
      (frame) => frame.event?.type === 'unit.click' && frame.event?.unitId === selectedId,
    );
    expect(clickFrame).toBeDefined();
    // 画布交互**不得**借道命令面（那会绕过 core 的世界事件通道）。
    const selectCommands = frames.filter(
      (frame) => frame.type === 'command.forward' && frame.command?.type === 'unit.select',
    );
    expect(selectCommands).toHaveLength(0);

    await page.screenshot({ path: `${SHOTS}/world-sync-r11-event-forward-click.png` });
  });

  test('② 点空地清选 + 框选多单位在远程模式同样生效（selection.box 也走转发）', async ({ page }) => {
    const frames = await captureClientFrames(page);
    await boot(page);

    const before = await readSnapshot(page);
    expect(before.units.length).toBeGreaterThan(0);

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas).not.toBeNull();
    const cx = canvas!.x + canvas!.width / 2;
    const cy = canvas!.y + canvas!.height / 2;

    // —— 点空地 = 清空选择（RTS 惯例；走 selection.box{unitIds:[]} 上行）——
    await page.mouse.click(cx + 260, cy + 200);
    await expect
      .poll(async () => (await readSnapshot(page)).selection.unitIds, { timeout: 10_000 })
      .toEqual([]);

    // —— 框选：把中心单位圈进去（从单位左上拖到右下）——
    await page.mouse.move(cx - 60, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 60, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await readSnapshot(page)).selection.unitIds.length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
    const after = await readSnapshot(page);
    expect(after.selection.revision).toBeGreaterThan(before.selection.revision);

    // —— 线上有 selection.box 的转发 ——
    const boxes = frames.filter(
      (frame) => frame.type === 'event.forward' && frame.event?.type === 'selection.box',
    );
    expect(boxes.length).toBeGreaterThan(0);
  });

  test('③ 纯视图事件（camera.moved）不上行：本地平移镜头，线上没有 event.forward', async ({ page }) => {
    const frames = await captureClientFrames(page);
    await boot(page);

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas).not.toBeNull();
    const cx = canvas!.x + canvas!.width / 2;
    const cy = canvas!.y + canvas!.height / 2;

    const fingerprintBefore = await regionFingerprint(page);

    // —— 右键拖拽 = 平移镜头（本地相机动了 → 本地产生 camera.moved）——
    await page.mouse.move(cx - 200, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx - 100, cy, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(400);

    // 镜头真的动了（否则下面的「没上行」是空断言）。
    expect(await regionFingerprint(page)).not.toBe(fingerprintBefore);

    // 线上没有 camera.moved 的转发（纯视图事件不污染 service 的真相）。
    const viewEvents = frames.filter(
      (frame) => frame.type === 'event.forward' && frame.event?.type === 'camera.moved',
    );
    expect(viewEvents).toHaveLength(0);
    // 也没有其它白名单外的事件型被上行。
    const forwardedTypes = frames
      .filter((frame) => frame.type === 'event.forward')
      .map((frame) => frame.event?.type ?? '');
    for (const type of forwardedTypes) {
      expect(['unit.click', 'selection.box', 'unit.move', 'camera.director']).toContain(type);
    }
  });

  test('④ HUD 命令（command.forward 既有路径）不受影响：建角色 → service 落库 → 快照回推', async ({
    page,
  }) => {
    const frames = await captureClientFrames(page);
    await boot(page);

    const before = await readSnapshot(page);
    const name = '转发验收员';

    // —— 真命令（客户端 HUD 命令面 → command.forward → service 的 core 裁决）——
    await page.evaluate((characterName) => {
      const handle = (window as unknown as {
        __srfApp?: { emitCommand: (command: unknown) => void };
      }).__srfApp;
      handle?.emitCommand({
        type: 'character.create',
        name: characterName,
        agentKind: 'claude-code',
        skinId: 'default',
      });
    }, name);

    // —— service 落库 → 快照回推 → 客户端看得到新角色 ——
    await expect
      .poll(
        async () => (await readSnapshot(page)).characters.some((item) => item.name === name),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(frames.some((frame) => frame.type === 'command.forward')).toBe(true);

    // —— 清理（不留测试垃圾）——
    const characterId = await page.evaluate(
      (characterName) => {
        const handle = (window as unknown as {
          __srfApp?: {
            snapshot: () => { characters: ReadonlyArray<{ id: string; name: string }> };
            emitCommand: (command: unknown) => void;
          };
        }).__srfApp;
        const target = handle?.snapshot().characters.find((item) => item.name === characterName);
        if (target) handle?.emitCommand({ type: 'character.delete', characterId: target.id });
        return target?.id ?? '';
      },
      name,
    );
    expect(characterId).toBeTruthy();
    await expect
      .poll(
        async () => (await readSnapshot(page)).characters.some((item) => item.name === name),
        { timeout: 15_000 },
      )
      .toBe(false);
    expect(before.characters.length).toBeGreaterThanOrEqual(0);
  });

  test('⑤ 协议面（真 socket）：方向反了的消息型与白名单外的事件仍被拒', async ({ page }) => {
    await boot(page);

    // 在页面里开一条**裸** WS 直连 service（旁路客户端实现，验服务端协议纪律）。
    const result = await page.evaluate(async () => {
      const socket = new WebSocket('ws://127.0.0.1:7524/ws/world-sync');
      const received: Array<{ type: string; code?: string }> = [];
      socket.addEventListener('message', (event) => {
        try {
          received.push(JSON.parse(String(event.data)) as { type: string; code?: string });
        } catch {
          received.push({ type: '<unparsable>' });
        }
      });
      await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
      socket.send(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'e2e-raw' }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterHello = received.length;

      // ① 方向反了：客户端发 service→客户端方向的 snapshot → 必须被拒。
      socket.send(JSON.stringify({ type: 'snapshot', seq: 99, state: { units: [] } }));
      await new Promise((resolve) => setTimeout(resolve, 400));

      // ② 白名单外的事件：camera.moved → 解不开 → 必须被拒。
      socket.send(
        JSON.stringify({
          type: 'event.forward',
          event: { type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));

      socket.close();
      return {
        afterHello,
        frames: received.map((frame) => ({ type: frame.type, code: frame.code ?? '' })),
      };
    });

    // hello 之后至少有一份快照（说明这条连接注册成功）。
    expect(result.afterHello).toBeGreaterThan(0);
    const errors = result.frames.filter((frame) => frame.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((frame) => frame.code === 'malformed_message')).toBe(true);
  });

  test('⑥ 本地模式（?stratix-remote=0）画布交互回归：真实点击仍生效，且线上没有 event.forward', async ({
    page,
  }) => {
    const frames = await captureClientFrames(page);
    // ★ 注意两点：① boot 的第二参是**选项对象**（传字符串会静默退回远程模式 —— 曾踩过）；
    //   ② 本地模式**不连网关**，名册与单位都由本地 core 从零起（没有 service 的快照可等）——
    //   故 expectUnits=false：等剧本自己建角色。
    await boot(page, { url: LOCAL_URL, expectUnits: false });

    // 本地模式：先建一个角色（真命令，本地 core 裁决）→ 战场上有单位可点。
    await page.evaluate(() => {
      const handle = (window as unknown as {
        __srfApp?: { emitCommand: (command: unknown) => void };
      }).__srfApp;
      handle?.emitCommand({
        type: 'character.create',
        name: '本地回归员',
        agentKind: 'claude-code',
        skinId: 'default',
      });
    });
    await expect
      .poll(async () => (await readSnapshot(page)).units.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(800); // 等入场动画落位

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas).not.toBeNull();
    const cx = canvas!.x + canvas!.width / 2;
    const cy = canvas!.y + canvas!.height / 2;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(200);
    await page.mouse.click(cx, cy);

    // —— 本地选中生效（本地 core runtime 裁决，与 task_156 之前的行为一致）——
    await expect
      .poll(async () => (await readSnapshot(page)).selection.unitIds.length, { timeout: 10_000 })
      .toBe(1);
    await expect(page.locator('strat-agent-panel [data-role="summary"]')).not.toHaveText('未选中单位');

    // —— 本地模式**零改动**：线上没有 event.forward（本地事件走本地总线）——
    expect(frames.filter((frame) => frame.type === 'event.forward')).toHaveLength(0);

    // —— 清理（不留测试垃圾进共享存档）——
    await page.evaluate(() => {
      const handle = (window as unknown as {
        __srfApp?: {
          snapshot: () => { characters: ReadonlyArray<{ id: string; name: string }> };
          emitCommand: (command: unknown) => void;
        };
      }).__srfApp;
      for (const character of handle?.snapshot().characters ?? []) {
        if (character.name === '本地回归员') {
          handle?.emitCommand({ type: 'character.delete', characterId: character.id });
        }
      }
    });
  });
});
