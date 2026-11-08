/**
 * 文件职责：**PERF-01 冷启动基线的渲染层进程（vite dev server）**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 这一单要什么 ============
 *   一份**与生产同源**的前端（同一套 main-entry / HUD / world / Phaser 装配），
 *   但它必须：① 挂在**自己的端口**上（绝不碰用户的 7523）；
 *   ② 把页面里的相对 URL（`/api` / `/textures` / `/ws`）代理到**本次基线自己的 service**。
 *
 * ============ 为什么与 qa-full-flow/vite-server.ts 分成两个文件 ============
 *   本文件多带一样东西：**场景 create 的时间戳注入**（见下方 perfSceneMarksPlugin）。
 *   QA harness 不需要它 ⇒ 不去改那份文件（避免动到别的单的验收资产）。
 *
 * ============ 场景 create 打点是怎么注入的（零产品改动）============
 *   冷启动基线要量「战场 scene create 完成」这一刻 —— 但产品码里**没有任何**可观测点
 *   （world 层零 DOM，Phaser 的 game 句柄也不在 window 上 ⇒ 页面里摸不到场景实例）。
 *   ⇒ 在**vite 侧**注入：给三个场景类的 `create` 包一层，打一条 `performance.mark`。
 *   - 注入发生在**测试侧**（本文件）⇒ 仓库里的 `src/world/**` **一个字节都没改**；
 *   - 注入内容只是「多打一条 mark」⇒ 场景行为零变化（渲染时序、事件、状态全不变）；
 *   - 注入位置在模块求值时（import 时）⇒ 早于任何场景实例化 ⇒ 第一次 create 也抓得到。
 *
 * 输入：两个环境变量 ——
 *   SX_PERF_VITE_PORT      本次基线的前端端口（缺省 7624）；
 *   SX_PERF_SERVICE_PORT   页面相对 URL 的代理目标 = 本次基线的 service 端口（缺省 7841）。
 * 输出：stdout 一行 `SX_PERF_VITE_READY {json}`。
 * 禁止事项：
 *   1. 改仓库那份 vite.config.ts —— 生产配置一个字都不动；
 *   2. 代理到 7524 / 7525 —— 那是用户实例，本单一个字节都不许碰。
 *
 * @since v3.3，task_230。
 */

import { createServer, mergeConfig, type UserConfig } from 'vite';

import baseConfig from '../../vite.config';
import { perfSceneMarksPlugin } from './scene-marks';

const VITE_PORT = Number(process.env.SX_PERF_VITE_PORT ?? '7624');
const SERVICE_PORT = Number(process.env.SX_PERF_SERVICE_PORT ?? '7841');

/** 仓库那份配置是 `defineConfig(async (env) => ...)` ⇒ 它是个函数，要自己调一次。 */
async function resolveBaseConfig(): Promise<UserConfig> {
  if (typeof baseConfig === 'function') {
    return (await (baseConfig as (env: unknown) => UserConfig | Promise<UserConfig>)({
      command: 'serve',
      mode: 'development',
      isSsrBuild: false,
      isPreview: false,
    })) as UserConfig;
  }
  return baseConfig as UserConfig;
}

/**
 * 场景 create 的时间戳注入（测试侧打点）。
 *
 * why 用 prototype 包一层而不是改场景源码：产品码零改动是本单的硬约束
 *   （「不实现优化 / 不改 core 行为」），打点属于**测量**而非**产品**。
 * why 打在 create **之后**：create 返回 = 场景建完（层都建好了）⇒ 这才是「scene create 完成」。
 * why 单独成文件（scene-marks.ts）：dev server 与 production build **两个进程**都要带它（口径必须一致）。
 */
async function main(): Promise<void> {
  const base = await resolveBaseConfig();

  // 代理目标换成**本次基线自己的 service**（相对 URL 的去处）。
  const overrides: UserConfig = {
    server: {
      host: '127.0.0.1',
      port: VITE_PORT,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
          ws: true,
        },
        '/textures': {
          target: `http://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `ws://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };

  const merged = mergeConfig(base, overrides);
  const server = await createServer({
    ...merged,
    // 配置已由本文件装配好 ⇒ 不让 vite 再去读一遍仓库那份（免得代理被写回 7524）。
    configFile: false,
    // ★ 仓库那份配置的插件**必须原样带上**（fx 素材清单 / sfx / 入口跳转 / HMR 防护 / vue）：
    //   少一个 ⇒ dev 态素材清单 404 ⇒ 页面报 JSON 解析错 ⇒ 测出来的冷启动是**残缺版**的。
    //   （本插件只是**追加**一个打点器，不替换任何一个。）
    plugins: [...(merged.plugins ?? []), perfSceneMarksPlugin()],
  });

  await server.listen();
  console.log(
    `SX_PERF_VITE_READY ${JSON.stringify({
      port: VITE_PORT,
      servicePort: SERVICE_PORT,
      root: server.config.root,
    })}`,
  );

  const shutdown = async (): Promise<void> => {
    await server.close();
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[perf-vite] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
