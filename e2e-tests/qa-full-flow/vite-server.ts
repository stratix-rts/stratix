/**
 * 文件职责：**QA-01 全流程端到端验收的渲染层进程**（@since v3.3，task_221 / QA-01）。
 *
 * ============ 这一单要什么 ============
 *   一份**与生产同源**的前端（同一套 main-entry / HUD / world / Phaser 装配），
 *   但它必须：
 *   ① 挂在**自己的端口**上（绝不碰用户的 7523）；
 *   ② 把页面里的**相对 URL**（`/api` / `/textures` / `/ws`）代理到**本次验收自己的 service**，
 *      而不是仓库 vite.config.ts 里写死的 7524 / 7525（那正是用户实例的端口）。
 *
 * ============ why 复用仓库的 vite.config.ts（而不是另抄一份）============
 *   仓库那份配置带着**三块不能少的东西**：
 *   ① `fxDevAssetsPlugin` —— dev 态的特效素材清单（少了它，Phaser 的 loader 解析 HTML 失败
 *      ⇒ **素材加载场景的 loader 永不完成** ⇒ 战场场景压根不 create（见 vite.config.ts 的文件头）；
 *   ② `sfxAssetsPlugin` / `legacyEntryRedirect` / `hmrFullReloadGuard`；
 *   ③ `resolve.alias`（`@` → src）与 `publicDir: 'assets'`（1.3G 精灵图）。
 *   另抄一份 = 抄漏一处就得到一个「看起来能跑、其实战场是空的」的假绿。
 *
 * ============ why 用 vite 的 JS API（而不是 vite CLI --config）============
 *   vite 的配置加载器会把 `__dirname` **替换成配置文件所在目录** ⇒ 把 QA 配置放在
 *   `e2e-tests/qa-full-flow/` 下会让仓库 vite.config.ts 里的 `resolve(__dirname, 'src')`
 *   指向 e2e 目录 ⇒ 别名全错。
 *   用 JS API + tsx 直接 `import` 仓库那份配置 ⇒ `__dirname` 仍是**仓库根**（tsx 走 CommonJS）。
 *
 * 输入（环境变量）：
 *   SX_QA_VITE_PORT      本次验收的前端端口（缺省 7623）。
 *   SX_QA_SERVICE_PORT   本次验收的 service 端口（代理目标；缺省 7831）。
 * 输出：stdout 一行 `SX_QA_VITE_READY {json}`。
 * 禁止事项：
 *   1. 改仓库那份 vite.config.ts —— 生产配置一个字都不动；
 *   2. 代理到 7524 / 7525 —— 那是用户实例，本单一个字节都不许碰。
 *
 * @since v3.3，task_221。
 */

import { createServer, mergeConfig, type UserConfig } from 'vite';

import baseConfig from '../../vite.config';

const VITE_PORT = Number(process.env.SX_QA_VITE_PORT ?? '7623');
const SERVICE_PORT = Number(process.env.SX_QA_SERVICE_PORT ?? '7831');

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

async function main(): Promise<void> {
  const base = await resolveBaseConfig();

  // 代理目标换成**本次验收自己的 service**（相对 URL 的去处）。
  // why 必须换：仓库那份写死 7524 / 7525 = 用户实例 ⇒ 页面里的 `/textures/...` 会被转发到
  //   用户的网关 ⇒ 本单「不碰用户实例」的纪律就破了。
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

  const server = await createServer({
    ...mergeConfig(base, overrides),
    // 配置已由本文件装配好 ⇒ 不让 vite 再去读一遍仓库那份（免得代理被写回 7524）。
    configFile: false,
  });

  await server.listen();
  console.log(
    `SX_QA_VITE_READY ${JSON.stringify({
      port: VITE_PORT,
      servicePort: SERVICE_PORT,
      root: server.config.root,
    })}`
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
    `[qa-vite] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
