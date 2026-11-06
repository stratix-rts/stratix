import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, relative, isAbsolute, sep, basename } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from 'fs';
import { NEW_ENTRY_HTML } from './src/app/entry-paths';
import { FX_DIR_NAME } from './src/world/appearance/fx-asset-path';
import { bakeFxRelease, FX_BAKE_MANIFEST_NAME } from './scripts/lib/fx-release-bake';
import { buildFxSnapshotManifest, fxSnapshotFingerprint } from './scripts/lib/fx-snapshot-manifest';

const ANALYZE = process.env.ANALYZE === 'true';

/**
 * 需要"变更即整页刷新"的目录（相对项目根的 posix 风格相对路径）。
 * why 这四个目录是游戏化前端的全部运行时代码：组合根装配（src/app）、HUD 组件（src/hud）、
 *   核心域（src/core）、世界场景（src/world）。
 */
const FULL_RELOAD_DIRS = ['src/app', 'src/hud', 'src/core', 'src/world'];

/**
 * 入口 HTML 的**旧路径**（task_122 之前入口住在 src/app/main/ 下）。
 * why 留这一行：入口挪到站点根后，旧书签 / 旧 e2e 脚本 / 别人分享的链接仍可能指着它，
 *   直接 404 会让人以为服务挂了 —— 这里 302 到站点根即可。
 * why 用 302 而不是 404：入口路径变了，**东西没变**，跳转才是如实的表达。
 */
const LEGACY_ENTRY_URL = '/src/app/main/index.html';

/**
 * HMR 半更新防护（task_067）。
 *
 * why 局部 HMR 对本仓库天然不安全 —— 本仓库是 Web Components + 组合根装配架构：
 *   1. 自定义元素一旦 define 过，HMR 换掉模块也不会重建已存在的实例，
 *      老实例继续持有老模块的闭包 → 页面变成"半新半旧"的混血；
 *   2. main-entry 组合根的闭包持有启动那一刻的模块引用，
 *      单文件热替换根本改不到已经装配出去的实例；
 *   3. 事件常量 / 消息结构在模块间共享，局部替换会让新旧实例用不同版本的常量，
 *      表现为不可复现的交互报错（全新实例零错误）。
 *   实际事故：用户 dev 实例连跑 31 小时、跨 3 个提交，被 HMR 打成混血状态，
 *   出现快捷键弹窗关闭钮之类的诡异报错（已用 Playwright 全量交互扫描对照验证）。
 *
 * how 命中四目录的模块变更 → server.ws.send({ type: 'full-reload' }) 主动整页刷新，
 *   并 return [] 阻止 vite 默认的模块级 HMR patch。
 *   仅 dev 生效（apply: 'serve'），构建产物行为完全不变。
 */
function hmrFullReloadGuard(root: string): Plugin {
  return {
    name: 'stratix:hmr-full-reload-guard',
    apply: 'serve',
    handleHotUpdate(ctx) {
      // vite 传进来的是归一化后的绝对路径；统一成 posix 风格相对路径再比对目录前缀
      const rel = relative(root, ctx.file).split(sep).join('/');
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
      const guarded =
        rel === NEW_ENTRY_HTML ||
        FULL_RELOAD_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
      if (!guarded) return undefined;
      ctx.server.ws.send({ type: 'full-reload', path: '*' });
      // 留一行日志：让"这次是强制整页刷新（而非局部 HMR）"在 dev 终端里可见、可追溯
      ctx.server.config.logger.info(
        `[stratix] ${rel} 变更 → 强制整页 reload（禁用局部 HMR）`,
        { clear: false, timestamp: true },
      );
      // 返回空数组 = 不做任何模块级热更新，强制走上面的整页刷新
      return [];
    },
  };
}

/**
 * 旧入口路径 → 站点根 的跳转（task_122）。
 *
 * why 需要：入口 HTML 从 `src/app/main/index.html` 上移到站点根 `index.html` 之后，
 *   旧地址（书签、e2e 脚本、历史分享链接）会直接 404 —— 看着像"服务挂了"。
 *   这里 302 到 '/'，让旧链接继续能用，同时正式入口只剩一个（站点根）。
 * 仅 dev 生效（apply: 'serve'）：正式产物里根本没有 src/ 段，无从兼容。
 */
function legacyEntryRedirect(): Plugin {
  return {
    name: 'stratix:legacy-entry-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url !== LEGACY_ENTRY_URL) return next();
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
      });
    },
  };
}

/**
 * 真实音源供给（task_087）：public/sfx/ 下的 mp3 要能在 dev server 与构建产物里
 * 以**站点根下的 /sfx/*** 取到（渲染层按 'sfx' 相对基址拼 URL —— 入口在站点根，深度 0），
 * 见 src/hud/sound-engine.ts 的 sfxBaseUrl）。
 *
 * why 不用 vite 的 publicDir —— 它已被 'assets' 占用：LPC 素材（1.3G，真源
 *   assets/spritesheets/）靠 publicDir 挂在站点根，改掉会打断素材服务
 *   （见 src/world/appearance/spritesheet-path.ts 的说明）。
 * why 不走「public/ → assets/ 拷贝脚本」的路子（rts-textures 的做法）——
 *   音效是演示的听觉主线索：音效取不到会**静默**回退到合成器，直播现场几乎听不出
 *   差别 —— 那等于白做。少一次 setup，就少一类「现场没声」的排查。
 *
 * how dev 用中间件直接读盘（配置在 vite 内部中间件之前，命中即返回）；
 *   build 用 emitFile 把文件打进产物根（= 站点根，dev 与 prod 的相对规则一致）。
 */
function sfxAssetsPlugin(root: string): Plugin {
  const sfxDir = resolve(root, 'public/sfx');
  const sfxDirPrefix = sfxDir + sep;
  return {
    name: 'stratix:sfx-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/sfx/')) return next();
        // basename 去掉任何目录段 —— 只放行 sfx 目录下的直系文件（防目录穿越）。
        const file = resolve(sfxDir, basename(url));
        if (!file.startsWith(sfxDirPrefix) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', statSync(file).size);
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      if (!existsSync(sfxDir)) return;
      for (const name of readdirSync(sfxDir)) {
        if (!name.endsWith('.mp3')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `sfx/${name}`,
          source: readFileSync(resolve(sfxDir, name)),
        });
      }
    },
  };
}

/**
 * **dev 态 fx 清单接线**（@since v3.3，task_211 / AP-05）——
 *   让 vite dev server（7523）按**发布期同构**的清单把特效素材喂给渲染层。
 *
 * ★ 为什么必须有这一步（dev 态 fx 报错的根因，实测口径）：
 *   发布期烘焙产物在 `dist/frontend/fx/`（不入库），dev server 没有 ⇒ 渲染层请求
 *   `<素材根>/fx-bake-manifest.json` 时静态中间件找不到文件 → **SPA 兜底改写成 index.html**
 *   （200 text/html）→ Phaser 的 JSONFile 解析 HTML 抛 `Unexpected token '<'`，
 *   并且它解析失败会 **rethrow**（phaser/src/loader/filetypes/JSONFile.js:109）。
 *   实测（Playwright 探针，dev 窗口）：
 *     · renderer 报 `Unexpected token '<'` + `Failed to process file: json fx:bake-manifest`；
 *     · 因为 rethrow 发生在 `onProcessComplete` **之前**，LoaderPlugin 不会推进这个文件
 *       ⇒ **素材加载场景的 loader 永远不完成** ⇒ 它的 create() 不会跑
 *       （变体清单的登记在那一步，见 src/world/scenes/fx-asset-scene.ts）；
 *     · 渲染循环本身还活着（实测 rAF 61 帧/秒），所以画面不是「冻住」，
 *       而是**清单这一段管线静悄悄地半瘫** —— 这种错最难自己发现。
 *
 * how dev 的清单怎么来：**仓内快照**（`assets/fx/`，task_161 的入库产物）如实派生
 *   （scripts/lib/fx-snapshot-manifest.ts）—— 字段口径与发布期 manifest 同构
 *   （共用 `buildFxBakeManifest`），运行时那一套消费代码
 *   （src/world/appearance/fx-variants.ts）**不感知 dev/release**（AP-05 的核心诉求）。
 * why 不在 dev 态即时烘焙：快照是**入库的既有事实**（读盘 + 算哈希几十毫秒），
 *   即时烘焙要跑 pixelfx 渲染（两套皮肤 24 张 sheet ≈ 24s），挂在启动路径上
 *   等于给每次起服务加冷启动 —— 而且快照的 PNG 与发布期烘焙产物**逐像素相同**
 *   （实测：六个效果全帧 0 字节差，只有 PNG 编码不同），dev 看到的画面与线上一致。
 *
 * why 素材也由本中间件自己发（不交给 publicDir 的静态中间件）：
 *   publicDir 的静态中间件对**缺失**的文件会 next() → 落到 SPA 兜底 → 又是 200 的 HTML。
 *   特效图/清单一旦取不到必须是**真 404**（Phaser 才会走「文件失败」而不是「解析炸掉」）。
 *   顺带把 content-type 定死：清单是 `application/json`（Phaser 按文本读，按 content-type 无妨，
 *   但排查时一眼能看出返回的是不是 JSON）。
 */
function fxDevAssetsPlugin(root: string): Plugin {
  const assetsRoot = resolve(root, 'assets', FX_DIR_NAME);
  const assetsRootPrefix = assetsRoot + sep;
  const urlPrefix = `/${FX_DIR_NAME}/`;
  const manifestUrl = `${urlPrefix}${FX_BAKE_MANIFEST_NAME}`;

  // 清单缓存：按快照指纹失效（用户重跑 fx:generate 换了图 → 指纹变 → 重算）。
  let cached: { fingerprint: string; body: string } | null = null;
  const manifestBody = (): string => {
    const fingerprint = fxSnapshotFingerprint(assetsRoot);
    if (!cached || cached.fingerprint !== fingerprint) {
      const manifest = buildFxSnapshotManifest({ rootDir: root, assetsRoot });
      cached = { fingerprint, body: `${JSON.stringify(manifest, null, 2)}\n` };
    }
    return cached.body;
  };

  return {
    name: 'stratix:fx-dev-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith(urlPrefix)) return next();

        // ① 清单：永远返回**真 JSON**（哪怕快照是空的）——
        //   返回 HTML 会让 Phaser 解析炸掉并冻住整个游戏循环（见文件头）。
        if (url === manifestUrl) {
          const body = manifestBody();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', Buffer.byteLength(body));
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }

        // ② 素材：只放行快照目录下的直系文件（防目录穿越）。
        let relativePath: string;
        try {
          relativePath = decodeURIComponent(url.slice(urlPrefix.length));
        } catch {
          // 百分号编码坏了 ⇒ 当作不存在（不能让一个坏 URL 把 dev server 带崩）。
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('404 fx asset not found');
          return;
        }
        const file = resolve(assetsRoot, relativePath);
        if (!file.startsWith(assetsRootPrefix) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('404 fx asset not found');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', fxContentType(file));
        res.setHeader('Content-Length', statSync(file).size);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** 特效素材的 content-type（只认两种扩展名 —— 特效素材就这两种）。 */
function fxContentType(filePath: string): string {
  return filePath.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8';
}

/**
 * **发布期特效烘焙**（@since v3.3，task_192 / AP-02）—— 构建期把 pixelfx 特效烘成 sprite sheet。
 *
 * why 挂在 closeBundle（构建产物写完之后）：vite 在 renderStart 阶段就把 publicDir（= assets/）
 *   拷进产物根，后面才是 rollup 写 bundle、最后 closeBundle —— 只有这个时点，
 *   本插件写进产物根的 fx/ 才不会被 publicDir 的拷贝覆盖。
 * why 产物落**产物根下的 fx/**：运行时按 world/appearance/fx-asset-path.ts 的相对规则取图
 *   （dev 是 <站点根>/fx/…，electron 是 file://…/dist/frontend/fx/…）—— 同一个相对位置，
 *   三种环境通用，运行时零改动。
 * why 产物不入库：它落在构建产物目录（dist/，已被 .gitignore 覆盖）——
 *   发布期的图是「构建期现烘」，不随仓库走（DESIGN §0 特效管线行）。
 * why 失败要炸构建：烘不出来还硬发 = 发一版特效缺失的包，比构建失败难查得多。
 * 逃生门：STRATIX_SKIP_FX_BAKE=1（本地只想看页面、不想等烘焙时用）。
 */
function fxReleaseBakePlugin(): Plugin {
  let root = process.cwd();
  let outDir = '';
  return {
    name: 'stratix:fx-release-bake',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (process.env.STRATIX_SKIP_FX_BAKE === '1') {
        this.info('特效烘焙已跳过（STRATIX_SKIP_FX_BAKE=1）');
        return;
      }
      const target = resolve(outDir, 'fx');
      const manifest = bakeFxRelease({ rootDir: root, outDir: target });
      this.info(
        `特效发布期烘焙完成：${manifest.artifacts.length} 个 atlas（皮肤 ${manifest.skins.join('/')}）→ ${target}`,
      );
    },
  };
}

export default defineConfig(async () => {
  const plugins = [
    vue(),
    hmrFullReloadGuard(__dirname),
    legacyEntryRedirect(),
    sfxAssetsPlugin(__dirname),
    fxDevAssetsPlugin(__dirname),
    fxReleaseBakePlugin(),
  ];

  if (ANALYZE) {
    // why 用变量形式的 specifier：rollup-plugin-visualizer 是可选的按需依赖（ANALYZE=true 才需要），
    // 不在 package.json 里。写成字符串字面量会让 tsc 报 TS2307，写成变量则跳过模块解析，
    // 运行时行为不变（没装依赖时 ANALYZE=true 依旧直接报错，符合"可选依赖"的预期）。
    const visualizerModule = 'rollup-plugin-visualizer';
    const { visualizer } = await import(visualizerModule);
    plugins.push(visualizer({
      filename: 'dist/.stats.html',
      open: true,
      gzipSize: true,
      template: 'treemap',
    }));
  }

  return {
    base: './',
    plugins,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@stratix-core': resolve(__dirname, 'src/stratix-core'),
        '@stratix-gateway': resolve(__dirname, 'src/stratix-gateway'),
        '@stratix-data-store': resolve(__dirname, 'src/stratix-data-store'),
        '@stratix-openclaw-adapter': resolve(__dirname, 'src/stratix-openclaw-adapter'),
        // pixelfx 运行时别名（@since v3.3，task_162 建立；task_191 / AP-01 改为**仓内 vendor**）：
        //   代码路由特效的 dev 入口需要直接 import pixelfx 库（MIT、零依赖）。
        // why 是别名而不是 file: 依赖：`file:` 会进 package.json 的 dependencies →
        //   别的机器 clone 下来 npm ci 就炸（file: 指向的仓外路径不存在）；别名只影响 dev 入口。
        // why 仓内 vendor（task_191）：源码已随仓进 vendor/pixelfx（上游 commit 记在
        //   vendor/pixelfx/UPSTREAM）—— 别名指仓内，别的机器 clone 下来就能跑，
        //   server.fs.allow 的仓外特例随之删除（见下）。
        // why 生产产物**会**带上它（@since v3.3，task_194 / AP-04）：正式入口已接代码路由 ——
        //   代码路由的特效源在 app/fx/code-fx-sources.ts（动态 import 效果模块），
        //   pixelfx 是 MIT、零依赖的纯 JS 库，随入口图打进产物即可（不引 npm 依赖）。
        //   效果模块走**动态 import** ⇒ 单独成 chunk ⇒ 取不到时战场静默回落 sheet 路由。
        // ★ 顺序要紧：字符串别名是「前缀匹配」，'pixelfx' 会连 'pixelfx/fx/…' 一起吃掉 ——
        //   所以更长的那个必须排在前面。
        'pixelfx/fx': resolve(__dirname, 'vendor', 'pixelfx', 'src', 'fx'),
        pixelfx: resolve(__dirname, 'vendor', 'pixelfx', 'src', 'core', 'index.js'),
      },
    },

    publicDir: 'assets',

    server: {
      host: '127.0.0.1',
      port: 7523,
      /**
       * 文件服务白名单：**已无特例**（@since v3.3，task_191）。
       * why：pixelfx 源码已 vendor 进仓（vendor/pixelfx/），别名指仓内路径 ——
       *   vite 默认就服务项目根内的文件，仓外那条例外（放行父目录）已随 vendor 化删除。
       * why 不影响生产：fs.allow 只在 dev server 生效，构建走的是模块图，不读磁盘白名单。
       */
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:7524',
          changeOrigin: true,
          ws: true,
        },
        '/textures': {
          target: 'http://127.0.0.1:7524',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://127.0.0.1:7525',
          changeOrigin: true,
          ws: true,
        },
      },
    },

    build: {
      outDir: 'dist/frontend',
      sourcemap: true,
      rollupOptions: {
        /**
         * 单入口构建：只产出新游戏化 UI（NEW_ENTRY_HTML）。
         * why task_017 起只有这一个入口：D5「Zone 整体砍掉」把旧 Vue 链（index.html → src/main.ts → App.vue）
         * 的地基抽掉了 —— 旧战场场景本身就是 Zone 模型（zone 即建筑/任务区/移动目标），保不住旧链。
         * 回退开关 STRATIX_LEGACY 随之失效（已下线），回退手段改为 git 历史，
         * 见 src/app/entry-paths.ts 的「回退策略变更」。
         */
        input: {
          main: resolve(__dirname, NEW_ENTRY_HTML),
        },
        output: {
          // why 显式返回 undefined：noImplicitReturns 打开时"隐式落空"也算错误分支，
          // 而"不归入任何手写 chunk"正是这里想要的行为（交给 rollup 默认切分）。
          manualChunks: (id: string): string | undefined => {
            if (id.includes('node_modules')) {
              if (id.includes('phaser')) return 'phaser';
              if (id.includes('vue') || id.includes('@vue')) return 'vue-vendor';
              if (id.includes('@anthropic') || id.includes('openai') || id.includes('@langchain')) return 'ai-langchain';
            }
            if (id.includes('highlight.js') || id.includes('marked')) return 'markdown-vendor';
            return undefined;
          },
        },
        external: ['fs-extra', 'graceful-fs'],
      },
    },

    optimizeDeps: {
      include: ['vue', 'axios', 'phaser', 'mitt'],
      exclude: ['lowdb', 'fs-extra', 'graceful-fs'],
    },

    define: {
      'process.env': {},
      global: 'globalThis',
      /**
       * 开发期开关：首启向导强制触发（@since v3.9，task_026）。
       * why 不用 import.meta.env：本仓库的 tsc 构建走 CommonJS（tsconfig.json），
       *   import.meta 在那里编译不过（TS1343），故由构建期注入一个常量。
       * 取值口径：'1' = 开，其余（含未设置）= 关。见 src/app/main/dev-flags.ts。
       */
      __STRATIX_ONBOARDING_FORCE__: JSON.stringify(process.env.STRATIX_ONBOARDING_FORCE ?? ''),
      /**
       * 远程模式开关（@since v3.43，task_083，前后端分离 B3）。
       * '1' = Electron 壳退化为纯视图客户端（数据源 = world-sync 远程 store）。
       * why 也走 define（不 import.meta.env）：本仓库的 tsc 构建走 CommonJS，import.meta 编译不过。
       * 取值口径见 src/app/main/dev-flags.ts。
       */
      __STRATIX_REMOTE__: JSON.stringify(process.env.STRATIX_REMOTE ?? ''),
      /** world-sync 端点地址（远程模式的数据源；空串 = 用缺省地址）。 */
      __STRATIX_WORLD_SYNC_URL__: JSON.stringify(process.env.STRATIX_WORLD_SYNC_URL ?? ''),
      /**
       * 互聊单回合超时（ms，@since v3.44，task_090；空串 = 用缺省 120s）。
       * why 也要构建期这一路：纯浏览器 dev（不起 Electron）没有 preload 通道，
       *   只有 vite define 能把 shell 里的环境变量带进渲染层。
       */
      __STRATIX_PEER_TURN_TIMEOUT_MS__: JSON.stringify(process.env.STRATIX_PEER_TURN_TIMEOUT_MS ?? ''),
      /**
       * LLM 自动起名配置（@since v3.47，task_104）：URL / Key / 模型；三者任一为空 → 规则版起名。
       * why 也要构建期这一路：纯浏览器 dev（不起 Electron）没有 preload 通道，
       *   只有 vite define 能把 shell 里的环境变量带进渲染层。
       */
      __STRATIX_TITLE_LLM_URL__: JSON.stringify(process.env.SX_TITLE_LLM_URL ?? ''),
      __STRATIX_TITLE_LLM_KEY__: JSON.stringify(process.env.SX_TITLE_LLM_KEY ?? ''),
      __STRATIX_TITLE_LLM_MODEL__: JSON.stringify(process.env.SX_TITLE_LLM_MODEL ?? ''),
      /**
       * 长会话压缩阈值（事件条数；@since v3.48，task_106 / v3.2b-B7；空串 = 用缺省 200）。
       * why 也要构建期这一路：纯浏览器 dev（不起 Electron）没有 preload 通道，
       *   只有 vite define 能把 shell 里的环境变量带进渲染层。
       */
      __STRATIX_SESSION_COMPRESS_THRESHOLD__: JSON.stringify(
        process.env.SX_SESSION_COMPRESS_THRESHOLD ?? '',
      ),
    },
  };
});
