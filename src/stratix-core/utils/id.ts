/**
 * 文件职责：全局实体 ID 生成（`{prefix}_{base36时间戳}_{9位随机}`）。
 * 输入：一个字符串前缀（如 'zone' / 'agent' / 'task'）。
 * 输出：可直接落库的主键字符串。
 * 禁止事项：
 *   1. 改 ID 格式 —— 该格式是**已落库的数据格式**，改了会让历史行主键与新行对不上；
 *   2. 引任何运行时依赖（vue / phaser / gateway）—— 本模块被 repository 层直接消费，必须纯 TS。
 * why 从 src/stratix-project/utils/helpers.ts 迁来：D6（stratix-project 整模块不迁移）删掉那个目录后，
 *   stratix-database / stratix-agent 的非 Zone 仓储仍在用本函数，属于"随项目模块一起消失但本身不是项目代码"的依赖。
 */

/**
 * 生成带前缀的实体 ID。
 * why 优先用 crypto.randomUUID 而不是纯 Math.random：主键会去重，撞了就是脏数据；
 * why 截断到 9 位：与既有落库数据同长度，避免索引膨胀。
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 9)
    : Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}