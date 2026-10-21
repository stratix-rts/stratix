/**
 * 文件职责：dev 入口的环境声明 —— 让 HUD 的 token CSS 以**字符串**被导入（vite 的 ?inline）。
 *   why 需要它：hud/theme/theme-controller.ts 的 sources 要的是 CSS 原文（它自己注入 <style>），
 *   而 vite 默认把 .css 导入解析成 URL。`?inline` 才是拿到原文的官方写法。
 *   声明只对 dev 调用栈有意义；生产产物消费的是 dev 入口之外的链路。
 */
declare module '*.css?inline' {
  const css: string;
  export default css;
}