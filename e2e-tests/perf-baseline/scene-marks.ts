/**
 * 文件职责：**场景 create 的时间戳注入器（测试侧打点）**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 为什么需要它 ============
 *   冷启动基线要量「战场 scene create 完成」这一刻 ——
 *   但产品码里**没有任何**可观测点：
 *     · world 层零 DOM（Phaser 的场景回调里碰不到 document）；
 *     · Phaser 的 game 句柄不在 window 上（Phaser 3.90 的 dist 里没有 `window.PHASER_GAME`）；
 *     · 渲染层没有暴露场景实例的调试口。
 *   ⇒ 只能**在构建期注入**。
 *
 * ============ 注入口径（零产品改动）============
 *   - 注入发生在**测试侧**（本目录）⇒ 仓库里的 `src/world/**` **一个字节都没改**；
 *   - 注入内容 = 给场景类的 `create` 包一层，**多打一条 `performance.mark`**；
 *     场景的行为（渲染时序 / 事件 / 状态 / 视觉）**零变化**；
 *   - 打在 create **返回之后** = 场景建完（所有层都建好了）⇒ 这才是「scene create 完成」；
 *   - 注入位置在模块求值时（import 时）⇒ 早于任何场景实例化 ⇒ **第一次** create 也抓得到。
 *
 * 输入：无（vite 插件）。
 * 输出：一个 vite 插件（`transform` 钩子）。
 * 禁止事项：
 *   1. 改场景源码 —— 打点属于**测量**，不属于产品；
 *   2. 改场景行为 —— 只包一层 mark，create 的参数与返回值原样透传。
 *
 * @since v3.3，task_230。
 */

import type { Plugin } from 'vite';

/** 目标场景文件（路径后缀）→ 导出类名 + mark 名。 */
const TARGETS: readonly { file: string; className: string; mark: string }[] = [
  {
    file: '/src/world/scenes/BattlefieldScene.ts',
    className: 'BattlefieldScene',
    mark: 'srf:scene-create:battlefield',
  },
  { file: '/src/world/scenes/LobbyScene.ts', className: 'LobbyScene', mark: 'srf:scene-create:lobby' },
  {
    file: '/src/world/scenes/fx-asset-scene.ts',
    className: 'FxAssetScene',
    mark: 'srf:scene-create:fx-asset',
  },
];

/** 造那个「给场景 create 打时间戳」的 vite 插件。 */
export function perfSceneMarksPlugin(): Plugin {
  return {
    name: 'stratix:perf-scene-marks',
    // pre = 拿到**未经 esbuild 转译**的 TS 源码（注入的是 TS，交给 esbuild 一起转）。
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?')[0];
      for (const target of TARGETS) {
        if (!file.endsWith(target.file)) continue;
        const injection = [
          '',
          '/* perf harness 注入（task_230 / PERF-01）：场景 create 打时间戳 —— 只多一条 mark，零行为变化 */',
          '{',
          `  const __srfPerfProto = (${target.className} as unknown as { prototype: Record<string, unknown> }).prototype;`,
          "  const __srfPerfOriginal = __srfPerfProto['create'];",
          "  if (typeof __srfPerfOriginal === 'function') {",
          "    __srfPerfProto['create'] = function (this: unknown, ...args: unknown[]): unknown {",
          '      const __srfPerfResult = (__srfPerfOriginal as (...a: unknown[]) => unknown).apply(this, args);',
          `      performance.mark('${target.mark}');`,
          '      return __srfPerfResult;',
          '    };',
          '  }',
          '}',
          '',
        ].join('\n');
        return { code: code + injection, map: null };
      }
      return null;
    },
  };
}
