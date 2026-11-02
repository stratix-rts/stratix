/**
 * 文件职责：CLI 子进程的 **spawn env 组装**（@since v3.44，task_090）——
 *   把「这一轮 CLI 该拿到哪些环境变量」收成一个**纯函数**，在 runtime 的 spawn options
 *   组装处调用一次（见 runtime.ts「env 组装」段）。各 adapter 零改动。
 * 输入：三个来源（调用方逐次 env / 主进程 env / STRATIX_CLI_ENV 的 JSON 串）。
 * 输出：拼好的 env（注入给子进程的那部分）+ 可读的告警（配置写错时告诉用户，而不是静默吞掉）。
 * 禁止事项：
 *   1. **不做全量展开** —— 绝不 `{ ...process.env }`：把主进程整个环境灌进 CLI 会污染
 *      CLI 自身的配置（内部开关 / 凭据 / 路径），也是本单的验收项（grep 验证）；
 *      自动透传只走白名单里的**代理类**变量；
 *   2. 在这里 import child_process —— 本文件是纯逻辑，进程生命周期归 runtime；
 *   3. 引入新依赖 —— 只用 JSON.parse；
 *   4. 读业务配置 —— 这里只管 env 拼装，不管「这个 agent 要不要代理」。
 *
 * ============ 为什么需要这一层（task_090 的根因）============
 * 互聊拉起的 claude CLI 拿不到代理 env → 它的 WebFetch / curl 撞外网黑洞 →
 * agent 空转重试零输出 → 120s 看门狗杀进程（用户侧表现为「调用超时:120000ms 无输出」）。
 * 修法 = 给 CLI 进程一个**显式**的 env 注入口：用户配一次（STRATIX_CLI_ENV），
 * 所有 CLI（claude / codex / kimi / opencode / openclaw / dsh）自动带上。
 *
 * ============ 优先级（高 → 低）============
 *   1. 调用方逐次显式 env（SpawnOptions.env）—— 最具体的一级，是 API 契约面；
 *   2. STRATIX_CLI_ENV（JSON 串，如 {"https_proxy":"http://127.0.0.1:7890"}）——
 *      用户显式指定的全局配置，键不限（用户自己负责不污染 CLI 配置）；
 *   3. 主进程 env 的**代理类**变量透传（https_proxy / http_proxy / all_proxy 三个白名单键）——
 *      兜底：主进程自己带着代理，就让 CLI 也带着；
 *   4. 都不命中 → 本函数不产出任何注入（= 现状：node-process.ts 照旧继承主进程 env）。
 *
 * ============ 与「现状继承」的关系 ============
 * node-process.ts 里 `{ ...process.env, ...spawnOptions.env }`（子进程继承主进程环境）
 * 是**既有行为**，本模块不动它 —— CLI 需要 PATH / HOME / 自己的 API key 才能起来。
 * 本模块只负责「额外注入」这一层，且注入内容受白名单约束（代理类）——
 * 用户显式给的 JSON 除外（那是用户自己的决定）。
 *
 * @since v3.44（task_090）
 */

/** STRATIX_CLI_ENV：用户配置 CLI 附加环境变量的环境变量名（值 = JSON 对象串）。 */
export const CLI_ENV_JSON_VAR = 'STRATIX_CLI_ENV';

/**
 * 自动透传的代理类变量白名单（**只有这三个**）。
 * why 只有三个：自动透传必须最小化 —— 主进程环境里还有一堆与 CLI 无关的东西
 *   （内部开关、凭据、路径），全量灌进去会污染 CLI 自身的配置解析。
 * why 都是小写：curl / git / pip 等 Unix 工具以小写为准（curl 同时认大写作为 CGI 例外）。
 *   大写变体（HTTP_PROXY / HTTPS_PROXY）不自动透传 —— 需要时写进 STRATIX_CLI_ENV 即可。
 */
export const PROXY_ENV_KEYS = ['https_proxy', 'http_proxy', 'all_proxy'] as const;

/** env 组装的来源（三处来源都可注入 —— 单测不必改 process.env）。 */
export interface SpawnEnvSources {
  /** 调用方逐次显式给的 env（SpawnOptions.env）；最高优先。 */
  readonly extra?: Readonly<Record<string, string>> | undefined;
  /** 主进程 env（缺省 process.env）；**只从中取代理类白名单键**。 */
  readonly hostEnv?: Readonly<Record<string, string | undefined>> | undefined;
  /** STRATIX_CLI_ENV 的原始串（缺省取主进程 env 里的同名变量）。 */
  readonly jsonEnv?: string | undefined;
}

/** env 组装结果：注入用的 env + 配置告警。 */
export interface SpawnEnvAssembly {
  /** 拼好的 env（注入给子进程的那部分；空对象 = 不注入）。 */
  readonly env: Readonly<Record<string, string>>;
  /** 配置写错时的告警（调用方负责转成日志 —— 本模块不碰 logger）。 */
  readonly warnings: readonly string[];
}

/**
 * 组装 spawn env（纯函数）。
 *
 * 口径见文件头「优先级」：extra > STRATIX_CLI_ENV > 主进程代理透传 > 不注入。
 * @param sources 三处来源（都可注入，便于单测）
 */
export function assembleSpawnEnv(sources: SpawnEnvSources = {}): SpawnEnvAssembly {
  const warnings: string[] = [];
  const env: Record<string, string> = {};

  // —— 第 3 级：主进程代理类变量（白名单三个键）——
  const hostEnv = sources.hostEnv ?? {};
  for (const key of PROXY_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === 'string' && value.trim().length > 0) env[key] = value;
  }

  // —— 第 2 级：STRATIX_CLI_ENV 的 JSON（覆盖第 3 级）——
  const raw = sources.jsonEnv;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      warnings.push(
        `${CLI_ENV_JSON_VAR} 不是合法 JSON，已忽略（${error instanceof Error ? error.message : String(error)}）`
      );
      parsed = undefined;
    }
    if (parsed !== undefined) {
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value !== 'string') {
            warnings.push(`${CLI_ENV_JSON_VAR} 的「${key}」不是字符串，已忽略`);
            continue;
          }
          if (value.length === 0) {
            warnings.push(`${CLI_ENV_JSON_VAR} 的「${key}」是空串，已忽略`);
            continue;
          }
          env[key] = value;
        }
      } else {
        warnings.push(`${CLI_ENV_JSON_VAR} 必须是一个 JSON 对象，已忽略`);
      }
    }
  }

  // —— 第 1 级：调用方逐次显式 env（最具体，赢过上面两级）——
  for (const [key, value] of Object.entries(sources.extra ?? {})) {
    if (typeof value !== 'string') continue;
    env[key] = value;
  }

  return { env, warnings };
}

/**
 * 按**当前进程**的真实环境组装 spawn env（生产路径用这个）。
 * @param extra 调用方逐次显式给的 env（最高优先）
 */
export function resolveSpawnEnv(extra?: Readonly<Record<string, string>>): SpawnEnvAssembly {
  // why 防御式读 process.env：渲染层 bundle 里 process.env 被 vite define 替换成空对象
  //   （见 vite.config.ts），本函数在那里的结果就是「不注入」——不崩、不假装有代理。
  const processEnv: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? process.env : {};
  return assembleSpawnEnv({
    extra,
    hostEnv: processEnv,
    jsonEnv: processEnv[CLI_ENV_JSON_VAR],
  });
}
