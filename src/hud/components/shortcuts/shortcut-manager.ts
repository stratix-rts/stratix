/**
 * 文件职责：**快捷键管理器**（task_058）—— window keydown → 动作解析（shortcut-catalog）
 *   → HudCommand 派发（经注入的 dispatch 口）+ 帮助浮层（shortcut-help）的开关驱动。
 *   口径移植自 v2 ShortcutManager 的事件层（keydown 监听 + 修饰键判定），砍掉注册表 /
 *   上下文仲裁 / 单例（v3 只有一个键盘入口，集中常量表足够）。
 * 输入：注入的 ports —— dispatch（命令出口，组合根喂 adapter.dispatch）、getState（读
 *   WorldState 快照：全选要单位名单、居中要选择集）、getUnitPosition（单位坐标口 ——
 *   位置真相在世界层，core 契约无坐标，组合根从 unit.position 累积表喂，同小地图口径）。
 * 输出：HudCommand（unit.select / unit.group.assign / unit.group.recall / camera.center）
 *   与帮助浮层的开 / 关。attach() 返回卸载闭包（监听必须可清理）。
 * 禁止事项：
 *   1. import world/、app/、core/bus —— 命令一律走注入的 dispatch（组件零总线依赖）；
 *   2. 在这里写业务态 —— 全选名单、编组成员、选择真相全在 core，这里只「读快照、发命令」；
 *   3. 劫持输入焦点里的键 —— isEditableTarget 命中一律放行（任务标题框里打字不受干扰）；
 *      判定对象是**真正被键击的元素**（穿 shadow DOM 重定向，见 resolveEventTarget），
 *      不是被重定向后的宿主 —— 否则命令行输入框里敲空格会被吃掉（字符丢失）。
 *   4. 泄漏监听 —— attach 的 keydown、浮层关闭请求监听都挂在返回的卸载闭包上。
 *
 * @since v3.34（task_058）。
 */

import { WORLD_BOUNDS, type HudCommand, type Point, type WorldState } from '../../../core/types';
import {
  isActivatableTarget,
  isEditableTarget,
  resolveShortcutAction,
  type KeyboardEventLike,
  type ShortcutAction,
} from './shortcut-catalog';
import {
  mountShortcutHelp,
  SHORTCUT_HELP_CLOSE_REQUEST,
  SHORTCUT_HELP_OCCLUSION_ID,
  type StratShortcutHelpElement,
} from './shortcut-help';

/** 本系统会发出的命令面（Extract 保持与契约同步 —— 新增字段不改这里）。 */
export type ShortcutDispatchCommand = Extract<
  HudCommand,
  { type: 'unit.select' | 'unit.group.assign' | 'unit.group.recall' | 'camera.center' }
>;

/**
 * 遮挡登记口（@since v3.5，task_099）—— 遮挡控制器（hud/layers/occlusion.ts）实现。
 * why 是一行接口而不是直接 import 控制器：组件只认「开 / 关」这一个动作，
 *   「谁压着谁、要不要禁点」归机制层管（与 chat-drawer 的抽屉口同口径）。
 */
export interface ShortcutOcclusionPort {
  /** 登记「有一个全屏弹窗开着」（requestClose = ESC 统一路由到栈顶时请它关）。 */
  openModal(id: string, requestClose?: () => void): void;
  /** 撤掉登记（浮层关上 → 四角全恢复）。 */
  closeModal(id: string): void;
}

/** 组合根注入的端口（全部显式注入，测试与生产共用同一份逻辑）。 */
export interface ShortcutPorts {
  /** 命令出口（生产 = adapter.dispatch；测试 = 收集数组）。 */
  readonly dispatch: (command: ShortcutDispatchCommand) => void;
  /** 读最新 WorldState（全选名单 / 居中目标都从它现读；null = 尚未收到广播）。 */
  readonly getState: () => WorldState | null;
  /**
   * 单位坐标口：位置真相在世界层（core 契约无坐标），组合根从恢复站位 + unit.position
   * 事件累积喂（与 minimap 的数据面同一份累积表）。查不到返回 null（按未知处理）。
   */
  readonly getUnitPosition: (unitId: string) => Point | null;
  /**
   * 遮挡登记口（@since v3.5，task_099；遮挡规则 R1）——
   *   帮助浮层是全屏弹窗：开着时四角常驻件统一降对比 + 禁点，关掉即全恢复。
   *   缺省 = 不登记（浮层照常开合，只是四角不降对比）。
   */
  readonly occlusion?: ShortcutOcclusionPort | null;
}

/**
 * 计算居中目标（纯函数，导出供单测直打）：
 *   - 有已知坐标的选中单位 → 坐标**算术平均**（质心 —— 不是包围盒中心：个别离群单位
 *     不该把镜头拽到没人的地方）；
 *   - 无选中 / 选中单位全部坐标未知 → 世界中心（WORLD_BOUNDS 契约常量 —— 钳制口径同源）。
 */
export function computeCenterPoint(
  unitIds: readonly string[],
  getUnitPosition: (unitId: string) => Point | null
): Point {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const id of unitIds) {
    const at = getUnitPosition(id);
    if (!at) continue;
    sumX += at.x;
    sumY += at.y;
    count += 1;
  }
  if (count === 0) {
    return {
      x: WORLD_BOUNDS.x + WORLD_BOUNDS.width / 2,
      y: WORLD_BOUNDS.y + WORLD_BOUNDS.height / 2,
    };
  }
  return { x: sumX / count, y: sumY / count };
}

/**
 * 键击真正落在哪个元素上（穿透 shadow DOM 的事件重定向）。
 * why 必须穿透：键盘事件冒泡出 shadow tree 时，`event.target` 被**重定向**成宿主元素
 *   （命令面板的 `<strat-command-panel>`），而不是用户真正在打字的 `<input>`。
 *   于是 isEditableTarget 判它"不是输入框" → 快捷键照样劫持 →
 *   在命令行输入框里敲空格被 preventDefault 吃掉（字符丢失），敲数字会召回编组。
 *   `composedPath()[0]` 才是真正被键击的元素（浏览器在派发期间一直给得到）。
 * 何时不用它：事件直接派发在 window / document 上时（单测替身口径）路径首项就是 window，
 *   那不是"被键击的元素" → 退回 event.target（派发之外拿到的事件同理：没有路径）。
 */
function resolveEventTarget(event: {
  readonly target?: EventTarget | null;
  readonly composedPath?: () => EventTarget[];
}): EventTarget | null {
  const path = event.composedPath?.();
  const first = path && path.length > 0 ? path[0] : null;
  if (first && isElementTarget(first)) return first;
  return event.target ?? null;
}

/** 目标是不是元素（window / document 不是）。typeof 守卫与 isEditableTarget 同口径。 */
function isElementTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return true;
}

/** 管理器对外形状（组合根与测试按它操作）。 */
export interface ShortcutManager {
  /** 接通 window keydown + 浮层关闭请求监听；返回卸载闭包（幂等：重复 attach 返回同一卸载）。 */
  attach(): () => void;
  /** 处理一次键击（解析 → 派发；返回动作或 null —— 测试与 attach 内部共用同一条路）。 */
  handleKeydown(
    event: KeyboardEventLike & {
      target?: EventTarget | null;
      composedPath?: () => EventTarget[];
    }
  ): ShortcutAction | null;
  /** 帮助浮层是否打开（真相位在管理器，浮层元素只是渲染镜像）。 */
  readonly helpOpen: boolean;
  /**
   * 开关帮助浮层（@since v3.9，task_150：⌘K 命令面板的「快捷键帮助」走这条）。
   * why 要公开出口：快捷键帮助的**开合**归管理器（它是 ESC 栈上的一个焦点面），
   *   但「谁来开它」不只键盘 —— ⌘K 面板也能开。两边都调同一个开关，才不会开成两个。
   */
  toggleHelp(): void;
}

/**
 * 创建快捷键管理器。不挂监听（attach 才挂），构造零副作用 —— 便于组合根控制生命周期、
 * 便于单测直接打 handleKeydown（不依赖 jsdom 的 window 派发时序）。
 */
export function createShortcutManager(
  ports: ShortcutPorts,
  help: StratShortcutHelpElement
): ShortcutManager {
  let helpOpen = false;
  let detach: (() => void) | null = null;

  const setHelpOpen = (open: boolean): void => {
    helpOpen = open;
    if (open) help.open();
    else help.close();
    // 遮挡登记（@since v3.5，task_099；遮挡规则 R1）：帮助浮层是**全屏弹窗** ——
    //   开着时四角常驻件统一降对比 + 禁点，关掉即全恢复。
    // why 不交 requestClose：帮助浮层的 ESC 归**快捷键管理器**自己（解析表里 Escape =
    //   closeHelp —— 浮层开着时 ESC 只关浮层，不清选择）。若把 requestClose 也交出去，
    //   遮挡控制器的 ESC 路由会先把浮层从栈里摘掉（helpOpen 变 false），
    //   紧接着管理器会按「浮层没开」把同一次 ESC 解析成 deselect —— 多清一次选择。
    if (open) {
      ports.occlusion?.openModal(SHORTCUT_HELP_OCCLUSION_ID);
    } else {
      ports.occlusion?.closeModal(SHORTCUT_HELP_OCCLUSION_ID);
    }
  };

  const execute = (action: ShortcutAction): void => {
    switch (action.type) {
      case 'selectAll': {
        // 全选 = 把 WorldState.units 的全员 id 打成一次 set（core 侧再对账 + 上限截断，
        // 与框选全体同一条路 —— 任务口径：unit.select set 全体 id）。
        const ids = (ports.getState()?.units ?? []).map((unit) => unit.id);
        ports.dispatch({ type: 'unit.select', unitIds: ids, mode: 'set' });
        return;
      }
      case 'deselect':
        // 取消选择 = set 空集（明确的「清空」语义，与命令面板 selection.clear 同一载荷形态）。
        ports.dispatch({ type: 'unit.select', unitIds: [], mode: 'set' });
        return;
      case 'groupAssign':
        ports.dispatch({ type: 'unit.group.assign', group: action.slot });
        return;
      case 'groupRecall':
        ports.dispatch({ type: 'unit.group.recall', group: action.slot });
        return;
      case 'centerSelection': {
        const selected = ports.getState()?.selection.unitIds ?? [];
        const center = computeCenterPoint(selected, ports.getUnitPosition);
        // core 收到后钳进 WORLD_BOUNDS 再转发 world 通道（场景 syncCameraCenter 落位），
        // 质心即使因未知坐标回退世界中心也是界内点，零兜底分支。
        ports.dispatch({ type: 'camera.center', x: center.x, y: center.y });
        return;
      }
      case 'toggleHelp':
        setHelpOpen(!helpOpen);
        return;
      case 'closeHelp':
        setHelpOpen(false);
        return;
    }
  };

  const handleKeydown = (
    event: KeyboardEventLike & {
      target?: EventTarget | null;
      composedPath?: () => EventTarget[];
    }
  ): ShortcutAction | null => {
    // 判定对象 = 真正被键击的元素（穿 shadow DOM 重定向 —— 见 resolveEventTarget）。
    const target = resolveEventTarget(event);
    // 输入框聚焦让路（任务标题 / 聊天框 / 命令行 / contenteditable 打字不触发全局键）。
    if (isEditableTarget(target)) return null;
    const action = resolveShortcutAction(event, helpOpen);
    if (action === null) return null;
    // Space 的原生语义让路：焦点在按钮/链接上时空格 = 激活它（HUD 按钮点完焦点会留在钮上）。
    if (action.type === 'centerSelection' && isActivatableTarget(target)) return null;
    execute(action);
    return action;
  };

  const attach = (): (() => void) => {
    if (detach) return detach;
    const onKeydown = (event: KeyboardEvent): void => {
      const action = handleKeydown(event);
      // 命中即吃掉默认行为：Ctrl+A 不再选 DOM 文本、Space 不再滚动页面。
      if (action !== null) event.preventDefault();
    };
    // 浮层自己的关闭出口（遮罩点击 / × 钮）：composed 事件冒泡到 window，经同一 setHelpOpen 收口。
    const onCloseRequest = (event: Event): void => {
      if (event.type === SHORTCUT_HELP_CLOSE_REQUEST) setHelpOpen(false);
    };
    window.addEventListener('keydown', onKeydown);
    window.addEventListener(SHORTCUT_HELP_CLOSE_REQUEST, onCloseRequest);
    detach = () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener(SHORTCUT_HELP_CLOSE_REQUEST, onCloseRequest);
      detach = null;
      setHelpOpen(false); // 卸载时关浮层：不留一个没人管的打开态
    };
    return detach;
  };

  return {
    attach,
    handleKeydown,
    toggleHelp: () => { setHelpOpen(!helpOpen); },
    get helpOpen() {
      return helpOpen;
    },
  };
}

/**
 * 装配工厂（组合根一口接完，与 mountMinimap 同一装配口径）：
 * 挂帮助浮层 → 建管理器 → attach 键盘监听。返回元素引用（测试断言浮层）+ unmount。
 */
export function mountShortcuts(host: HTMLElement, ports: ShortcutPorts): {
  readonly element: StratShortcutHelpElement;
  readonly manager: ShortcutManager;
  readonly unmount: () => void;
} {
  const { element: help, unmount: unmountHelp } = mountShortcutHelp(host);
  const manager = createShortcutManager(ports, help);
  const detach = manager.attach();
  return {
    element: help,
    manager,
    unmount: () => {
      detach();
      unmountHelp();
    },
  };
}
