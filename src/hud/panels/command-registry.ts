/**
 * 文件职责：**命令行解析器**（@since v3.6，task_113；@since v3.9，task_150 收编词表）——
 *   底栏命令行（`<strat-command-panel>` 的搜索框）里「命令名 → 命令」的解析与帮助文案。
 *   纯逻辑：零 DOM、零 IO、零总线依赖（node 环境可直测）。
 *
 * ============ task_150：词表收编到共享注册表 ============
 *   此前本文件持有 CLI 词表本体，⌘K 面板（task_150）另起了一份全应用命令清单 ——
 *   两份「设置 / 主题 / 回放」的写法必然对不上（别名、用法串、参数白名单各写一份）。
 *   现在**词表只有一份**：在 hud/lib/command-registry.ts（共享注册表），
 *   本文件从那里**派生** CLI_COMMANDS —— 底栏 composer 与 ⌘K 面板共用一份事实源。
 *   行为零回归：五条命令的名字 / 别名 / 用法 / 参数口径一字未改（既有测试全绿即证）。
 *
 * why 独立成文件（不并进 command-catalog.ts）：
 *   command-catalog 是**按钮目录** —— 点一条 = 一条 HudCommand，可用性看当前 WorldState；
 *   本模块是**命令行解析** —— 敲一串字 = 一次带参调用，可用性只看输入串本身。
 *   两者形态不同、判定口径不同，混在一处必然互相污染（按钮目录不该知道「参数」这回事，
 *   命令行也不该关心当前选中集 —— 那是按钮那侧的事）。
 *
 * 输入：一行用户输入（纯文本）。
 * 输出：CliParseResult（命中的命令 + 参数 / 未命中）+ 可直接展示的帮助文案。
 *
 * 禁止事项：
 *   1. 触碰 DOM —— 渲染归 command-panel.ts；
 *   2. import core/bus —— 派发一律经注入的 adapter（铁律：HUD 只经 bus-adapter 说话）；
 *   3. 在这里**执行**命令 —— 本文件只认得命令，不执行（执行要 DOM 与总线，属面板的事）；
 *   4. **自建词表** —— 词表在共享注册表（hud/lib/command-registry.ts），此处只派生与解析。
 */

import { CLI_BINDINGS } from '../lib/command-registry';

/** 命令行的命令 id（稳定标识；与 HudCommand.type 不同名是刻意的 —— 命令与契约变体不是一回事）。 */
export type CliCommandId = 'mission' | 'theme' | 'settings' | 'replay' | 'help';

export interface CliCommandSpec {
  readonly id: CliCommandId;
  /** 命令名（规范写法；大小写不敏感）。 */
  readonly name: string;
  /** 别名（同样能命中；中文别名是底栏那行提示词的老承诺，兑现它）。 */
  readonly aliases?: readonly string[];
  /** 用法串（help 列表与用法提示共用；`<>` 必填、`[]` 可选）。 */
  readonly usage: string;
  /** 一句话说明（help 列表用）。 */
  readonly summary: string;
  /** 参数必填（缺了只给用法提示，不执行）。 */
  readonly argRequired?: boolean;
  /** 参数取值白名单（给了就只认这几个；缺省 = 自由文本参数）。 */
  readonly allowedArgs?: readonly string[];
}

/**
 * 命令表本体 —— **从共享注册表派生**（@since v3.9，task_150）。
 * why 派生而不是另抄一份：⌘K 面板（task_150）与底栏 composer 共用一份事实源 ——
 *   「help 列出来的」与「真能敲的」必须同源，两份清单迟早对不上 = 又一个假入口。
 *   派生后，共享注册表里给命令加 cli 绑定，composer 自动认得（不用改第二处）。
 * 顺序即 help 列表的展示顺序（= 共享注册表里的登记顺序）。
 */
export const CLI_COMMANDS: readonly CliCommandSpec[] = Object.freeze(
  CLI_BINDINGS.map((binding) => ({
    id: binding.id as CliCommandId,
    name: binding.name,
    ...(binding.aliases ? { aliases: binding.aliases } : {}),
    usage: binding.usage,
    summary: binding.summary,
    ...(binding.argRequired ? { argRequired: binding.argRequired } : {}),
    ...(binding.allowedArgs ? { allowedArgs: binding.allowedArgs } : {}),
  }))
);

/** 解析结果的五种形态。做成可判别的联合：调用方按 kind 分支时 spec 自动收窄（不用断言）。 */
export type CliParseResult =
  | {
      readonly kind: 'empty';
      readonly spec: null;
      readonly arg: '';
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'matched';
      readonly spec: CliCommandSpec;
      /** 参数（已 trim；白名单参数的命令已小写归一）。 */
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'missing-arg';
      readonly spec: CliCommandSpec;
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'invalid-arg';
      readonly spec: CliCommandSpec;
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'unknown';
      readonly spec: null;
      readonly arg: string;
      /** 输入原样（trim 后），用于回显「没有匹配的命令「xxx」」。 */
      readonly input: string;
      /** 近似候选命令名（null = 没有近似项）。 */
      readonly suggestion: string | null;
    };

/** 名字 → 目录项（规范名与别名都算；大小写不敏感）。 */
function findByName(name: string): CliCommandSpec | undefined {
  const key = name.toLowerCase();
  return CLI_COMMANDS.find(
    (c) => c.name.toLowerCase() === key || (c.aliases ?? []).some((a) => a.toLowerCase() === key)
  );
}

/**
 * 子序列模糊匹配（与 command-catalog 的搜索同一套口径：容忍缩写）。
 * why 自己抄一份而不 import command-catalog：那边是 private 的，
 *   而跨文件 import 一个纯函数只为几行字会让两个目录的耦合凭空长出来。
 */
function subsequenceMatch(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const pattern = needle.toLowerCase();
  let p = 0;
  for (let i = 0; i < text.length && p < pattern.length; i += 1) {
    if (text[i] === pattern[p]) p += 1;
  }
  return p === pattern.length;
}

/** 未命中时给个近似候选（"sett" → "settings"）；没有近似就 null（不硬凑）。 */
function suggestFor(name: string): string | null {
  const hit = CLI_COMMANDS.find((c) => subsequenceMatch(c.name, name));
  return hit ? hit.name : null;
}

/**
 * 解析一行命令行输入。
 *
 * 口径：
 *   - 第一个词是命令名（大小写不敏感，别名也算）；
 *   - 剩下的整段是参数（保留内部空格 —— 任务标题可能带空格）；
 *   - 参数必填而没给 → 'missing-arg'（调用方给用法提示，不执行）；
 *   - 参数不在白名单里 → 'invalid-arg'（调用方列出合法值）。
 */
export function parseCliInput(raw: string): CliParseResult {
  const input = raw.trim();
  if (input.length === 0) {
    return { kind: 'empty', spec: null, arg: '', input, suggestion: null };
  }

  const spaceAt = input.search(/\s/);
  const name = spaceAt === -1 ? input : input.slice(0, spaceAt);
  const rawArg = spaceAt === -1 ? '' : input.slice(spaceAt + 1).trim();

  const spec = findByName(name);
  if (!spec) {
    return { kind: 'unknown', spec: null, arg: rawArg, input, suggestion: suggestFor(name) };
  }

  const arg = spec.allowedArgs ? rawArg.toLowerCase() : rawArg;

  if (spec.argRequired === true && arg.length === 0) {
    return { kind: 'missing-arg', spec, arg, input, suggestion: null };
  }
  if (spec.allowedArgs && arg.length > 0 && !spec.allowedArgs.includes(arg)) {
    return { kind: 'invalid-arg', spec, arg, input, suggestion: null };
  }
  return { kind: 'matched', spec, arg, input, suggestion: null };
}

/** 用法清单（一行，含参数写法）—— help 与「未匹配」引导共用同一份。 */
export function cliUsageList(): string {
  return CLI_COMMANDS.map((c) => c.usage).join(' · ');
}

/**
 * help 的正文：紧凑清单一行 + 每条命令一行（用法 + 别名 + 说明）。
 * why 带别名：中文别名是底栏提示词承诺过的老入口（主题 / 设置 / 回放），
 *   help 只列规范名的话，用户敲「设置」才发现它也认 —— **列出来的必须是能敲的全部形态**，
 *   否则 help 又成了半个假入口（这是复测发现的 P2：help 静默 + 清单不完整）。
 */
export function cliHelpText(): string {
  const lines = CLI_COMMANDS.map((c) => {
    const alias = c.aliases && c.aliases.length > 0 ? `（别名：${c.aliases.join(' / ')}）` : '';
    return `${c.usage}${alias} —— ${c.summary}`;
  });
  return [`可用命令：${cliUsageList()}`, ...lines].join('\n');
}

/**
 * 未匹配输入的回执：**先说没匹配上，再把能敲的命令全列出来**。
 * why 不是干巴巴一句「没有匹配的命令」：死功能报告里最刺眼的就是这句 ——
 *   用户照着提示词敲了一串，得到的只有一堵墙。给得出清单，才叫引导。
 */
export function cliUnknownText(input: string): string {
  const parsed = parseCliInput(input);
  const hint = parsed.suggestion ? `（是不是想输入「${parsed.suggestion}」？）` : '';
  return `没有匹配的命令「${parsed.input}」${hint}\n可用命令：${cliUsageList()}`;
}

/** 用法提示（参数缺失时）：用法串 + 一个能直接抄的例子。 */
export function cliUsageHint(spec: CliCommandSpec): string {
  const example = spec.id === 'mission' ? 'mission 整理战场' : spec.usage;
  return `用法：${spec.usage} —— 例如 ${example}`;
}
