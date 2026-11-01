/**
 * 文件职责：CDP 走查 —— 连接探测 + 世界状态快照。
 *
 * 用法：node e2e-tests/probe.mjs
 * 产出：stdout 一份 JSON（连接信息 + 世界状态：角色 / 单位 / 任务 / 使命）。
 *
 * 用途：任何走查的第一步 —— 确认「Electron 页面在、core 广播在」，
 * 并拿到当前世界里有哪些角色 / 单位 / 任务 / 使命（后续脚本的角色 id 从这里取）。
 */

import { connectPage, READ_STATE_EXPR, CDP_BASE } from './lib/cdp.mjs';

async function main() {
  const session = await connectPage();
  try {
    const state = await session.evaluate(READ_STATE_EXPR);
    if (state?.error) {
      console.error(`探查失败：${state.error}`);
      return 1;
    }
    console.log(
      JSON.stringify(
        {
          cdp: {
            base: CDP_BASE,
            pageTitle: session.page.title,
            pageUrl: session.page.url,
          },
          ...state,
        },
        null,
        2
      )
    );
    return 0;
  } finally {
    session.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`探查异常：${err?.message ?? err}`);
    process.exitCode = 1;
  });
