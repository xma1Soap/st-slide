// @ts-nocheck
import { extension_settings, getContext } from '../../../../../extensions.js';
import { showMoreMessages } from '../../../../../../script.js';
import { hideMessageHtmlAppsSync } from '../html_popup/html_popup.js?v=1.0.26';
import { setClass } from '../utils/class_guard.js?v=1.0.26';

// ============================================================
// P1：TauriTavern API 接入层 — 阅读位置记忆
// 完全可选：标准 SillyTavern 上静默跳过，不影响任何功能
// ============================================================
const TT_NS = 'twt';  // metadata namespace

function getWin() {
    try {
        if (window.parent && window.parent.document) return window.parent;
    } catch {}
    return window;
}

/** 获取 TauriTavern Chat API handle，不可用时返回 null */
async function getTTHandle() {
    try {
        const win = getWin();
        const tt = win.__TAURITAVERN__ || window.__TAURITAVERN__ || window.parent?.__TAURITAVERN__ || window.top?.__TAURITAVERN__;
        if (!tt) return null;
        await (tt.ready ?? tt.__TAURITAVERN_MAIN_READY__);
        return tt.api?.chat?.current?.handle?.() ?? null;
    } catch {
        return null;
    }
}

let savePositionTimer = null;

/**
 * 构建当前阅读位置快照数据（锚点消息ID + 消息内页偏移 + 是否在末尾 + 页码）
 */
function buildReadingPositionPayload(targetPage = lastUserPage) {
    const chat = getChat();
    const step = chat ? getColStep(chat) : 0;
    const total = (chat && step > 0) ? Math.max(1, Math.round(chat.scrollWidth / step)) : 1;
    const isAtEnd = total > 1 ? (targetPage >= total - 1) : true;
    const anchorMesId = activeReadingAnchor?.mesId ?? null;
    const pageOffsetInMes = activeReadingAnchor?.pageOffsetInMes ?? 0;
    return {
        lastPage: targetPage,
        totalPages: total,
        isAtEnd,
        anchorMesId: anchorMesId !== null ? String(anchorMesId) : null,
        pageOffsetInMes,
        explicitPageZero: targetPage === 0 && !isAtEnd,
        savedAt: Date.now(),
    };
}

/**
 * 保存当前阅读位置到 TauriTavern metadata
 */
export async function savePaginationPosition(targetPage = lastUserPage) {
    if (targetPage < 0 || isChatRestoring || !userInteractedSinceSwitch) return;
    try {
        const payload = buildReadingPositionPayload(targetPage);
        const handle = await getTTHandle();
        if (handle) {
            await handle.metadata.setExtension({
                namespace: TT_NS,
                value: payload,
            });
        }
        if (typeof chat_metadata !== 'undefined' && chat_metadata) {
            chat_metadata[TT_NS] = Object.assign(chat_metadata[TT_NS] || {}, payload);
        }
    } catch (e) {
        console.warn('[TwT] Failed to save reading position:', e);
    }
}

export function debouncedSavePaginationPosition() {
    if (isChatRestoring || !userInteractedSinceSwitch) return;
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
        updateActiveReadingAnchor(true);
        savePaginationPosition(lastUserPage);
    }, 450);
}

/**
 * 从 TauriTavern / chat_metadata 恢复阅读位置
 * 在新聊天的列宽稳定后调用，返回恢复的位置对象（无数据时返回 null）
 */
async function restorePaginationPosition() {
    try {
        let syncSaved = null;
        if (typeof chat_metadata !== 'undefined' && chat_metadata?.[TT_NS] && typeof chat_metadata[TT_NS].lastPage === 'number') {
            syncSaved = chat_metadata[TT_NS];
        }
        const handle = await getTTHandle();
        if (handle) {
            const meta = await handle.metadata.get();
            const saved = meta?.extensions?.[TT_NS];
            if (saved && typeof saved.lastPage === 'number' && saved.lastPage >= 0) {
                if (!syncSaved || (saved.savedAt || 0) >= (syncSaved.savedAt || 0)) {
                    return saved;
                }
            }
        }
        if (syncSaved && syncSaved.lastPage >= 0) {
            return syncSaved;
        }
        return null;
    } catch (e) {
        console.warn('[TwT] Failed to restore reading position:', e);
        return null;
    }
}

// ============================================================
// 核心状态
// ============================================================
let lastUserPage = 0;           // 用户当前所在页（唯一权威来源）
let isScrolling = false;        // 正在执行程序化 scrollTo，屏蔽 snap 校正
let isTouching = false;         // 手指正在触摸屏幕
let isGenerating = false;       // 正在进行 AI 流式生成，抑制高频后台排版扫描
let lastChatSwitchTime = 0;     // 聊天切换时间戳，用于防抖保护
let isChatRestoring = false;    // 聊天刚切入、正在等待多轮排版稳定的保护锁
let chatRestoreSettleTimer = null; // 聊天切入稳定期定时器
let chatRestoreTarget = null;   // 切入聊天时的目标锁定描述：{ mode: 'end' | 'anchor' | 'page', mesId, pageOffsetInMes, page }
let userInteractedSinceSwitch = false; // 用户在进入聊天后是否已主动翻页/触摸
let userExplicitlyFocusedInput = false; // 用户是否通过真实手势点击/触摸了输入框（杜绝酒馆 getChat 结束后自动 focus #send_textarea 导致移动端永久锁死）

/** 判断用户当前是否在输入框打字（此时应全面暂停后台排版与重试计算，避免打字卡顿） */
/** 实时探测酒馆是否正在真实流式生成回复 */
export function checkIsActuallyGenerating() {
    if (!isGenerating) return false;
    const doc = document;
    const isPress = doc.body.classList.contains('is_send_press');
    const hasStop = doc.body.classList.contains('mes_stop') || !!doc.querySelector('.mes_stop');
    if (!isPress && !hasStop) {
        isGenerating = false;
    }
    return isGenerating;
}

export function isInputFocused() {
    if (!userExplicitlyFocusedInput) return false;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) && !el.classList.contains('twt-p-textarea');
}

// ============================================================
// Observer / Timer 句柄
// ============================================================
let resizeObserver = null;
let mutationObserver = null;
let scrollEventsAbortController = null;
let snapTimer = null;
let colWidthRetryTimer = null;
let stableColWidth = 0;         // Precise step cache after layout stabilizes; 0 = not established
let lastKnownScrollWidth = 0;   // Last scrollWidth seen by MutationObserver, for streaming detection
let stableColWidthTimer = null; // Timer to rebuild stableColWidth after streaming ends
let winStartIdx = 0;            // 当前激活的楼层窗口起始索引（含）
let winEndIdx = -1;             // 当前激活的楼层窗口结束索引（含）
let totalDomMesCount = 0;       // DOM 中总 .mes 数量

// ============================================================
// 进场极简齿轮加载遮罩组件 (Loading Gear Overlay)
// ============================================================
function ensureLoadingOverlay() {
    let overlay = document.getElementById('twt-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'twt-loading-overlay';
        overlay.innerHTML = `
            <svg class="twt-loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                <circle cx="12" cy="12" r="7"/>
            </svg>
            <div class="twt-loading-text">正在排版最新楼层...</div>
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

function showLoadingOverlay() {
    ensureLoadingOverlay();
    setClass(document.body, 'twt-chat-switching', true);
    setClass(getChat(), 'twt-chat-switching', true);
}

// 每次翻页都会调用，必须先判断再写，否则会触发酒馆对整页的按钮扫描（见 class_guard.js）
function hideLoadingOverlay() {
    setClass(document.body, 'twt-chat-switching', false);
    setClass(getChat(), 'twt-chat-switching', false);
}

/**
 * 切入聊天稳定期防抖调度：持续吸收后续历史消息加载(MORE_MESSAGES_LOADED)、图片加载、字体渲染引发的列数变动
 * 只要持续有消息注入或重排，就会不断推迟，直到完全稳定后才撤除遮罩并释放保护锁
 */
export function scheduleRestoreSettle(delay = 600) {
    if (userInteractedSinceSwitch) return;
    clearTimeout(chatRestoreSettleTimer);
    chatRestoreSettleTimer = setTimeout(() => {
        isChatRestoring = false;
        hideLoadingOverlay();
        if (!userInteractedSinceSwitch && document.body.classList.contains('twt-reading-mode')) {
            const chat = getChat();
            const cw = stableColWidth > 0 ? stableColWidth : (chat ? getColWidth(chat) : 0);
            if (chat && cw > 0 && chatRestoreTarget) {
                hideMessageHtmlAppsSync(true, false);
                applyRestoreTarget(chat, cw);
            }
        }
        chatRestoreTarget = null;
    }, delay);
}
// 严禁在日常高频日志中调用 chat.scrollWidth 或 elementFromPoint，彻底消除强制同步重排 (Layout Thrashing)
// ============================================================
const TWT_DIAG_MAX_LOGS = 600;
const twtDiagLogs = [];
let twtDiagEpoch = Date.now();
let twtDiagLastTime = Date.now();
let twtDiagSeq = 0;
let twtDiagPanelExpanded = false;
let twtDiagLastJsSetSL = null;
let twtDiagLastObservedSL = 0;
let lastInteractiveMatchReason = '';
let twtDiagUiRafId = null;
let isAligningNewMessage = false;

function describeEl(el) {
    if (!el) return 'null';
    const node = el.nodeType === 3 ? el.parentElement : el;
    if (!node || !node.tagName) return 'unknown';
    let s = node.tagName.toLowerCase();
    if (node.id) s += '#' + node.id;
    const mes = node.closest?.('.mes');
    if (mes) {
        s += `[#${mes.getAttribute('mesid') || '?'}]`;
    }
    return s;
}

export function twtDiagLog(tag, detail = '') {
    try {
        const now = Date.now();
        const rel = now - twtDiagEpoch;
        const delta = now - twtDiagLastTime;
        twtDiagLastTime = now;
        twtDiagSeq++;

        const chat = document.getElementById('chat');
        const cw = stableColWidth > 0 ? stableColWidth : 0;
        const sl = twtDiagLastObservedSL || (chat ? Math.round(chat.scrollLeft) : 0);
        const sw = lastKnownScrollWidth || 0;
        const realP = cw > 0 && sl >= 0 ? (sl / cw).toFixed(1) : '-';
        const maxP = cw > 0 && sw > 0 ? Math.max(0, Math.round(sw / cw) - 1) : '-';
        const curMes = activeReadingAnchor?.mesId ? `#${activeReadingAnchor.mesId}` : '?';
        const winInfo = `${winStartIdx}..${winEndIdx}/${totalDomMesCount}`;
        const flags = `R${isChatRestoring ? 1 : 0}I${userInteractedSinceSwitch ? 1 : 0}T${isTouching ? 1 : 0}S${isScrolling ? 1 : 0}G${isGenerating ? 1 : 0}F${isInputFocused() ? 1 : 0}`;

        const line = `[${twtDiagSeq}] +${rel}ms (Δ${delta}ms) [${tag}] ${detail} | uP=${lastUserPage} realP=${realP}/${maxP} sl=${sl} sw=${sw} cw=${Math.round(cw)} | mes=${curMes} win=[${winInfo}] | ${flags}`;
        twtDiagLogs.push(line);
        if (twtDiagLogs.length > TWT_DIAG_MAX_LOGS) {
            twtDiagLogs.shift();
        }
        scheduleDiagPanelUI(realP, maxP, curMes, winInfo);
    } catch (e) {
        console.warn('[TwT Diag Error]', e);
    }
}


export function isDiagEnabled(settings) {
    if (settings && typeof settings.diagLogEnabled !== 'undefined') {
        return !!settings.diagLogEnabled;
    }
    try {
        return !!(extension_settings?.twt?.diagLogEnabled);
    } catch {
        return false;
    }
}

export function updateDiagPanelVisibility(settings) {
    const enabled = isDiagEnabled(settings);
    const panel = document.getElementById('twt-diag-panel');
    if (!enabled) {
        if (panel) panel.style.display = 'none';
        return;
    }
    const isReading = document.body.classList.contains('twt-reading-mode');
    if (isReading) {
        const p = ensureDiagPanel();
        if (p) {
            p.style.display = 'block';
            scheduleDiagPanelUI();
        }
    }
}

function ensureDiagPanel() {
    let panel = document.getElementById('twt-diag-panel');
    if (panel) return panel;
    if (!document.body) return null;

    panel = document.createElement('div');
    panel.id = 'twt-diag-panel';
    panel.style.cssText = [
        'position: fixed',
        'top: 50%',
        'left: 50%',
        'transform: translate(-50%, -50%)',
        'width: max-content',
        'max-width: 82vw',
        'z-index: 2147483647',
        'background: rgba(15, 23, 42, 0.92)',
        'color: #f8fafc',
        'border: 1px solid rgba(56, 189, 248, 0.7)',
        'border-radius: 8px',
        'padding: 5px 8px',
        'font-family: monospace, sans-serif',
        'font-size: 11px',
        'line-height: 1.35',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.45)',
        'pointer-events: auto',
        'user-select: none',
        '-webkit-user-select: none',
    ].join(';');

    panel.innerHTML = `
        <div id="twt-diag-header" style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <span id="twt-diag-status" style="font-weight:bold;color:#38bdf8;font-size:11px;">📊 TwT v1.0.26 诊断就绪</span>
            <div style="display:flex;gap:5px;align-items:center;">
                <button id="twt-diag-copy-btn" type="button" style="background:#0284c7;color:#fff;border:none;border-radius:4px;padding:3px 7px;font-size:11px;cursor:pointer;font-weight:bold;">📋 复制日志</button>
                <button id="twt-diag-clear-btn" type="button" style="background:#475569;color:#fff;border:none;border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer;">清空</button>
                <button id="twt-diag-toggle-btn" type="button" style="background:#334155;color:#fff;border:none;border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer;">展开</button>
                <button id="twt-diag-close-btn" type="button" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:3px 6px;font-size:11px;cursor:pointer;" title="关闭诊断浮窗 (可在阅读设置中重新开启)">✕</button>
            </div>
        </div>
        <textarea id="twt-diag-body" readonly style="display:none;width:100%;height:190px;margin-top:6px;background:#090d16;color:#a7f3d0;border:1px solid #334155;border-radius:4px;padding:5px;font-family:monospace;font-size:10px;line-height:1.35;box-sizing:border-box;white-space:pre;overflow:auto;user-select:text;-webkit-user-select:text;"></textarea>
    `;

    const stopAll = (e) => e.stopPropagation();
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup'].forEach(evt => {
        panel.addEventListener(evt, stopAll, false);
    });

    document.body.appendChild(panel);
    panel.style.display = (isDiagEnabled() && document.body.classList.contains('twt-reading-mode')) ? 'block' : 'none';

    const copyBtn = panel.querySelector('#twt-diag-copy-btn');
    const clearBtn = panel.querySelector('#twt-diag-clear-btn');
    const toggleBtn = panel.querySelector('#twt-diag-toggle-btn');
    const bodyEl = panel.querySelector('#twt-diag-body');
    const closeBtn = panel.querySelector('#twt-diag-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (extension_settings?.twt) {
                extension_settings.twt.diagLogEnabled = false;
                try {
                    getContext()?.saveSettingsDebounced?.();
                } catch {}
            }
            const chk1 = document.getElementById('twt_diag_enabled');
            if (chk1) chk1.checked = false;
            const chk2 = document.getElementById('twt_page_diag_enabled');
            if (chk2) chk2.checked = false;
            panel.style.display = 'none';
        });
    }

    copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        twtDiagLog('USER_COPY_LOGS', '用户点击复制日志按钮');
        const headerInfo = [
            `=== TwT Pagination Diagnostic Report (v1.0.23) ===`,
            `Time: ${new Date().toISOString()}`,
            `UA: ${navigator.userAgent}`,
            `Viewport: ${window.innerWidth}x${window.innerHeight} (dpr=${window.devicePixelRatio})`,
            `Total Logs: ${twtDiagLogs.length}`,
            `==================================================`
        ].join('\n');
        const fullText = headerInfo + '\n' + twtDiagLogs.join('\n');
        if (bodyEl) {
            bodyEl.value = fullText;
        }

        let copied = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(fullText);
                copied = true;
            }
        } catch {}

        if (!copied) {
            try {
                const ta = document.createElement('textarea');
                ta.value = fullText;
                ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                copied = document.execCommand('copy');
                ta.remove();
            } catch {}
        }

        if (copied) {
            copyBtn.textContent = `✅ 已复制(${twtDiagLogs.length}条)`;
            copyBtn.style.background = '#16a34a';
            if (typeof toastr !== 'undefined') {
                toastr.success(`已复制 ${twtDiagLogs.length} 条翻页诊断日志到剪贴板`, 'TwT 诊断日志');
            }
            setTimeout(() => {
                copyBtn.textContent = '📋 复制日志';
                copyBtn.style.background = '#0284c7';
            }, 2000);
        } else {
            twtDiagPanelExpanded = true;
            panel.style.width = '88vw';
            panel.style.maxWidth = '460px';
            if (bodyEl) {
                bodyEl.style.display = 'block';
                bodyEl.value = fullText;
                bodyEl.focus();
                bodyEl.select();
            }
            copyBtn.textContent = '请长按下方框复制';
        }
    });

    clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        twtDiagLogs.length = 0;
        twtDiagEpoch = Date.now();
        twtDiagLastTime = Date.now();
        twtDiagSeq = 0;
        twtDiagLog('LOGS_CLEARED', '手动清空日志');
    });

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        twtDiagPanelExpanded = !twtDiagPanelExpanded;
        panel.style.width = twtDiagPanelExpanded ? '88vw' : 'max-content';
        panel.style.maxWidth = twtDiagPanelExpanded ? '460px' : '82vw';
        if (bodyEl) {
            bodyEl.style.display = twtDiagPanelExpanded ? 'block' : 'none';
            if (twtDiagPanelExpanded) {
                bodyEl.value = twtDiagLogs.join('\n');
                bodyEl.scrollTop = bodyEl.scrollHeight;
            }
        }
        toggleBtn.textContent = twtDiagPanelExpanded ? '收起' : '展开';
    });

    return panel;
}

function scheduleDiagPanelUI(realP, maxP, curMes, winInfo = '') {
    if (!isDiagEnabled()) {
        const panel = document.getElementById('twt-diag-panel');
        if (panel) panel.style.display = 'none';
        return;
    }
    if (twtDiagUiRafId) return;
    twtDiagUiRafId = requestAnimationFrame(() => {
        twtDiagUiRafId = null;
        const panel = ensureDiagPanel();
        if (!panel) return;
        const isReading = document.body.classList.contains('twt-reading-mode');
        panel.style.display = isReading ? 'block' : 'none';
        const statusEl = panel.querySelector('#twt-diag-status');
        if (statusEl) {
            const wStr = winInfo || `${winStartIdx}..${winEndIdx}/${totalDomMesCount}`;
            statusEl.textContent = `📊 页:${lastUserPage}(${realP}/${maxP}) | 楼:${curMes}[${wStr}] | ${twtDiagLogs.length}条`;
        }
        if (twtDiagPanelExpanded) {
            const bodyEl = panel.querySelector('#twt-diag-body');
            if (bodyEl) {
                bodyEl.value = twtDiagLogs.join('\n');
                bodyEl.scrollTop = bodyEl.scrollHeight;
            }
        }
    });
}

let lagDetectorStarted = false;
function startLagDetector() {
    if (lagDetectorStarted) return;
    lagDetectorStarted = true;
    let lastFrameTime = performance.now();
    function checkFrame(now) {
        const gap = Math.round(now - lastFrameTime);
        lastFrameTime = now;
        if (gap > 220 && document.body?.classList?.contains('twt-reading-mode') && !document.hidden) {
            twtDiagLog('⚠️MAIN_THREAD_LAG', `主线程阻塞帧间隔 ${gap}ms`);
        }
        requestAnimationFrame(checkFrame);
    }
    requestAnimationFrame(checkFrame);
}

// ============================================================
// 纵向滚动阻断锁：彻底杜绝多列横向布局下的 scrollTop 顶出位移
// 拦截外部脚本（如酒馆原生 showMoreMessages / scrollChatToBottom）
// 向 #chat.scrollTop 写入非 0 值的操作
// ============================================================
let isScrollTopLocked = false;
let origScrollTopDescriptor = null;

export function lockChatScrollTop(chat) {
    if (!chat || isScrollTopLocked) return;
    try {
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        const descLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
        const descHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
        if (!desc) return;
        origScrollTopDescriptor = desc;
        Object.defineProperty(chat, 'scrollTop', {
            get() {
                return 0;
            },
            set(val) {
                if (document.body.classList.contains('twt-reading-mode')) {
                    if (desc.get.call(chat) !== 0) {
                        desc.set.call(chat, 0);
                    }
                    return;
                }
                desc.set.call(chat, val);
            },
            configurable: true
        });
        // 拦截酒馆原生 scrollChatToBottom() / scrollOnMediaLoad() 对 chat.scrollHeight 的高频读取，彻底杜绝进入聊天后被原生代码触发同步强制重排
        if (descHeight) {
            Object.defineProperty(chat, 'scrollHeight', {
                get() {
                    if (document.body.classList.contains('twt-reading-mode')) {
                        return chat.clientHeight || 0;
                    }
                    return descHeight.get.call(chat);
                },
                configurable: true
            });
        }
        if (descLeft) {
            Object.defineProperty(chat, 'scrollLeft', {
                get() {
                    return descLeft.get.call(chat);
                },
                set(val) {
                    const prev = descLeft.get.call(chat);
                    descLeft.set.call(chat, val);
                    const after = descLeft.get.call(chat);
                    twtDiagLastJsSetSL = after;
                    twtDiagLastObservedSL = after;
                    // 手指连续跟手滑动(isTouching)期间不刷屏记录每一帧 setter，其余任何时刻写入 scrollLeft 均记录调用栈与钳制对比
                    if (!isTouching && document.body.classList.contains('twt-reading-mode')) {
                        const clampedNote = Math.abs(after - val) > 2 ? ` ⚠️CLAMPED(req=${Math.round(val)}->actual=${Math.round(after)})` : '';
                        twtDiagLog('SET_SL', `${Math.round(prev)}->${Math.round(after)} (req=${Math.round(val)})${clampedNote}`);
                    }
                },
                configurable: true
            });
        }
        isScrollTopLocked = true;
        if (chat.scrollTop !== 0) chat.scrollTop = 0;
    } catch (e) {
        console.warn('[TwT] Failed to lock chat.scrollTop:', e);
    }
}

export function unlockChatScrollTop(chat) {
    if (!chat || !isScrollTopLocked) return;
    try {
        delete chat.scrollTop;
        delete chat.scrollLeft;
        delete chat.scrollHeight;
        isScrollTopLocked = false;
    } catch (e) {
        console.warn('[TwT] Failed to unlock chat.scrollTop:', e);
    }
}

// ============================================================
// 动态楼层滑动窗口引擎 (Windowed On-Demand Floor Layout v1.0.23)
// 同一时刻仅让当前阅读楼层及其前后各 2 楼（共约 4~5 楼）参与 CSS 多列排版，
// 其余楼层通过 .twt-mes-window-hidden 暂时移出渲染树，将重排耗时从 600ms+ 降至 <3ms！
// ============================================================
function isHiddenToolCallFloor(mes) {
    return document.body.classList.contains('twt-toolcall-hide') && mes.classList.contains('twt-toolcall-mes');
}

function isNoBreakToolCallFloor(mes) {
    return document.body.classList.contains('twt-toolcall-no-break') && mes.classList.contains('twt-toolcall-mes');
}

function applyFloorWindowByIndex(chat, centerIdx, radiusBefore = 2, radiusAfter = 2) {
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;
    const allMes = Array.from(chat.querySelectorAll(':scope > .mes'));
    const total = allMes.length;
    totalDomMesCount = total;
    if (total === 0) {
        winStartIdx = 0;
        winEndIdx = -1;
        return false;
    }

    centerIdx = Math.max(0, Math.min(total - 1, centerIdx));

    // 向右统计正文楼层
    let newEnd = centerIdx;
    let countAfter = 0;
    while (newEnd < total - 1 && countAfter < radiusAfter) {
        newEnd++;
        const m = allMes[newEnd];
        if (!isHiddenToolCallFloor(m) && !isNoBreakToolCallFloor(m)) {
            countAfter++;
        }
    }

    // 若中心靠近末尾（右侧不足 radiusAfter），自动向左补足窗口宽度，确保首屏至少包含 3~4 个有效楼层
    const targetBefore = radiusBefore + Math.max(0, radiusAfter - countAfter);
    let newStart = centerIdx;
    let countBefore = 0;
    while (newStart > 0 && countBefore < targetBefore) {
        newStart--;
        const m = allMes[newStart];
        if (!isHiddenToolCallFloor(m) && !isNoBreakToolCallFloor(m)) {
            countBefore++;
        }
    }

    // 若中心靠近开头（左侧不足 radiusBefore），自动向右补足窗口宽度
    const extraAfter = Math.max(0, radiusBefore - countBefore);
    while (newEnd < total - 1 && countAfter < radiusAfter + extraAfter) {
        newEnd++;
        const m = allMes[newEnd];
        if (!isHiddenToolCallFloor(m) && !isNoBreakToolCallFloor(m)) {
            countAfter++;
        }
    }

    // 确保紧邻的不跨页工具调用楼层与正文楼层一同留在窗口内
    while (newStart > 0 && (isNoBreakToolCallFloor(allMes[newStart - 1]) || isHiddenToolCallFloor(allMes[newStart - 1]))) {
        newStart--;
    }
    while (newEnd < total - 1 && (isNoBreakToolCallFloor(allMes[newEnd + 1]) || isHiddenToolCallFloor(allMes[newEnd + 1]))) {
        newEnd++;
    }

    const newlyRevealed = [];
    let anyChanged = (newStart !== winStartIdx || newEnd !== winEndIdx);
    for (let i = 0; i < total; i++) {
        const m = allMes[i];
        if (i >= newStart && i <= newEnd) {
            if (m.classList.contains('twt-mes-window-hidden')) {
                m.classList.remove('twt-mes-window-hidden');
                newlyRevealed.push(m);
                anyChanged = true;
            }
        } else {
            if (!m.classList.contains('twt-mes-window-hidden')) {
                m.classList.add('twt-mes-window-hidden');
                anyChanged = true;
            }
        }
    }

    winStartIdx = newStart;
    winEndIdx = newEnd;

    // 关键优化：切入聊天且用户尚未交互时，延迟至揭开遮罩后再异步渲染复杂浮窗/微件，消除首屏挂载卡顿
    if (newlyRevealed.length > 0 && userInteractedSinceSwitch) {
        hideMessageHtmlAppsSync(true, false);
        tagToolCallMessages();
        if (typeof window.twtRenderCommentsForMes === 'function') {
            for (let i = 0; i < newlyRevealed.length; i++) {
                const mid = newlyRevealed[i].getAttribute('mesid');
                if (mid !== null && mid !== undefined) {
                    try { window.twtRenderCommentsForMes(mid); } catch {}
                }
            }
        }
    }
    return anyChanged;
}

/**
 * 激活以指定消息（mesId / DOM节点 / 'start' / 'end'）为中心的楼层排版窗口
 */
export function activateWindowForMessage(mesOrId) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;
    const allMes = Array.from(chat.querySelectorAll(':scope > .mes'));
    totalDomMesCount = allMes.length;
    if (!allMes.length) return false;

    let targetIdx = allMes.length - 1;
    if (mesOrId === 'start') {
        targetIdx = 0;
    } else if (mesOrId === 'end' || mesOrId === null || mesOrId === undefined) {
        targetIdx = allMes.length - 1;
    } else if (typeof mesOrId === 'object' && mesOrId.nodeType === 1) {
        const idx = allMes.indexOf(mesOrId);
        if (idx >= 0) targetIdx = idx;
    } else {
        const strId = String(mesOrId);
        const idx = allMes.findIndex(m => m.getAttribute('mesid') === strId);
        if (idx >= 0) {
            targetIdx = idx;
        } else {
            const numId = Number(mesOrId);
            if (!isNaN(numId)) {
                let bestIdx = allMes.length - 1;
                let bestDiff = Infinity;
                for (let i = 0; i < allMes.length; i++) {
                    const d = Math.abs(Number(allMes[i].getAttribute('mesid')) - numId);
                    if (d < bestDiff) {
                        bestDiff = d;
                        bestIdx = i;
                    }
                }
                targetIdx = bestIdx;
            }
        }
    }

    const changed = applyFloorWindowByIndex(chat, targetIdx, 2, 2);
    if (changed) {
        containOversizedElements();
    }
    return changed;
}

/**
 * 当读者翻页接近当前激活窗口左/右边缘时，无感滑动楼层窗口并同步补偿 scrollLeft（0 像素视觉跳动）
 */
function slideFloorWindowIfNeeded(chat, cw, direction = 'auto') {
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;
    if (isAligningNewMessage || checkIsActuallyGenerating()) return false;
    const step = cw || getColStep(chat);
    if (step <= 0) return false;

    const allMes = Array.from(chat.querySelectorAll(':scope > .mes'));
    const total = allMes.length;
    totalDomMesCount = total;
    if (total === 0) return false;

    // 倘若尚未初始化窗口，先初始化到末尾
    if (winEndIdx < 0 || winEndIdx >= total) {
        applyFloorWindowByIndex(chat, total - 1, 2, 2);
    }

    const sw = chat.scrollWidth || step;
    lastKnownScrollWidth = sw;
    const totalPages = Math.max(1, Math.round(sw / step));
    const curPage = Math.max(0, Math.min(totalPages - 1, Math.round(chat.scrollLeft / step)));

    const needSlideLeft = winStartIdx > 0 && (
        (direction === 'left' && curPage <= 2) ||
        (direction === 'auto' && totalPages >= 5 && curPage <= 1)
    );
    const needSlideRight = winEndIdx < total - 1 && (
        (direction === 'right' && curPage >= totalPages - 3) ||
        (direction === 'auto' && totalPages >= 5 && curPage >= totalPages - 2)
    );

    if (!needSlideLeft && !needSlideRight) return false;

    const chatRect = chat.getBoundingClientRect();
    let anchorIdx = -1;

    // 在当前窗口内定位视口正处于的锚点楼层
    for (let i = winStartIdx; i <= winEndIdx && i < total; i++) {
        const m = allMes[i];
        if (m.classList.contains('twt-mes-window-hidden')) continue;
        const r = m.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > chatRect.left + 4 && r.left < chatRect.right - 4) {
            anchorIdx = i;
            break;
        }
    }

    if (anchorIdx < 0) {
        anchorIdx = needSlideLeft ? winStartIdx : winEndIdx;
    }

    const anchorMes = allMes[anchorIdx];
    if (!anchorMes) return false;

    // 计算新窗口中心：确保向翻页方向至少推进 2~3 个楼层
    let centerIdx = anchorIdx;
    if (needSlideLeft && centerIdx > winStartIdx) {
        centerIdx = winStartIdx;
    } else if (needSlideRight && centerIdx < winEndIdx) {
        centerIdx = winEndIdx;
    }

    const t0 = performance.now();
    const beforeLeft = anchorMes.getBoundingClientRect().left - chatRect.left;
    const oldStart = winStartIdx;
    const oldEnd = winEndIdx;

    const radBefore = needSlideLeft ? 3 : 2;
    const radAfter = needSlideRight ? 3 : 2;
    const changed = applyFloorWindowByIndex(chat, centerIdx, radBefore, radAfter);
    if (!changed) return false;

    containOversizedElements();

    const afterLeft = anchorMes.getBoundingClientRect().left - chatRect.left;
    const shiftPx = afterLeft - beforeLeft;

    const wasScrolling = isScrolling;
    isScrolling = true;
    if (Math.abs(shiftPx) > 1) {
        chat.scrollLeft += shiftPx;
    }
    const newSw = chat.scrollWidth;
    lastKnownScrollWidth = newSw;
    const newPage = Math.max(0, Math.round(chat.scrollLeft / step));
    lastUserPage = newPage;
    chat.scrollLeft = newPage * step;
    if (!wasScrolling) {
        isScrolling = false;
    }

    const cost = Math.round(performance.now() - t0);
    twtDiagLog('WIN_SLIDE', `dir=${direction} [${oldStart}..${oldEnd}]->[${winStartIdx}..${winEndIdx}]/${total} anchor=#${anchorMes.getAttribute('mesid')} shift=${Math.round(shiftPx)}px newP=${newPage} cost=${cost}ms`);
    return true;
}

// ============================================================
// ============================================================
// 消息截断机制（“要渲染 # 条消息”）历史消息加载与锚点定位
// ============================================================
let isExplicitJumpLoading = false;
let isLoadingMoreMessages = false;
let pendingFlipBackwards = false;

export function setExplicitJumpLoading(val) {
    isExplicitJumpLoading = !!val;
}

export function captureReadingAnchor() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return null;
    const chatRect = chat.getBoundingClientRect();
    if (chatRect.width <= 0) return null;

    // 关键防护：若用户刚进入聊天室尚未主动翻页，且恢复目标为最新楼层末尾（mode === 'end'），
    // 直接锚定最后一条可见消息，彻底杜绝因移动端侧栏关闭动画遮挡 elementFromPoint 或多列异步重排而误抓取第 1 条渲染消息（如 74 楼）！
    if (!userInteractedSinceSwitch && (!chatRestoreTarget || chatRestoreTarget.mode === 'end')) {
        const allNodes = chat.querySelectorAll(':scope > .mes:not(.twt-mes-window-hidden)');
        for (let i = allNodes.length - 1; i >= 0; i--) {
            const m = allNodes[i];
            if (m.offsetWidth > 0 || m.offsetHeight > 0) {
                const mesId = m.getAttribute('mesid');
                const mesRect = m.getBoundingClientRect();
                const visualLeft = mesRect.left - chatRect.left;
                const step = getColStep(chat);
                const pageOffsetInMes = step > 0 ? Math.max(0, Math.round(-visualLeft / step)) : 0;
                return { mesId, visualLeft, pageOffsetInMes };
            }
        }
    }

    let visibleMes = null;

    // 1. 尝试极速多点探测 (O(1)): 利用 document.elementFromPoint
    // 直接在视口内多个采样点进行命中检测，微秒级拿到当前可见消息，0 次 Layout
    const probePoints = [
        [0.15, 0.30],
        [0.50, 0.50],
        [0.35, 0.25],
        [0.65, 0.65],
        [0.25, 0.75]
    ];
    for (let i = 0; i < probePoints.length; i++) {
        const px = chatRect.left + chatRect.width * probePoints[i][0];
        const py = chatRect.top + chatRect.height * probePoints[i][1];
        const hitEl = document.elementFromPoint(px, py);
        if (hitEl && chat.contains(hitEl)) {
            const candidate = hitEl.closest('.mes:not(.twt-mes-window-hidden)');
            if (candidate && (candidate.offsetWidth > 0 || candidate.offsetHeight > 0)) {
                visibleMes = candidate;
                break;
            }
        }
    }

    // 2. 兜底策略：若像素探测被浮窗遮挡或命中楼层间隙空白，仅在当前激活窗口内的可见消息中二分查找
    if (!visibleMes) {
        const allNodes = chat.querySelectorAll(':scope > .mes:not(.twt-mes-window-hidden)');
        const messages = [];
        for (let i = 0; i < allNodes.length; i++) {
            const m = allNodes[i];
            if (m.offsetWidth > 0 || m.offsetHeight > 0) {
                messages.push(m);
            }
        }
        const len = messages.length;
        if (!len) return null;

        let low = 0;
        let high = len - 1;
        let bestMid = -1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const rect = messages[mid].getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                low = mid + 1;
                continue;
            }
            if (rect.right <= chatRect.left + 2) {
                low = mid + 1;
            } else if (rect.left >= chatRect.right - 2) {
                high = mid - 1;
            } else {
                bestMid = mid;
                visibleMes = messages[mid];
                break;
            }
            bestMid = mid;
        }
        // 优先防护：如果当前已在末尾页（最新楼层），直接锚定最后一条可见消息，杜绝误抓取中途楼层
        const step = getColStep(chat);
        const total = step > 0 ? Math.max(1, Math.round(chat.scrollWidth / step)) : 1;
        if (!visibleMes && lastUserPage >= total - 2) {
            visibleMes = messages[len - 1];
        }

        if (!visibleMes && bestMid >= 0) {
            const candidate = messages[bestMid];
            const cRect = candidate.getBoundingClientRect();
            if (cRect.left < chatRect.right && cRect.right > chatRect.left) {
                visibleMes = candidate;
            }
        }

        if (!visibleMes && activeReadingAnchor && activeReadingAnchor.mesId) {
            const prevEl = chat.querySelector(`.mes[mesid="${activeReadingAnchor.mesId}"]`);
            if (prevEl && (prevEl.offsetWidth > 0 || prevEl.offsetHeight > 0)) {
                visibleMes = prevEl;
            }
        }
    }

    if (!visibleMes) return null;
    const mesId = visibleMes.getAttribute('mesid');
    const mesRect = visibleMes.getBoundingClientRect();
    const visualLeft = mesRect.left - chatRect.left;
    const step = getColStep(chat);
    const pageOffsetInMes = step > 0 ? Math.max(0, Math.round(-visualLeft / step)) : 0;
    return { mesId, visualLeft, pageOffsetInMes };
}

let activeReadingAnchor = null;

export function updateActiveReadingAnchor(force = false) {
    if (!force && (isTouching || isScrolling)) return;
    const anchor = captureReadingAnchor();
    if (anchor && anchor.mesId) {
        activeReadingAnchor = anchor;
    }
}

export function lockReadingPosition() {
    updateActiveReadingAnchor();
}

export function unlockReadingPosition() {}

export function markAutoScrollingToNewMessage() {}

export function realignToActiveAnchor() {
    if (isTouching || isScrolling) return false;

    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;

    const step = getColStep(chat);
    if (step <= 0) return false;

    // 若用户进入聊天室后尚未主动翻页/触摸，始终钉死在恢复目标（最新楼层末尾），杜绝被慢速加载的字体、代码块或主题重排拽回前序楼层
    if (!userInteractedSinceSwitch && !isGenerating && !isLoadingMoreMessages && chatRestoreTarget) {
        applyRestoreTarget(chat, step);
        return true;
    }

    if (!activeReadingAnchor || !activeReadingAnchor.mesId) return false;

    const anchorEl = chat.querySelector(`.mes[mesid="${activeReadingAnchor.mesId}"]`);
    if (!anchorEl || (anchorEl.offsetWidth === 0 && anchorEl.offsetHeight === 0)) return false;

    const sw = chat.scrollWidth;
    lastKnownScrollWidth = sw;
    const total = Math.max(1, Math.round(sw / step));
    const chatRect = chat.getBoundingClientRect();
    const rect = anchorEl.getBoundingClientRect();
    const absLeft = rect.left - chatRect.left + chat.scrollLeft;
    const mesStartPage = Math.max(0, Math.floor((absLeft + 2) / step));
    const mesEndPage = Math.max(mesStartPage, Math.floor((absLeft + rect.width - 2) / step));
    const offsetPages = Math.max(0, Number(activeReadingAnchor.pageOffsetInMes) || 0);
    const targetPage = Math.min(total - 1, Math.min(mesEndPage, mesStartPage + offsetPages));

    twtDiagLog('REALIGN_ANCHOR', `anchorMes=#${activeReadingAnchor.mesId} offsetP=${offsetPages} mesPages=[${mesStartPage}..${mesEndPage}] -> targetP=${targetPage}`);
    isScrolling = true;
    lastUserPage = targetPage;
    chat.scrollLeft = targetPage * step;
    chat.scrollTop = 0;
    activeReadingAnchor.visualLeft = anchorEl.getBoundingClientRect().left - chatRect.left;
    clearTimeout(scrollUnlockTimer);
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
    }, 60);
    return true;
}

/**
 * 将视口对齐到指定消息的起始第一页
 */
export function realignToMessageStart(mesId) {
    if (mesId === undefined || mesId === null) return false;
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return false;

    activateWindowForMessage(mesId);
    const targetMes = chat.querySelector(`.mes[mesid="${mesId}"]`);
    if (!targetMes) return false;

    const step = getColStep(chat);
    if (step <= 0) return false;

    const chatRect = chat.getBoundingClientRect();
    const rect = targetMes.getBoundingClientRect();
    const absLeft = rect.left - chatRect.left + chat.scrollLeft;
    const targetPage = Math.max(0, Math.floor(absLeft / step));

    chat.scrollLeft = targetPage * step;
    chat.scrollTop = 0;
    lastUserPage = targetPage;
    updateActiveReadingAnchor();
    return true;
}

/**
 * 当某楼层发生 swipe（切换候选项或触发重roll）时调用
 */
export function handleMessageSwiped(mesId) {
    if (mesId === undefined || mesId === null) return;
    const currentAnchor = captureReadingAnchor();
    // 仅在读者当前正停留在该消息（或无有效锚点）时，才重对齐到该消息起始页
    // 严禁在读者阅读前面楼层时强行将视口拽到末尾！
    if (!currentAnchor || !currentAnchor.mesId || String(currentAnchor.mesId) === String(mesId)) {
        realignToMessageStart(mesId);
    }
}

/**
 * 当开始生成（GENERATION_STARTED）时调用：
 * 重roll场景下对齐到被重roll楼层第一页，防止继承旧回答末尾偏移
 */
export function handleGenerationStarted(type) {
    userInteractedSinceSwitch = true;
    chatRestoreTarget = null;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();
    isGenerating = true;
    const isReroll = (type === 'swipe' || type === 'regenerate');
    if (isReroll) {
        const chat = getChat();
        const lastMesId = chat?.querySelector('.mes:last-child')?.getAttribute('mesid');
        const currentAnchor = captureReadingAnchor();
        if (lastMesId && (!currentAnchor || !currentAnchor.mesId || String(currentAnchor.mesId) === String(lastMesId))) {
            realignToMessageStart(lastMesId);
        }
    }
}

/**
 * 用户发送新消息（MESSAGE_SENT）时的翻页调度
 */
export function handleUserMessageSent() {
    userInteractedSinceSwitch = true;
    chatRestoreTarget = null;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();
    isGenerating = checkIsActuallyGenerating();
    updateActiveReadingAnchor();
}

/**
 * 生成结束（GENERATION_STOPPED / GENERATION_ENDED）时的视口校准
 */
export function handleGenerationEnded() {
    isGenerating = false;
    updateActiveReadingAnchor();
    // 生成彻底结束，稍作防抖等待 DOM 稳定后统一执行一次增量收容与工具调用打标，绝不强制覆盖已有滚动对齐
    setTimeout(() => {
        if (!isGenerating && !isTouching && !isScrolling && !isInputFocused() && !isAligningNewMessage) {
            containOversizedElements();
            tagToolCallMessages();
            updateActiveReadingAnchor();
        }
    }, 250);
}

export async function triggerLoadMoreMessages(isFlippingBackwards = false) {
    if (isLoadingMoreMessages) return;
    if (Date.now() - lastChatSwitchTime < 500) return;
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    const showMoreBtn = document.getElementById('show_more_messages');
    if (!showMoreBtn) return;

    isLoadingMoreMessages = true;
    pendingFlipBackwards = isFlippingBackwards;
    updateActiveReadingAnchor();
    try {
        if (typeof showMoreMessages === 'function') {
            await showMoreMessages();
        } else {
            showMoreBtn.click();
        }
    } catch (e) {
        console.warn('[TwT] Failed to load more messages via showMoreMessages:', e);
        try {
            showMoreBtn.click();
        } catch {}
    } finally {
        isLoadingMoreMessages = false;
    }
}

export async function handleMoreMessagesLoaded(isExplicitJump = isExplicitJumpLoading) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    // 1. 深度清零纵向滚动
    chat.scrollTop = 0;
    const sheld = document.getElementById('sheld');
    if (sheld) sheld.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    if (isExplicitJump) {
        pendingFlipBackwards = false;
        return;
    }

    // 关键加固：若用户切入聊天后尚未主动翻页/触摸（!userInteractedSinceSwitch），
    // 此时后台分批补全历史楼层（20->40->60->95）绝对不可跳往 'start' 或依据未初始化锚点计算位移！
    // 保持遮罩覆盖、严格锁定在末尾窗口 'end'，彻底杜绝跳页与中间态暴露！
    if (!userInteractedSinceSwitch && (!chatRestoreTarget || chatRestoreTarget.mode === 'end')) {
        showLoadingOverlay();
        isChatRestoring = true;
        activateWindowForMessage('end');
        containOversizedElements();
        tagToolCallMessages();
        const step = stableColWidth > 0 ? stableColWidth : getColStep(chat);
        if (step > 0) {
            applyRestoreTarget(chat, step);
        }
        pendingFlipBackwards = false;
        scheduleRestoreSettle(600);
        return;
    }

    // 2. 正常阅读状态下的向上翻页补全：仅激活锚点附近的楼层窗口
    activateWindowForMessage(activeReadingAnchor?.mesId || 'end');

    // 3. 等待浏览器完成多列排版计算 (双帧等待)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    updateColWidth();
    containOversizedElements();
    tagToolCallMessages();
    void chat.offsetHeight;

    const step = getColStep(chat);
    if (activeReadingAnchor && activeReadingAnchor.mesId && step > 0) {
        const anchorEl = chat.querySelector(`.mes[mesid="${activeReadingAnchor.mesId}"]`);
        if (anchorEl) {
            const chatRect = chat.getBoundingClientRect();
            const currentVisualLeft = anchorEl.getBoundingClientRect().left - chatRect.left;
            const shift = currentVisualLeft - (activeReadingAnchor.visualLeft || 0);

            if (pendingFlipBackwards) {
                // 如果读者是在第 0 页向前翻页（左翻）触发的加载，自然滑向新加载批次的最后一页
                const targetPage = Math.max(0, Math.floor((chat.scrollLeft + shift) / step) - 1);
                chat.scrollLeft = targetPage * step;
                lastUserPage = targetPage;
            } else if (Math.abs(shift) > 1) {
                chat.scrollLeft += shift;
                lastUserPage = Math.round(chat.scrollLeft / step);
            }
            pendingFlipBackwards = false;
            updateActiveReadingAnchor();
            return;
        }
    }
    pendingFlipBackwards = false;
    updateActiveReadingAnchor();
}

/**
 * 处理用户发送新消息或 AI 回复渲染完成（USER_MESSAGE_RENDERED / CHARACTER_MESSAGE_RENDERED）
 * 根据 autoScrollNewMessage 配置决定是否自动翻到最新一页，或者严格保持在当前阅读位置
 */
export function handleNewMessageRendered(messageId, settings = extension_settings?.twt) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    userInteractedSinceSwitch = true;
    chatRestoreTarget = null;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();

    chat.scrollTop = 0;

    const shouldAutoScroll = settings?.autoScrollNewMessage !== false;
    if (!shouldAutoScroll) {
        // 关闭自动翻页：严格停留在当前阅读位置，不执行任何滚动操作
        return;
    }

    const allMes = chat.querySelectorAll('.mes');
    if (!allMes.length) return;
    const lastMes = allMes[allMes.length - 1];
    const lastMesId = Number(lastMes.getAttribute('mesid'));

    // 关键校验 1：严禁对顶部补位渲染的历史楼层执行“新消息翻页”！
    // 只有当被渲染的消息是末尾最新消息时，才属于新消息翻页
    if (messageId !== undefined && messageId !== null && !isNaN(lastMesId)) {
        const targetId = Number(messageId);
        if (!isNaN(targetId) && targetId < lastMesId) {
            // 这是删除末尾楼层后顶部补入的历史旧楼层，或者是向上加载的历史消息，绝不翻页！
            return;
        }
    }

    requestAnimationFrame(() => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        activateWindowForMessage(messageId ?? 'end');
        const step = getColStep(chat);
        if (step <= 0) return;

        const total = Math.max(1, Math.round(chat.scrollWidth / step));
        let targetPage = total - 1;

        const allMes = chat.querySelectorAll(':scope > .mes');
        const lastMes = allMes.length > 0 ? allMes[allMes.length - 1] : null;
        const targetMes = (messageId !== undefined && messageId !== null)
            ? chat.querySelector(`.mes[mesid="${messageId}"]`)
            : lastMes;
        if (targetMes && (targetMes.offsetWidth > 0 || targetMes.offsetHeight > 0)) {
                const chatRect = chat.getBoundingClientRect();
                const rect = targetMes.getBoundingClientRect();
                const absLeft = rect.left - chatRect.left + chat.scrollLeft;
                const mesStartPage = Math.max(0, Math.min(total - 1, Math.floor(absLeft / step)));
                const absRight = rect.right - chatRect.left + chat.scrollLeft;
                const mesEndPage = Math.max(0, Math.min(total - 1, Math.floor((absRight - 1) / step)));

                // 关键校验 2：如果读者已经自主翻到了该新回复范围内开始阅读（从起始页到尾页）
                // 尊重读者的自主阅读节奏，严禁在后续分段渲染或完成时强行将视口拽到剧透结尾！
                if (lastUserPage >= mesStartPage && lastUserPage <= mesEndPage) {
                    return;
                }

                // 首次自动翻页进入新楼层：对齐到新楼层的第一页（起始位置），方便自上而下阅读，而不是跳到结尾
                targetPage = mesStartPage;
        }

        isAligningNewMessage = true;
        scrollToPage(chat, targetPage, step);
        setTimeout(() => {
            isAligningNewMessage = false;
        }, 250);
    });
}

/**
 * 当删除消息（MESSAGE_DELETED）时的视口优雅收敛
 */
export function handleMessageDeleted() {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    requestAnimationFrame(() => {
        const step = getColStep(chat);
        if (step <= 0) return;
        const total = Math.max(1, Math.round(chat.scrollWidth / step));
        const allMes = chat.querySelectorAll('.mes');
        if (!allMes.length) return;

        // 如果读者当前阅读的位置超出了新总页数，或锚点已被删除
        const anchorEl = (activeReadingAnchor && activeReadingAnchor.mesId) ? chat.querySelector(`.mes[mesid="${activeReadingAnchor.mesId}"]`) : null;
        if (!anchorEl || lastUserPage >= total) {
            const targetPage = Math.max(0, Math.min(lastUserPage, total - 1));
            scrollToPage(chat, targetPage, step);
            updateActiveReadingAnchor();
        }
    });
}

// ============================================================
// 超大元素收容与强制断页（高性能读写分离优化版）
// 100% 保留原有逻辑与折中防 Bug 判定规则，彻底消除循环内部 DOM 强制重排 (Layout Thrashing)
// ============================================================
const elementPrevHeights = new WeakMap();
const HEIGHT_SURGE_THRESHOLD = 80;

const EXCLUDED_TAGS = new Set([
    'P','SPAN','BLOCKQUOTE','PRE','OL','UL','LI',
    'H1','H2','H3','H4','H5','H6','A','CODE','EM','STRONG','I','B'
]);

function getAdaptiveMaxHeight(el, chat, colH, pageBreakEnabled) {
    if (pageBreakEnabled) return colH - 20;
    const elTop = el.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    const remaining = (elTop > 0 && elTop < colH) ? colH - elTop : colH;
    return remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
}

const POTENTIAL_CONTAINERS_SELECTOR = '.mes:not(.twt-mes-window-hidden) .mes_text > table, .mes:not(.twt-mes-window-hidden) .mes_text > details, .mes:not(.twt-mes-window-hidden) .mes_text > iframe, .mes:not(.twt-mes-window-hidden) .mes_text > section, .mes:not(.twt-mes-window-hidden) .mes_text > form, .mes:not(.twt-mes-window-hidden) .mes_text > article, .mes:not(.twt-mes-window-hidden) .mes_text > div';

function containOversizedElements() {
    const chat = document.getElementById('chat');
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    if (isGenerating || isInputFocused()) return;
    const colH = chat.clientHeight;
    if (colH <= 0) return;

    // 如果启用了 HTML 弹窗召出功能，则跳过在翻页文本流中的断页与强制收容逻辑
    if (extension_settings?.twt?.htmlPopupEnabled !== false) {
        return;
    }

    const pageBreakEnabled = extension_settings?.twt?.htmlPageBreakEnabled !== false;
    const chatRect = chat.getBoundingClientRect();

    // 缓存数据计划队列，彻底分离“读相位”与“写相位”
    const toScrollable = [];
    const toBreakSet   = new Set();
    const scrollableEls = new Set();
    const containerClasses = [];

    // 精准选择潜在大容器，避免在长聊天中遍历数千个常规文本节点（P、SPAN等）
    const children = chat.querySelectorAll(POTENTIAL_CONTAINERS_SELECTOR);
    if (!children.length) return;

    // ------------------------------------------------------------
    // 读相位 (Phase 1: Read All Layout Data) - 全程 0 次 DOM 写入
    // ------------------------------------------------------------
    for (let i = 0; i < children.length; i++) {
        const el = children[i];

        // 1. 跳过思维链与工具调用内部
        if (el.closest('.thought-block, .mes_reasoning_details, .mes_reasoning_details_body, .toolCall, .twt-toolcall-mes')) continue;

        const isContainer = (
            el.tagName === 'DIV' || el.tagName === 'TABLE' ||
            el.tagName === 'SECTION' || el.tagName === 'FORM' ||
            el.tagName === 'ARTICLE' || el.tagName === 'DETAILS' ||
            el.tagName === 'IFRAME'
        );
        containerClasses.push({ el, isContainer });

        // 2. 已经是 scrollable 的，直接沿用并重算高度
        if (el.classList.contains('twt-pagination-scrollable')) {
            const maxH = getAdaptiveMaxHeight(el, chat, colH, pageBreakEnabled);
            toScrollable.push({ el, maxH });
            scrollableEls.add(el);
            if (pageBreakEnabled) toBreakSet.add(el);
            continue;
        }

        // 3. 跳过已决定收容的元素的子孙
        let isChildOfScrollable = false;
        for (const scrollableParent of scrollableEls) {
            if (scrollableParent.contains(el)) {
                isChildOfScrollable = true;
                break;
            }
        }
        if (isChildOfScrollable) continue;

        // 4. 跳过普通文字流标签
        if (EXCLUDED_TAGS.has(el.tagName)) continue;

        const elRect = el.getBoundingClientRect();
        const elTop = elRect.top - chatRect.top;
        const remaining = (elTop > 0 && elTop < colH) ? colH - elTop : colH;
        const currentH = el.scrollHeight;

        // 5. DETAILS：仅在展开状态下评估，彻底消除循环内 toggle open 引发的剧烈 Layout Thrashing
        if (el.tagName === 'DETAILS') {
            if (el.open) {
                if (currentH > remaining) {
                    if (pageBreakEnabled) {
                        toBreakSet.add(el);
                        if (currentH > colH) {
                            toScrollable.push({ el, maxH: colH - 20 });
                            scrollableEls.add(el);
                        }
                    } else {
                        const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                        toScrollable.push({ el, maxH });
                        scrollableEls.add(el);
                    }
                }
            }
            elementPrevHeights.set(el, currentH);
            continue;
        }

        // 6. 高度突变检测（未知折叠组件）
        const prevH = elementPrevHeights.get(el);
        const surged = prevH !== undefined && (currentH - prevH) > HEIGHT_SURGE_THRESHOLD;
        elementPrevHeights.set(el, currentH);

        if (currentH > remaining || surged) {
            const cs = getComputedStyle(el);
            const makesBFC = (
                (cs.overflow !== 'visible' && cs.overflow !== '') ||
                cs.display === 'flex' || cs.display === 'inline-flex' ||
                cs.display === 'grid' || cs.display === 'inline-grid' ||
                cs.position === 'absolute' || cs.position === 'fixed' ||
                cs.display === 'flow-root'
            );
            if (makesBFC || isContainer) {
                if (pageBreakEnabled) {
                    toBreakSet.add(el);
                    if (currentH > colH || surged) {
                        toScrollable.push({ el, maxH: colH - 20 });
                        scrollableEls.add(el);
                    }
                } else {
                    const maxH = remaining > 150 ? remaining - 20 : Math.max(150, Math.min(200, colH - 20));
                    toScrollable.push({ el, maxH });
                    scrollableEls.add(el);
                }
            }
        }
    }

    // ------------------------------------------------------------
    // 写相位 (Phase 2: Batch DOM Writes) - 一次性集中批量写入与脏检查
    // ------------------------------------------------------------
    // 标记/取消标记 twt-html-container
    for (let i = 0; i < containerClasses.length; i++) {
        const { el, isContainer } = containerClasses[i];
        if (isContainer) {
            if (!el.classList.contains('twt-html-container')) {
                el.classList.add('twt-html-container');
            }
        } else {
            if (el.classList.contains('twt-html-container')) el.classList.remove('twt-html-container');
            if (el.classList.contains('twt-html-needs-break')) el.classList.remove('twt-html-needs-break');
        }
    }

    // 断页标记更新 (使用 Set O(1) 匹配与脏检查)
    const existingBreakEls = chat.querySelectorAll('.twt-html-needs-break');
    for (let i = 0; i < existingBreakEls.length; i++) {
        const el = existingBreakEls[i];
        if (!toBreakSet.has(el)) el.classList.remove('twt-html-needs-break');
    }
    toBreakSet.forEach(el => {
        if (!el.classList.contains('twt-html-needs-break')) el.classList.add('twt-html-needs-break');
    });

    // 收容样式批量写入 (带脏检查，避免频繁重复设 inline style)
    for (let i = 0; i < toScrollable.length; i++) {
        const { el, maxH } = toScrollable[i];
        const targetMaxH = `${maxH}px`;
        if (el.style.getPropertyValue('max-height') !== targetMaxH) {
            el.style.setProperty('max-height', targetMaxH, 'important');
        }
        if (el.style.getPropertyValue('overflow-y') !== 'auto') {
            el.style.setProperty('overflow-y', 'auto', 'important');
        }
        if (!el.classList.contains('twt-pagination-scrollable')) {
            el.classList.add('twt-pagination-scrollable');
        }
    }

    // 越界校正（优先使用稳定步长缓存）
    if (!isTouching && !isScrolling) {
        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
        if (cw > 0) {
            const total = Math.round(chat.scrollWidth / cw);
            if (lastUserPage >= total) {
                lastUserPage = Math.max(0, total - 1);
                chat.scrollLeft = lastUserPage * cw;
            }
        }
    }
}

// ============================================================
// 核心翻页：scrollToPage
// ============================================================
function getChat() { return document.getElementById('chat'); }

/**
 * 获取多列布局下 Chromium / WebKit 渲染引擎排版每一列的绝对精确物理步长 (Column Step S)
 * 在 CSS Multi-column 布局下，总可滚动宽度为 chat.scrollWidth，总列数为 N。
 * 每列精准步长 S = chat.scrollWidth / N。
 * 任何一页 page 的精确 scrollLeft 均为 page * S。
 * 彻底抹平因 Math.round() 整数化与亚像素 (subpixel) 渲染不匹配导致的“逐页累积偏移/左移”Bug！
 */
export function getColStep(chat) {
    if (!chat) return 0;
    if (stableColWidth > 0) return stableColWidth;
    const rawWidth = chat.getBoundingClientRect().width || chat.clientWidth;
    return rawWidth > 0 ? rawWidth : 0;
}

function getColWidth(chat) {
    return getColStep(chat);
}

let scrollUnlockTimer = null;

/**
 * 实时同步并获取当前真实物理页码：
 * 当 html_popup 异步隐藏代码块或图片完成布局导致 scrollWidth 缩水、浏览器自动钳制 (clamp) scrollLeft 后，
 * 确保 lastUserPage 立即与当前视口真实页码对齐，彻底解决“在最新楼层首次点击向前翻页无反应”的问题。
 */
function getSyncedCurrentPage(chat, cw) {
    const step = cw || getColStep(chat);
    if (!chat || step <= 0) return lastUserPage;
    const sw = chat.scrollWidth || step;
    lastKnownScrollWidth = sw;
    const maxPage = Math.max(0, Math.round(sw / step) - 1);
    const actualPage = Math.max(0, Math.min(maxPage, Math.round(chat.scrollLeft / step)));
    if (lastUserPage > maxPage || Math.abs(actualPage - lastUserPage) >= 1) {
        twtDiagLog('SYNC_PAGE_DRIFT', `uP ${lastUserPage} -> actual ${actualPage} (maxP=${maxPage})`);
        lastUserPage = actualPage;
    }
    return lastUserPage;
}

function scrollToPage(chat, page, cw, knownTotal = 0) {
    if (!chat) return;
    const step = cw || getColStep(chat);
    if (step <= 0) return;
    const sw = knownTotal > 0 ? (knownTotal * step) : (chat.scrollWidth || step);
    lastKnownScrollWidth = sw;
    const total = Math.max(1, Math.round(sw / step));
    const reqPage = page;
    page = Math.max(0, Math.min(page, total - 1));
    const targetScrollLeft = page * step;

    const prevPage = lastUserPage;
    lastUserPage = page;
    isScrolling = true;

    clearTimeout(scrollUnlockTimer);
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
        updateActiveReadingAnchor(true);
        debouncedSavePaginationPosition();
    }, 60);

    twtDiagLog('SCROLL_TO_PAGE', `p: ${prevPage}->${page} (req=${reqPage}, total=${total})`);
    chat.scrollLeft = targetScrollLeft;
}

// ============================================================
// snap 校正（scroll 结束后对齐到权威整页，拦截非预期的浏览器跳页）
// ============================================================
function doSnap(chat) {
    if (isTouching || isScrolling || isInputFocused() || isGenerating || isLoadingMoreMessages) return;
    if (!document.body.classList.contains('twt-reading-mode')) return;
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    const cw = stableColWidth > 0 ? stableColWidth : (chat.clientWidth || 0);
    if (cw <= 0) return;

    // 若刚进入聊天且用户尚未触摸翻页，严禁被原生清空/重绘事件误吸附到前序楼层
    if (!userInteractedSinceSwitch && chatRestoreTarget) {
        twtDiagLog('DO_SNAP_RESTORE', '未交互状态触发 doSnap，拉回恢复目标');
        applyRestoreTarget(chat, cw);
        return;
    }

    const sw = chat.scrollWidth;
    lastKnownScrollWidth = sw;
    const maxPage = Math.max(0, Math.round(sw / cw) - 1);
    const authoritativePage = Math.max(0, Math.min(lastUserPage, maxPage));
    const expected = authoritativePage * cw;

    lastUserPage = authoritativePage;
    if (Math.abs(chat.scrollLeft - expected) > 1) {
        twtDiagLog('DO_SNAP_CORRECT', `拦截异常偏移 sl=${Math.round(chat.scrollLeft)} -> 拉回 expected=${Math.round(expected)} (authP=${authoritativePage})`);
        isScrolling = true;
        chat.scrollLeft = expected;
        clearTimeout(scrollUnlockTimer);
        scrollUnlockTimer = setTimeout(() => {
            isScrolling = false;
            updateActiveReadingAnchor(true);
        }, 60);
    } else {
        updateActiveReadingAnchor(true);
    }
}

/**
 * 根据切入聊天时的恢复目标（末尾 / 指定锚点楼层 / 指定页），将视口精准对齐到目标列
 */
function applyRestoreTarget(chat, cw) {
    if (!chat || cw <= 0 || !chatRestoreTarget) return;
    if (chatRestoreTarget.mode === 'end') {
        activateWindowForMessage('end');
    } else if (chatRestoreTarget.mode === 'anchor' && chatRestoreTarget.mesId !== null && chatRestoreTarget.mesId !== undefined) {
        activateWindowForMessage(chatRestoreTarget.mesId);
    }
    const sw = chat.scrollWidth;
    lastKnownScrollWidth = sw;
    const total = Math.max(1, Math.round(sw / cw));
    let targetPage = total - 1;

    if (chatRestoreTarget.mode === 'end') {
        const allMes = chat.querySelectorAll(':scope > .mes');
        const lastMes = allMes.length > 0 ? allMes[allMes.length - 1] : null;
        if (lastMes && (lastMes.offsetWidth > 0 || lastMes.offsetHeight > 0)) {
            const chatRect = chat.getBoundingClientRect();
            const rect = lastMes.getBoundingClientRect();
            const absLeft = rect.left - chatRect.left + chat.scrollLeft;
            const mesStartPage = Math.max(0, Math.floor((absLeft + 2) / cw));
            targetPage = Math.min(mesStartPage, total - 1);
        } else {
            targetPage = total - 1;
        }
    } else if (chatRestoreTarget.mode === 'anchor' && chatRestoreTarget.mesId !== null && chatRestoreTarget.mesId !== undefined) {
        const anchorEl = chat.querySelector(`.mes[mesid="${chatRestoreTarget.mesId}"]`);
        if (anchorEl && (anchorEl.offsetWidth > 0 || anchorEl.offsetHeight > 0)) {
            const chatRect = chat.getBoundingClientRect();
            const rect = anchorEl.getBoundingClientRect();
            const absLeft = rect.left - chatRect.left + chat.scrollLeft;
            const mesStartPage = Math.max(0, Math.floor((absLeft + 2) / cw));
            const mesEndPage = Math.max(mesStartPage, Math.floor((absLeft + rect.width - 2) / cw));
            const offsetPages = Math.max(0, Number(chatRestoreTarget.pageOffsetInMes) || 0);
            targetPage = Math.min(total - 1, Math.min(mesEndPage, mesStartPage + offsetPages));
        } else if (typeof chatRestoreTarget.page === 'number' && chatRestoreTarget.page > 0) {
            targetPage = Math.min(chatRestoreTarget.page, total - 1);
        } else {
            targetPage = total - 1;
        }
    } else if (chatRestoreTarget.mode === 'page' && typeof chatRestoreTarget.page === 'number') {
        targetPage = Math.max(0, Math.min(chatRestoreTarget.page, total - 1));
    }

    isScrolling = true;
    lastUserPage = targetPage;
    twtDiagLog('APPLY_RESTORE', `mode=${chatRestoreTarget.mode} targetP=${targetPage} total=${total}`);
    chat.scrollLeft = targetPage * cw;
    chat.scrollTop = 0;
    clearTimeout(scrollUnlockTimer);
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
        updateActiveReadingAnchor(true);
    }, 60);
}

/**
 * 解析存储的阅读位置记录，生成恢复目标策略
 */
function resolveRestoreTargetFromSaved(saved, total) {
    const shouldRestore = extension_settings?.twt?.autoRestoreReadingPosition !== false;
    if (!shouldRestore || !saved) {
        return { mode: 'end' };
    }
    if (typeof saved === 'number') {
        // 兼容旧版纯数字格式：旧版由于 Bug 经常把 0 误存进 metadata，因此 saved === 0 一律定位到最新楼层末尾，彻底杜绝进聊天跳到 #show_more_messages
        if (saved <= 0 || saved >= total - 1) {
            return { mode: 'end' };
        }
        return { mode: 'page', page: saved };
    }
    if (typeof saved === 'object') {
        if (saved.isAtEnd) {
            return { mode: 'end' };
        }
        // 如果保存的页码是第 0 页，且并非显式标记在多页中停留于第 0 页，默认回到底部最新楼层
        if ((saved.lastPage === 0 || saved.lastPage === undefined) && !saved.explicitPageZero) {
            return { mode: 'end' };
        }
        if (saved.anchorMesId !== null && saved.anchorMesId !== undefined) {
            // 检查锚点是否是最后一条消息且偏移接近末尾
            return {
                mode: 'anchor',
                mesId: saved.anchorMesId,
                pageOffsetInMes: saved.pageOffsetInMes || 0,
                page: typeof saved.lastPage === 'number' ? saved.lastPage : (total - 1),
            };
        }
        if (typeof saved.lastPage === 'number' && saved.lastPage > 0) {
            return { mode: 'page', page: saved.lastPage };
        }
    }
    return { mode: 'end' };
}

// ============================================================
// 列宽初始化：等待 scrollWidth 稳定
// ============================================================
function updateColWidth() {
    stableColWidth = 0; // Invalidate cache; layout is changing
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    hideMessageHtmlAppsSync(true, false);
    autoNormalizeBubbleTheme();
    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
    if (rawW > 0) {
        // Use precise floating-point viewport width so column-width matches the real viewport
        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
        containOversizedElements();
        // 直接使用精确视口宽度作为稳定步长，杜绝 scrollWidth 被美化溢出撑大引发的步长膨胀与逐页左移
        stableColWidth = rawW;
        lastKnownScrollWidth = chat.scrollWidth;
    }
}

function updateColWidthWhenReady(retries = 4, interval = 60) {
    clearTimeout(colWidthRetryTimer);
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;

    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
    if (rawW <= 0) {
        if (retries > 0) colWidthRetryTimer = setTimeout(() => updateColWidthWhenReady(retries - 1, interval), interval);
        return;
    }

    const t0 = performance.now();
    // 1. 优先激活末尾楼层窗口，将前序所有楼层移出多列渲染树，彻底杜绝首屏对成百上千页做全量重排！
    activateWindowForMessage('end');
    const hiddenCnt = hideMessageHtmlAppsSync(true, false);
    const tHide = Math.round(performance.now() - t0);
    autoNormalizeBubbleTheme();
    chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
    const t1 = performance.now();
    containOversizedElements();
    const tContain = Math.round(performance.now() - t1);
    stableColWidth = rawW;

    const sw1 = chat.scrollWidth;
    lastKnownScrollWidth = sw1;
    twtDiagLog('COL_READY', `hidden=${hiddenCnt}(${tHide}ms) contain=${tContain}ms totalCost=${Math.round(performance.now() - t0)}ms`);

    // 2. 直接同步定位在最新楼层末尾，一步到位锁定真实尾页！
    isChatRestoring = true;
    chatRestoreTarget = { mode: 'end' };
    applyRestoreTarget(chat, rawW);

    // 3. 启动切入聊天稳定期守护（持续吸收后续历史消息加载、图片加载、字体渲染引发的列数变动）
    scheduleRestoreSettle(600);
}

// ============================================================
// MutationObserver：监听 DOM 变化，驱动 containOversizedElements
// ============================================================
function initMutationObserver() {
    const chat = getChat();
    if (!chat || mutationObserver) return;

    let debounceTimer = null;

    mutationObserver = new MutationObserver((mutations) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;

        // 1. 检测酒馆 clearChat() 清空聊天或 printMessages() 初次批量挂载消息（此时 CHAT_CHANGED 尚未触发！）
        // 在微任务阶段立即激活末尾楼层窗口并直接同步将 scrollLeft 钉死到最新楼层末尾，彻底消灭首屏闪现 #show_more_messages 和全量排版阻塞！
        let addedShowMore = false;
        let addedLastMes = false;
        let hasMeaningfulDomChange = false;
        if (mutations && mutations.length > 0) {
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type === 'attributes') {
                    hasMeaningfulDomChange = true;
                    continue;
                }
                if (m.type === 'childList') {
                    if (m.addedNodes && m.addedNodes.length > 0) {
                        for (let j = 0; j < m.addedNodes.length; j++) {
                            const node = m.addedNodes[j];
                            if (node.nodeType === 1) {
                                if (node.id === 'show_more_messages') addedShowMore = true;
                                if (node.classList?.contains('last_mes')) addedLastMes = true;
                                if (!node.classList?.contains('twt-comment-badge') &&
                                    !node.classList?.contains('twt-toolcall-floor-badge') &&
                                    !node.classList?.contains('twt-app-placeholder')) {
                                    hasMeaningfulDomChange = true;
                                }
                            }
                        }
                    }
                    if (m.removedNodes && m.removedNodes.length > 0) {
                        for (let j = 0; j < m.removedNodes.length; j++) {
                            const node = m.removedNodes[j];
                            if (node.nodeType === 1 &&
                                !node.classList?.contains('twt-comment-badge') &&
                                !node.classList?.contains('twt-app-placeholder')) {
                                hasMeaningfulDomChange = true;
                            }
                        }
                    }
                }
            }
        }

        const isInitialBatchMount = (addedShowMore || addedLastMes) && isChatRestoring && chatRestoreTarget && !userInteractedSinceSwitch && !isLoadingMoreMessages && !isGenerating && (Date.now() - lastChatSwitchTime < 2500);
        if (chat.children.length <= 1 || isInitialBatchMount) {
            isChatRestoring = true;
            userInteractedSinceSwitch = false;
            lastChatSwitchTime = Date.now();
            chatRestoreTarget = { mode: 'end' };
            showLoadingOverlay();
            if (isInitialBatchMount) {
                const t0 = performance.now();
                activateWindowForMessage('end');
                const hiddenCnt = hideMessageHtmlAppsSync(true, false);
                const rawW = stableColWidth > 0 ? stableColWidth : (chat.getBoundingClientRect().width || chat.clientWidth);
                if (rawW > 0) {
                    if (!stableColWidth) {
                        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
                        stableColWidth = rawW;
                    }
                    applyRestoreTarget(chat, rawW);
                }
                twtDiagLog('MUT_BATCH_MOUNT', `首屏挂载微任务对齐 hidden=${hiddenCnt} cost=${Math.round(performance.now() - t0)}ms`);
            }
        } else if (addedLastMes && isGenerating) {
            activateWindowForMessage('end');
        }

        if (!hasMeaningfulDomChange) return;
        if (isInputFocused() || isGenerating) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (isTouching || isInputFocused() || isGenerating || isLoadingMoreMessages) return;
            mutationObserver.disconnect();
            try {
                const t0 = performance.now();
                const hiddenCnt = hideMessageHtmlAppsSync(false, false);
                containOversizedElements();
                tagToolCallMessages();
                autoNormalizeBubbleTheme();
                const cost = Math.round(performance.now() - t0);
                if (chat && stableColWidth > 0) {
                    const sw = chat.scrollWidth;
                    lastKnownScrollWidth = sw;
                    twtDiagLog('MUT_DEBOUNCE', `hidden=${hiddenCnt} cost=${cost}ms`);
                    if (!userInteractedSinceSwitch && chatRestoreTarget) {
                        applyRestoreTarget(chat, stableColWidth);
                        scheduleRestoreSettle(600);
                    } else if (userInteractedSinceSwitch && !isScrolling) {
                        const maxPage = Math.max(0, Math.round(sw / stableColWidth) - 1);
                        if (lastUserPage > maxPage) {
                            lastUserPage = maxPage;
                        }
                        const expected = lastUserPage * stableColWidth;
                        if (Math.abs(chat.scrollLeft - expected) > 1) {
                            chat.scrollLeft = expected;
                        }
                        updateActiveReadingAnchor(true);
                    }
                }
            } finally {
                mutationObserver.observe(chat, MUT_OPTS);
            }
        }, 200);
    });

    mutationObserver.observe(chat, MUT_OPTS);
}

const MUT_OPTS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
};

function disconnectMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
}

// ============================================================
// ResizeObserver（带防抖与打字期静默）
// ============================================================
let resizeDebounceTimer = null;
let lastObservedChatWidth = 0;
let lastObservedChatHeight = 0;

function initResizeObserver() {
    const chat = getChat();
    if (!chat || resizeObserver) return;
    lastObservedChatWidth = chat.getBoundingClientRect().width || chat.clientWidth || 0;
    lastObservedChatHeight = chat.clientHeight || 0;
    resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
            if (!document.body.classList.contains('twt-reading-mode')) return;
            const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
            const rawH = chat.clientHeight;
            if (rawW <= 0 || rawH <= 0) return;

            const widthChanged = Math.abs(rawW - lastObservedChatWidth) > 1;
            const heightChanged = Math.abs(rawH - lastObservedChatHeight) > 10;
            lastObservedChatWidth = rawW;
            lastObservedChatHeight = rawH;

            if (widthChanged || heightChanged) {
                twtDiagLog('RESIZE_OBS', `wChanged=${widthChanged}(${Math.round(rawW)}) hChanged=${heightChanged}(${Math.round(rawH)})`);
            }
            if (widthChanged) {
                updateColWidth();
            }

            if (isChatRestoring && !userInteractedSinceSwitch && chatRestoreTarget) {
                const cw = stableColWidth > 0 ? stableColWidth : rawW;
                applyRestoreTarget(chat, cw);
            } else if (!isInputFocused() && (widthChanged || heightChanged)) {
                realignToActiveAnchor();
            }
        }, 80);
    });
    resizeObserver.observe(chat);
}

// ============================================================
// patchScrollIntoView（阅读模式内禁止 scrollIntoView 劫持滚动位置）
// ============================================================
let scrollIntoViewPatched = false;
function patchScrollIntoView() {
    if (scrollIntoViewPatched) return;
    scrollIntoViewPatched = true;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
        if (document.body.classList.contains('twt-reading-mode') && this.closest('#chat')) return;
        orig.apply(this, args);
    };
}

// ============================================================
// 虚拟键盘防护
// ============================================================
let keyboardGuardInit = false;

function initVirtualKeyboardGuard() {
    if (keyboardGuardInit) return;
    keyboardGuardInit = true;

    // 仅当用户通过真实触摸/鼠标点击输入框时才标记为“用户主动聚焦输入”，彻底免疫酒馆 getChat 异步延时触发的 $('#send_textarea').trigger('focus')
    const onPointerDownTrackInput = (e) => {
        if (!e.isTrusted) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) {
            userExplicitlyFocusedInput = true;
        } else {
            userExplicitlyFocusedInput = false;
        }
    };
    document.addEventListener('pointerdown', onPointerDownTrackInput, true);
    document.addEventListener('touchstart', onPointerDownTrackInput, { capture: true, passive: true });
    document.addEventListener('mousedown', onPointerDownTrackInput, true);

    // 当输入框失焦（键盘收起）时，仅在视口列宽实际因软键盘收起而改变时才重新校准，防止酒馆自动聚焦 #send_textarea 后点击聊天区触发错误的锚点回跳
    document.addEventListener('focusout', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            userExplicitlyFocusedInput = false;
            setTimeout(() => {
                if (!isInputFocused() && !isTouching && !isScrolling) {
                    const chat = getChat();
                    if (!chat) return;
                    const rawW = chat.getBoundingClientRect().width || chat.clientWidth;
                    if (rawW > 0 && chat.style.getPropertyValue('--twt-col-width') !== `${rawW}px`) {
                        updateColWidth();
                        realignToActiveAnchor();
                    }
                }
            }, 250);
        }
    });
}

/**
 * 获取消息楼层编号文本（如 "#15"）
 */
function getMessageFloorText(mes) {
    const idDisplay = mes.querySelector('.mesIDDisplay');
    const text = idDisplay?.textContent?.trim();
    if (text) {
        return text.startsWith('#') ? text : `#${text}`;
    }
    const mesId = mes.getAttribute('mesid');
    if (mesId !== null && mesId !== undefined && mesId !== '') {
        return `#${mesId}`;
    }
    return '';
}

/**
 * 注入或更新 Tool Call 楼层的专属楼层徽章
 */
function updateToolCallFloorBadge(mes) {
    const floorText = getMessageFloorText(mes);
    if (!floorText) return;

    const summary = mes.querySelector('.mes_text details summary');
    if (summary) {
        let badge = summary.querySelector('.twt-toolcall-floor-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'twt-toolcall-floor-badge';
            summary.prepend(badge);
        }
        const badgeContent = `<i class="fa-solid fa-wrench"></i><span>${floorText} 工具调用</span>`;
        if (badge.innerHTML !== badgeContent) {
            badge.innerHTML = badgeContent;
        }
        if (!summary.querySelector('.twt-toolcall-arrow')) {
            const arrow = document.createElement('i');
            arrow.className = 'fa-solid fa-chevron-right twt-toolcall-arrow';
            summary.appendChild(arrow);
        }
    } else {
        const mesText = mes.querySelector('.mes_text');
        if (mesText) {
            let badge = mesText.querySelector(':scope > .twt-toolcall-floor-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'twt-toolcall-floor-badge';
                badge.style.marginBottom = '4px';
                mesText.prepend(badge);
            }
            const badgeContent = `<i class="fa-solid fa-wrench"></i><span>${floorText} 工具调用</span>`;
            if (badge.innerHTML !== badgeContent) {
                badge.innerHTML = badgeContent;
            }
        }
    }
}

/**
 * 为 Tool Call 楼层打上标记类名，以便 CSS 规则匹配
 */
export function tagToolCallMessages(settings = extension_settings?.twt) {
    const chat = getChat();
    if (!chat) return;
    if (isGenerating || isInputFocused()) return;
    const baseSel = settings?.toolCallSelector?.trim() || '.mes.toolCall, .mes[is_system="true"].toolCall';
    try {
        // 增量优化：优先仅查询尚未打标的节点，避免在近百楼层高频反复遍历
        let selector = baseSel;
        try {
            selector = baseSel.split(',').map(s => {
                const trimmed = s.trim();
                return trimmed ? `${trimmed}:not(.twt-toolcall-mes)` : '';
            }).filter(Boolean).join(', ') || baseSel;
        } catch (_) {
            selector = baseSel;
        }
        const matches = chat.querySelectorAll(selector);
        for (let i = 0; i < matches.length; i++) {
            const el = matches[i];
            const mes = el.closest('.mes') || el;
            const hasTagged = mes.classList.contains('twt-toolcall-mes');
            if (!hasTagged) {
                mes.classList.add('twt-toolcall-mes');
            }
            // 增量优化：如果已经打标且已经有了徽章，跳过重复的 DOM 操作
            if (!hasTagged || !mes.querySelector('.twt-toolcall-floor-badge')) {
                updateToolCallFloorBadge(mes);
            }
        }
    } catch (e) {
        console.warn('[TwT] Invalid toolCallSelector:', e);
    }
}

// ============================================================
// 气泡拼接/负值外挂美化主题 — 自动坐标系平移自适应引擎
// 自动检测并消除主题在 .mes::before、.mesAvatarWrapper 等组件上
// 使用负位移导致的跨列撕裂与错层 Bug
// ============================================================

let lastNormalizedChatWidth = 0;
let lastCheckedBubbleThemeCss = null;
let lastMeasuredNonBubbleWidth = 0;
let bubbleThemeRetryTimer = null;

export function cleanupBubbleThemeNormalization() {
    clearTimeout(bubbleThemeRetryTimer);
    lastNormalizedChatWidth = 0;
    lastCheckedBubbleThemeCss = null;
    lastMeasuredNonBubbleWidth = 0;
    const styleEl = document.getElementById('twt-auto-bubble-patch');
    if (styleEl) styleEl.remove();
}

function getActiveThemeCustomCss() {
    try {
        if (typeof power_user !== 'undefined' && power_user?.custom_css) {
            return power_user.custom_css;
        }
    } catch {}
    try {
        const customStyle = document.getElementById('custom-style');
        if (customStyle && customStyle.textContent) {
            return customStyle.textContent;
        }
    } catch {}
    try {
        const textarea = document.getElementById('customCSS');
        if (textarea && textarea.value) {
            return textarea.value;
        }
    } catch {}
    return '';
}

function parseThemeBubbleRules(cssText) {
    if (!cssText || typeof cssText !== 'string') return null;

    let mesMarginTopStr = null;
    const mMargin = cssText.match(/[.]mes\s*\{[^}]*?margin:\s*([^;]+);/s);
    if (mMargin) mesMarginTopStr = mMargin[1].trim().split(/\s+/)[0];

    if (!mesMarginTopStr) return null;
    const isVw = mesMarginTopStr.includes('vw');
    const isPx = mesMarginTopStr.includes('px');
    const unit = isVw ? 'vw' : (isPx ? 'px' : null);
    if (!unit) return null;

    const H = parseFloat(mesMarginTopStr);
    if (isNaN(H) || H < 25) return null; // 非气泡拼接主题

    let beforeTopStr = null;
    let beforeTranslateYStr = null;
    let beforeAspectStr = null;
    const mBefore = cssText.match(/[.]mes::before\s*\{[^}]*?\}/sg);
    if (mBefore) {
        mBefore.forEach(b => {
            const topM = b.match(/top:\s*([^;]+);/);
            if (topM) beforeTopStr = topM[1].trim();
            const transM = b.match(/translateY\(([^)]+)\)/);
            if (transM) beforeTranslateYStr = transM[1].trim();
            const aspectM = b.match(/aspect-ratio:\s*([^;]+);/);
            if (aspectM) beforeAspectStr = aspectM[1].trim();
        });
    }

    let avatarTopStr = null;
    const mAvatar = cssText.match(/[.]mesAvatarWrapper\s*\{[^}]*?\}/sg);
    if (mAvatar) {
        mAvatar.forEach(a => {
            const topM = a.match(/top:\s*([^;]+);/);
            if (topM) avatarTopStr = topM[1].trim();
        });
    }

    let beforeTop = null;
    if (beforeTranslateYStr && beforeTranslateYStr.includes('%')) {
        let ratio = 1.0;
        if (beforeAspectStr) {
            const parts = beforeAspectStr.split('/').map(s => parseFloat(s.trim()));
            if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
                ratio = parts[1] / parts[0];
            }
        }
        const pct = Math.abs(parseFloat(beforeTranslateYStr));
        const beforeShift = ratio * pct;
        beforeTop = Math.max(0, H - beforeShift);
    } else if (beforeTopStr) {
        const bVal = parseFloat(beforeTopStr);
        beforeTop = Math.max(0, H + bVal);
    }

    let avatarTop = null;
    if (avatarTopStr) {
        const aVal = parseFloat(avatarTopStr);
        avatarTop = Math.max(0, H + aVal);
    }

    return {
        unit,
        safePaddingTop: `${H.toFixed(2)}${unit}`,
        newBeforeTop: beforeTop !== null ? `${beforeTop.toFixed(2)}${unit}` : null,
        newAvatarTop: avatarTop !== null ? `${avatarTop.toFixed(2)}${unit}` : null
    };
}

let lastGeneratedBubblePatchCss = '';

export function generateBubbleThemePatchCss() {
    const themeCss = getActiveThemeCustomCss();
    const parsed = parseThemeBubbleRules(themeCss);
    if (parsed) {
        const { safePaddingTop, newBeforeTop, newAvatarTop } = parsed;
        return `/* === [TwT] 气泡拼接美化智能适配规则 (源码级精准解析) === */
body.twt-reading-mode #chat > .mes,
body.twt-reading-mode #chat .mes {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    padding: ${safePaddingTop} 0 0 0 !important;
    background-origin: content-box !important;
    background-clip: content-box !important;
}
${newBeforeTop !== null ? `body.twt-reading-mode #chat .mes::before {
    top: ${newBeforeTop} !important;
    transform: none !important;
}
` : ''}${newAvatarTop !== null ? `body.twt-reading-mode #chat .mes .mesAvatarWrapper {
    top: ${newAvatarTop} !important;
}
` : ''}body.twt-reading-mode #chat .mes .timestamp,
body.twt-reading-mode #chat .mes .mesIDDisplay,
body.twt-reading-mode #chat .mes .tokenCounterDisplay,
body.twt-reading-mode #chat .mes .mes_timer {
    position: absolute !important;
}`;
    }

    if (lastGeneratedBubblePatchCss) {
        return lastGeneratedBubblePatchCss;
    }

    const chat = getChat();
    const candidateMes = chat ? (chat.querySelector('.mes:not([is_system="true"]):not(.system_mes)') || chat.querySelector('.mes')) : null;
    if (candidateMes) {
        try {
            const mesStyle = window.getComputedStyle(candidateMes);
            const beforeStyle = window.getComputedStyle(candidateMes, '::before');
            const avatar = candidateMes.querySelector('.mesAvatarWrapper');
            const avatarStyle = avatar ? window.getComputedStyle(avatar) : null;
            const marginTopPx = parseFloat(mesStyle.marginTop) || 0;
            if (marginTopPx >= 25) {
                let beforeShiftPx = 0;
                let hasBeforeDecor = false;
                if (beforeStyle.content && beforeStyle.content !== 'none') {
                    const topPx = parseFloat(beforeStyle.top) || 0;
                    let translateYPx = 0;
                    if (beforeStyle.transform && beforeStyle.transform !== 'none') {
                        const matrixMatch = beforeStyle.transform.match(/matrix(?:3d)?\(([^)]+)\)/);
                        if (matrixMatch) {
                            const parts = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
                            if (parts.length === 6 && !isNaN(parts[5])) translateYPx = parts[5];
                            else if (parts.length === 16 && !isNaN(parts[13])) translateYPx = parts[13];
                        }
                    }
                    beforeShiftPx = topPx + translateYPx;
                    hasBeforeDecor = true;
                }
                let avatarShiftPx = 0;
                let hasAvatar = false;
                if (avatarStyle) {
                    const aTopPx = parseFloat(avatarStyle.top) || 0;
                    let aTranslateYPx = 0;
                    if (avatarStyle.transform && avatarStyle.transform !== 'none') {
                        const matrixMatch = avatarStyle.transform.match(/matrix(?:3d)?\(([^)]+)\)/);
                        if (matrixMatch) {
                            const parts = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
                            if (parts.length === 6 && !isNaN(parts[5])) aTranslateYPx = parts[5];
                            else if (parts.length === 16 && !isNaN(parts[13])) aTranslateYPx = parts[13];
                        }
                    }
                    avatarShiftPx = aTopPx + aTranslateYPx;
                    hasAvatar = true;
                }
                const winW = window.innerWidth || 1;
                const pxToVw = (px) => ((px / winW) * 100).toFixed(3);
                const safePaddingTopVw = pxToVw(marginTopPx);
                const newBeforeTopVw = pxToVw(Math.max(0, marginTopPx + beforeShiftPx));
                const newAvatarTopVw = pxToVw(Math.max(0, marginTopPx + avatarShiftPx));
                return `/* === [TwT] 气泡拼接美化智能适配规则 (DOM测量兜底) === */
body.twt-reading-mode #chat > .mes,
body.twt-reading-mode #chat .mes {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    padding: ${safePaddingTopVw}vw 0 0 0 !important;
    background-origin: content-box !important;
    background-clip: content-box !important;
}
${hasBeforeDecor ? `body.twt-reading-mode #chat .mes::before {
    top: ${newBeforeTopVw}vw !important;
    transform: none !important;
}
` : ''}${hasAvatar ? `body.twt-reading-mode #chat .mes .mesAvatarWrapper {
    top: ${newAvatarTopVw}vw !important;
}
` : ''}body.twt-reading-mode #chat .mes .timestamp,
body.twt-reading-mode #chat .mes .mesIDDisplay,
body.twt-reading-mode #chat .mes .tokenCounterDisplay,
body.twt-reading-mode #chat .mes .mes_timer {
    position: absolute !important;
}`;
            }
        } catch {}
    }

    return '';
}

export function autoNormalizeBubbleTheme(settings = extension_settings?.twt) {
    if (!document.body.classList.contains('twt-reading-mode')) {
        cleanupBubbleThemeNormalization();
        const diagPanel = document.getElementById('twt-diag-panel');
        if (diagPanel) diagPanel.style.display = 'none';
        return;
    }
    if (settings?.autoBubbleThemeEnabled === false) {
        cleanupBubbleThemeNormalization();
        return;
    }

    const chat = getChat();
    if (!chat) return;

    // AI 生成中避让
    if (isGenerating) return;

    let dynamicStyle = document.getElementById('twt-auto-bubble-patch');

    // 优先：从原生主题 CSS 源码中解析原始参数，避免浏览器 computedStyle 测量阶段丢失 transform 百分比
    const themeCss = getActiveThemeCustomCss();
    const parsed = parseThemeBubbleRules(themeCss);

    if (parsed) {
        const { safePaddingTop, newBeforeTop, newAvatarTop } = parsed;
        const css = `
/* [TwT] 气泡拼接美化自动坐标平移自适应规则 (源码级精准解析) */
body.twt-reading-mode #chat > .mes,
body.twt-reading-mode #chat .mes {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    padding: ${safePaddingTop} 0 0 0 !important;
    background-origin: content-box !important;
    background-clip: content-box !important;
}
${newBeforeTop !== null ? `body.twt-reading-mode #chat .mes::before {
    top: ${newBeforeTop} !important;
    transform: none !important;
}` : ''}
${newAvatarTop !== null ? `body.twt-reading-mode #chat .mes .mesAvatarWrapper {
    top: ${newAvatarTop} !important;
}` : ''}
body.twt-reading-mode #chat .mes .timestamp,
body.twt-reading-mode #chat .mes .mesIDDisplay,
body.twt-reading-mode #chat .mes .tokenCounterDisplay,
body.twt-reading-mode #chat .mes .mes_timer {
    position: absolute !important;
}
`;

        lastGeneratedBubblePatchCss = css;
        if (!dynamicStyle) {
            dynamicStyle = document.createElement('style');
            dynamicStyle.id = 'twt-auto-bubble-patch';
            document.head.appendChild(dynamicStyle);
        }
        if (dynamicStyle.textContent !== css) {
            dynamicStyle.textContent = css;
            console.log(`[TwT] 气泡美化自适应已生效: padding=${safePaddingTop} 0 0 0, before.top=${newBeforeTop}, avatar.top=${newAvatarTop}`);
        }
        return;
    }

    // 备用：若主题 CSS 未注册在 custom_css 中，回退到 DOM computedStyle 测量
    const candidateMes = chat.querySelector('.mes:not([is_system="true"]):not(.system_mes)') || chat.querySelector('.mes');
    if (!candidateMes) {
        clearTimeout(bubbleThemeRetryTimer);
        bubbleThemeRetryTimer = setTimeout(() => {
            if (document.body.classList.contains('twt-reading-mode')) {
                autoNormalizeBubbleTheme(settings);
            }
        }, 150);
        return;
    }

    const chatWidth = chat.clientWidth || window.innerWidth || 1;
    if (dynamicStyle && lastNormalizedChatWidth > 0 && Math.abs(chatWidth - lastNormalizedChatWidth) < 2) {
        return;
    }
    if (!dynamicStyle && lastCheckedBubbleThemeCss === themeCss && lastMeasuredNonBubbleWidth > 0 && Math.abs(chatWidth - lastMeasuredNonBubbleWidth) < 2) {
        return;
    }

    if (dynamicStyle) {
        dynamicStyle.remove();
        dynamicStyle = null;
    }

    try {
        const mesStyle = window.getComputedStyle(candidateMes);
        const beforeStyle = window.getComputedStyle(candidateMes, '::before');
        const avatar = candidateMes.querySelector('.mesAvatarWrapper');
        const avatarStyle = avatar ? window.getComputedStyle(avatar) : null;

        const marginTopPx = parseFloat(mesStyle.marginTop) || 0;
        if (marginTopPx < 25) {
            lastCheckedBubbleThemeCss = themeCss;
            lastMeasuredNonBubbleWidth = chatWidth;
            return;
        }

        let beforeShiftPx = 0;
        let hasBeforeDecor = false;
        if (beforeStyle.content && beforeStyle.content !== 'none') {
            const topPx = parseFloat(beforeStyle.top) || 0;
            let translateYPx = 0;
            if (beforeStyle.transform && beforeStyle.transform !== 'none') {
                const matrixMatch = beforeStyle.transform.match(/matrix(?:3d)?\(([^)]+)\)/);
                if (matrixMatch) {
                    const parts = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
                    if (parts.length === 6 && !isNaN(parts[5])) translateYPx = parts[5];
                    else if (parts.length === 16 && !isNaN(parts[13])) translateYPx = parts[13];
                }
            }
            beforeShiftPx = topPx + translateYPx;
            hasBeforeDecor = true;
        }

        let avatarShiftPx = 0;
        let hasAvatar = false;
        if (avatarStyle) {
            const aTopPx = parseFloat(avatarStyle.top) || 0;
            let aTranslateYPx = 0;
            if (avatarStyle.transform && avatarStyle.transform !== 'none') {
                const matrixMatch = avatarStyle.transform.match(/matrix(?:3d)?\(([^)]+)\)/);
                if (matrixMatch) {
                    const parts = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
                    if (parts.length === 6 && !isNaN(parts[5])) aTranslateYPx = parts[5];
                    else if (parts.length === 16 && !isNaN(parts[13])) aTranslateYPx = parts[13];
                }
            }
            avatarShiftPx = aTopPx + aTranslateYPx;
            hasAvatar = true;
        }

        const isNegativeSuspension = (hasBeforeDecor && beforeShiftPx < -15) || (hasAvatar && avatarShiftPx < -15);
        if (!isNegativeSuspension) return;

        const winW = window.innerWidth || 1;
        const pxToVw = (px) => ((px / winW) * 100).toFixed(3);

        const safePaddingTopVw = pxToVw(marginTopPx);
        const newBeforeTopVw = pxToVw(Math.max(0, marginTopPx + beforeShiftPx));
        const newAvatarTopVw = pxToVw(Math.max(0, marginTopPx + avatarShiftPx));

        const css = `
body.twt-reading-mode #chat > .mes,
body.twt-reading-mode #chat .mes {
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    padding: ${safePaddingTopVw}vw 0 0 0 !important;
    background-origin: content-box !important;
    background-clip: content-box !important;
}
${hasBeforeDecor ? `body.twt-reading-mode #chat .mes::before {
    top: ${newBeforeTopVw}vw !important;
    transform: none !important;
}` : ''}
${hasAvatar ? `body.twt-reading-mode #chat .mes .mesAvatarWrapper {
    top: ${newAvatarTopVw}vw !important;
}` : ''}
body.twt-reading-mode #chat .mes .timestamp,
body.twt-reading-mode #chat .mes .mesIDDisplay,
body.twt-reading-mode #chat .mes .tokenCounterDisplay,
body.twt-reading-mode #chat .mes .mes_timer {
    position: absolute !important;
}
`;

        dynamicStyle = document.createElement('style');
        dynamicStyle.id = 'twt-auto-bubble-patch';
        document.head.appendChild(dynamicStyle);
        dynamicStyle.textContent = css;
        lastGeneratedBubblePatchCss = css;
        lastNormalizedChatWidth = chatWidth;

        console.log(`[TwT] 气泡美化自适应已生效 (DOM测量兜底): padding=${safePaddingTopVw}vw 0 0 0, before.top=${newBeforeTopVw}vw, avatar.top=${newAvatarTopVw}vw`);
    } catch (e) {
        console.warn('[TwT] autoNormalizeBubbleTheme error:', e);
    }
}

// ============================================================
// 公开 API
// ============================================================

export function applyPaginationMode(enabled, settings) {
    if (enabled) {
        setClass(document.body, 'twt-reading-mode', true);
        if (isDiagEnabled(settings)) ensureDiagPanel();
        startLagDetector();
        twtDiagLog('APPLY_PAGINATION', '翻页阅读模式已开启');
        const chat = getChat();
        if (chat) lockChatScrollTop(chat);
        if (settings) {
            setClass(document.body, 'twt-swipe-disabled',      !settings.swipeEnabled);
            setClass(document.body, 'twt-message-page',        !!settings.messagePageEnabled);
            setClass(document.body, 'twt-avatar-theme-layout', settings.avatarLayoutMode === 'theme');
            setClass(document.body, 'twt-toolcall-hide',       settings.toolCallMode === 'hide');
            setClass(document.body, 'twt-toolcall-compact',    settings.toolCallMode === 'compact');
            setClass(document.body, 'twt-toolcall-minimal',    (settings.toolCallMode || 'minimal') === 'minimal');
            setClass(document.body, 'twt-toolcall-no-break',   settings.toolCallNoPageBreak !== false);
            tagToolCallMessages(settings);
        }
        autoNormalizeBubbleTheme(settings);
        updateColWidthWhenReady();
        window.addEventListener('resize', onWindowResize);
        initResizeObserver();
        patchScrollIntoView();
        initVirtualKeyboardGuard();
        initMutationObserver();
    } else {
        [
            'twt-reading-mode', 'twt-swipe-disabled', 'twt-chat-switching',
            'twt-message-page', 'twt-avatar-theme-layout',
            'twt-toolcall-hide', 'twt-toolcall-compact', 'twt-toolcall-minimal', 'twt-toolcall-no-break'
        ].forEach(cls => setClass(document.body, cls, false));
        window.removeEventListener('resize', onWindowResize);
        cleanupBubbleThemeNormalization();

        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        disconnectMutationObserver();
        const diagPanel = document.getElementById('twt-diag-panel');
        if (diagPanel) diagPanel.style.display = 'none';

        const chat = getChat();
        if (chat) unlockChatScrollTop(chat);
        if (chat) {
            setClass(chat, 'twt-chat-switching', false);
            chat.querySelectorAll('.twt-mes-window-hidden').forEach(el => {
                el.classList.remove('twt-mes-window-hidden');
            });
            chat.querySelectorAll('.twt-pagination-scrollable').forEach(el => {
                el.style.removeProperty('max-height');
                el.style.removeProperty('overflow-y');
                el.classList.remove('twt-pagination-scrollable');
            });
            chat.querySelectorAll('.twt-html-container, .twt-html-needs-break').forEach(el => {
                el.classList.remove('twt-html-container', 'twt-html-needs-break');
            });
        }
    }
}

function onWindowResize() {
    if (isInputFocused()) return;
    updateColWidth();
}

export function refreshPagination(targetPage = null) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
    updateColWidth();
    const cw = getColWidth(chat);
    if (cw <= 0) return;
    const total = Math.round(chat.scrollWidth / cw);
    const page = targetPage !== null ? Math.max(0, Math.min(targetPage, total - 1)) : total - 1;
    requestAnimationFrame(() => {
        scrollToPage(chat, page, cw);
    });
}

export function scrollPageLeft() {
    if (isInputFocused()) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) active.blur();
    }
    const chat = getChat();
    if (!chat) return;
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return;
    userInteractedSinceSwitch = true;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();
    slideFloorWindowIfNeeded(chat, cw, 'left');
    const curPage = getSyncedCurrentPage(chat, cw);
    if (curPage <= 0 && winStartIdx <= 0 && document.getElementById('show_more_messages')) {
        triggerLoadMoreMessages(true);
        return;
    }
    scrollToPage(chat, curPage - 1, cw);
}

export function scrollPageRight() {
    if (isInputFocused()) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) active.blur();
    }
    const chat = getChat();
    if (!chat) return;
    const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
    if (cw <= 0) return;
    userInteractedSinceSwitch = true;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();
    slideFloorWindowIfNeeded(chat, cw, 'right');
    const curPage = getSyncedCurrentPage(chat, cw);
    scrollToPage(chat, curPage + 1, cw);
}

export function setLastUserPage(page) {
    lastUserPage = page;
    userInteractedSinceSwitch = true;
    isChatRestoring = false;
    clearTimeout(chatRestoreSettleTimer);
    hideLoadingOverlay();
    isScrolling = true;
    clearTimeout(scrollUnlockTimer);
    scrollUnlockTimer = setTimeout(() => {
        isScrolling = false;
        updateActiveReadingAnchor(true);
        debouncedSavePaginationPosition();
    }, 60);
}

/**
 * 核心归正功能：全向深度归正（左右翻页网格校准 + 纵向打字顶出位移复原）
 * 1. 深度清零 #chat、所有祖先容器及 window/body 的 scrollTop 纵向偏移
 * 2. 解除可能处于冻结状态的 #chat 容器高度与焦点保护锁
 * 3. 强制重置 #chat 内部所有消息块及子容器的纵向滚动偏位
 * 4. 触发强制重排 (Reflow) 与列宽校准，消除横向亚像素漂移并重置 scrollLeft
 * @param {boolean} verbose 是否弹出 Toast 提示与打印控制台诊断日志
 * @returns {object|null} 返回归正前后的物理偏差诊断报告
 */
export function realignPagination(verbose = true) {
    const chat = getChat();
    if (!chat || !document.body.classList.contains('twt-reading-mode')) {
        if (verbose && typeof toastr !== 'undefined') {
            toastr.info('当前未处于翻页阅读模式，无需归正。', '翻页归正');
        }
        return null;
    }

    // 1. 采集归正前的纵向漂移与横向物理数据
    const prevChatScrollTop = chat.scrollTop || 0;
    const prevWinScrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    
    let ancestorScrollTopSum = 0;
    let node = chat.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
        if (node.scrollTop > 0) {
            ancestorScrollTopSum += node.scrollTop;
            node.scrollTop = 0;
        }
        node = node.parentElement;
    }

    // 2. 强制清零所有层级的纵向滚动
    chat.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {}

    const sheld = document.getElementById('sheld');
    if (sheld) sheld.scrollTop = 0;

    // 清理聊天区内部真正具有滚动能力的子容器可能产生的 scrollTop
    const internalScrolled = chat.querySelectorAll('.twt-pagination-scrollable, pre, textarea');
    internalScrolled.forEach(el => {
        if (el.scrollTop > 0) el.scrollTop = 0;
    });

    // 4. 采集横向网格数据
    const rawW = chat.getBoundingClientRect().width || chat.clientWidth || 0;
    const scrollW = chat.scrollWidth || 0;
    const currentScrollLeft = chat.scrollLeft;
    const currentPage = lastUserPage;

    const calcStep = getColStep(chat);
    const expectedScrollLeft = currentPage * (stableColWidth > 0 ? stableColWidth : calcStep);
    const offsetDelta = currentScrollLeft - expectedScrollLeft;
    const subpixelDrift = (currentScrollLeft % (calcStep || 1)).toFixed(3);
    const totalPages = calcStep > 0 ? Math.round(scrollW / calcStep) : 1;

    // 5. 执行物理归正重置与强制 Reflow
    stableColWidth = 0;
    lastKnownScrollWidth = 0;
    clearTimeout(stableColWidthTimer);

    if (rawW > 0) {
        chat.style.setProperty('--twt-col-width', `${rawW}px`, 'important');
    }

    containOversizedElements();

    // 强制同步重排，确保高度和列断点恢复正常
    void chat.offsetHeight;

    const newSw = chat.scrollWidth;
    if (newSw > 0 && rawW > 0) {
        stableColWidth = rawW;
        lastKnownScrollWidth = newSw;
    }

    const finalStep = stableColWidth > 0 ? stableColWidth : calcStep;
    const finalMaxPage = finalStep > 0 ? Math.max(0, Math.round(newSw / finalStep) - 1) : 0;
    const targetPage = Math.min(currentPage, finalMaxPage);
    lastUserPage = targetPage;

    // 物理强行归正对齐
    chat.scrollLeft = targetPage * finalStep;
    chat.scrollTop = 0;
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch {}

    const totalVerticalDrift = Number((prevChatScrollTop + prevWinScrollY + ancestorScrollTopSum).toFixed(2));
    const report = {
        currentPage: targetPage,
        totalPages: finalMaxPage + 1,
        currentScrollLeft: Number(currentScrollLeft.toFixed(2)),
        expectedScrollLeft: Number(expectedScrollLeft.toFixed(2)),
        offsetDelta: Number(offsetDelta.toFixed(2)),
        subpixelDrift: Number(subpixelDrift),
        verticalDrift: totalVerticalDrift,
        colWidth: Number(calcStep.toFixed(2)),
        scrollWidth: newSw,
        viewportWidth: rawW
    };

    // 6. 诊断日志输出
    const logMsg = `🔍 全向归正诊断：当前页 [${targetPage + 1}/${finalMaxPage + 1}]，` +
                   `横向偏差: ${offsetDelta > 0 ? '+' : ''}${offsetDelta.toFixed(2)}px，` +
                   `纵向顶出位移: ${totalVerticalDrift}px (已完全复原)`;
    console.log('[TwT] ' + logMsg);

    // 7. 用户 Toast 反馈
    if (verbose && typeof toastr !== 'undefined') {
        const absDelta = Math.abs(offsetDelta).toFixed(1);
        let msg = '翻页排版已完成全向归正！';
        if (totalVerticalDrift > 0 && Math.abs(offsetDelta) > 1) {
            msg = `翻页排版已归正！(复原顶出: ${totalVerticalDrift}px，修正偏移: ${absDelta}px)`;
        } else if (totalVerticalDrift > 0) {
            msg = `上下顶出已复原！(清理纵向位移: ${totalVerticalDrift}px)`;
        } else {
            msg = `翻页网格已完成归正！(偏移偏差: ${offsetDelta > 0 ? '+' : ''}${absDelta}px → 0.00px)`;
        }
        toastr.success(msg, '翻页归正');
    }

    return report;
}

// ============================================================
// resetPaginationBinding：切换聊天时重置并重绑定
// ============================================================
import { invalidateMuluStoreCache } from '../mulu/mulu.js?v=1.0.26';

export function resetPaginationBinding(getSettings) {
    twtDiagEpoch = Date.now();
    lastChatSwitchTime = Date.now();
    ensureDiagPanel();
    startLagDetector();
    showLoadingOverlay();
    twtDiagLog('CHAT_SWITCH_RESET', '收到 CHAT_CHANGED 重置绑定');
    userInteractedSinceSwitch = false;
    userExplicitlyFocusedInput = false;
    isChatRestoring = true;
    chatRestoreTarget = { mode: 'end' };
    clearTimeout(chatRestoreSettleTimer);
    clearTimeout(savePositionTimer);
    invalidateMuluStoreCache();

    // 关键防护：手机端切入聊天时立即强制失焦输入框并全天候拦截非用户主动点击的程序化自动聚焦（无论高楼层加载耗时多久）
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        active.blur();
    }
    const sendTextarea = document.getElementById('send_textarea');
    if (sendTextarea) {
        sendTextarea.blur();
        if (!sendTextarea.__twt_guard_attached__) {
            sendTextarea.__twt_guard_attached__ = true;
            sendTextarea.addEventListener('focus', (e) => {
                if (document.body.classList.contains('twt-reading-mode') && !userExplicitlyFocusedInput) {
                    e.preventDefault();
                    sendTextarea.blur();
                }
            }, true);
        }
    }

    // 中止旧事件
    if (scrollEventsAbortController) {
        scrollEventsAbortController.abort();
        scrollEventsAbortController = null;
    }

    lastUserPage = 0;
    stableColWidth = 0;
    lastKnownScrollWidth = 0;
    winStartIdx = 0;
    winEndIdx = -1;
    totalDomMesCount = 0;
    clearTimeout(stableColWidthTimer);
    isScrolling  = false;
    isGenerating = false;
    activeReadingAnchor = null;

    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    disconnectMutationObserver();

    if (!document.body.classList.contains('twt-reading-mode')) return;

    function tryBind(retries) {
        const chat = getChat();
        if (chat) {
            lockChatScrollTop(chat);
            initResizeObserver();
            bindScrollEvents(getSettings);
            // ② 切换后：列宽稳定时会触发位置恢复（见 updateColWidthWhenReady）
            updateColWidthWhenReady();
            initMutationObserver();
        } else if (retries > 0) {
            setTimeout(() => tryBind(retries - 1), 100);
        }
    }
    tryBind(20);
}

// ============================================================
// 点按 / 点击翻页判断与处理引擎
// ============================================================
let lastPageTurnTime = 0;
let lastTouchEndTime = 0;

function isInteractiveTarget(targetEl, settings, chat) {
    lastInteractiveMatchReason = '';
    if (!targetEl || !chat) return false;
    const el = targetEl.nodeType === 3 ? targetEl.parentElement : targetEl;
    if (!el || !chat.contains(el)) return false;

    // 装饰层穿透：若 pointer-events 为 none，说明是装饰性容器，不响应交互
    try {
        if (getComputedStyle(el).pointerEvents === 'none') return false;
    } catch {}

    // Tool Call 防误触
    if (settings?.toolCallPreventFlip !== false) {
        const tcSel = settings?.toolCallSelector?.trim() || '.mes.toolCall, .mes[is_system="true"].toolCall';
        try {
            if (el.closest(tcSel) || el.closest('.twt-toolcall-mes')) {
                lastInteractiveMatchReason = 'toolCall';
                return true;
            }
        } catch {
            if (el.closest('.mes.toolCall') || el.closest('.twt-toolcall-mes')) {
                lastInteractiveMatchReason = 'toolCall';
                return true;
            }
        }
    }

    // 生图拓展防误触：ST-BaiBai-Image（柏宝绘）
    try {
        if (el.closest('div[data-bbi-slot], [data-bbi-slot], .bbi-figure, #bbi-app-host')) {
            lastInteractiveMatchReason = 'bbi-image';
            return true;
        }
    } catch {}

    // 用户自定义白名单
    if (settings?.customWhitelist?.trim()) {
        try {
            if (el.closest(settings.customWhitelist.trim())) {
                lastInteractiveMatchReason = 'customWhitelist';
                return true;
            }
        } catch {}
    }

    // 明确的真实交互控件（排除容器如 .mes, .mes_block, .mes_text 等）
    const baseSelector = 'button, a, input, textarea, select, label, summary, [onclick], .mes_button, .swipe-button, .swipe_left, .swipe_right, .ch_name, .avatar, img, video, audio, .svg-icon';
    const matchedBase = el.closest(baseSelector);
    if (matchedBase) {
        lastInteractiveMatchReason = 'baseSelector:' + describeEl(matchedBase);
        return true;
    }

    // 针对具有 role="button" 或带合法 tabindex 的交互控件（严禁误判 .mes 等大容器）
    const customControl = el.closest('[role="button"], [tabindex]');
    if (customControl && customControl !== chat &&
        !customControl.classList.contains('mes') &&
        !customControl.classList.contains('mes_block') &&
        !customControl.classList.contains('mes_text')) {
        const tabIdx = customControl.getAttribute('tabindex');
        // tabindex="-1" 仅用于程序化聚焦，不视为交互控件
        if (tabIdx !== '-1') {
            lastInteractiveMatchReason = 'role/tabindex:' + describeEl(customControl);
            return true;
        }
    }

    // 仅针对目标元素本身（非大容器）检查是否为 pointer 光标
    if (el !== chat && !el.classList.contains('mes') && !el.classList.contains('mes_block') && !el.classList.contains('mes_text')) {
        try {
            const cur = getComputedStyle(el).cursor;
            if (cur === 'pointer' || cur === 'zoom-in' || cur === 'zoom-out') {
                lastInteractiveMatchReason = 'cursor:' + cur + ':' + describeEl(el);
                return true;
            }
        } catch {}
    }

    return false;
}

const PAGE_FLIP_COOLDOWN_MS = 220;

/**
 * 记录"用户刚刚翻过页"的时间点。
 * 手机上连续快速点两下翻页会被浏览器当成双击（dblclick），
 * 段评模块据此判断：刚翻过页的双击不是想打开段评，直接忽略。
 */
function markUserPageFlip() {
    window.__twtLastUserFlipTime = Date.now();
}

function handlePageFlip(clientX, targetEl, settings) {
    if (!settings?.enabled) return false;
    if (!document.body.classList.contains('twt-reading-mode')) return false;

    // 关键防线：杜绝手机端主线程卡顿/丢帧后操作系统事件队列暴风骤雨式瞬间释放排队触摸事件（曾导致 13ms 连击跨越 20 页狂跳）
    const now = Date.now();
    if (now - lastPageTurnTime < PAGE_FLIP_COOLDOWN_MS) {
        twtDiagLog('FLIP_DROP_BURST', `丢弃冷却期内连击/排队事件 gap=${now - lastPageTurnTime}ms`);
        return false;
    }
    if (targetEl?.closest?.('#twt-diag-panel')) return false;
    if (document.body.classList.contains('twt-paragraph-editing')) {
        twtDiagLog('FLIP_REJECT', 'reason=paragraph-editing');
        return false;
    }
    if (document.body.classList.contains('twt-excerpt-active')) {
        twtDiagLog('FLIP_REJECT', 'reason=excerpt-active');
        return false;
    }

    // 自定义菜单显示中，不翻页
    const menu = document.getElementById('twt-custom-menu');
    if (menu && getComputedStyle(menu).display !== 'none') {
        twtDiagLog('FLIP_REJECT', 'reason=custom-menu-open');
        return false;
    }

    // HTML / Iframe 浮窗弹窗召出中，或最近刚收起弹窗时，不翻页
    if (document.body.classList.contains('twt-html-popup-active') ||
        document.getElementById('twt-html-app-modal') ||
        (Date.now() - (window.__twtLastHtmlModalCloseTime || 0) < 450)) {
        twtDiagLog('FLIP_REJECT', 'reason=html-popup-active');
        return false;
    }

    const chat = getChat();
    if (!chat) return false;
    if (targetEl && !chat.contains(targetEl) && targetEl !== chat) {
        twtDiagLog('FLIP_REJECT', `reason=outside-chat target=${describeEl(targetEl)}`);
        return false;
    }

    // 点击加载更多历史消息按钮
    const showMoreClicked = targetEl?.closest?.('#show_more_messages');
    if (showMoreClicked) {
        twtDiagLog('FLIP_SHOW_MORE', '点击 #show_more_messages');
        triggerLoadMoreMessages(false);
        return true;
    }

    if (isInteractiveTarget(targetEl, settings, chat)) {
        twtDiagLog('FLIP_REJECT', `reason=interactive(${lastInteractiveMatchReason}) target=${describeEl(targetEl)}`);
        return false;
    }

    // 有文字选区时不翻页
    if (window.getSelection && window.getSelection().toString().trim().length > 0) {
        twtDiagLog('FLIP_REJECT', 'reason=text-selection');
        return false;
    }

    const cw = getColWidth(chat);
    if (cw <= 0) {
        twtDiagLog('FLIP_REJECT', 'reason=cw<=0');
        return false;
    }

    // 按聊天区自身的宽度划分左右点按区。手机上聊天区占满屏幕，效果和按窗口算一样；
    // 电脑上聊天区居中，按整个窗口算的话左右 30% 根本落不到聊天区里，点击永远翻不了页。
    const chatRect = chat.getBoundingClientRect();
    const winW = window.innerWidth || document.documentElement.clientWidth || 1;
    const ratio = chatRect.width > 0 ? (clientX - chatRect.left) / chatRect.width : clientX / winW;

    if (ratio < 0.3) {
        if (isInputFocused()) {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
        }
        userInteractedSinceSwitch = true;
        isChatRestoring = false;
        clearTimeout(chatRestoreSettleTimer);
        hideLoadingOverlay();
        unlockReadingPosition();
        slideFloorWindowIfNeeded(chat, cw, 'left');
        const curPage = getSyncedCurrentPage(chat, cw);
        markUserPageFlip();
        twtDiagLog('FLIP_LEFT', `ratio=${ratio.toFixed(2)} curP=${curPage} target=${describeEl(targetEl)}`);
        if (curPage <= 0 && winStartIdx <= 0 && document.getElementById('show_more_messages')) {
            triggerLoadMoreMessages(true);
            return true;
        }
        scrollToPage(chat, curPage - 1, cw);
        return true;
    } else if (ratio > 0.7) {
        if (isInputFocused()) {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
        }
        userInteractedSinceSwitch = true;
        isChatRestoring = false;
        clearTimeout(chatRestoreSettleTimer);
        hideLoadingOverlay();
        unlockReadingPosition();
        slideFloorWindowIfNeeded(chat, cw, 'right');
        const curPage = getSyncedCurrentPage(chat, cw);
        markUserPageFlip();
        twtDiagLog('FLIP_RIGHT', `ratio=${ratio.toFixed(2)} curP=${curPage} target=${describeEl(targetEl)}`);
        scrollToPage(chat, curPage + 1, cw);
        return true;
    }
    twtDiagLog('FLIP_CENTER_NOOP', `点击中间区域不翻页 ratio=${ratio.toFixed(2)} target=${describeEl(targetEl)}`);
    return false;
}

// ============================================================
// initPaginationEvent：全局一次性初始化（不随聊天切换重建）
// ============================================================
export function initPaginationEvent(getSettings) {

    // 用户在侧栏/抽屉点击角色或聊天记录切换时，第一时间打上遮罩使 #chat 彻底静默，酒馆清屏期间 0 毫秒闪烁
    const onNavClick = (e) => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const t = e.target;
        if (t && t.closest && t.closest('.character_select, .chat_select, .select_chat_block, .select_chat_block_wrapper, [chat_id], [chid], [data-chid], [data-grid], #select_chat, #chat_list, .group_select, #rm_char_group_popup, .menu_button_chat, #dialogue_del_mes')) {
            isChatRestoring = true;
            userInteractedSinceSwitch = false;
            userExplicitlyFocusedInput = false;
            lastChatSwitchTime = Date.now();
            chatRestoreTarget = { mode: 'end' };
            twtDiagEpoch = Date.now();
            showLoadingOverlay();
            twtDiagLog('NAV_CLICK', `点击切换聊天/角色 target=${describeEl(t)}`);
        }
    };
    document.addEventListener('click', onNavClick, true);
    try {
        if (window.parent && window.parent.document && window.parent.document !== document) {
            window.parent.document.addEventListener('click', onNavClick, true);
        }
    } catch {}

    // ---- 监听 html_popup 异步隐藏代码块完成事件，实时同步页数与视口 ----
    window.addEventListener('twt:html-apps-hidden', () => {
        const chat = getChat();
        if (!chat || !document.body.classList.contains('twt-reading-mode')) return;
        const cw = stableColWidth > 0 ? stableColWidth : getColStep(chat);
        if (cw <= 0) return;
        if (!userInteractedSinceSwitch && !isGenerating && !isLoadingMoreMessages && chatRestoreTarget) {
            applyRestoreTarget(chat, cw);
        } else {
            getSyncedCurrentPage(chat, cw);
            updateActiveReadingAnchor(true);
        }
    });

    // ---- 点击翻页（使用捕获阶段监听，防止子元素或外部框架 stopPropagation 拦截）----
    const onDocumentClick = (e) => {
        if (e.target?.closest?.('#twt-diag-panel')) return;
        const now = Date.now();
        // 触摸后浏览器补发的 click 由 lastTouchEndTime 判断；鼠标连点只需和其他翻页方式一样的冷却时间，
        // 原先固定 450ms 会让电脑上稍快的连续点击每隔一下就被吞掉。
        if (now - lastPageTurnTime < PAGE_FLIP_COOLDOWN_MS || now - lastTouchEndTime < 800) {
            twtDiagLog('DOC_CLICK_SKIP', `忽略触摸后合成click dtTurn=${now - lastPageTurnTime}ms dtTouch=${now - lastTouchEndTime}ms`);
            return;
        }
        twtDiagLog('DOC_CLICK', `x=${Math.round(e.clientX)} target=${describeEl(e.target)}`);
        const handled = handlePageFlip(e.clientX, e.target, getSettings());
        if (handled) {
            lastPageTurnTime = Date.now();
        }
    };

    document.addEventListener('click', onDocumentClick, true);

    try {
        if (window.parent && window.parent.document && window.parent.document !== document) {
            window.parent.document.addEventListener('click', onDocumentClick, true);
        }
    } catch {}

    // 初次绑定 #chat 上的 scroll / touch 事件
    bindScrollEvents(getSettings);
}

// ============================================================
// bindScrollEvents：绑定 #chat 的 scroll / touch 事件
// ============================================================
function bindScrollEvents(getSettings) {
    const chat = getChat();
    if (!chat) return;

    if (scrollEventsAbortController) scrollEventsAbortController.abort();
    scrollEventsAbortController = new AbortController();
    const signal = scrollEventsAbortController.signal;

    // ---- Scroll snap 校正 ----
    // 优先使用 scrollend；不支持时降级为 scroll + debounce
    const supportsScrollend = 'onscrollend' in window;

    if (supportsScrollend) {
        chat.addEventListener('scrollend', () => {
            if (isTouching || isScrolling) return;
            doSnap(chat);
        }, { signal });
    }

    chat.addEventListener('scroll', () => {
        const curSL = chat.scrollLeft;
        const prevObs = twtDiagLastObservedSL;
        twtDiagLastObservedSL = curSL;
        if (!isTouching && !isScrolling && Math.abs(curSL - (twtDiagLastJsSetSL ?? curSL)) > 2) {
            twtDiagLog('⚠️NATIVE_SCROLL', `非JS触发的浏览器原生滚动! prevSL=${Math.round(prevObs)} -> curSL=${Math.round(curSL)} (lastJsSL=${Math.round(twtDiagLastJsSetSL ?? -1)})`);
        }

        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (isInputFocused()) return;
        if (isScrolling || isTouching || isGenerating || isLoadingMoreMessages) return;
        // 切入聊天且用户尚未操作时，若发生非预期的原生滚动，立即拉回恢复目标
        if (!userInteractedSinceSwitch && chatRestoreTarget) {
            const cw = stableColWidth > 0 ? stableColWidth : (chat.clientWidth || 0);
            if (cw > 0) applyRestoreTarget(chat, cw);
            return;
        }

        clearTimeout(snapTimer);
        // 防抖 snap：80ms 后校验并拦截非触摸/非程序翻页引起的浏览器异常跳页
        snapTimer = setTimeout(() => {
            if (!isTouching && !isScrolling) {
                doSnap(chat);
            }
        }, 80);
    }, { signal });

    // ---- 触摸滑动与点按翻页 ----
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartLeft = 0;
    let touchStartTime = 0;
    let touchIsHorizontal = null; // null=未判定, true=横, false=纵
    let touchStartPage = 0;
    let touchMaxScroll = 0;
    let touchTotalPages = 1;
    let touchMoved = false;
    let touchFallbackTimer = null;
    let activeTouchCleanup = null;
    let touchMoveRafId = null;
    let pendingTouchScrollLeft = null;

    const cancelPendingTouchCleanup = () => {
        if (touchFallbackTimer) {
            clearTimeout(touchFallbackTimer);
            touchFallbackTimer = null;
        }
        if (activeTouchCleanup && supportsScrollend) {
            chat.removeEventListener('scrollend', activeTouchCleanup);
            activeTouchCleanup = null;
        }
        if (touchMoveRafId) {
            cancelAnimationFrame(touchMoveRafId);
            touchMoveRafId = null;
        }
        pendingTouchScrollLeft = null;
    };

    chat.addEventListener('touchstart', e => {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-paragraph-editing')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;
        if (document.body.classList.contains('twt-html-popup-active') ||
            document.getElementById('twt-html-app-modal') ||
            (Date.now() - (window.__twtLastHtmlModalCloseTime || 0) < 450)) {
            return;
        }
        const settings = getSettings();
        if (!settings?.enabled) return;

        // 关键修复：立即清除上一轮翻页遗留的 600ms fallback 与 scrollend 监听，防止快速连续翻页时中途把 isTouching 误置为 false 导致卡死！
        cancelPendingTouchCleanup();
        clearTimeout(snapTimer);
        clearTimeout(scrollUnlockTimer);
        unlockReadingPosition();
        isTouching = true;
        isScrolling = false;
        touchMoved = false;

        touchStartX    = e.touches[0].clientX;
        touchStartY    = e.touches[0].clientY;
        touchStartLeft = chat.scrollLeft;
        touchStartTime = Date.now();
        touchIsHorizontal = null;

        const cw = stableColWidth > 0 ? stableColWidth : getColWidth(chat);
        if (cw > 0) {
            slideFloorWindowIfNeeded(chat, cw, 'auto');
        }
        const sw = chat.scrollWidth || (cw * touchTotalPages);
        if (sw > 0) lastKnownScrollWidth = sw;
        touchTotalPages = cw > 0 ? Math.max(1, Math.round(sw / cw)) : 1;
        touchStartPage = cw > 0 ? getSyncedCurrentPage(chat, cw) : 0;
        touchStartLeft = touchStartPage * cw;
        touchMaxScroll = Math.max(0, sw - (cw > 0 ? cw : (chat.clientWidth || 100)));
        twtDiagLog('TOUCH_START', `x=${Math.round(touchStartX)} y=${Math.round(touchStartY)} startP=${touchStartPage}/${touchTotalPages} target=${describeEl(e.target)}`);
    }, { passive: true, signal });

    chat.addEventListener('touchmove', e => {
        if (!isTouching) return;
        if (!document.body.classList.contains('twt-reading-mode')) return;
        if (document.body.classList.contains('twt-excerpt-active')) return;
        if (document.body.classList.contains('twt-html-popup-active') ||
            document.getElementById('twt-html-app-modal')) {
            return;
        }
        const settings = getSettings();
        if (!settings?.enabled) return;

        const adx = Math.abs(e.touches[0].clientX - touchStartX);
        const ady = Math.abs(e.touches[0].clientY - touchStartY);

        if (adx > 14 || ady > 14) {
            touchMoved = true;
        }

        if (!settings.swipeEnabled) return;

        // 方向判定（首次移动 14px 以上才判定为拖拽滑动，避免手指点按微动误入滑动分支导致点击翻页失灵）
        if (touchIsHorizontal === null) {
            if (adx > 14 || ady > 14) touchIsHorizontal = adx >= ady;
            return;
        }
        if (!touchIsHorizontal) return;

        userInteractedSinceSwitch = true;
        isChatRestoring = false;
        clearTimeout(chatRestoreSettleTimer);
        hideLoadingOverlay();

        const dx = e.touches[0].clientX - touchStartX;
        pendingTouchScrollLeft = Math.max(0, Math.min(touchMaxScroll, touchStartLeft - dx));
        // 使用 rAF 合并同一渲染帧内的多次 touchmove，避免移动端 120Hz/240Hz 触控采样在超高楼层多列容器中每帧多次写 scrollLeft 造成主线程合成阻塞
        if (!touchMoveRafId) {
            touchMoveRafId = requestAnimationFrame(() => {
                touchMoveRafId = null;
                if (isTouching && pendingTouchScrollLeft !== null) {
                    chat.scrollLeft = pendingTouchScrollLeft;
                }
            });
        }
    }, { passive: true, signal });

    chat.addEventListener('touchend', e => {
        lastTouchEndTime = Date.now();
        if (!isTouching) return;

        if (touchMoveRafId) {
            cancelAnimationFrame(touchMoveRafId);
            touchMoveRafId = null;
        }
        pendingTouchScrollLeft = null;

        const wasHorizontal = touchIsHorizontal;
        const didMove = touchMoved;
        touchIsHorizontal = null;
        touchMoved = false;

        if (!document.body.classList.contains('twt-reading-mode') ||
            document.body.classList.contains('twt-paragraph-editing') ||
            document.body.classList.contains('twt-excerpt-active')) {
            isTouching = false; return;
        }
        const settings = getSettings();
        if (!settings?.enabled) {
            isTouching = false; return;
        }

        const touchEndX = e.changedTouches?.[0]?.clientX ?? touchStartX;
        const touchEndY = e.changedTouches?.[0]?.clientY ?? touchStartY;
        const dt = Date.now() - touchStartTime;
        const dist = Math.hypot(touchEndX - touchStartX, touchEndY - touchStartY);
        twtDiagLog('TOUCH_END', `dx=${Math.round(touchEndX - touchStartX)} dy=${Math.round(touchEndY - touchStartY)} dt=${dt}ms dist=${Math.round(dist)} wasH=${wasHorizontal}`);

        // 1. 点按翻页优先判定（Tap Detection）：
        // 移动端拇指点击屏幕边缘翻页时常伴随 8~24px 的微小滚动，若总位移 < 24px 且触碰时间 < 450ms，一律优先作为点按翻页处理！
        if (dt < 450 && dist < 24) {
            isTouching = false;
            if (Date.now() - lastPageTurnTime < PAGE_FLIP_COOLDOWN_MS) {
                twtDiagLog('TAP_DROP_BURST', `丢弃冷却期内点击 gap=${Date.now() - lastPageTurnTime}ms`);
                return;
            }
            const targetEl = e.target || document.elementFromPoint(touchEndX, touchEndY);
            const handled = handlePageFlip(touchEndX, targetEl, settings);
            if (handled) {
                lastPageTurnTime = Date.now();
                return;
            }
            // 若点击在中间非翻页区但 touchmove 产生了轻微偏移，复原到起始页
            if (wasHorizontal && Math.abs(chat.scrollLeft - touchStartLeft) > 1) {
                const cw = getColWidth(chat);
                if (cw > 0) scrollToPage(chat, touchStartPage, cw, touchTotalPages);
            }
            return;
        }

        // 2. 横向滑动翻页处理
        if (wasHorizontal && settings.swipeEnabled) {
            userInteractedSinceSwitch = true;
            isChatRestoring = false;
            clearTimeout(chatRestoreSettleTimer);

            const cw = getColWidth(chat);
            if (cw <= 0) { isTouching = false; return; }

            markUserPageFlip();
            const dx        = touchEndX - touchStartX;
            const fastSwipe = dt < 350 && Math.abs(dx) > 24;
            const longSwipe = Math.abs(dx) > cw * 0.22;

            let targetPage;
            if (fastSwipe || longSwipe) {
                targetPage = dx > 0 ? touchStartPage - 1 : touchStartPage + 1;
            } else {
                // 未超阈值：吸附到最近整页（但限制在 startPage ± 1）
                const nearest = Math.round(chat.scrollLeft / cw);
                targetPage = Math.max(touchStartPage - 1, Math.min(touchStartPage + 1, nearest));
            }

            if (targetPage <= 0 && winStartIdx > 0) {
                const slid = slideFloorWindowIfNeeded(chat, cw, 'left');
                if (slid) {
                    touchTotalPages = Math.max(1, Math.round(lastKnownScrollWidth / cw));
                    targetPage = Math.max(0, lastUserPage - 1);
                }
            } else if (targetPage >= touchTotalPages - 1 && winEndIdx < totalDomMesCount - 1) {
                const slid = slideFloorWindowIfNeeded(chat, cw, 'right');
                if (slid) {
                    touchTotalPages = Math.max(1, Math.round(lastKnownScrollWidth / cw));
                    targetPage = Math.min(touchTotalPages - 1, lastUserPage + 1);
                }
            }

            if (targetPage < 0) {
                if (winStartIdx <= 0 && document.getElementById('show_more_messages')) {
                    isTouching = false;
                    isScrolling = false;
                    triggerLoadMoreMessages(true);
                    return;
                }
            }

            isTouching = false;
            scrollToPage(chat, targetPage, cw, touchTotalPages);
            return;
        }

        isTouching = false;
    }, { passive: true, signal });

    chat.addEventListener('touchcancel', () => {
        cancelPendingTouchCleanup();
        isTouching        = false;
        isScrolling       = false;
        touchIsHorizontal = null;
        touchMoved        = false;
    }, { passive: true, signal });
}
