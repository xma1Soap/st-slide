// @ts-nocheck
/**
 * 只在类名状态真的需要改变时才写入。
 *
 * 原因：酒馆自带的 keyboard.js 会监听全页面的 class 变化。哪怕只是
 * "移除一个本来就没有的类"，浏览器也会把它算作一次变化，酒馆随即把这个元素
 * 整棵子树里的按钮重新扫描一遍。对 body / #chat 这种大元素来说，楼层越多
 * 扫得越久（1500 楼时一次约 0.5 秒），翻页、加载历史时就会明显卡顿。
 *
 * @param {Element|null|undefined} el
 * @param {string} className
 * @param {boolean} on 为 true 时确保有这个类，false 时确保没有
 */
export function setClass(el, className, on) {
    if (!el) return;
    const want = !!on;
    if (el.classList.contains(className) === want) return;
    el.classList.toggle(className, want);
}
