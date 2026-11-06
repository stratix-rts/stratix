/**
 * 文件职责：**合成器版本号** —— 角色烘焙缓存键的第三要素（@since v3.3，task_195 / CP-01）。
 *   权威定义：docs/DESIGN-asset-pipelines.md §2.2 纪律 1
 *   （缓存键 = agent 标识 + 皮肤 + Composer 版本号；版本变 ⇒ 旧图自动失效重烘）。
 *   设计取舍与依据见 docs/DESIGN-asset-pipelines.md §2.1 / §2.2。
 * 输入：无（常量 + 常量表）。
 * 输出：COMPOSER_VERSION（版本号字符串）+ 参与源码哈希的文件清单。
 * 禁止事项：
 *   1. 在运行时算哈希 —— 本文件要进渲染层 bundle，不能 import fs / crypto；
 *      哈希**离线**算（见 __tests__/helpers/composer-version-hash.ts），
 *      本文件只**声明**当前值；两者不一致时那条单测会红 ——
 *      这正是「改了合成器却忘了失效缓存」被自动拦下的执行机制。
 *   2. 把版本号混进精灵表几何那类常量（constants.ts）—— 版本号有自己的 bump 语义
 *      （合成器或素材变了就变），与几何常量不是一回事，混在一起会让 bump 规则失焦。
 *
 * ★ 版本号格式：`r<手工位>-<源码哈希前 8 位>`
 *   - **手工位**（r1 / r2 …）：给**素材升级**用 —— LPC 素材不在仓内（1.3G，.gitignore 排除），
 *     源码哈希看不见它；素材换了图就把手工位 +1，旧缓存随之自动失效。
 *   - **源码哈希**：给**合成器逻辑升级**用 —— 由 character-composer.ts / part-registry.ts /
 *     constants.ts 三个文件的 sha256 前 8 位算出（顺序固定，见下方清单）；
 *     改了这三个文件里的任何一个，哈希就变 → 版本变 → 旧烘焙图自动失效重烘。
 *   两条合起来 = 「Composer 逻辑 / 部件素材升级 ⇒ 版本变 ⇒ 旧图自动失效重烘」
 *   （DESIGN §2.2 纪律 1 的原话）。
 *
 * ★ 为什么不用「素材目录的哈希」：素材真源 1.3G 且不在仓内，
 *   逐字节哈希既慢又不可复现（不同机器拷进来的素材可能不同）；
 *   合成结果只取决于**本次用到的那些部位文件**，把它们纳入哈希要等素材就位才有意义 ——
 *   眼下按「源码哈希 + 素材手工位」这条可判定、可复现的路子走。
 */

/**
 * 合成器版本号（缓存键第三要素）。
 *
 * ⚠️ 改动合成器源码（character-composer.ts / part-registry.ts / constants.ts）后
 *   **必须**把这里更新成新哈希（单测会打印期望值，照抄即可）。
 */
export const COMPOSER_VERSION = 'r1-d31e3a44';

/**
 * 参与源码哈希的合成器源码文件（相对本目录）。
 *
 * why 只这三份：它们决定**同一份外观合成出来的像素**（合成算法 / 素材路径拼法 / 精灵表几何）。
 *   类型声明（types.ts）、随机化（appearance-randomizer.ts）、兜底长相（character-look.ts）
 *   都不影响像素 —— 纳入哈希只会让无谓的改动作废缓存。
 * why 顺序固定：哈希与拼接顺序有关，顺序变了哈希就变（那也只是一次性失效，代价可接受，
 *   但固定顺序让「同样的源码永远同一个版本号」这条性质成立）。
 */
export const COMPOSER_VERSION_SOURCE_FILES = [
  'character-composer.ts',
  'part-registry.ts',
  'constants.ts',
] as const;
