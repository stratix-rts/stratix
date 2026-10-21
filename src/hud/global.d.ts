/**
 * HUD 模块的环境声明。
 *   - *.css ：将 CSS 文件作为字符串导入（用于把 token 注入 <style>，避免 bundler 解析与路径耦合）。
 *   本声明只对 dev-only 调用栈有意义，编译产物消费的是字符串字面量。
 */
declare module '*.css' {
  const css: string;
  export default css;
}
