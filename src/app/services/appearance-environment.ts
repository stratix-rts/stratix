/**
 * 文件职责：LPC 合成栈的**浏览器绑定** —— 把 world/appearance（零 DOM 的纯逻辑）接到真实 DOM 上。
 *   任务：.long-run-agent/tasks/task_027.md。
 *   场景：.long-run-agent/tasks/task_029.md（canvas 合成真机手测）。
 * 输入：document / window（浏览器环境）。
 * 输出：AppearanceEnvironment —— 画布工厂 + 图片工厂 + 素材根 URL。
 * 禁止事项：
 *   1. 碰 core 状态 / 广播 —— 这里只提供"造 DOM 对象"的能力，不含业务；
 *   2. 在此写合成逻辑 —— 合成在 world/appearance/character-composer.ts；
 *   3. 把素材复制/搬动 —— 1.3G 的 LPC 素材原地不动，只算基址（见 spritesheet-path.ts 的说明）。
 *
 * ★ 为什么绑定落在 app 而不是 world：
 *   world/README.md 的铁律是 world 不直接用 `document.*`（world 只经 bridge 与 core 通信、
 *   不自己摸 DOM 全局）。合成栈要画布与图片对象，就必须有一处碰 DOM ——
 *   app 是组合根（唯一允许同时认识 hud 与 world 的地方），放这儿正合适。
 *   代价是 world/appearance 的所有 DOM 能力都得从这儿注入（合成器的构造参数）。
 */

import { spritesheetBaseUrl } from '../../world/appearance/spritesheet-path';
import { ENTRY_PATH_DEPTH } from '../entry-paths';

/** 合成栈需要的浏览器能力。 */
export interface AppearanceEnvironment {
  /** 画布工厂。 */
  readonly createCanvas: () => HTMLCanvasElement;
  /** 图片工厂。 */
  readonly createImage: () => HTMLImageElement;
  /** 素材根 URL（末尾无斜杠），如 'http://127.0.0.1:7523/spritesheets'。 */
  readonly spritesheetBaseUrl: string;
}

/**
 * 造一份浏览器绑定。
 *
 * @param baseUri 页面基址（缺省 document.baseURI）。
 * @param entryDepth 入口 HTML 相对站点根的目录层数（缺省取 entry-paths 的事实源）。
 */
export function createBrowserAppearanceEnvironment(
  baseUri: string = document.baseURI,
  entryDepth: number = ENTRY_PATH_DEPTH
): AppearanceEnvironment {
  return {
    createCanvas: () => document.createElement('canvas'),
    createImage: () => new Image(),
    spritesheetBaseUrl: spritesheetBaseUrl(baseUri, entryDepth),
  };
}
