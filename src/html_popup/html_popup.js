// @ts-nocheck
import { extension_settings, getContext } from '../../../../../extensions.js';
import { setClass } from '../utils/class_guard.js?v=1.0.28';

function getWin() {
    try {
        if (window.parent && window.parent.document) return window.parent;
    } catch {}
    return window;
}

function getDoc() {
    try {
        if (window.parent && window.parent.document) return window.parent.document;
    } catch {}
    return document;
}

const QR_BTN_ID = 'twt-qr-html-app-btn';
const FLOAT_BTN_ID = 'twt-float-html-app-btn';
const FLOAT_POS_KEY = 'twt_html_popup_float_pos';
const MODAL_ID = 'twt-html-app-modal';
const POS_KEY = 'twt_html_popup_saved_pos';

/**
 * 获取当前对话/角色卡的唯一隔离命名空间，防止不同角色卡间状态串扰
 */
function getChatContextKey() {
    try {
        if (typeof getContext === 'function') {
            const ctx = getContext();
            if (ctx) {
                const charId = ctx.characterId ?? ctx.this_chid ?? '';
                const chatId = ctx.chatId ?? '';
                const groupId = ctx.groupId ?? '';
                if (groupId) return `grp_${groupId}_${chatId}`;
                if (charId !== '') return `chr_${charId}_${chatId}`;
            }
        }
    } catch (e) {}
    return 'default';
}

/**
 * 检查指定 DOM 节点或代码块是否匹配用户设置的正文内嵌白名单 (不抽离至弹窗)
 */
export function isElementWhitelisted(el) {
    if (!el) return false;
    const rawWhitelist = extension_settings?.twt?.htmlPopupWhitelist || '';
    if (!rawWhitelist.trim()) return false;

    // 解析规则（支持按换行或逗号分割）
    const rules = rawWhitelist
        .split(/[\n,]+/)
        .map(r => r.trim())
        .filter(Boolean);

    if (rules.length === 0) return false;

    const elId = el.id || '';
    const elClass = (typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || ''));
    const elOuter = (el.outerHTML || '').substring(0, 1500);
    const codeText = (el.textContent || '').substring(0, 1500);

    for (const rule of rules) {
        // 1. 尝试作为标准 CSS 选择器匹配
        try {
            if (typeof el.matches === 'function' && el.matches(rule)) return true;
            if (typeof el.closest === 'function' && el.closest(rule)) return true;
            if (typeof el.querySelector === 'function' && el.querySelector(rule)) return true;
        } catch (e) {}

        // 2. 关键字/子串模式匹配 (ID, Class, 属性, 内容)
        const cleanRule = rule.replace(/^[.#\[\]]/g, '').trim();
        if (cleanRule) {
            if (elId && elId.includes(cleanRule)) return true;
            if (elClass && typeof elClass === 'string' && elClass.includes(cleanRule)) return true;
            if (elOuter.includes(rule) || elOuter.includes(cleanRule)) return true;
            if (codeText.includes(rule) || codeText.includes(cleanRule)) return true;
        }
    }

    return false;
}

/**
 * 判断一个代码块（PRE / CODE）是否包含可执行/可展示的 HTML 或 Iframe 应用
 */
function isHtmlAppCodeBlock(el) {
    if (!el) return false;
    if (el.closest?.('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return false;
    if (isElementWhitelisted(el)) return false;

    const pre = el.tagName === 'PRE' ? el : el.closest?.('pre');
    const codeEl = el.tagName === 'CODE' ? el : (el.querySelector?.('code') || el);

    const cls = ((pre?.className || '') + ' ' + (codeEl?.className || '')).toLowerCase();
    const text = (codeEl?.textContent || pre?.textContent || '').trim();
    if (text.length < 15) return false;

    if (el.__twt_is_html_app__ !== undefined) return el.__twt_is_html_app__;

    // 1. 明确标记为 HTML/XML/IFRAME 代码块
    const isHtmlLang = cls.includes('language-html') ||
                       cls.includes('language-xml') ||
                       cls.includes('language-iframe') ||
                       cls.includes('language-htm');

    // 2. 文本内容特征检测
    const hasIframe = /<iframe[\s\S]*?>/i.test(text);
    const hasHtmlDoc = /<!DOCTYPE\s+html|<html[\s>]/i.test(text);
    const hasComplexHtml = /<(div|canvas|svg|style|script)[\s\S]*?>/i.test(text) && text.length > 50;

    const result = Boolean(isHtmlLang || hasIframe || hasHtmlDoc || (cls.includes('language-') && hasComplexHtml));
    el.__twt_is_html_app__ = result;
    return result;
}

/**
 * 从代码块提取纯净的 HTML 字符串 (支持解析 <iframe srcdoc="..."> 嵌套，带预热缓存)
 */
function extractHtmlFromCodeBlock(el) {
    if (el.__twt_extracted_html__) return el.__twt_extracted_html__;
    const codeNode = el.querySelector?.('code') || el;
    let rawCode = (codeNode.textContent || '').trim();

    // 如果是用 <iframe srcdoc="..."> 包装的代码，优先解析出内部真正的内容
    if (/<iframe[\s\S]*srcdoc=/i.test(rawCode)) {
        const match = rawCode.match(/srcdoc=(["'])([\s\S]*?)\1/i);
        if (match && match[2]) {
            const d = getDoc().createElement('textarea');
            d.innerHTML = match[2];
            rawCode = d.value;
        }
    }

    el.__twt_extracted_html__ = rawCode;
    return rawCode;
}

/**
 * 新 Iframe 被捕捉未读状态标志与更新器
 */
let hasUnreadApp = false;

function updateQrBadge(show) {
    hasUnreadApp = show;
    const doc = getDoc();
    const qrBtn = doc.getElementById(QR_BTN_ID);
    if (qrBtn) {
        qrBtn.classList.toggle('has-unread', show);
    }
    const floatBtn = doc.getElementById(FLOAT_BTN_ID);
    if (floatBtn) {
        floatBtn.classList.toggle('has-unread', show);
    }
}

/**
 * 动态 ResizeObserver 句柄
 */
let activeResizeObserver = null;
let activeIframeObserver = null;

function stopAppResizeObserver() {
    if (activeResizeObserver) {
        if (typeof activeResizeObserver.disconnect === 'function') {
            activeResizeObserver.disconnect();
        }
        activeResizeObserver = null;
    }
    if (activeIframeObserver) {
        if (typeof activeIframeObserver.disconnect === 'function') {
            activeIframeObserver.disconnect();
        }
        activeIframeObserver = null;
    }
}

/**
 * 全局空白区域点击收回监听器句柄
 */
let activeOutsideClickListener = null;

function removeOutsideClickListener() {
    if (activeOutsideClickListener) {
        const doc = getDoc();
        doc.removeEventListener('mousedown', activeOutsideClickListener, true);
        doc.removeEventListener('touchstart', activeOutsideClickListener, true);
        doc.removeEventListener('click', activeOutsideClickListener, true);
        activeOutsideClickListener = null;
    }
}

/**
 * 节流/防抖函数 (Debounce)
 */
function debounce(fn, delay = 150) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
            timer = null;
        }, delay);
    };
}

/**
 * LRU 机制：限制 localStorage 中保存的 HTML 展开状态最多为 MAX_STORED_STATES 个
 */
const MAX_STORED_STATES = 30;

function cleanOldAppHtmlStates() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('twt_app_saved_html_')) {
                keys.push(k);
            }
        }
        if (keys.length > MAX_STORED_STATES) {
            const toRemoveCount = keys.length - MAX_STORED_STATES;
            keys.sort(); 
            for (let i = 0; i < toRemoveCount; i++) {
                localStorage.removeItem(keys[i]);
            }
            console.log(`[TwT HtmlPopup] 自动执行 LRU 清理，已清除 ${toRemoveCount} 条较旧的 HTML 展开状态缓存`);
        }
    } catch (e) {
        console.warn('[TwT HtmlPopup] LRU 清理失败:', e);
    }
}

/**
 * 追踪当前移入 Modal 的真实 DOM 节点与其正文占位符
 */
let currentlyMovedEl = null;

function returnMovedElementBack() {
    stopAppResizeObserver();
    // 先原子性清空全局引用，防止并发调用造成双重归位竞态
    const el = currentlyMovedEl;
    currentlyMovedEl = null;
    if (!el) return;

    const ph = el.__twt_placeholder__;
    if (ph) delete el.__twt_placeholder__;

    // 关键：在插回文档流之前，先设置完全隐藏，杜绝未隐藏状态导致的瞬时高度撑开与多栏布局位移
    el.classList.add('twt-app-hidden');
    el.style.display = 'none';
    el.style.visibility = 'hidden';

    if (ph && ph.parentNode && getDoc().body.contains(ph)) {
        // 正常路径：占位符仍在文档树中，将应用节点插回原位
        ph.parentNode.insertBefore(el, ph);
        ph.remove();
    } else if (el.parentNode) {
        // 竞态路径：占位符已随 Swipe/重构重建的 DOM 消失，安全移除避免孤立节点泄漏
        el.parentNode.removeChild(el);
        console.log('[TwT HtmlPopup] 占位节点已消失，应用节点已从当前父节点安全移除（防泄漏）');
    }
}

/**
 * 读取与保存弹窗的持久化位置信息
 */
function getSavedPosition() {
    try {
        const data = localStorage.getItem(POS_KEY);
        if (data) return JSON.parse(data);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 读取本地保存的位置数据失败:', e);
    }
    return null;
}

function saveSavedPosition(left, top) {
    try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
        console.log(`[TwT HtmlPopup] 弹窗位置已持久化记忆: Left=${left}px, Top=${top}px`);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 保存位置到 localStorage 失败:', e);
    }
}

/**
 * 读取与保存消息关联的已选应用索引 (按角色卡/对话隔离)
 */
function getSavedAppIndex(mesIndexInfo) {
    try {
        const cKey = getChatContextKey();
        if (mesIndexInfo) {
            const val = localStorage.getItem(`twt_html_popup_index_${cKey}_${mesIndexInfo}`);
            if (val !== null && !isNaN(parseInt(val, 10))) return parseInt(val, 10);
        }
        const globalVal = localStorage.getItem(`twt_html_popup_last_index_${cKey}`);
        if (globalVal !== null && !isNaN(parseInt(globalVal, 10))) return parseInt(globalVal, 10);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 读取记忆的应用索引失败:', e);
    }
    return 0;
}

function saveSavedAppIndex(mesIndexInfo, index) {
    try {
        const cKey = getChatContextKey();
        if (mesIndexInfo) {
            localStorage.setItem(`twt_html_popup_index_${cKey}_${mesIndexInfo}`, index);
        }
        localStorage.setItem(`twt_html_popup_last_index_${cKey}`, index);
        console.log(`[TwT HtmlPopup] [${cKey}] 消息 #${mesIndexInfo} 的当前应用索引 [${index}] 已保存记忆`);
    } catch (e) {
        console.warn('[TwT HtmlPopup] 保存应用索引失败:', e);
    }
}

/**
 * 物理精确测算并自适应调整 Iframe 及其内部 DOM 内容尺寸 (防负反馈收缩版)
 */
function fitIframeToContent(iframeEl, dialogEl) {
    if (!iframeEl || iframeEl.tagName !== 'IFRAME') return;
    try {
        const iDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        const win = getWin();
        const maxW = Math.floor(win.innerWidth * 0.96);
        const maxH = Math.floor(win.innerHeight * 0.92);
        const defaultW = Math.min(Math.floor(win.innerWidth * 0.94), 620);

        // 1. 确定稳定宽度（以属性声明或基准视口宽度为锚点，杜绝响应式 body 负反馈收缩）
        let targetW = 0;
        const attrW = parseInt(iframeEl.getAttribute('width'), 10);
        if (!isNaN(attrW) && attrW > 50) {
            targetW = attrW;
        }

        if (!targetW) {
            targetW = defaultW;
        }

        // 仅当内部元素存在明确的水平溢出（例如超宽表格或非响应式固定宽容器）时才适度扩宽
        if (iDoc && iDoc.body) {
            const bodyScrollW = iDoc.body.scrollWidth || 0;
            const docScrollW = iDoc.documentElement ? (iDoc.documentElement.scrollWidth || 0) : 0;
            const overflowW = Math.max(bodyScrollW, docScrollW);
            if (overflowW > targetW + 15 && overflowW <= maxW) {
                targetW = overflowW;
            }
        }

        const finalW = Math.min(Math.max(Math.ceil(targetW), 100), maxW);

        // 2. 测算自适应高度
        let measuredH = 0;
        if (iDoc && iDoc.body) {
            const children = Array.from(iDoc.body.children).filter(
                c => c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && c.tagName !== 'LINK'
            );

            let maxChildH = 0;
            children.forEach(child => {
                const r = child.getBoundingClientRect();
                if (r.bottom > maxChildH) maxChildH = r.bottom;
            });

            const bodyScrollH = iDoc.body.scrollHeight || 0;
            const docScrollH = iDoc.documentElement ? (iDoc.documentElement.scrollHeight || 0) : 0;
            const bodyOffsetH = iDoc.body.offsetHeight || 0;

            measuredH = Math.max(maxChildH, bodyScrollH, docScrollH, bodyOffsetH);
        }

        if (measuredH <= 30) {
            const attrH = parseInt(iframeEl.getAttribute('height'), 10);
            if (!isNaN(attrH) && attrH > 30) measuredH = attrH;
        }
        if (measuredH <= 30) measuredH = Math.min(420, maxH);

        const finalH = Math.min(Math.max(Math.ceil(measuredH), 50), maxH);

        // 3. 应用尺寸（iframe 始终铺满 wrapper 宽度，避免嵌套挤压）
        iframeEl.style.width = '100%';
        if (dialogEl && dialogEl.style.width !== `${finalW}px`) {
            dialogEl.style.width = `${finalW}px`;
        }

        const curH = parseInt(iframeEl.style.height, 10) || 0;
        if (Math.abs(curH - finalH) > 3) {
            iframeEl.style.height = `${finalH}px`;
        }
    } catch (e) {
        console.warn('[TwT HtmlPopup] 测算 Iframe 内容尺寸失败:', e);
    }
}

/**
 * 实时监测并响应 Iframe / DOM 内部尺寸变化，自适应动态调整 (防循环触发)
 */
function observeAppDynamicResizing(appEl, dialogEl) {
    stopAppResizeObserver();
    const win = getWin();

    const doFit = () => {
        if (!appEl || !dialogEl) return;
        try {
            if (appEl.tagName === 'IFRAME') {
                fitIframeToContent(appEl, dialogEl);
            } else {
                const innerNode = appEl.firstElementChild || appEl;
                const rect = innerNode.getBoundingClientRect();
                const curW = rect.width || appEl.offsetWidth;
                if (curW > 50 && curW < win.innerWidth * 0.98) {
                    dialogEl.style.width = `${Math.ceil(curW)}px`;
                    appEl.style.width = '100%';
                }
            }
        } catch (e) {}
    };

    doFit();

    if (appEl.tagName === 'IFRAME') {
        // 多阶段延迟重测（应对异步图片、脚本、ECharts 等图表渲染）
        requestAnimationFrame(doFit);
        setTimeout(doFit, 40);
        setTimeout(doFit, 160);
        setTimeout(doFit, 450);

        const tryAttachIframeObserver = () => {
            try {
                const iDoc = appEl.contentDocument || appEl.contentWindow?.document;
                if (iDoc) {
                    doFit();
                    const ResizeObserverClass = win.ResizeObserver || window.ResizeObserver;
                    if (ResizeObserverClass && iDoc.body) {
                        activeResizeObserver = new ResizeObserverClass(debounce(doFit, 100));
                        activeResizeObserver.observe(iDoc.body);
                    }
                }
            } catch (e) {}
        };

        appEl.addEventListener('load', () => {
            tryAttachIframeObserver();
            doFit();
            requestAnimationFrame(doFit);
        });

        tryAttachIframeObserver();
    } else {
        const ResizeObserverClass = win.ResizeObserver || window.ResizeObserver;
        if (ResizeObserverClass) {
            activeResizeObserver = new ResizeObserverClass(debounce(doFit, 80));
            activeResizeObserver.observe(appEl);
            if (appEl.firstElementChild) activeResizeObserver.observe(appEl.firstElementChild);
        }
    }
}

/**
 * 监听并防抖保存 Iframe 内部展开/折叠 DOM 状态 (按角色卡/对话隔离)
 */
function attachIframeStateTracker(iframeEl, mesIndexInfo, appIndex) {
    const rawSave = () => {
        try {
            const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            if (doc && doc.documentElement) {
                const fullHtml = doc.documentElement.outerHTML;
                if (fullHtml && fullHtml.length > 20) {
                    cleanOldAppHtmlStates();
                    const cKey = getChatContextKey();
                    localStorage.setItem(`twt_app_saved_html_${cKey}_${mesIndexInfo}_${appIndex}`, fullHtml);
                }
            }
        } catch (e) {}
    };

    const debouncedSave = debounce(rawSave, 300);

    const tryBind = () => {
        try {
            const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            if (doc) {
                doc.removeEventListener('click', debouncedSave, true);
                doc.removeEventListener('toggle', debouncedSave, true);
                doc.removeEventListener('change', debouncedSave, true);
                doc.removeEventListener('input', debouncedSave, true);

                doc.addEventListener('click', debouncedSave, true);
                doc.addEventListener('toggle', debouncedSave, true);
                doc.addEventListener('change', debouncedSave, true);
                doc.addEventListener('input', debouncedSave, true);
            }
        } catch (e) {}
    };

    iframeEl.addEventListener('load', tryBind);
    tryBind();
}

/**
 * 监听并防抖保存 普通 DOM 节点展开/折叠状态 (按角色卡/对话隔离)
 */
function attachDomStateTracker(domEl, mesIndexInfo, appIndex) {
    const rawSave = () => {
        try {
            domEl.querySelectorAll('details').forEach((d) => {
                if (d.open) d.setAttribute('open', '');
                else d.removeAttribute('open');
            });
            domEl.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((inp) => {
                if (inp.checked) inp.setAttribute('checked', '');
                else inp.removeAttribute('checked');
            });

            const currentHtml = domEl.innerHTML;
            cleanOldAppHtmlStates();
            const cKey = getChatContextKey();
            localStorage.setItem(`twt_app_saved_html_${cKey}_${mesIndexInfo}_${appIndex}`, currentHtml);
        } catch (e) {}
    };

    const debouncedSave = debounce(rawSave, 200);

    domEl.addEventListener('click', debouncedSave, true);
    domEl.addEventListener('toggle', debouncedSave, true);
    domEl.addEventListener('change', debouncedSave, true);
}

/**
 * 解析用户自定义标题映射规则
 */
function resolveAppTitle(el, index) {
    const rawMapStr = extension_settings?.twt?.htmlPopupTitleMap || '';
    const rules = [];

    if (rawMapStr.trim()) {
        const lines = rawMapStr.split('\n');
        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let parts = trimmed.split('=');
            if (parts.length < 2) parts = trimmed.split(':');
            if (parts.length >= 2) {
                const pattern = parts[0].trim();
                const replacement = parts.slice(1).join('=').trim();
                if (pattern && replacement) {
                    rules.push({ pattern, replacement });
                }
            }
        });
    }

    const elId = el.id || '';
    const elClass = el.className || '';
    const dataTitle = el.getAttribute?.('data-title') || el.getAttribute?.('title') || el.getAttribute?.('name') || '';
    const textSample = (el.textContent || '').substring(0, 400);

    for (const rule of rules) {
        if (
            (elId && elId.includes(rule.pattern)) ||
            (elClass && elClass.includes(rule.pattern)) ||
            (dataTitle && dataTitle.includes(rule.pattern)) ||
            (textSample && textSample.includes(rule.pattern)) ||
            (el.outerHTML && el.outerHTML.includes(rule.pattern))
        ) {
            return rule.replacement;
        }
    }

    if (dataTitle) {
        let cleanTitle = dataTitle.replace(/\s+/g, ' ').trim();
        if (cleanTitle.length > 14) cleanTitle = cleanTitle.substring(0, 14) + '…';
        return cleanTitle;
    }

    if (el.querySelector) {
        const titleEl = el.querySelector('h1, h2, h3, h4, header, .title, [data-title]');
        if (titleEl && titleEl.textContent) {
            let t = titleEl.textContent.trim().replace(/\s+/g, ' ');
            if (t && t.length < 16) return t;
        }
    }

    return `应用 #${index + 1}`;
}

/**
 * 获取默认设置
 */
export function getHtmlPopupDefaultSettings() {
    return {
        htmlPopupEnabled: true,
        htmlPopupFallbackEnabled: false,
        htmlPopupSelector: 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app',
        htmlPopupTitleMap: 'TH-message=剧情摘要\napp-stat=角色状态',
        htmlPopupWhitelist: '',
        htmlPopupHideInStream: true,
    };
}

/**
 * 样式注入 (彻底消除黑底、无框线、纯透明顶栏，包含平滑过渡手风琴动画)
 */
function injectStyles() {
    const doc = getDoc();
    let style = doc.getElementById('twt-html-popup-style');
    if (style && style.textContent) return;
    if (!style) {
        style = doc.createElement('style');
        style.id = 'twt-html-popup-style';
        doc.head.appendChild(style);
    }

    style.textContent = `
        /* 正文中隐藏应用 DOM 节点与 HTML 代码块，及其占位符与空包裹容器 */
        .twt-app-hidden,
        .twt-app-placeholder {
            display: none !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 0 !important;
            min-height: 0 !important;
            border: none !important;
            line-height: 0 !important;
            font-size: 0 !important;
        }

        /* 当段落、代码块外层或容器内仅含有被隐藏的应用节点时，彻底消除其占据的空白与间距 */
        .mes_text p:empty,
        .mes_text p:has(> .twt-app-hidden:only-child),
        .mes_text p:has(> .twt-app-placeholder:only-child),
        .mes_text div:has(> .twt-app-hidden:only-child),
        .mes_text div:has(> .twt-app-placeholder:only-child),
        .mes_text .code-block-container:has(.twt-app-hidden),
        .mes_text .code-block-container:has(.twt-app-placeholder),
        .mes_text .code-wrapper:has(.twt-app-hidden),
        .mes_text .code-wrapper:has(.twt-app-placeholder) {
            display: none !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 0 !important;
            min-height: 0 !important;
            border: none !important;
            line-height: 0 !important;
            font-size: 0 !important;
        }

        /* QR 栏按钮与左上角高亮纯色静止圆点 */
        #twt-qr-html-app-btn {
            position: relative;
        }

        #twt-qr-html-app-btn .twt-qr-badge {
            display: none;
            position: absolute;
            top: 2px;
            left: 2px;
            width: 6px;
            height: 6px;
            background-color: var(--SmartThemeQuoteColor, #f38ba8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 2;
        }

        #twt-qr-html-app-btn.has-unread .twt-qr-badge {
            display: block;
        }

        /* 拖拽期间防止 iframe 截断事件 */
        body.twt-ball-dragging-active iframe {
            pointer-events: none !important;
        }

        /* 侧边吸附可拖拽悬浮球样式 (参考 Zero 悬浮球磁吸贴边与半隐藏) */
        #twt-float-html-app-btn {
            position: fixed;
            z-index: 10002;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: var(--SmartThemeBlurTintColor, rgba(24, 24, 32, 0.88));
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1.5px solid var(--SmartThemeQuoteColor, #7b8cde);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.42), 0 0 12px rgba(123, 140, 222, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: grab;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.2s ease, box-shadow 0.2s ease;
            box-sizing: border-box;
            color: var(--SmartThemeBodyColor, #cdd6f4);
            font-size: 16px;
        }

        #twt-float-html-app-btn:hover,
        #twt-float-html-app-btn:active {
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 16px rgba(123, 140, 222, 0.35);
        }

        #twt-float-html-app-btn.is-dragging,
        #twt-float-html-app-btn.dragging {
            cursor: grabbing !important;
            transform: scale(1.08) translate3d(0, 0, 0) !important;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(123, 140, 222, 0.45) !important;
            opacity: 0.95 !important;
            transition: none !important;
        }

        /* 贴边半隐藏态 (Docked Edge Half-Hide) */
        #twt-float-html-app-btn.docked-right {
            transform: translate3d(50%, 0, 0);
            opacity: 0.68;
        }

        #twt-float-html-app-btn.docked-right:hover,
        #twt-float-html-app-btn.docked-right:active,
        #twt-float-html-app-btn.docked-right.modal-open {
            transform: translate3d(0, 0, 0);
            opacity: 1;
        }

        #twt-float-html-app-btn.docked-left {
            transform: translate3d(-50%, 0, 0);
            opacity: 0.68;
        }

        #twt-float-html-app-btn.docked-left:hover,
        #twt-float-html-app-btn.docked-left:active,
        #twt-float-html-app-btn.docked-left.modal-open {
            transform: translate3d(0, 0, 0);
            opacity: 1;
        }

        #twt-float-html-app-btn.modal-open {
            border-color: var(--SmartThemeUnderlineColor, #007aff);
            background: var(--SmartThemeUnderlineColor, #007aff);
            color: #ffffff;
            opacity: 1;
            box-shadow: 0 0 14px var(--SmartThemeUnderlineColor, #007aff);
        }

        #twt-float-html-app-btn .twt-float-badge {
            display: none;
            position: absolute;
            top: -2px;
            right: -2px;
            width: 10px;
            height: 10px;
            background-color: var(--SmartThemeQuoteColor, #f38ba8);
            border-radius: 50%;
            border: 1.5px solid var(--SmartThemeDarkColor, #1e1e2e);
            pointer-events: none;
            z-index: 2;
        }

        #twt-float-html-app-btn.has-unread .twt-float-badge {
            display: block;
        }

        /* 弹窗顶层遮罩（允许穿透到底图，仅弹窗主体响应鼠标） */
        #twt-html-app-modal {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            z-index: 999999;
            pointer-events: none;
            box-sizing: border-box;
        }

        .twt-modal-dialog {
            pointer-events: auto;
            position: absolute;
            width: auto;
            height: auto;
            max-width: 98vw;
            max-height: 98vh;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            display: flex;
            flex-direction: column;
            overflow: visible;
            border-radius: 8px;
            box-sizing: border-box;
            will-change: width, height, transform;
            transition: width 0.15s cubic-bezier(0.2, 0, 0.2, 1), height 0.15s cubic-bezier(0.2, 0, 0.2, 1);
        }

        .twt-modal-dialog.no-transition {
            transition: none !important;
        }

        .twt-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 2px 6px;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            color: #cdd6f4;
            font-size: 12px;
            font-weight: 500;
            user-select: none;
            cursor: move;
            width: 100%;
            box-sizing: border-box;
            gap: 6px;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        }

        .twt-modal-drag-handle {
            display: flex;
            align-items: center;
            opacity: 0.85;
            font-size: 11px;
            padding: 0 2px;
            flex-shrink: 0;
            gap: 4px;
        }

        .twt-modal-floor-badge {
            font-size: 10px;
            opacity: 0.85;
            background: rgba(0, 0, 0, 0.4);
            padding: 1px 5px;
            border-radius: 4px;
            white-space: nowrap;
            backdrop-filter: blur(4px);
        }

        .twt-modal-controls {
            display: flex;
            align-items: center;
            gap: 3px;
            flex-shrink: 0;
            margin-left: auto;
        }

        .twt-modal-switcher {
            display: flex;
            align-items: center;
            gap: 3px;
            margin-right: 4px;
            padding-right: 4px;
            border-right: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 11px;
            opacity: 0.95;
        }

        .twt-modal-select {
            background: rgba(0, 0, 0, 0.45);
            color: #cdd6f4;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 11px;
            cursor: pointer;
            outline: none;
            max-width: 130px;
            text-overflow: ellipsis;
            white-space: nowrap;
            backdrop-filter: blur(4px);
        }

        .twt-modal-select:hover {
            border-color: rgba(255, 255, 255, 0.5);
            background: rgba(0, 0, 0, 0.65);
        }

        .twt-modal-select option {
            background: #181825;
            color: #cdd6f4;
            padding: 4px;
        }

        .twt-modal-btn {
            background: transparent;
            border: none !important;
            outline: none !important;
            color: currentColor;
            opacity: 0.85;
            cursor: pointer;
            padding: 2px 5px;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.15s ease;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        }

        .twt-modal-btn:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.2);
        }

        .twt-modal-btn.close-btn:hover {
            background: #f38ba8;
            color: #11111b;
            text-shadow: none;
        }

        .twt-modal-body {
            width: 100% !important;
            height: auto !important;
            max-width: 98vw;
            max-height: 92vh;
            overflow: auto;
            position: relative;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-sizing: border-box;
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }

        .twt-modal-body iframe,
        .twt-modal-body .twt-app-content-wrapper iframe {
            border: none !important;
            outline: none !important;
            display: block;
            background: transparent !important;
            max-width: 96vw;
            max-height: 90vh;
        }

        .twt-modal-body .twt-app-content-wrapper {
            width: 100% !important;
            height: auto !important;
            box-sizing: border-box;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }
    `;
}

/**
 * 提取并隐藏正文中的匹配元素（同时支持已渲染 DOM 节点与原生 HTML 代码块，带预热缓存）
 */
let hideScheduled = false;

export function hideMessageHtmlAppsSync(forceHide = false, notify = true) {
    const settings = extension_settings?.twt;
    if (!settings || settings.htmlPopupEnabled === false) return 0;

    // 流式输出中且用户设置了不在生成时隐藏，跳过（避免 AI 生成时 iframe 闪烁消失）
    if (!forceHide && settings.htmlPopupHideInStream === false) {
        const doc = getDoc();
        if (doc.body.classList.contains('is_send_press') ||
            doc.body.classList.contains('mes_stop')) return 0;
    }

    const selector = settings.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    if (!chat) return 0;

    const modal = doc.getElementById(MODAL_ID);
    let count = 0;

    try {
        // 1. 匹配标准 DOM 元素选择器（翻页阅读模式下仅扫描当前激活窗口内的楼层，窗口滑动时按需增量处理）
        const isReading = doc.body.classList.contains('twt-reading-mode');
        const mesScope = isReading ? '.mes:not([data-twt-win-hidden]) ' : '';
        const selList = selector.split(',').map(s => s.trim()).filter(Boolean);
        const fullSelector = selList.map(s => `${mesScope}.mes_text ${s}`).join(', ');
        const matchingElements = Array.from(chat.querySelectorAll(fullSelector));

        // 2. 匹配未渲染的 HTML / Iframe 代码块 (PRE)（按需在打开弹窗时再提取源码，避免切入高楼层聊天时同步解码几十个大代码块阻塞主线程）
        chat.querySelectorAll(`${mesScope}.mes_text pre`).forEach((pre) => {
            if (isHtmlAppCodeBlock(pre)) {
                if (!matchingElements.includes(pre)) {
                    matchingElements.push(pre);
                }
            }
        });

        // 恢复之前被隐藏但现在匹配白名单的元素
        chat.querySelectorAll(`${mesScope}.twt-app-hidden`).forEach((hiddenEl) => {
            if (isElementWhitelisted(hiddenEl)) {
                hiddenEl.classList.remove('twt-app-hidden');
                hiddenEl.style.display = '';
                hiddenEl.style.visibility = '';
                if (hiddenEl.parentElement && hiddenEl.parentElement.classList.contains('twt-app-hidden')) {
                    hiddenEl.parentElement.classList.remove('twt-app-hidden');
                    hiddenEl.parentElement.style.display = '';
                }
            }
        });

        matchingElements.forEach((el) => {
            if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body')) return;
            if (currentlyMovedEl === el) return;
            if (modal && modal.contains(el)) return; // modal 内的活跃节点不隐藏

            if (isElementWhitelisted(el)) {
                // 白名单元素：在文本流中正常显示
                if (el.classList.contains('twt-app-hidden')) {
                    el.classList.remove('twt-app-hidden');
                    el.style.display = '';
                    el.style.visibility = '';
                }
                if (el.parentElement && el.parentElement.classList.contains('twt-app-hidden')) {
                    el.parentElement.classList.remove('twt-app-hidden');
                    el.parentElement.style.display = '';
                }
                return;
            }

            if (!el.classList.contains('twt-app-hidden')) {
                el.classList.add('twt-app-hidden');
                count++;
            }

            // 如果外层包裹容器（如 <p> 或代码块包装 div）仅包含此应用节点，同时隐藏外层容器，彻底消除留白
            const parent = el.parentElement;
            if (parent && !parent.classList.contains('mes_text')) {
                const nonHiddenSiblings = Array.from(parent.childNodes).filter(node => {
                    if (node === el) return false;
                    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '') return false;
                    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'BR' || node.classList?.contains('twt-app-hidden') || node.classList?.contains('twt-app-placeholder'))) return false;
                    return true;
                });
                if (nonHiddenSiblings.length === 0 && !parent.classList.contains('twt-app-hidden')) {
                    parent.classList.add('twt-app-hidden');
                    count++;
                }
            }
        });

        if (count > 0) {
            if (!modal) {
                updateQrBadge(true);
            }
            if (notify) {
                try {
                    window.dispatchEvent(new CustomEvent('twt:html-apps-hidden', { detail: { count } }));
                } catch {}
            }
        }
    } catch (err) {
        console.error(`[TwT HtmlPopup] 隐藏匹配元素失败:`, err);
    }
    return count;
}

export function hideMessageHtmlApps(forceHide = false) {
    const settings = extension_settings?.twt;
    if (!settings || settings.htmlPopupEnabled === false) return;

    if (!forceHide && settings.htmlPopupHideInStream === false) {
        const doc = getDoc();
        if (doc.body.classList.contains('is_send_press') ||
            doc.body.classList.contains('mes_stop')) return;
    }

    if (hideScheduled) return;
    hideScheduled = true;

    requestAnimationFrame(() => {
        hideScheduled = false;
        hideMessageHtmlAppsSync(forceHide, true);
    });
}

/**
 * 提取指定消息内的所有有效 HTML 应用节点（含已渲染 DOM 节点与 HTML 代码块，自动排除白名单内嵌应用）
 */
function getMessageAppElements(mesEl, selector) {
    if (!mesEl) return [];
    try {
        const results = [];
        const selList = selector.split(',').map(s => s.trim()).filter(Boolean);
        const fullSelector = selList.join(', ');
        const matching = Array.from(mesEl.querySelectorAll(fullSelector)).filter(
            el => !el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body') && !isElementWhitelisted(el)
        );
        results.push(...matching);

        // 识别 HTML/iframe 代码块
        mesEl.querySelectorAll('.mes_text pre').forEach((pre) => {
            if (isHtmlAppCodeBlock(pre) && !isElementWhitelisted(pre) && !results.includes(pre)) {
                results.push(pre);
            }
        });

        return results;
    } catch (e) {
        return [];
    }
}

/**
 * 定位当前视口聚焦的消息 Element（支持多栏翻页模式与手机端/普通纵向滚动模式）
 */
export function getCurrentFocusedMessage() {
    const doc = getDoc();
    const chat = doc.getElementById('chat');
    if (!chat) return null;

    const messages = Array.from(chat.querySelectorAll('.mes'));
    if (messages.length === 0) return null;

    const settings = extension_settings?.twt;
    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';

    // 1. 多栏水平翻页/阅读模式
    if (doc.body.classList.contains('twt-reading-mode')) {
        const chatRect = chat.getBoundingClientRect();
        const chatWidth = chat.clientWidth || window.innerWidth;
        const chatLeft = chatRect.left;

        const visibleMessages = [];
        messages.forEach((mes) => {
            if (getComputedStyle(mes).display === 'none') return;
            const r = mes.getBoundingClientRect();
            const mesLeft = r.left - chatLeft;
            const mesRight = mesLeft + r.width;
            const overlap = Math.max(0, Math.min(mesRight, chatWidth) - Math.max(mesLeft, 0));
            if (overlap > 10) {
                visibleMessages.push({ mes, overlap });
            }
        });

        // 优先在当前可见消息中寻找直接含有 HTML 应用的消息
        for (let i = visibleMessages.length - 1; i >= 0; i--) {
            if (getMessageAppElements(visibleMessages[i].mes, selector).length > 0) {
                return visibleMessages[i].mes;
            }
        }

        if (visibleMessages.length > 0) {
            visibleMessages.sort((a, b) => b.overlap - a.overlap);
            return visibleMessages[0].mes;
        }
    }

    // 2. 普通纵向滚动模式（手机端与桌面默认）
    const winH = getWin().innerHeight;
    const visibleList = [];

    messages.forEach((mes) => {
        if (getComputedStyle(mes).display === 'none') return;
        const rect = mes.getBoundingClientRect();
        if (rect.bottom > 15 && rect.top < winH - 15) {
            const visibleHeight = Math.min(rect.bottom, winH) - Math.max(rect.top, 0);
            const hasApp = getMessageAppElements(mes, selector).length > 0;
            visibleList.push({ mes, rect, visibleHeight, hasApp });
        }
    });

    // 视口内有可见消息包含应用时，优先选择最新的可见含应用消息（通常为最新生成的 AI 回复）
    for (let i = visibleList.length - 1; i >= 0; i--) {
        if (visibleList[i].hasApp) {
            return visibleList[i].mes;
        }
    }

    if (visibleList.length > 0) {
        visibleList.sort((a, b) => b.visibleHeight - a.visibleHeight);
        return visibleList[0].mes;
    }

    return messages[messages.length - 1];
}

/**
 * 历史楼层回溯：在当前楼层未找到应用时，向前查找最近出现过 HTML 应用的消息
 */
function fallbackToPreviousFloors(focusedMes, selector) {
    const doc = getDoc();
    const allMessages = Array.from(doc.querySelectorAll('#chat .mes'));
    if (allMessages.length === 0) return;

    const focusedMesIndex = focusedMes ? allMessages.indexOf(focusedMes) : allMessages.length - 1;

    let targetMes = null;
    let targetAppEls = [];
    let targetMesIndex = -1;

    const isExplicitlyHiddenMes = (mes) => {
        if (mes.style.display === 'none') return true;
        if (mes.classList.contains('twt-toolcall-mes') && doc.body.classList.contains('twt-toolcall-hide')) return true;
        return false;
    };

    const startIdx = focusedMesIndex >= 0 ? focusedMesIndex - 1 : allMessages.length - 1;
    for (let i = startIdx; i >= 0; i--) {
        const mes = allMessages[i];
        if (isExplicitlyHiddenMes(mes)) continue;
        const matchingInMes = getMessageAppElements(mes, selector);
        if (matchingInMes.length > 0) {
            targetMes = mes;
            targetAppEls = matchingInMes;
            targetMesIndex = i;
            break;
        }
    }

    if (targetAppEls.length === 0) {
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const mes = allMessages[i];
            if (isExplicitlyHiddenMes(mes)) continue;
            const matchingInMes = getMessageAppElements(mes, selector);
            if (matchingInMes.length > 0) {
                targetMes = mes;
                targetAppEls = matchingInMes;
                targetMesIndex = i;
                break;
            }
        }
    }

    if (targetAppEls.length > 0 && targetMes) {
        const fallbackMesId = targetMes.getAttribute('mesid') || targetMes.id || '';
        const fallbackMesIndex = targetMes.getAttribute('data-index') || (parseInt(fallbackMesId) + 1) || (targetMesIndex + 1);
        const diffFloors = (focusedMesIndex >= 0 && targetMesIndex >= 0) ? Math.abs(focusedMesIndex - targetMesIndex) : 0;

        openHtmlAppModal(targetAppEls, fallbackMesIndex, null, diffFloors);
        return;
    }

    if (typeof toastr !== 'undefined') {
        toastr.info('当前聊天记录中未检测到任何可召出的 HTML / iframe 应用', 'TwT 应用召出');
    }
}

/**
 * 展开 Modal 弹窗（极速零延迟呈现）
 */
export function openHtmlAppModal(appEls, mesIndexInfo, initialIndex = null, diffFloors = 0) {
    const doc = getDoc();
    const win = getWin();
    closeHtmlAppModal();
    updateQrBadge(false);

    const appElsList = Array.isArray(appEls) ? appEls : [appEls];
    if (appElsList.length === 0) return;

    let targetIndex = initialIndex !== null ? initialIndex : getSavedAppIndex(mesIndexInfo);
    let currentIndex = Math.max(0, Math.min(targetIndex, appElsList.length - 1));

    const modal = doc.createElement('div');
    modal.id = MODAL_ID;
    doc.body?.classList.add('twt-html-popup-active');

    const dialog = doc.createElement('div');
    dialog.className = 'twt-modal-dialog no-transition';

    // 极速初始几何尺寸预设（杜绝 0px 延迟撑开闪烁）
    const initialW = Math.min(Math.floor(win.innerWidth * 0.94), 600);
    dialog.style.width = `${initialW}px`;

    // 恢复持久化记忆的位置
    const savedPos = getSavedPosition();
    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        dialog.style.left = `${savedPos.left}px`;
        dialog.style.top = `${savedPos.top}px`;
        dialog.style.transform = 'none';
    } else {
        dialog.style.left = '50%';
        dialog.style.top = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
    }

    // 头部控制栏
    const header = doc.createElement('div');
    header.className = 'twt-modal-header';

    const dragHandle = doc.createElement('div');
    dragHandle.className = 'twt-modal-drag-handle';
    dragHandle.title = '按住拖拽移动弹窗';

    if (diffFloors > 0) {
        dragHandle.innerHTML = `<i class="fa-solid fa-grip-lines"></i> <span class="twt-modal-floor-badge" title="当前楼层应用">#${mesIndexInfo} (-${diffFloors}层)</span>`;
    } else {
        dragHandle.innerHTML = `<i class="fa-solid fa-grip-lines"></i> <span class="twt-modal-floor-badge" title="当前楼层应用">#${mesIndexInfo}</span>`;
    }
    header.appendChild(dragHandle);

    const controls = doc.createElement('div');
    controls.className = 'twt-modal-controls';

    if (appElsList.length > 1) {
        const switcher = doc.createElement('div');
        switcher.className = 'twt-modal-switcher';

        const prevBtn = doc.createElement('button');
        prevBtn.className = 'twt-modal-btn';
        prevBtn.title = '上一个应用';
        prevBtn.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;

        const selectEl = doc.createElement('select');
        selectEl.className = 'twt-modal-select';
        selectEl.title = '下拉选择要查看的 HTML 部件';
        selectEl.onclick = (e) => e.stopPropagation();

        const populateOptions = () => {
            selectEl.innerHTML = '';
            appElsList.forEach((el, idx) => {
                const opt = doc.createElement('option');
                opt.value = String(idx);
                const customTitle = resolveAppTitle(el, idx);
                opt.textContent = `${idx + 1}. ${customTitle}`;
                selectEl.appendChild(opt);
            });
            selectEl.value = String(currentIndex);
        };

        populateOptions();

        selectEl.onchange = (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentIndex = parseInt(selectEl.value, 10);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
            selectEl.blur();
        };

        prevBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentIndex = (currentIndex - 1 + appElsList.length) % appElsList.length;
            selectEl.value = String(currentIndex);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
            prevBtn.blur();
        };

        const nextBtn = doc.createElement('button');
        nextBtn.className = 'twt-modal-btn';
        nextBtn.title = '下一个应用';
        nextBtn.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentIndex = (currentIndex + 1) % appElsList.length;
            selectEl.value = String(currentIndex);
            saveSavedAppIndex(mesIndexInfo, currentIndex);
            renderBodyContent();
            nextBtn.blur();
        };

        switcher.appendChild(prevBtn);
        switcher.appendChild(selectEl);
        switcher.appendChild(nextBtn);
        controls.appendChild(switcher);
    }

    // 按钮：刷新
    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'twt-modal-btn';
    refreshBtn.title = '刷新 / 重新渲染';
    refreshBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i>`;
    refreshBtn.onclick = (e) => {
        e.stopPropagation();
        renderBodyContent();
    };

    // 按钮：关闭
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'twt-modal-btn close-btn';
    closeBtn.title = '关闭弹窗 (Esc / 点击外部空白)';
    closeBtn.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeHtmlAppModal();
    };

    controls.appendChild(refreshBtn);
    controls.appendChild(closeBtn);

    header.appendChild(controls);

    // 绑定拖拽功能
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const startDrag = (clientX, clientY) => {
        isDragging = true;
        startX = clientX;
        startY = clientY;
        const rect = dialog.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        dialog.style.left = `${initialLeft}px`;
        dialog.style.top = `${initialTop}px`;
        dialog.style.transform = 'none';
    };

    const moveDrag = (clientX, clientY) => {
        if (!isDragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const maxLeft = win.innerWidth - 60;
        const maxTop = win.innerHeight - 30;

        const newLeft = Math.max(0, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(0, Math.min(maxTop, initialTop + dy));

        dialog.style.left = `${newLeft}px`;
        dialog.style.top = `${newTop}px`;
    };

    const endDrag = () => {
        if (isDragging) {
            isDragging = false;
            const currentLeft = parseFloat(dialog.style.left) || 0;
            const currentTop = parseFloat(dialog.style.top) || 0;
            saveSavedPosition(currentLeft, currentTop);
        }
    };

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.twt-modal-btn, .twt-modal-select')) return;
        startDrag(e.clientX, e.clientY);

        const onMouseMove = (moveEv) => moveDrag(moveEv.clientX, moveEv.clientY);
        const onMouseUp = () => {
            endDrag();
            doc.removeEventListener('mousemove', onMouseMove);
            doc.removeEventListener('mouseup', onMouseUp);
        };

        doc.addEventListener('mousemove', onMouseMove);
        doc.addEventListener('mouseup', onMouseUp);
    });

    header.addEventListener('touchstart', (e) => {
        if (e.target.closest('.twt-modal-btn, .twt-modal-select')) return;
        const touch = e.touches[0];
        if (!touch) return;
        startDrag(touch.clientX, touch.clientY);

        const onTouchMove = (moveEv) => {
            const t = moveEv.touches[0];
            if (t) moveDrag(t.clientX, t.clientY);
        };
        const onTouchEnd = () => {
            endDrag();
            doc.removeEventListener('touchmove', onTouchMove);
            doc.removeEventListener('touchend', onTouchEnd);
        };

        doc.addEventListener('touchmove', onTouchMove, { passive: true });
        doc.addEventListener('touchend', onTouchEnd);
    }, { passive: true });

    // 弹窗主体
    const body = doc.createElement('div');
    body.className = 'twt-modal-body';

    function renderBodyContent() {
        const chat = doc.getElementById('chat');
        const savedScrollLeft = chat ? chat.scrollLeft : 0;
        const savedScrollTop = chat ? chat.scrollTop : 0;

        returnMovedElementBack();

        body.innerHTML = '';
        const currentAppEl = appElsList[currentIndex];
        if (!currentAppEl) return;

        const cKey = getChatContextKey();
        const savedHtml = localStorage.getItem(`twt_app_saved_html_${cKey}_${mesIndexInfo}_${currentIndex}`);

        const isCodeBlock = currentAppEl.tagName === 'PRE' || isHtmlAppCodeBlock(currentAppEl);

        if (isCodeBlock) {
            // 针对原生 HTML/Iframe 代码块，直接提取当前消息中的最新代码 (杜绝旧 swipe 缓存污染)
            const dynamicIframe = doc.createElement('iframe');
            dynamicIframe.className = 'twt-dynamic-html-app';
            dynamicIframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-modals');
            dynamicIframe.setAttribute('allowtransparency', 'true');
            dynamicIframe.style.backgroundColor = 'transparent';
            dynamicIframe.style.width = '100%';
            dynamicIframe.style.height = '400px';

            let srcContent = extractHtmlFromCodeBlock(currentAppEl);
            dynamicIframe.srcdoc = srcContent;

            const wrapper = doc.createElement('div');
            wrapper.className = 'twt-app-content-wrapper';
            wrapper.appendChild(dynamicIframe);
            body.appendChild(wrapper);

            currentlyMovedEl = null;

            observeAppDynamicResizing(dynamicIframe, dialog);
            attachIframeStateTracker(dynamicIframe, mesIndexInfo, currentIndex);
        } else {
            // 针对真实 DOM 节点，如果已有内容直接使用真实内容，只有在内容为空时才使用 savedHtml
            if (currentAppEl.tagName === 'IFRAME') {
                if (!currentAppEl.srcdoc && !currentAppEl.src && savedHtml) {
                    currentAppEl.srcdoc = savedHtml;
                }
            } else if (!currentAppEl.innerHTML && savedHtml) {
                currentAppEl.innerHTML = savedHtml;
            }

            const placeholder = doc.createElement('div');
            placeholder.className = 'twt-app-placeholder';
            placeholder.style.display = 'none';

            if (currentAppEl.parentNode) {
                currentAppEl.parentNode.insertBefore(placeholder, currentAppEl);
                currentAppEl.__twt_placeholder__ = placeholder;
            }

            currentAppEl.classList.remove('twt-app-hidden');
            currentAppEl.style.display = '';
            currentAppEl.style.visibility = '';
            currentAppEl.style.backgroundColor = 'transparent';

            if (currentAppEl.tagName === 'IFRAME') {
                currentAppEl.setAttribute('allowtransparency', 'true');
                attachIframeStateTracker(currentAppEl, mesIndexInfo, currentIndex);
            } else {
                attachDomStateTracker(currentAppEl, mesIndexInfo, currentIndex);
            }

            const wrapper = doc.createElement('div');
            wrapper.className = 'twt-app-content-wrapper';
            wrapper.appendChild(currentAppEl);
            body.appendChild(wrapper);

            currentlyMovedEl = currentAppEl;

            observeAppDynamicResizing(currentAppEl, dialog);
        }

        // 恢复聊天流滚动位置（防止因为 DOM 节点移动触发浏览器 auto-scroll 导致正文大幅度翻页）
        if (chat) {
            if (chat.scrollLeft !== savedScrollLeft) chat.scrollLeft = savedScrollLeft;
            if (chat.scrollTop !== savedScrollTop) chat.scrollTop = savedScrollTop;
            requestAnimationFrame(() => {
                if (chat.scrollLeft !== savedScrollLeft) chat.scrollLeft = savedScrollLeft;
                if (chat.scrollTop !== savedScrollTop) chat.scrollTop = savedScrollTop;
            });
        }
    }

    renderBodyContent();

    dialog.appendChild(header);
    dialog.appendChild(body);
    modal.appendChild(dialog);

    // Esc 键关闭监听
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeHtmlAppModal();
            doc.removeEventListener('keydown', escHandler);
        }
    };
    doc.addEventListener('keydown', escHandler);

    // 空白区域点击收回监听 (点击弹窗外部任何空白区域自动收回)
    removeOutsideClickListener();
    activeOutsideClickListener = (e) => {
        const currentModal = doc.getElementById(MODAL_ID);
        if (!currentModal) {
            removeOutsideClickListener();
            return;
        }
        if (dialog.contains(e.target) || e.target.closest?.(`#${QR_BTN_ID}`) || e.target.closest?.(`#${FLOAT_BTN_ID}`)) return;
        win.__twtLastHtmlModalCloseTime = Date.now();
        closeHtmlAppModal();
    };

    setTimeout(() => {
        if (doc.getElementById(MODAL_ID)) {
            doc.addEventListener('mousedown', activeOutsideClickListener, true);
            doc.addEventListener('touchstart', activeOutsideClickListener, true);
            doc.addEventListener('click', activeOutsideClickListener, true);
        }
    }, 40);

    doc.body.appendChild(modal);

    const floatBtn = doc.getElementById(FLOAT_BTN_ID);
    if (floatBtn) {
        floatBtn.classList.add('modal-open');
    }

    // 首次渲染完成后移除 no-transition，恢复后续交互的平滑过渡
    requestAnimationFrame(() => {
        dialog.classList.remove('no-transition');
    });
}

/**
 * 清除指定消息的 HTML 展开状态缓存
 */
function clearAppHtmlStateForMessage(mesIndexOrId) {
    try {
        const cKey = getChatContextKey();
        const prefix1 = `twt_app_saved_html_${cKey}_${mesIndexOrId}_`;
        const prefix2 = `twt_app_saved_html_${cKey}_${parseInt(mesIndexOrId) + 1}_`;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith(prefix1) || k.startsWith(prefix2))) {
                toRemove.push(k);
            }
        }
        toRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}

/**
 * 关闭 Modal 弹窗（物理归还真实 DOM 节点）
 */
export function closeHtmlAppModal() {
    removeOutsideClickListener();
    returnMovedElementBack();

    const doc = getDoc();
    const win = getWin();
    const old = doc.getElementById(MODAL_ID);
    // 切换聊天、加载历史楼层、删除消息时也会调用这里。只有弹窗真的开着时才记录"刚关闭"的时间：
    // 翻页模块会在关闭后 450ms 内忽略点按，没开弹窗也记录的话，加载历史后的第一下翻页就会被吞掉。
    const wasOpen = !!old || !!doc.body?.classList.contains('twt-html-popup-active');
    if (wasOpen) {
        win.__twtLastHtmlModalCloseTime = Date.now();
    }
    setClass(doc.body, 'twt-html-popup-active', false);

    if (old) {
        old.remove();
        console.log('[TwT HtmlPopup] Modal 弹窗已关闭，真实 DOM 已归位');
    }
    const floatBtn = doc.getElementById(FLOAT_BTN_ID);
    if (floatBtn) {
        floatBtn.classList.remove('modal-open');
    }
}

/**
 * 处理 QR 栏按钮点击召出/收回逻辑 (极速响应版)
 */
function handleQrBtnClick() {
    const doc = getDoc();

    // 1. 如果弹窗已打开，点击 QR 栏按钮执行收回 (Toggle 行为)
    const existingModal = doc.getElementById(MODAL_ID);
    if (existingModal) {
        closeHtmlAppModal();
        return;
    }

    updateQrBadge(false);

    const settings = extension_settings?.twt;
    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';

    // 2. 获取当前可视楼层的消息
    const focusedMes = getCurrentFocusedMessage();
    if (!focusedMes) {
        if (typeof toastr !== 'undefined') {
            toastr.info('当前所在楼层未检测到 HTML / iframe 应用', 'TwT 应用召出');
        }
        return;
    }

    const mesId = focusedMes.getAttribute('mesid') || focusedMes.id || '';
    const mesIndex = focusedMes.getAttribute('data-index') || (parseInt(mesId) + 1) || '';

    // 3. 尝试直接获取当前聚焦消息中的应用节点（含已渲染节点与预解析 HTML 代码块）
    let appEls = getMessageAppElements(focusedMes, selector);

    // 如果在当前主聚焦消息没找到，但在翻页模式下，检查当前视口内可见的其他消息
    if (appEls.length === 0 && doc.body.classList.contains('twt-reading-mode')) {
        const chat = doc.getElementById('chat');
        if (chat) {
            const chatRect = chat.getBoundingClientRect();
            const chatWidth = chat.clientWidth || window.innerWidth;
            const chatLeft = chatRect.left;
            const messages = Array.from(chat.querySelectorAll('.mes'));

            for (const mes of messages) {
                if (getComputedStyle(mes).display === 'none') continue;
                const r = mes.getBoundingClientRect();
                const mesLeft = r.left - chatLeft;
                const mesRight = mesLeft + r.width;
                const overlap = Math.max(0, Math.min(mesRight, chatWidth) - Math.max(mesLeft, 0));
                if (overlap > 10) {
                    const found = getMessageAppElements(mes, selector);
                    if (found.length > 0) {
                        const mId = mes.getAttribute('mesid') || mes.id || '';
                        const mIndex = mes.getAttribute('data-index') || (parseInt(mId) + 1) || '';
                        openHtmlAppModal(found, mIndex, null, 0);
                        return;
                    }
                }
            }
        }
    }

    if (appEls.length > 0) {
        openHtmlAppModal(appEls, mesIndex, null, 0);
        return;
    }

    // 4. 防竞态处理：仅在确定存在尚未完成 DOM 初始化的标签时做轻量探测
    const mesTextEl = focusedMes.querySelector('.mes_text');
    const rawHtml = mesTextEl ? mesTextEl.innerHTML : '';
    const hasUnrenderedCode = rawHtml.includes('&lt;iframe') && !focusedMes.querySelector('iframe');

    if (hasUnrenderedCode) {
        let retries = 0;
        const maxRetries = 6;

        const pollCheck = () => {
            appEls = getMessageAppElements(focusedMes, selector);
            if (appEls.length > 0) {
                hideMessageHtmlApps();
                openHtmlAppModal(appEls, mesIndex, null, 0);
                return;
            }
            retries++;
            if (retries < maxRetries) {
                setTimeout(pollCheck, 60);
            } else {
                if (settings?.htmlPopupFallbackEnabled === true) {
                    fallbackToPreviousFloors(focusedMes, selector);
                } else {
                    if (typeof toastr !== 'undefined') {
                        toastr.info('当前所在楼层未检测到 HTML / iframe 应用', 'TwT 应用召出');
                    }
                }
            }
        };

        setTimeout(pollCheck, 30);
        return;
    }

    // 5. 当前楼层未检测到任何应用，根据配置决定是否回溯
    if (settings?.htmlPopupFallbackEnabled === true) {
        console.log('[TwT HtmlPopup] 当前楼层无应用，根据用户配置执行历史楼层回溯...');
        fallbackToPreviousFloors(focusedMes, selector);
    } else {
        if (typeof toastr !== 'undefined') {
            toastr.info('当前所在楼层未检测到 HTML / iframe 应用', 'TwT 应用召出');
        }
    }
}

/**
 * 监听酒馆全套生命周期事件，实现即时响应与弹窗自动刷新
 */
export function registerHtmlPopupEvents(context) {
    if (!context || !context.eventSource || !context.eventTypes) return;

    const { eventSource, eventTypes } = context;

    let resetHideTimer = null;
    const onChatResetOrSwitched = (reason) => {
        closeHtmlAppModal();
        updateQrBadge(false);
        clearTimeout(resetHideTimer);

        // 翻页阅读模式下由 pagination.js 在激活末尾窗口后同步调用 hideMessageHtmlAppsSync，避免冗余异步定时器引发二次重排
        if (getDoc().body?.classList?.contains('twt-reading-mode')) {
            return;
        }

        hideMessageHtmlAppsSync(true, true);
        hideMessageHtmlApps(true);
        resetHideTimer = setTimeout(() => hideMessageHtmlAppsSync(true, true), 200);
    };

    const onMessageChangedOrSwiped = (mesId) => {
        console.log(`[TwT HtmlPopup] [即时响应] 捕获到消息重roll / Swipe / 更新事件 (mesId: ${mesId})`);

        returnMovedElementBack();

        hideMessageHtmlApps();
        setTimeout(hideMessageHtmlApps, 100);
        setTimeout(hideMessageHtmlApps, 350);

        const doc = getDoc();
        const modal = doc.getElementById(MODAL_ID);
        if (modal) {
            setTimeout(() => {
                const focusedMes = getCurrentFocusedMessage();
                if (focusedMes) {
                    const settings = extension_settings?.twt;
                    const selector = settings?.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app';
                    const newAppEls = getMessageAppElements(focusedMes, selector);
                    if (newAppEls.length > 0) {
                        const mId = focusedMes.getAttribute('mesid') || focusedMes.id || '';
                        const mIndex = focusedMes.getAttribute('data-index') || (parseInt(mId) + 1) || '';
                        console.log(`[TwT HtmlPopup] [自动刷新] 实时加载 Swipe/重roll 后的新 Iframe 应用 (Index: #${mIndex})`);
                        openHtmlAppModal(newAppEls, mIndex, null, 0);
                    }
                }
            }, 180);
        }
    };

    if (eventTypes.MESSAGE_SWIPED) eventSource.on(eventTypes.MESSAGE_SWIPED, onMessageChangedOrSwiped);
    if (eventTypes.MESSAGE_UPDATED) eventSource.on(eventTypes.MESSAGE_UPDATED, onMessageChangedOrSwiped);
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onMessageChangedOrSwiped);

    if (eventTypes.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, () => onChatResetOrSwitched('CHAT_CHANGED'));
    if (eventTypes.MORE_MESSAGES_LOADED) eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => onChatResetOrSwitched('MORE_MESSAGES_LOADED'));
    if (eventTypes.MESSAGE_DELETED) eventSource.on(eventTypes.MESSAGE_DELETED, () => onChatResetOrSwitched('MESSAGE_DELETED'));
}

/**
 * 悬浮球位置读取与持久化 (完全对齐 Zero 拓展)
 */
function loadFloatPosition() {
    try {
        const raw = localStorage.getItem(FLOAT_POS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const side = parsed.side || (typeof parsed.x === 'number' && parsed.x < window.innerWidth / 2 ? 'left' : 'right');
        const top = typeof parsed.top === 'number' ? parsed.top : (typeof parsed.y === 'number' ? parsed.y : null);
        return { side, top };
    } catch (e) {
        return null;
    }
}

function saveFloatPosition(side, top) {
    try {
        localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ side, top: Math.round(top) }));
    } catch (e) {}
}

/**
 * 初始化悬浮球位置与贴边状态
 */
function initFloatPosition(ball, win, doc) {
    const saved = loadFloatPosition();
    const vh = win.innerHeight || doc.documentElement?.clientHeight || 600;
    const bh = 42;
    const dockSide = saved?.side || 'right';
    let top = saved?.top ?? Math.round(vh * 0.65);
    top = Math.max(20, Math.min(top, vh - bh - 20));

    ball.style.top = `${top}px`;
    if (dockSide === 'right') {
        ball.style.left = 'auto';
        ball.style.right = '0px';
        ball.classList.remove('docked-left');
        ball.classList.add('docked-right');
    } else {
        ball.style.left = '0px';
        ball.style.right = 'auto';
        ball.classList.remove('docked-right');
        ball.classList.add('docked-left');
    }
}

/**
 * 磁吸贴边 (Magnetic Edge Snap - 参考 Zero 拓展)
 * @param {HTMLElement} ball 
 * @param {Window} win 
 * @param {Document} doc 
 * @param {boolean} animate 是否执行平滑缓动动画
 */
function snapFloatToEdge(ball, win, doc, animate = true) {
    if (!ball) return;

    const rect = ball.getBoundingClientRect();
    const vw = win.innerWidth || doc.documentElement?.clientWidth || 800;
    const vh = win.innerHeight || doc.documentElement?.clientHeight || 600;
    const bw = ball.offsetWidth || 42;
    const bh = ball.offsetHeight || 42;

    const centerX = rect.left + bw / 2;
    const snapToRight = centerX >= vw / 2;
    const dockSide = snapToRight ? 'right' : 'left';

    const finalTop = Math.max(20, Math.min(vh - bh - 20, rect.top));
    saveFloatPosition(dockSide, finalTop);

    if (animate) {
        const targetLeft = snapToRight ? vw - bw : 0;
        ball.style.transition = 'left 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), top 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.22s ease, opacity 0.22s ease';
        ball.style.left = `${targetLeft}px`;
        ball.style.right = 'auto';
        ball.style.top = `${finalTop}px`;

        setTimeout(() => {
            if (!ball || !ball.isConnected) return;
            ball.style.transition = '';
            if (dockSide === 'right') {
                ball.style.left = 'auto';
                ball.style.right = '0px';
                ball.classList.remove('docked-left');
                ball.classList.add('docked-right');
            } else {
                ball.style.left = '0px';
                ball.style.right = 'auto';
                ball.classList.remove('docked-right');
                ball.classList.add('docked-left');
            }
        }, 220);
    } else {
        ball.style.transition = 'none';
        ball.style.top = `${finalTop}px`;
        if (dockSide === 'right') {
            ball.style.left = 'auto';
            ball.style.right = '0px';
            ball.classList.remove('docked-left');
            ball.classList.add('docked-right');
        } else {
            ball.style.left = '0px';
            ball.style.right = 'auto';
            ball.classList.remove('docked-right');
            ball.classList.add('docked-left');
        }
    }
}

/**
 * 确保侧边吸附、可拖拽悬浮球的注入、更新与移除
 */
function ensureFloatButton(doc, win, showFloat) {
    let floatBtn = doc.getElementById(FLOAT_BTN_ID);

    if (!showFloat) {
        if (floatBtn) {
            floatBtn.remove();
            console.log('[TwT HtmlPopup] 悬浮球已移除');
        }
        return;
    }

    if (!floatBtn) {
        floatBtn = doc.createElement('div');
        floatBtn.id = FLOAT_BTN_ID;
        floatBtn.className = 'twt-float-html-app interactable';
        floatBtn.setAttribute('role', 'button');
        floatBtn.setAttribute('tabindex', '0');
        floatBtn.title = '召出/收回当前消息 HTML 应用 (拖拽贴边吸附)';
        floatBtn.innerHTML = `<i class="fa-solid fa-window-maximize"></i><span class="twt-float-badge"></span>`;

        initFloatPosition(floatBtn, win, doc);

        // 绑定拖拽逻辑 (参考 Zero 拓展的 document 捕获模型与时间/位移防误触)
        let isTracking = false;
        let hasDragged = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;
        let startTime = 0;

        const onStart = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            startX = clientX;
            startY = clientY;
            startTime = Date.now();
            hasDragged = false;
            isTracking = true;

            const rect = floatBtn.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            doc.addEventListener('mousemove', onMove, { passive: false });
            doc.addEventListener('mouseup', onEnd, { capture: true });
            doc.addEventListener('touchmove', onMove, { passive: false });
            doc.addEventListener('touchend', onEnd, { capture: true });
            doc.addEventListener('touchcancel', onEnd, { capture: true });
        };

        const onMove = (e) => {
            if (!isTracking) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (!hasDragged && Math.hypot(deltaX, deltaY) > 6) {
                hasDragged = true;
                doc.body.classList.add('twt-ball-dragging-active');
                floatBtn.classList.remove('docked-left', 'docked-right');
                floatBtn.classList.add('is-dragging');
            }

            if (hasDragged) {
                if (e.cancelable) e.preventDefault();

                const vw = win.innerWidth || doc.documentElement?.clientWidth || 800;
                const vh = win.innerHeight || doc.documentElement?.clientHeight || 600;
                const bw = floatBtn.offsetWidth || 42;
                const bh = floatBtn.offsetHeight || 42;

                const newLeft = Math.max(0, Math.min(vw - bw, initialLeft + deltaX));
                const newTop = Math.max(20, Math.min(vh - bh - 20, initialTop + deltaY));

                floatBtn.style.left = `${newLeft}px`;
                floatBtn.style.right = 'auto';
                floatBtn.style.top = `${newTop}px`;
            }
        };

        const onEnd = (e) => {
            if (!isTracking) return;
            isTracking = false;

            doc.removeEventListener('mousemove', onMove);
            doc.removeEventListener('mouseup', onEnd, { capture: true });
            doc.removeEventListener('touchmove', onMove);
            doc.removeEventListener('touchend', onEnd, { capture: true });
            doc.removeEventListener('touchcancel', onEnd, { capture: true });
            doc.body.classList.remove('twt-ball-dragging-active');

            const duration = Date.now() - startTime;
            floatBtn.classList.remove('is-dragging');

            if (!hasDragged || duration < 220) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                handleQrBtnClick();
                return;
            }

            snapFloatToEdge(floatBtn, win, doc, true);
        };

        floatBtn.addEventListener('mousedown', onStart);
        floatBtn.addEventListener('touchstart', onStart, { passive: true });

        // 键盘回车/空格辅助
        floatBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleQrBtnClick();
            }
        });

        doc.body.appendChild(floatBtn);
        console.log('[TwT HtmlPopup] 成功注入 Zero 风格磁吸贴边悬浮球');
    }

    // 状态更新
    floatBtn.classList.toggle('has-unread', hasUnreadApp);
    const hasModal = !!doc.getElementById(MODAL_ID);
    floatBtn.classList.toggle('modal-open', hasModal);

    // 窗口尺寸变化自适应贴边
    if (!floatResizeBound) {
        floatResizeBound = true;
        win.addEventListener('resize', () => {
            const btn = doc.getElementById(FLOAT_BTN_ID);
            if (!btn || btn.classList.contains('is-dragging')) return;
            snapFloatToEdge(btn, win, doc, false);
        });
    }
}

/**
 * 注入与更新 QR 栏按钮及悬浮球
 */
export function toggleHtmlAppPopup() {
    handleQrBtnClick();
}

/**
 * 注入与更新 QR 栏按钮及悬浮球
 */
export function applyHtmlPopupSettings() {
    injectStyles();
    const settings = extension_settings?.twt;
    const enabled = settings?.htmlPopupEnabled !== false;
    const triggerMode = settings?.htmlPopupTriggerMode || 'qr';
    const qrInject = settings?.qrInjectEnabled !== false;
    const doc = getDoc();
    const win = getWin();

    const showQr = enabled && qrInject && (triggerMode === 'qr' || triggerMode === 'both');
    const showFloat = enabled && (triggerMode === 'float' || triggerMode === 'both');

    // 1. QR 栏按钮管理
    let btn = doc.getElementById(QR_BTN_ID);
    if (showQr) {
        if (!btn) {
            const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
            if (btnContainer) {
                btn = doc.createElement('div');
                btn.id = QR_BTN_ID;
                btn.className = 'qr--button menu_button interactable';
                btn.tabIndex = 0;
                btn.role = 'button';
                btn.title = '召出/收回当前消息 HTML 应用';
                btn.innerHTML = `<i class="fa-solid fa-window-maximize"></i><span class="twt-qr-badge"></span>`;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleQrBtnClick();
                });
                btnContainer.prepend(btn);
                console.log('[TwT HtmlPopup] 成功注入 QR 栏召出按钮');
            }
        }
        if (btn) {
            btn.classList.toggle('has-unread', hasUnreadApp);
        }
    } else {
        if (btn) {
            btn.remove();
            console.log('[TwT HtmlPopup] QR 栏按钮已移除');
        }
    }

    // 2. 悬浮球管理
    ensureFloatButton(doc, win, showFloat);

    // 3. 正文应用节点隐藏/显示管理
    if (enabled) {
        hideMessageHtmlApps();
    } else {
        doc.querySelectorAll('.twt-app-hidden').forEach(el => el.classList.remove('twt-app-hidden'));
    }
}

/**
 * 初始化 HTML Popup 模块
 */
export function initHtmlPopup() {
    console.log('[TwT HtmlPopup] 正在初始化 HTML 应用弹窗模块...');
    injectStyles();

    const doc = getDoc();
    const win = getWin();
    const MutationObserverClass = win.MutationObserver || win.parent?.MutationObserver || window.MutationObserver;

    // 保持 Observer 监听，在 QR bar 或 DOM 发生变动时按需补全按钮或悬浮球（带节流，避免切入高楼层聊天时高频触发）
    let popupObsTimer = null;
    const observer = new MutationObserverClass(() => {
        if (popupObsTimer) return;
        popupObsTimer = setTimeout(() => {
            popupObsTimer = null;
            const settings = extension_settings?.twt;
            const enabled = settings?.htmlPopupEnabled !== false;
            const triggerMode = settings?.htmlPopupTriggerMode || 'qr';
            const qrInject = settings?.qrInjectEnabled !== false;
            const needsQr = enabled && qrInject && (triggerMode === 'qr' || triggerMode === 'both') && !doc.getElementById(QR_BTN_ID) && doc.querySelector('#qr--bar');
            const needsFloat = enabled && (triggerMode === 'float' || triggerMode === 'both') && !doc.getElementById(FLOAT_BTN_ID);
            if (needsQr || needsFloat) {
                applyHtmlPopupSettings();
            }
        }, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });

    setTimeout(applyHtmlPopupSettings, 500);
    setTimeout(applyHtmlPopupSettings, 1500);
}
