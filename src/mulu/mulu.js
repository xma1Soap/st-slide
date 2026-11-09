// @ts-nocheck
import { extension_settings, getContext } from '../../../../../extensions.js';
import { showMoreMessages } from '../../../../../../script.js';
import { setLastUserPage, realignPagination, getColStep, setExplicitJumpLoading, updateActiveReadingAnchor, activateWindowForMessage } from '../pagination/pagination.js?v=1.0.26';

// ============================================================
// P2 & P3：TauriTavern Store & Search API 接入层
// 完全可选：标准 SillyTavern 上静默降级，不影响任何原版逻辑
// ============================================================
const MULU_NS  = 'twt-mulu';
const MULU_KEY = 'mulu-meta';

async function getMuluTTHandle() {
    try {
        const win = typeof getWin === 'function' ? getWin() : window;
        const tt = win.__TAURITAVERN__ || window.__TAURITAVERN__ || window.parent?.__TAURITAVERN__ || window.top?.__TAURITAVERN__;
        if (!tt) return null;
        await (tt.ready ?? tt.__TAURITAVERN_MAIN_READY__);
        return tt.api?.chat?.current?.handle?.() ?? null;
    } catch {
        return null;
    }
}


function positionDropdown(dropdown, anchor, parentDoc, options = {}) {
    const { width = 130, height = 0, clientX = null, clientY = null } = options;
    const bodyRect = parentDoc.body.getBoundingClientRect();
    const viewportWidth = parentDoc.documentElement.clientWidth;
    const viewportHeight = parentDoc.documentElement.clientHeight;

    let left, top;
    if (clientX !== null && clientY !== null) {
        left = clientX - bodyRect.left;
        top = clientY - bodyRect.top;
    } else {
        const rect = anchor.getBoundingClientRect();
        left = rect.left - bodyRect.left;
        top = rect.bottom - bodyRect.top + 4;
    }

    if (left + width > viewportWidth - 10) {
        if (anchor && clientX === null) {
            left = anchor.getBoundingClientRect().right - bodyRect.left - width;
        } else {
            left = viewportWidth - width - 10;
        }
    }
    if (left < 10) left = 10;

    if (height > 0 && top + height > viewportHeight - 10) {
        top = viewportHeight - height - 10;
    }
    if (top < 10) top = 10;

    dropdown.style.left = left + 'px';
    dropdown.style.top = top + 'px';
}

let _muluStoreCache = null;
let _muluStoreCacheChatId = null;

async function getMuluStore(handle) {
    const context = typeof getContext === 'function' ? getContext() : null;
    const chatId = context ? context.chatId : 'default';
    if (_muluStoreCache !== null && _muluStoreCacheChatId === chatId) {
        return _muluStoreCache;
    }
    try {
        const keys = await handle.store.listKeys({ namespace: MULU_NS });
        if (Array.isArray(keys) && keys.includes(MULU_KEY)) {
            const data = await handle.store.getJson({ namespace: MULU_NS, key: MULU_KEY });
            _muluStoreCache = data ?? { tabs: {}, titles: {} };
        } else {
            _muluStoreCache = { tabs: {}, titles: {} };
        }
        _muluStoreCacheChatId = chatId;
        return _muluStoreCache;
    } catch {
        _muluStoreCache = { tabs: {}, titles: {} };
        _muluStoreCacheChatId = chatId;
        return _muluStoreCache;
    }
}

async function saveMuluStore(handle, data) {
    try {
        const context = typeof getContext === 'function' ? getContext() : null;
        _muluStoreCache = data;
        _muluStoreCacheChatId = context ? context.chatId : 'default';
        await handle.store.setJson({ namespace: MULU_NS, key: MULU_KEY, value: data });
    } catch (e) {
        console.warn('[TwT/mulu] Failed to save mulu store:', e);
    }
}

export function invalidateMuluStoreCache() {
    _muluStoreCache = null;
    _muluStoreCacheChatId = null;
}

async function getMuluTabOf(mesId, msgObj) {
    const handle = await getMuluTTHandle();
    if (handle) {
        const store = await getMuluStore(handle);
        const storeVal = store?.tabs?.[String(mesId)];
        if (storeVal !== undefined) return storeVal;
        if (msgObj?.extra?.twtMuluTab) {
            const tab = msgObj.extra.twtMuluTab;
            store.tabs = store.tabs || {};
            store.tabs[String(mesId)] = tab;
            delete msgObj.extra.twtMuluTab;
            saveMuluStore(handle, store);
            return tab;
        }
        return undefined;
    }
    return msgObj?.extra?.twtMuluTab;
}

async function setMuluTabOf(mesId, msgObj, tab, context) {
    const handle = await getMuluTTHandle();
    if (handle) {
        const store = await getMuluStore(handle);
        store.tabs = store.tabs || {};
        if (tab === null || tab === undefined) {
            delete store.tabs[String(mesId)];
        } else {
            store.tabs[String(mesId)] = tab;
        }
        await saveMuluStore(handle, store);
        return;
    }
    if (msgObj) {
        msgObj.extra = msgObj.extra || {};
        if (tab === null || tab === undefined) {
            delete msgObj.extra.twtMuluTab;
        } else {
            msgObj.extra.twtMuluTab = tab;
        }
    }
    if (context && typeof context.saveChat === 'function') {
        await context.saveChat();
    }
}

async function batchSetMuluTab(mesIds, tab, chatArray, context) {
    const handle = await getMuluTTHandle();
    if (handle) {
        const store = await getMuluStore(handle);
        store.tabs = store.tabs || {};
        mesIds.forEach(id => {
            if (tab === null || tab === undefined) {
                delete store.tabs[String(id)];
            } else {
                store.tabs[String(id)] = tab;
            }
        });
        await saveMuluStore(handle, store);
        return;
    }
    mesIds.forEach(id => {
        const msg = chatArray?.[id];
        if (!msg) return;
        msg.extra = msg.extra || {};
        if (tab === null || tab === undefined) {
            delete msg.extra.twtMuluTab;
        } else {
            msg.extra.twtMuluTab = tab;
        }
    });
    if (context && typeof context.saveChat === 'function') {
        await context.saveChat();
    }
}

async function setMuluTitleOf(mesId, msgObj, title, context) {
    const handle = await getMuluTTHandle();
    if (handle) {
        const store = await getMuluStore(handle);
        store.titles = store.titles || {};
        if (!title) {
            delete store.titles[String(mesId)];
        } else {
            store.titles[String(mesId)] = title;
        }
        await saveMuluStore(handle, store);
        return;
    }
    if (msgObj) {
        msgObj.extra = msgObj.extra || {};
        if (!title) {
            delete msgObj.extra.twtMuluTitle;
        } else {
            msgObj.extra.twtMuluTitle = title;
        }
    }
    if (context && typeof context.saveChat === 'function') {
        await context.saveChat();
    }
}

/**
 * P3：使用 TauriTavern Rust 全文检索能力检索消息
 */

function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
}

/**
 * P3：使用 TauriTavern Rust 全文检索能力检索消息，返回 Map<mesId, SearchHit>
 */
async function searchMuluMessagesMap(query) {
    if (!query) return null;
    const handle = await getMuluTTHandle();
    if (!handle || typeof handle.searchMessages !== 'function') return null;
    try {
        const hits = await handle.searchMessages({
            query: query,
            limit: 200,
            filters: { role: 'assistant' }
        });
        if (Array.isArray(hits)) {
            const hitMap = new Map();
            hits.forEach(h => hitMap.set(h.index, h));
            return hitMap;
        }
    } catch (e) {
        console.warn('[TwT/mulu] Rust searchMessages failed, fallback to local search:', e);
    }
    return null;
}

function extractMatches(text, query, rustSnippet) {
    const hits = [];
    if (!text || !query) return hits;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;

    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
        const start = Math.max(0, pos - 25);
        const end = Math.min(text.length, pos + query.length + 25);
        let snippetText = text.substring(start, end);
        if (start > 0) snippetText = '...' + snippetText;
        if (end < text.length) snippetText = snippetText + '...';

        hits.push({
            charIndex: pos,
            snippet: snippetText
        });

        pos += lowerQuery.length;
        if (hits.length >= 5) break; // Limit max 5 snippets per row
    }

    if (hits.length === 0 && rustSnippet) {
        hits.push({ charIndex: 0, snippet: rustSnippet });
    }

    return hits;
}

async function jumpToMessagePosition(mesId, charIndex = 0, totalLength = 1) {
    const mes = await ensureMessageLoaded(mesId);
    if (!mes) return;
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;

    if (doc.body.classList.contains('twt-reading-mode')) {
        chatContainer.scrollTop = 0;
        const chatRect = chatContainer.getBoundingClientRect();
        const step = (typeof getColStep === 'function' ? getColStep(chatContainer) : 0) || chatContainer.getBoundingClientRect().width;
        const currentScrollLeft = chatContainer.scrollLeft;
        const rect = mes.getBoundingClientRect();
        const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
        
        const ratio = totalLength > 0 ? Math.min(1, Math.max(0, charIndex / totalLength)) : 0;
        const targetOffsetLeft = absoluteLeft + (rect.width * ratio);
        
        const targetPage = Math.max(0, Math.floor(targetOffsetLeft / step));
        chatContainer.scrollTo({ left: targetPage * step, behavior: 'auto' });
        setLastUserPage(targetPage);
        chatContainer.scrollTop = 0;
        if (typeof updateActiveReadingAnchor === 'function') updateActiveReadingAnchor();
    } else {
        mes.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
}

function renderRowSnippetsAndPageBadges(rowEl, mesId, query, hits, fullText) {
    const doc = getDoc();
    const snippetBox = doc.createElement('div');
    snippetBox.className = 'twt-mulu-snippet-container';
    snippetBox.style.cssText = `
        margin-top: 6px;
        padding: 5px 8px;
        background: rgba(255, 255, 255, 0.04);
        border-left: 2px solid var(--SmartThemeUnderlineColor, #007aff);
        border-radius: 4px;
        font-size: 0.82em;
        display: flex;
        flex-direction: column;
        gap: 4px;
        cursor: default;
        width: 100%;
        box-sizing: border-box;
    `;

    snippetBox.addEventListener('click', (e) => e.stopPropagation());

    hits.forEach((hit, idx) => {
        const itemDiv = doc.createElement('div');
        itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%;';

        const escapedQuery = escapeRegExp(query);
        const highlighted = escapeHtml(hit.snippet).replace(
            new RegExp(escapedQuery, 'gi'),
            (m) => `<span style="color: var(--SmartThemeUnderlineColor, #007aff); font-weight: bold; background: rgba(0, 122, 255, 0.15); padding: 0 2px; border-radius: 2px;">${m}</span>`
        );

        const textSpan = doc.createElement('span');
        textSpan.innerHTML = highlighted;
        textSpan.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.88; text-align: left;';

        const jumpBtn = doc.createElement('button');
        jumpBtn.className = 'menu_button';
        jumpBtn.style.cssText = 'padding: 1px 6px !important; margin: 0 !important; font-size: 0.78em !important; min-height: 20px !important; height: 20px !important; border-radius: 4px !important; background: var(--SmartThemeUnderlineColor, #007aff) !important; color: #fff !important; border: none !important; flex-shrink: 0 !important; font-weight: bold !important; cursor: pointer !important;';
        
        const label = hits.length > 1 ? `位置 ${idx + 1}` : '跳转';
        jumpBtn.innerText = label;

        jumpBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeMuluModal();
            await jumpToMessagePosition(mesId, hit.charIndex, fullText.length);
        });

        itemDiv.appendChild(textSpan);
        itemDiv.appendChild(jumpBtn);
        snippetBox.appendChild(itemDiv);
    });

    rowEl.appendChild(snippetBox);
}

async function searchMuluMessages(query) {
    if (!query) return null;
    const handle = await getMuluTTHandle();
    if (!handle || typeof handle.searchMessages !== 'function') return null;
    try {
        const hits = await handle.searchMessages({
            query: query,
            limit: 200,
            filters: { role: 'assistant' }
        });
        if (Array.isArray(hits)) {
            const hitSet = new Set(hits.map(h => h.index));
            return hitSet;
        }
    } catch (e) {
        console.warn('[TwT/mulu] Rust searchMessages failed, fallback to local search:', e);
    }
    return null;
}


const BTN_START_ID = 'twt-mulu-start-btn';
const BTN_END_ID = 'twt-mulu-end-btn';
const BTN_TOC_ID = 'twt-mulu-toc-btn';

const escapeHtml = (str) => (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function isToolCallMessage(msg) {
    if (!msg) return false;
    if (msg.extra?.tool_invocations && msg.extra.tool_invocations.length > 0) return true;
    if (msg.extra?.type === 'toolCall' || msg.extra?.isSmallSys === true) return true;
    if (typeof msg.mes === 'string' && (msg.mes.includes('<details><summary>Tool calls:') || msg.mes.includes('Tool calls:'))) {
        return true;
    }
    return false;
}

function getToolNames(msg) {
    if (!msg) return '';
    if (Array.isArray(msg.extra?.tool_invocations) && msg.extra.tool_invocations.length > 0) {
        const names = msg.extra.tool_invocations.map(t => t.displayName || t.name || '').filter(Boolean);
        if (names.length > 0) return names.join(', ');
    }
    if (typeof msg.mes === 'string') {
        const match = msg.mes.match(/<summary>Tool calls:\s*([^<]+)<\/summary>/i);
        if (match && match[1]) return match[1].trim();
        const plainMatch = msg.mes.match(/Tool calls:\s*([^\r\n]+)/i);
        if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
    }
    return '';
}

// 模块级全局变量，保证目录模态框关闭后重新打开时日志和生成状态依然存在
let globalBatchLogs = [];
let globalGenerationStatus = 'idle'; // 'idle', 'generating', 'done'
let currentActiveMuluTab = '全部';

function getDoc() {
    try {
        if (window.parent && window.parent.document) {
            return window.parent.document;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document in mulu.js", e);
    }
    return document;
}

function getWin() {
    try {
        if (window.parent && window.parent.document) {
            return window.parent;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent in mulu.js", e);
    }
    return window;
}

async function ensureMessageLoaded(mesId) {
    const doc = getDoc();
    let targetMes = doc.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (targetMes) {
        if (doc.body.classList.contains('twt-reading-mode') && typeof activateWindowForMessage === 'function') {
            activateWindowForMessage(mesId);
        }
        return targetMes;
    }
    
    // If not found in DOM, load the messages!
    const firstMesEl = doc.querySelector('#chat .mes');
    if (!firstMesEl) return null;
    
    const firstDisplayedMesId = parseInt(firstMesEl.getAttribute('mesid'));
    if (isNaN(firstDisplayedMesId)) return null;
    
    if (mesId < firstDisplayedMesId) {
        const needToLoadCount = firstDisplayedMesId - mesId;
        if (typeof setExplicitJumpLoading === 'function') setExplicitJumpLoading(true);
        try {
            await showMoreMessages(needToLoadCount);
        } catch (e) {
            console.error('Failed to load more messages via showMoreMessages:', e);
            // Fallback: try clicking the show more messages button
            const showMoreBtn = doc.getElementById('show_more_messages');
            if (showMoreBtn) {
                showMoreBtn.click();
                // Wait a tiny bit and check
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } finally {
            if (typeof setExplicitJumpLoading === 'function') setExplicitJumpLoading(false);
        }

        const chat = doc.getElementById('chat');
        if (chat) {
            chat.scrollTop = 0;
            const sheld = doc.getElementById('sheld');
            if (sheld) sheld.scrollTop = 0;
            try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch {}

            if (doc.body.classList.contains('twt-reading-mode') && typeof activateWindowForMessage === 'function') {
                activateWindowForMessage(mesId);
            }

            // 等待双帧完成多列 DOM 实际排版与重绘
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            if (doc.body.classList.contains('twt-reading-mode') && typeof realignPagination === 'function') {
                realignPagination(false);
            }
        }
    }
    
    // Query again
    const loadedMes = doc.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (loadedMes && doc.body.classList.contains('twt-reading-mode') && typeof activateWindowForMessage === 'function') {
        activateWindowForMessage(mesId);
    }
    return loadedMes;
}

function findSiblingAiMessageId(currentId, direction) {
    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray) return -1;
    
    if (direction === 'prev') {
        for (let i = currentId - 1; i >= 0; i--) {
            const msg = chatArray[i];
            if (msg && !msg.is_user && !msg.is_system && !msg.system) {
                return i;
            }
        }
    } else {
        for (let i = currentId + 1; i < chatArray.length; i++) {
            const msg = chatArray[i];
            if (msg && !msg.is_user && !msg.is_system && !msg.system) {
                return i;
            }
        }
    }
    return -1;
}

function getTargetMessage() {
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return null;
    
    const chatRect = chatContainer.getBoundingClientRect();
    const messages = Array.from(doc.querySelectorAll('#chat .mes'));
    const aiMessages = messages.filter(m => {
        const isUser = m.classList.contains('user_mes') || m.getAttribute('is_user') === 'true';
        const isSystem = m.classList.contains('system_mes') || m.getAttribute('is_system') === 'true';
        const isVisible = m.offsetWidth > 0 || m.offsetHeight > 0;
        return !isUser && !isSystem && isVisible;
    });
    if (aiMessages.length === 0) return null;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        const currentScrollLeft = chatContainer.scrollLeft;
        const cw = chatContainer.getBoundingClientRect().width;
        const pageCenter = currentScrollLeft + (cw / 2);
        
        // Find the AI message that spans the pageCenter
        for (let i = aiMessages.length - 1; i >= 0; i--) {
            const mes = aiMessages[i];
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const absoluteRight = rect.right - chatRect.left + currentScrollLeft;
            if (pageCenter >= absoluteLeft && pageCenter <= absoluteRight) {
                return mes;
            }
        }
        
        // Fallback: closest AI message to the center
        let closestMes = null;
        let minDistance = Infinity;
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
            const absoluteRight = rect.right - chatRect.left + currentScrollLeft;
            const mesCenter = (absoluteLeft + absoluteRight) / 2;
            const dist = Math.abs(mesCenter - pageCenter);
            if (dist < minDistance) {
                minDistance = dist;
                closestMes = mes;
            }
        }
        return closestMes || aiMessages[aiMessages.length - 1];
    } else {
        // Normal vertical scrolling mode - only check visible AI messages!
        const chatCenterY = chatRect.top + chatRect.height / 2;
        let closestMes = null;
        let minDistance = Infinity;
        
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            if (rect.top <= chatRect.bottom && rect.bottom >= chatRect.top) {
                const mesCenterY = rect.top + rect.height / 2;
                const dist = Math.abs(mesCenterY - chatCenterY);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestMes = mes;
                }
            }
        }
        
        if (closestMes) return closestMes;
        
        for (const mes of aiMessages) {
            const rect = mes.getBoundingClientRect();
            if (rect.bottom >= chatRect.top) {
                return mes;
            }
        }
        
        return aiMessages[aiMessages.length - 1];
    }
}

async function scrollToMessageEdge(edge) {
    let mes = getTargetMessage();
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;

    if (!mes) {
        // 未找到活跃 AI 消息，直接瞬间跳到绝对开头或绝对结尾
        if (doc.body.classList.contains('twt-reading-mode')) {
            if (typeof activateWindowForMessage === 'function') activateWindowForMessage(edge);
            const step = (typeof getColStep === 'function' ? getColStep(chatContainer) : 0) || chatContainer.clientWidth || 1;
            if (edge === 'start') {
                chatContainer.scrollLeft = 0;
                setLastUserPage(0);
            } else {
                const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / step) - 1);
                const allMes = chatContainer.querySelectorAll('.mes');
                const lastMes = allMes.length > 0 ? allMes[allMes.length - 1] : null;
                let targetPage = maxPage;
                if (lastMes && (lastMes.offsetWidth > 0 || lastMes.offsetHeight > 0)) {
                    const chatRect = chatContainer.getBoundingClientRect();
                    const rect = lastMes.getBoundingClientRect();
                    const absLeft = rect.left - chatRect.left + chatContainer.scrollLeft;
                    targetPage = Math.max(0, Math.min(maxPage, Math.floor((absLeft + 2) / step)));
                }
                chatContainer.scrollLeft = targetPage * step;
                setLastUserPage(targetPage);
            }
            chatContainer.scrollTop = 0;
            if (typeof updateActiveReadingAnchor === 'function') updateActiveReadingAnchor();
        } else {
            if (edge === 'start') {
                chatContainer.scrollTop = 0;
            } else {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
        return;
    }
    
    const currentId = parseInt(mes.getAttribute('mesid'));
    if (isNaN(currentId)) return;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        chatContainer.scrollTop = 0;
        const chatRect = chatContainer.getBoundingClientRect();
        const step = (typeof getColStep === 'function' ? getColStep(chatContainer) : 0) || chatContainer.clientWidth || 1;
        const currentScrollLeft = chatContainer.scrollLeft;
        const currentPage = Math.round(currentScrollLeft / step);
        
        let targetPage = -1;
        let targetScrollLeft = 0;
        
        for (let attempts = 0; attempts < 2; attempts++) {
            const curScrollLeft = chatContainer.scrollLeft;
            const rect = mes.getBoundingClientRect();
            const absoluteLeft = rect.left - chatRect.left + curScrollLeft;
            const absoluteRight = rect.right - chatRect.left + curScrollLeft;
            
            if (edge === 'start') {
                targetScrollLeft = absoluteLeft;
            } else {
                targetScrollLeft = Math.floor((absoluteRight - 1) / step) * step;
                targetScrollLeft = Math.max(targetScrollLeft, Math.floor(absoluteLeft / step) * step);
            }
            
            targetPage = Math.round(targetScrollLeft / step);
            
            if (targetPage === currentPage && attempts === 0) {
                let siblingId = currentId;
                let loadedMes = null;
                while (true) {
                    siblingId = findSiblingAiMessageId(siblingId, edge === 'start' ? 'prev' : 'next');
                    if (siblingId === -1) break;
                    const tempMes = await ensureMessageLoaded(siblingId);
                    if (tempMes && (tempMes.offsetWidth > 0 || tempMes.offsetHeight > 0)) {
                        loadedMes = tempMes;
                        break;
                    }
                }
                if (loadedMes) {
                    mes = loadedMes;
                    await new Promise(resolve => setTimeout(resolve, 0));
                    continue;
                }
                break;
            } else {
                break;
            }
        }
        
        if (targetPage === currentPage) {
            // 已在边界或未找到相邻 AI 消息 -> 直接瞬间跳到聊天的绝对开头或绝对结尾！
            if (typeof activateWindowForMessage === 'function') activateWindowForMessage(edge);
            if (edge === 'start') {
                chatContainer.scrollLeft = 0;
                setLastUserPage(0);
            } else {
                const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / step) - 1);
                chatContainer.scrollLeft = maxPage * step;
                setLastUserPage(maxPage);
            }
        } else {
            // 即时定位到目标页，0ms 延迟，杜绝 smooth scroll 逐帧插值引发的一页页翻过和严重掉帧！
            chatContainer.scrollLeft = targetPage * step;
            setLastUserPage(targetPage);
        }
        chatContainer.scrollTop = 0;
        if (typeof updateActiveReadingAnchor === 'function') updateActiveReadingAnchor();
    } else {
        // 垂直滚动模式
        const chatRect = chatContainer.getBoundingClientRect();
        const rect = mes.getBoundingClientRect();
        const currentScrollTop = chatContainer.scrollTop;
        
        let shouldJumpToSibling = false;
        if (edge === 'start') {
            const diff = Math.abs(rect.top - chatRect.top);
            if (diff < 15) {
                shouldJumpToSibling = true;
            }
        } else {
            const diff = Math.abs(rect.bottom - chatRect.bottom);
            if (diff < 15) {
                shouldJumpToSibling = true;
            }
        }
        
        if (shouldJumpToSibling) {
            let siblingId = currentId;
            let loadedMes = null;
            while (true) {
                siblingId = findSiblingAiMessageId(siblingId, edge === 'start' ? 'prev' : 'next');
                if (siblingId === -1) break;
                const tempMes = await ensureMessageLoaded(siblingId);
                if (tempMes && (tempMes.offsetWidth > 0 || tempMes.offsetHeight > 0)) {
                    loadedMes = tempMes;
                    break;
                }
            }
            if (loadedMes) {
                mes = loadedMes;
                const newRect = mes.getBoundingClientRect();
                const targetScrollTop = edge === 'start'
                    ? newRect.top - chatRect.top + currentScrollTop
                    : newRect.bottom - chatRect.bottom + currentScrollTop;
                const isFar = Math.abs(targetScrollTop - currentScrollTop) > 1500;
                chatContainer.scrollTo({ top: targetScrollTop, behavior: isFar ? 'auto' : 'smooth' });
                return;
            }
            // Sibling not found or already at edge -> jump to absolute start or end!
            if (edge === 'start') {
                chatContainer.scrollTop = 0;
            } else {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
            return;
        }
        
        const targetScrollTop = edge === 'start'
            ? rect.top - chatRect.top + currentScrollTop
            : rect.bottom - chatRect.bottom + currentScrollTop;
        const isFar = Math.abs(targetScrollTop - currentScrollTop) > 1500;
        chatContainer.scrollTo({ top: targetScrollTop, behavior: isFar ? 'auto' : 'smooth' });
    }
}

function scrollToAbsoluteEdge(edge) {
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;
    if (doc.body.classList.contains('twt-reading-mode')) {
        if (typeof activateWindowForMessage === 'function') activateWindowForMessage(edge);
        chatContainer.scrollTop = 0;
        const step = (typeof getColStep === 'function' ? getColStep(chatContainer) : 0) || chatContainer.clientWidth || 1;
        if (edge === 'start') {
            chatContainer.scrollLeft = 0;
            setLastUserPage(0);
        } else {
            const maxPage = Math.max(0, Math.ceil(chatContainer.scrollWidth / step) - 1);
            const allMes = chatContainer.querySelectorAll('.mes');
            const lastMes = allMes.length > 0 ? allMes[allMes.length - 1] : null;
            let targetPage = maxPage;
            if (lastMes && (lastMes.offsetWidth > 0 || lastMes.offsetHeight > 0)) {
                const chatRect = chatContainer.getBoundingClientRect();
                const rect = lastMes.getBoundingClientRect();
                const absLeft = rect.left - chatRect.left + chatContainer.scrollLeft;
                targetPage = Math.max(0, Math.min(maxPage, Math.floor((absLeft + 2) / step)));
            }
            chatContainer.scrollLeft = targetPage * step;
            setLastUserPage(targetPage);
        }
        chatContainer.scrollTop = 0;
        if (typeof updateActiveReadingAnchor === 'function') updateActiveReadingAnchor();
    } else {
        if (edge === 'start') {
            chatContainer.scrollTop = 0;
        } else {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }
}

function createButton(id, title, iconClass, onClick, onDblClick = null) {
    const doc = getDoc();
    const btn = doc.createElement('div');
    btn.id = id;
    btn.className = 'qr--button menu_button interactable';
    btn.tabIndex = 0;
    btn.role = 'button';
    btn.title = title;
    btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    if (onDblClick) {
        btn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onDblClick();
        });
    }
    return btn;
}

function injectMuluStyles() {
    const doc = getDoc();
    if (doc.getElementById('twt-mulu-styles')) return;
    const style = doc.createElement('style');
    style.id = 'twt-mulu-styles';
    style.innerHTML = `
        #twt-mulu-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.6);
            z-index: 10000;
            backdrop-filter: blur(3px);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #twt-mulu-modal {
            position: relative;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            background: var(--SmartThemeBlurTintColor, rgba(30, 30, 30, 0.95));
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 12px;
            box-shadow: 0 10px 30px var(--SmartThemeShadowColor, rgba(0, 0, 0, 0.5));
            color: var(--SmartThemeBodyColor, #fff);
            z-index: 10001;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            backdrop-filter: blur(10px);
            font-family: var(--SmartThemeFontFamily, sans-serif);
        }
        #twt-mulu-modal button.menu_button {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            color: var(--SmartThemeBodyColor, #fff);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #twt-mulu-modal button.menu_button:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        .twt-mulu-list::-webkit-scrollbar {
            width: 6px;
        }
        .twt-mulu-list::-webkit-scrollbar-track {
            background: transparent;
        }
        .twt-mulu-list::-webkit-scrollbar-thumb {
            background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
            border-radius: 3px;
        }
        .twt-mulu-list::-webkit-scrollbar-thumb:hover {
            background: var(--SmartThemeEmColor, rgba(255, 255, 255, 0.4));
        }
        
        /* 目录分组页签样式 */
        .twt-mulu-tabs {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            background: transparent;
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            overflow-x: auto;
            white-space: nowrap;
            width: 100%;
            box-sizing: border-box;
        }
        .twt-mulu-tabs::-webkit-scrollbar {
            height: 4px;
        }
        .twt-mulu-tabs::-webkit-scrollbar-thumb {
            background: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
            border-radius: 2px;
        }
        .twt-mulu-tab-btn {
            padding: 4px 12px;
            font-size: 0.85em;
            cursor: pointer;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            background: transparent;
            color: var(--SmartThemeBodyColor, #fff);
            border-radius: 999px; /* Capsule shape */
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            user-select: none;
        }
        .twt-mulu-tab-btn.active {
            background: var(--SmartThemeUnderlineColor, #007aff) !important;
            color: #fff !important;
            border-color: var(--SmartThemeUnderlineColor, #007aff) !important;
            font-weight: bold;
        }
        .twt-mulu-tab-btn:hover:not(.active) {
            background: rgba(255, 255, 255, 0.12);
        }
    `;
    doc.head.appendChild(style);
}

async function showMuluModal() {
    closeMuluModal();
    injectMuluStyles();

    // P2 & P3：初始化 TauriTavern 句柄并预加载 store 数据到缓存
    const ttHandle = await getMuluTTHandle();
    if (ttHandle) await getMuluStore(ttHandle);

    const settings = extension_settings.twt;
    const regexStr = settings.customMuluRegex;
    const sortOrder = settings.muluSortOrder || 'asc';

    const doc = getDoc();
    const parentDoc = doc;
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) {
        toastr.error('无法找到聊天容器');
        return;
    }

    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray || chatArray.length === 0) {
        toastr.info('当前没有聊天记录', '提示');
        return;
    }

    // 收集页签数据
    const chatTabsKey = context ? context.chatId : 'default';
    settings.muluChatTabs = settings.muluChatTabs || {};
    let customTabs = settings.muluChatTabs[chatTabsKey] || [];
    
    const tabsSet = new Set(customTabs);
    if (ttHandle && _muluStoreCache?.tabs) {
        Object.values(_muluStoreCache.tabs).forEach(tab => tabsSet.add(tab));
    } else {
        chatArray.forEach(msg => {
            if (msg.extra && msg.extra.twtMuluTab) {
                tabsSet.add(msg.extra.twtMuluTab);
            }
        });
    }
    const allTabs = Array.from(tabsSet);
    
    if (currentActiveMuluTab !== '全部' && !allTabs.includes(currentActiveMuluTab)) {
        currentActiveMuluTab = '全部';
    }

    const tocItems = [];
    const toolCallMode = settings.muluToolCallMode || 'hide';

    for (let i = 0; i < chatArray.length; i++) {
        const msg = chatArray[i];
        if (!msg || msg.is_user || msg.system) continue;

        // 工具调用楼层处理
        if (isToolCallMessage(msg)) {
            if (toolCallMode === 'hide') {
                continue;
            } else if (toolCallMode === 'merge') {
                let j = i;
                const toolNamesList = [];
                while (j < chatArray.length && isToolCallMessage(chatArray[j])) {
                    const names = getToolNames(chatArray[j]);
                    if (names) toolNamesList.push(names);
                    j++;
                }
                const count = j - i;
                const startId = i;
                const endId = j - 1;
                const uniqueNames = Array.from(new Set(toolNamesList.flatMap(s => s.split(',').map(x => x.trim())))).filter(Boolean);
                const namesSummary = uniqueNames.length > 0 ? `: ${uniqueNames.join(', ')}` : '';

                const title = count > 1 
                    ? `[工具调用 ×${count}]${namesSummary}` 
                    : `[工具调用]${namesSummary}`;

                const fullText = `工具调用 (共 ${count} 项, 楼层 #${startId}${count > 1 ? ` - #${endId}` : ''})${namesSummary}`;

                tocItems.push({
                    mesId: startId,
                    endMesId: endId,
                    title: title,
                    fullText: fullText,
                    isToolCall: true,
                    toolCount: count
                });

                i = endId;
                continue;
            } else {
                // 'show' 模式：独立成项
                const names = getToolNames(msg);
                const title = names ? `[工具调用] ${names}` : `[工具调用]`;
                const rawText = msg.mes || '';
                const cleanText = getCleanText(rawText);
                tocItems.push({
                    mesId: i,
                    endMesId: i,
                    title: title,
                    fullText: cleanText || title,
                    isToolCall: true,
                    toolCount: 1
                });
                continue;
            }
        }

        const rawText = msg.mes || '';
        const cleanText = getCleanText(rawText);

        let displayTitle = '';
        const storedTitle = ttHandle
            ? _muluStoreCache?.titles?.[String(i)]
            : msg.extra?.twtMuluTitle;
        if (storedTitle) {
            displayTitle = storedTitle;
        } else if (regexStr && regexStr.trim() !== '') {
            const matchedTitle = extractDirectoryTitle(cleanText, regexStr);
            if (matchedTitle) {
                displayTitle = matchedTitle;
            } else {
                continue;
            }
        } else {
            displayTitle = cleanText;
        }

        // 强行替换所有换行符为空格，并将多个连续空格合并为一个，以确保维持“一楼层一行”的单行排版
        displayTitle = displayTitle.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

        tocItems.push({
            mesId: i,
            title: displayTitle,
            fullText: cleanText
        });
    }

    if (tocItems.length === 0) {
        toastr.info(regexStr ? '未匹配到任何符合正则的目录项' : '未找到任何AI消息', '提示');
        return;
    }

    if (sortOrder === 'desc') {
        tocItems.sort((a, b) => b.mesId - a.mesId);
    } else {
        tocItems.sort((a, b) => a.mesId - b.mesId);
    }

    // Resolve opaque background color based on SmartThemeBlurTintColor (opacity 100%)
    let opaqueBgColor = '';
    try {
        const temp = doc.createElement('div');
        temp.style.color = 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, var(--SmartThemeBgColor, rgba(30, 30, 30, 0.95))))';
        doc.body.appendChild(temp);
        const style = getWin().getComputedStyle(temp).color;
        doc.body.removeChild(temp);
        const match = style.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            opaqueBgColor = `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
        }
    } catch (e) {
        console.error("TwT: Failed to resolve opaque background color in mulu.js", e);
    }

    const overlay = doc.createElement('div');
    overlay.id = 'twt-mulu-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeMuluModal();
        }
    });

    const modal = doc.createElement('div');
    modal.id = 'twt-mulu-modal';
    if (opaqueBgColor) {
        modal.style.setProperty('background-color', opaqueBgColor, 'important');
    }

    const listContainer = doc.createElement('div');
    listContainer.className = 'twt-mulu-list';
    listContainer.style.cssText = `
        flex: 1;
        overflow-y: auto;
        max-height: 55vh;
        padding: 5px 0;
        width: 100%;
        box-sizing: border-box;
    `;
    listContainer.addEventListener('scroll', () => {
        closeAllMuluDropdowns();
    });

    const header = doc.createElement('div');
    header.className = 'twt-mulu-header';
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
        gap: 4px;
    `;

    const titleSpan = doc.createElement('span');
    titleSpan.innerText = '目录';
    titleSpan.style.cssText = `
        font-size: 1.1em;
        font-weight: bold;
        flex-shrink: 0;
    `;

    const searchInput = doc.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'twt-mulu-search';
    searchInput.placeholder = '搜索...';
    searchInput.style.cssText = `
        flex: 1;
        box-sizing: border-box;
        padding: 4px 8px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
        border-radius: 4px;
        background: transparent;
        color: var(--SmartThemeBodyColor, #fff);
        font-size: 0.85em;
        outline: none;
        transition: border-color 0.2s;
        min-width: 0;
    `;

    let searchTimeout = null;
    let lastQuery = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = searchInput.value.toLowerCase().trim();
            if (query === lastQuery) return; // 内容未变，跳过
            lastQuery = query;

            const rows = listContainer.querySelectorAll('.twt-mulu-row');
            // 读相位：一次性收集所有匹配结果（不触发布局重排）
            const show = new Uint8Array(rows.length);
            for (let i = 0; i < rows.length; i++) {
                const rowText = (rows[i].getAttribute('data-text') || '').toLowerCase();
                const fullText = (rows[i].getAttribute('data-full-text') || '').toLowerCase();
                show[i] = (query === '' || rowText.includes(query) || fullText.includes(query)) ? 1 : 0;
            }
            // 写相位：批量修改 display，带脏检查避免不必要的重排
            for (let i = 0; i < rows.length; i++) {
                const next = show[i] ? 'flex' : 'none';
                if (rows[i].style.display !== next) rows[i].style.display = next;
            }
        }, 150); // 150ms 防抖；原值 800ms 是卡顿感的直接来源
    });

    let isBatchMode = false;

    // Batch Action Container (starts hidden)
    const batchActionsContainer = doc.createElement('div');
    batchActionsContainer.style.cssText = `
        display: none;
        flex: 1;
        align-items: center;
        gap: 2px;
        box-sizing: border-box;
        overflow-x: auto;
        min-width: 0;
    `;
    
    // Shared exit batch mode logic
    const exitBatchSelectMode = () => {
        isBatchMode = false;
        batchActionsContainer.style.display = 'none';
        searchInput.style.display = 'block';
        batchSelectBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        
        // Hide checkboxes, restore regular clicks
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'false';
            cb.style.display = 'none';
            cb.innerHTML = '';
        });
    };

    const btnStyle = 'padding: 2px 3px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 28px !important; line-height: 1 !important; height: auto !important; width: auto !important; flex-shrink: 0 !important;';
    
    // Add batch action buttons:
    const btnSelectAll = doc.createElement('button');
    btnSelectAll.className = 'menu_button';
    btnSelectAll.style.cssText = btnStyle;
    btnSelectAll.innerText = '全选';
    btnSelectAll.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'true';
            cb.innerHTML = '<i class="fa-solid fa-check" style="font-size:11px;"></i>';
        });
    });

    const btnReverseSelect = doc.createElement('button');
    btnReverseSelect.className = 'menu_button';
    btnReverseSelect.style.cssText = btnStyle;
    btnReverseSelect.innerText = '反选';
    btnReverseSelect.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            const nowChecked = cb.dataset.checked !== 'true';
            cb.dataset.checked = String(nowChecked);
            cb.innerHTML = nowChecked ? '<i class="fa-solid fa-check" style="font-size:11px;"></i>' : '';
        });
    });

    const btnRangeSelect = doc.createElement('button');
    btnRangeSelect.className = 'menu_button';
    btnRangeSelect.style.cssText = btnStyle;
    btnRangeSelect.innerText = '连选';
    btnRangeSelect.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkboxes = Array.from(listContainer.querySelectorAll('.twt-mulu-checkbox'));
        const checkedIndices = checkboxes.reduce((acc, cb, idx) => {
            if (cb.dataset.checked === 'true') acc.push(idx);
            return acc;
        }, []);
        if (checkedIndices.length >= 2) {
            const minIdx = Math.min(...checkedIndices);
            const maxIdx = Math.max(...checkedIndices);
            for (let i = minIdx; i <= maxIdx; i++) {
                checkboxes[i].dataset.checked = 'true';
                checkboxes[i].innerHTML = '<i class="fa-solid fa-check" style="font-size:11px;"></i>';
            }
        } else {
            toastr.info('请先手动勾选至少两个章节作为起点和终点！', '提示');
        }
    });

    const btnClearAll = doc.createElement('button');
    btnClearAll.className = 'menu_button';
    btnClearAll.style.cssText = btnStyle;
    btnClearAll.innerText = '清空';
    btnClearAll.addEventListener('click', (e) => {
        e.stopPropagation();
        listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => {
            cb.dataset.checked = 'false';
            cb.innerHTML = '';
        });
    });

    const btnGenerate = doc.createElement('button');
    btnGenerate.className = 'menu_button';
    btnGenerate.style.cssText = 'padding: 2px 4px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; white-space: nowrap !important; background: var(--SmartThemeUnderlineColor, #007aff) !important; color: #fff !important; font-weight: bold !important; border: none !important; border-radius: 4px !important; display: inline-flex !important; align-items: center !important; gap: 2px !important; flex-shrink: 0 !important;';
    btnGenerate.innerHTML = '<i class="fa-regular fa-comment-dots"></i> 生成';

    // 日志图标按钮：生成前显示普通日志图标，生成中显示转圈圈，生成后显示勾号并可点击查看日志
    const btnLog = doc.createElement('button');
    btnLog.className = 'menu_button';
    btnLog.style.cssText = 'padding: 2px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 24px !important; height: 24px !important; width: 24px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; border-radius: 4px !important;';
    
    // 根据全局状态初始化图标
    if (globalGenerationStatus === 'generating') {
        btnLog.title = '正在生成...';
        btnLog.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnLog.disabled = true;
    } else if (globalGenerationStatus === 'done') {
        btnLog.title = `查看生成日志 (共${globalBatchLogs.length}条)`;
        btnLog.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#4caf50;"></i>';
        btnLog.disabled = false;
    } else {
        btnLog.title = '查看生成日志 (暂无日志)';
        btnLog.innerHTML = '<i class="fa-solid fa-list" style="opacity: 0.5;"></i>';
        btnLog.disabled = false;
    }

    // 日志面板（浮层弹出，使用和目录类似的遮罩居中机制）
    const showLogPanel = () => {
        const existingOverlay = doc.getElementById('twt-batch-log-overlay');
        if (existingOverlay) { existingOverlay.remove(); return; }

        // 注入日志面板专用样式（避免被宿主 CSS 覆盖）
        if (!doc.getElementById('twt-log-panel-styles')) {
            const s = doc.createElement('style');
            s.id = 'twt-log-panel-styles';
            s.textContent = `
                #twt-batch-log-overlay {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(0,0,0,0.6); z-index: 10005;
                    backdrop-filter: blur(3px);
                    display: flex; align-items: center; justify-content: center;
                }
                #twt-batch-log-panel {
                    position: relative; width: 90%; max-width: 600px;
                    height: 80vh;
                    background: var(--twt-comments-bg-solid, var(--SmartThemeBlurTintColor, #1e1e2e));
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15));
                    border-radius: 12px;
                    box-shadow: 0 10px 30px var(--SmartThemeShadowColor, rgba(0,0,0,0.5));
                    display: flex; flex-direction: column;
                    overflow: hidden;
                    font-size: 0.85em; color: var(--SmartThemeBodyColor, #e0e0e0);
                    z-index: 10006; box-sizing: border-box;
                    font-family: var(--SmartThemeFontFamily, sans-serif);
                }
                #twt-batch-log-panel-header {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 14px; flex-shrink: 0;
                    border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1));
                }
                #twt-batch-log-panel-body {
                    flex: 1; overflow-y: scroll; overflow-x: hidden;
                    min-height: 0;
                    padding: 10px 14px;
                    box-sizing: border-box;
                }
                #twt-batch-log-panel-body::-webkit-scrollbar { width: 6px; }
                #twt-batch-log-panel-body::-webkit-scrollbar-track { background: transparent; }
                #twt-batch-log-panel-body::-webkit-scrollbar-thumb {
                    background: var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
                    border-radius: 3px;
                }
                .twt-log-card { 
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1));
                    border-radius: 6px; overflow: hidden; margin-bottom: 10px;
                }
                .twt-log-card:last-child { margin-bottom: 0; }
                .twt-log-card-head {
                    display: flex; align-items: center; gap: 8px; padding: 7px 10px;
                    cursor: pointer; background: rgba(255,255,255,0.03); user-select: none;
                }
                .twt-log-card-body {
                    display: none; padding: 8px 10px;
                    border-top: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.08));
                }
                .twt-log-card-body.open { display: block; }
                .twt-log-msg-block {
                    border-radius: 4px; overflow: hidden;
                    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.08));
                    margin-bottom: 6px;
                }
                .twt-log-msg-block:last-child { margin-bottom: 0; }
                .twt-log-pre {
                    margin: 0; padding: 6px 8px; white-space: pre-wrap;
                    word-break: break-all; font-family: inherit; font-size: 0.88em;
                    line-height: 1.5; max-height: 180px; overflow-y: auto;
                    overscroll-behavior: contain;
                }
                .twt-log-pre::-webkit-scrollbar { width: 4px; }
                .twt-log-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius:2px; }
            `;
            doc.head.appendChild(s);
        }

        const overlay = doc.createElement('div');
        overlay.id = 'twt-batch-log-overlay';
        overlay.addEventListener('click', () => overlay.remove());

        const panel = doc.createElement('div');
        panel.id = 'twt-batch-log-panel';
        panel.addEventListener('click', (e) => e.stopPropagation());

        // 头部
        const panelHeader = doc.createElement('div');
        panelHeader.id = 'twt-batch-log-panel-header';
        panelHeader.innerHTML = `<span style="font-weight:bold;font-size:1em;"><i class="fa-solid fa-clipboard-list" style="margin-right:6px;"></i>生成日志 (${globalBatchLogs.length}条)</span>`;
        const panelClose = doc.createElement('button');
        panelClose.className = 'menu_button';
        panelClose.style.cssText = 'padding:2px 6px !important; font-size:0.9em !important; margin:0 !important;';
        panelClose.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        panelClose.addEventListener('click', () => overlay.remove());
        panelHeader.appendChild(panelClose);
        panel.appendChild(panelHeader);

        // 内容区（纯 block，不用 flex，让 overflow-y:scroll 真正生效）
        const panelBody = doc.createElement('div');
        panelBody.id = 'twt-batch-log-panel-body';

        if (globalBatchLogs.length === 0) {
            panelBody.innerHTML = '<div style="opacity:0.5;text-align:center;padding:20px;">暂无日志</div>';
        } else {
            globalBatchLogs.forEach(entry => {
                const context = getContext ? getContext() : null;
                const msgPreview = context && context.chat && context.chat[entry.mesId]
                    ? (context.chat[entry.mesId].mes || '').substring(0, 40) + '...'
                    : `消息 #${entry.mesId}`;

                const statusColor = entry.status === 'ok' ? '#4caf50' : entry.status === 'empty' ? '#ff9800' : entry.status === 'skip' ? '#9e9e9e' : '#f44336';
                const statusIcon = entry.status === 'ok' ? 'fa-circle-check' : entry.status === 'empty' ? 'fa-circle-exclamation' : entry.status === 'skip' ? 'fa-circle-minus' : 'fa-circle-xmark';
                const statusLabel = entry.status === 'ok' ? `成功 (生成${entry.commentsCount}条段评)` : entry.status === 'empty' ? 'AI未返回段评' : entry.status === 'skip' ? '已跳过' : '失败';

                const card = doc.createElement('div');
                card.className = 'twt-log-card';

                const cardHead = doc.createElement('div');
                cardHead.className = 'twt-log-card-head';
                cardHead.innerHTML = `
                    <i class="fa-solid ${statusIcon}" style="color:${statusColor};flex-shrink:0;"></i>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">#${entry.mesId} ${escapeHtml(msgPreview)}</span>
                    <span style="color:${statusColor};white-space:nowrap;font-size:0.9em;">${statusLabel}</span>
                    <i class="fa-solid fa-chevron-down" style="font-size:0.8em;opacity:0.5;flex-shrink:0;"></i>
                `;

                const cardBody = doc.createElement('div');
                cardBody.className = 'twt-log-card-body';

                // 错误信息
                if (entry.error) {
                    const errDiv = doc.createElement('div');
                    errDiv.style.cssText = 'background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);border-radius:4px;padding:6px 8px;color:#f44336;white-space:pre-wrap;word-break:break-all;margin-bottom:6px;';
                    errDiv.textContent = '错误：' + entry.error;
                    cardBody.appendChild(errDiv);
                }

                // 发送的提示词
                if (entry.sentMessages && entry.sentMessages.length > 0) {
                    const promptLabel = doc.createElement('div');
                    promptLabel.style.cssText = 'font-weight:bold;opacity:0.7;font-size:0.9em;margin-bottom:4px;';
                    promptLabel.textContent = '发送的提示词：';
                    cardBody.appendChild(promptLabel);

                    entry.sentMessages.forEach((msg) => {
                        const msgBlock = doc.createElement('div');
                        msgBlock.className = 'twt-log-msg-block';
                        const roleTag = msg.role === 'system' ? '系统' : msg.role === 'user' ? '用户' : '助手';
                        const roleColor = msg.role === 'system' ? '#9c27b0' : msg.role === 'user' ? '#2196f3' : '#4caf50';
                        const msgHead = doc.createElement('div');
                        msgHead.style.cssText = `background:rgba(${msg.role === 'system' ? '156,39,176' : msg.role === 'user' ? '33,150,243' : '76,175,80'},0.15);padding:3px 8px;font-size:0.85em;font-weight:bold;color:${roleColor};`;
                        msgHead.textContent = `[${roleTag}]`;
                        const msgContent = doc.createElement('pre');
                        msgContent.className = 'twt-log-pre';
                        msgContent.textContent = msg.content || '';
                        msgBlock.appendChild(msgHead);
                        msgBlock.appendChild(msgContent);
                        cardBody.appendChild(msgBlock);
                    });
                }

                // AI 原始回复
                if (entry.rawResponse) {
                    const respLabel = doc.createElement('div');
                    respLabel.style.cssText = 'font-weight:bold;opacity:0.7;font-size:0.9em;margin-top:6px;margin-bottom:4px;';
                    respLabel.textContent = 'AI 原始回复：';
                    cardBody.appendChild(respLabel);
                    const respBlock = doc.createElement('pre');
                    respBlock.className = 'twt-log-pre';
                    respBlock.style.cssText += 'background:rgba(255,255,255,0.04);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,0.08));border-radius:4px;';
                    respBlock.textContent = entry.rawResponse;
                    cardBody.appendChild(respBlock);
                }

                // 展开/折叠切换
                let expanded = entry.status !== 'ok';
                if (expanded) {
                    cardBody.classList.add('open');
                    const chevron = cardHead.querySelector('.fa-chevron-down');
                    if (chevron) chevron.className = 'fa-solid fa-chevron-up';
                }
                cardHead.addEventListener('click', () => {
                    expanded = !expanded;
                    cardBody.classList.toggle('open', expanded);
                    const chevron = cardHead.querySelector('.fa-chevron-down, .fa-chevron-up');
                    if (chevron) chevron.className = `fa-solid fa-chevron-${expanded ? 'up' : 'down'}`;
                });

                card.appendChild(cardHead);
                card.appendChild(cardBody);
                panelBody.appendChild(card);
            });
        }

        panel.appendChild(panelBody);
        overlay.appendChild(panel);
        doc.body.appendChild(overlay);
    };

    btnLog.addEventListener('click', (e) => {
        e.stopPropagation();
        if (globalBatchLogs.length === 0) {
            toastr.info('暂无日志，请先开始生成段评', '提示');
            return;
        }
        showLogPanel();
    });

    const progressSpan = doc.createElement('span');
    progressSpan.style.cssText = 'font-size: 0.8em; opacity: 0.8; white-space: nowrap; display: none; margin-left: 3px;';
    progressSpan.innerText = '';

    btnGenerate.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selectedCbs = listContainer.querySelectorAll('.twt-mulu-checkbox[data-checked="true"]');
        const selectedIds = Array.from(selectedCbs).map(cb => parseInt(cb.getAttribute('data-id')));
        if (selectedIds.length === 0) {
            toastr.warning('请先选择要生成段评的章节！', '提示');
            return;
        }

        // 重置全局日志和全局状态
        globalBatchLogs = [];
        globalGenerationStatus = 'generating';

        // 进入旋转状态
        btnLog.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnLog.title = '正在生成...';
        btnLog.disabled = true;

        // Disable batch buttons during generation
        btnSelectAll.disabled = true;
        btnReverseSelect.disabled = true;
        btnRangeSelect.disabled = true;
        btnClearAll.disabled = true;
        btnGenerate.disabled = true;

        progressSpan.style.display = 'inline';
        progressSpan.innerText = `准备中...`;

        try {
            const { triggerBatchCommentsForMessages } = await import('../paragraph/paragraph.js?v=1.0.26');
            // Sequentially generate with progress callback and log callback
            await triggerBatchCommentsForMessages(
                selectedIds,
                (current, total) => {
                    progressSpan.innerText = `${current}/${total}`;
                },
                (mesId, logEntry) => {
                    globalBatchLogs.push(logEntry);
                }
            );
            toastr.success('批量生成段评完成！', '成功');
            globalGenerationStatus = 'done';
        } catch (err) {
            console.error('Batch comments generation failed:', err);
            toastr.error(`生成失败: ${err.message || err}`, '错误');
            globalGenerationStatus = 'done';
        } finally {
            // Re-enable
            btnSelectAll.disabled = false;
            btnReverseSelect.disabled = false;
            btnRangeSelect.disabled = false;
            btnClearAll.disabled = false;
            btnGenerate.disabled = false;
            progressSpan.style.display = 'none';

            // 日志按钮切换为勾号状态
            btnLog.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#4caf50;"></i>';
            btnLog.title = `查看生成日志 (共${globalBatchLogs.length}条)`;
            btnLog.disabled = false;

            // Exit batch mode
            exitBatchSelectMode();
        }
    });

    // 批量归类按钮
    const btnBatchGroup = doc.createElement('button');
    btnBatchGroup.className = 'menu_button';
    btnBatchGroup.style.cssText = btnStyle + ' background: var(--SmartThemeUnderlineColor, #007aff) !important; color: #fff !important; font-weight: bold !important; border: none !important;';
    btnBatchGroup.innerText = '归类';
    btnBatchGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedCbs = listContainer.querySelectorAll('.twt-mulu-checkbox[data-checked="true"]');
        const selectedIds = Array.from(selectedCbs).map(cb => Number(cb.getAttribute('data-id')));
        if (selectedIds.length === 0) {
            toastr.info('请先勾选需要归类的楼层！', '提示');
            return;
        }

        const oldDropdown = doc.getElementById('twt-mulu-batch-tag-dropdown');
        if (oldDropdown) {
            closeAllMuluDropdowns();
            return;
        }
        closeAllMuluDropdowns();

        const dropdown = doc.createElement('div');
        dropdown.id = 'twt-mulu-batch-tag-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            z-index: 1000000;
            background: ${opaqueBgColor || 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))'};
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 6px;
            padding: 4px 0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 0.85em;
            min-width: 120px;
            color: var(--SmartThemeBodyColor, #fff);
        `;

        const rect = btnBatchGroup.getBoundingClientRect();
        const bodyRect = parentDoc.body.getBoundingClientRect();
        
        // Prevent exceeding viewport width
        const dropdownWidth = 130;
        const viewportWidth = parentDoc.documentElement.clientWidth;
        let left = rect.left - bodyRect.left;
        if (left + dropdownWidth > viewportWidth - 10) {
            left = rect.right - bodyRect.left - dropdownWidth;
            if (left < 10) left = 10;
        }
        let top = rect.bottom - bodyRect.top + 4;
        dropdown.style.left = `${left}px`;
        dropdown.style.top = `${top}px`;

        // 移出分组
        const optUncat = doc.createElement('div');
        optUncat.innerText = '移出分组';
        optUncat.style.cssText = 'padding: 6px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
        optUncat.addEventListener('mouseenter', () => optUncat.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optUncat.addEventListener('mouseleave', () => optUncat.style.background = 'transparent');
        optUncat.addEventListener('click', async () => {
            selectedIds.forEach(id => {
                const msg = chatArray[id];
                if (msg && msg.extra) {
                    delete msg.extra.twtMuluTab;
                }
            });
            if (context && typeof context.saveChat === 'function') {
                await context.saveChat();
            }
            closeAllMuluDropdowns();
            exitBatchSelectMode();
            showMuluModal();
        });
        dropdown.appendChild(optUncat);

        // 归类至页签
        allTabs.forEach(tab => {
            const optTab = doc.createElement('div');
            optTab.innerText = `归类至：${tab}`;
            optTab.style.cssText = 'padding: 6px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
            optTab.addEventListener('mouseenter', () => optTab.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
            optTab.addEventListener('mouseleave', () => optTab.style.background = 'transparent');
            optTab.addEventListener('click', async () => {
                selectedIds.forEach(id => {
                    const msg = chatArray[id];
                    if (msg) {
                        msg.extra = msg.extra || {};
                        msg.extra.twtMuluTab = tab;
                    }
                });
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
                closeAllMuluDropdowns();
                exitBatchSelectMode();
                showMuluModal();
            });
            dropdown.appendChild(optTab);
        });

        parentDoc.body.appendChild(dropdown);

        const closeDropdown = (evt) => {
            if (!dropdown.contains(evt.target) && evt.target !== btnBatchGroup) {
                closeAllMuluDropdowns();
                parentDoc.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            parentDoc.addEventListener('click', closeDropdown);
        }, 0);
    });

    batchActionsContainer.appendChild(btnSelectAll);
    batchActionsContainer.appendChild(btnReverseSelect);
    batchActionsContainer.appendChild(btnRangeSelect);
    batchActionsContainer.appendChild(btnClearAll);
    batchActionsContainer.appendChild(btnBatchGroup);
    batchActionsContainer.appendChild(btnGenerate);
    batchActionsContainer.appendChild(progressSpan);

    const headerActions = doc.createElement('div');
    headerActions.style.cssText = `
        display: flex;
        gap: 3px;
        align-items: center;
        flex-shrink: 0;
    `;

    const iconBtnStyle = 'padding: 2px !important; margin: 0 !important; font-size: 0.8em !important; min-height: 24px !important; min-width: 24px !important; height: 24px !important; width: 24px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important;';

    const batchSelectBtn = doc.createElement('button');
    batchSelectBtn.className = 'menu_button';
    batchSelectBtn.style.cssText = iconBtnStyle + ' background: rgba(255, 255, 255, 0.08);';
    batchSelectBtn.title = '批量生成段评';
    batchSelectBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';
    batchSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isBatchMode = !isBatchMode;
        if (isBatchMode) {
            searchInput.style.display = 'none';
            batchActionsContainer.style.display = 'flex';
            batchSelectBtn.style.background = 'var(--SmartThemeUnderlineColor, #007aff)';
            
            // Show checkboxes
            listContainer.querySelectorAll('.twt-mulu-checkbox').forEach(cb => cb.style.display = 'inline-flex');
        } else {
            exitBatchSelectMode();
        }
    });

    const sortBtn = doc.createElement('button');
    sortBtn.className = 'menu_button';
    sortBtn.style.cssText = iconBtnStyle;
    sortBtn.title = sortOrder === 'asc' ? '当前：正序 (点击切换倒序)' : '当前：倒序 (点击切换正序)';
    sortBtn.innerHTML = sortOrder === 'asc' ? '<i class="fa-solid fa-sort-amount-down-alt"></i>' : '<i class="fa-solid fa-sort-amount-up"></i>';
    sortBtn.addEventListener('click', () => {
        settings.muluSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        if (context && typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        }
        showMuluModal(); 
    });

    // 分组页签配置管理按钮
    const settingsBtn = doc.createElement('button');
    settingsBtn.className = 'menu_button';
    settingsBtn.style.cssText = iconBtnStyle;
    settingsBtn.title = '分组页签管理';
    settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const oldDropdown = doc.getElementById('twt-mulu-settings-dropdown');
        if (oldDropdown) {
            closeAllMuluDropdowns();
            return;
        }
        closeAllMuluDropdowns();

        const dropdown = doc.createElement('div');
        dropdown.id = 'twt-mulu-settings-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            z-index: 1000000;
            background: ${opaqueBgColor || 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))'};
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 6px;
            padding: 4px 0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 0.85em;
            min-width: 120px;
            color: var(--SmartThemeBodyColor, #fff);
        `;

        const rect = settingsBtn.getBoundingClientRect();
        const bodyRect = parentDoc.body.getBoundingClientRect();
        
        // Prevent exceeding viewport width
        const dropdownWidth = 130;
        const viewportWidth = parentDoc.documentElement.clientWidth;
        let left = rect.left - bodyRect.left;
        if (left + dropdownWidth > viewportWidth - 10) {
            left = rect.right - bodyRect.left - dropdownWidth;
            if (left < 10) left = 10;
        }
        let top = rect.bottom - bodyRect.top + 4;
        dropdown.style.left = `${left}px`;
        dropdown.style.top = `${top}px`;

        // 1. 新建页签
        const optAdd = doc.createElement('div');
        optAdd.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:6px;"></i>新建页签...';
        optAdd.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
        optAdd.addEventListener('mouseenter', () => optAdd.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optAdd.addEventListener('mouseleave', () => optAdd.style.background = 'transparent');
        optAdd.addEventListener('click', () => {
            dropdown.remove();
            const newName = prompt('请输入新页签的名称:');
            if (newName && newName.trim()) {
                const trimmed = newName.trim();
                if (trimmed === '全部') {
                    toastr.warning('不能创建名为 "全部" 的页签', '提示');
                    return;
                }
                if (!allTabs.includes(trimmed)) {
                    settings.muluChatTabs[chatTabsKey] = settings.muluChatTabs[chatTabsKey] || [];
                    settings.muluChatTabs[chatTabsKey].push(trimmed);
                    if (context && typeof context.saveSettingsDebounced === 'function') {
                        context.saveSettingsDebounced();
                    }
                    currentActiveMuluTab = trimmed;
                    showMuluModal();
                } else {
                    toastr.warning('该页签名称已存在', '提示');
                }
            }
        });
        dropdown.appendChild(optAdd);

        // 2. 删除空页签
        const optDel = doc.createElement('div');
        optDel.innerHTML = '<i class="fa-solid fa-trash-can" style="margin-right:6px;"></i>删除空页签';
        optDel.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1)); color: var(--SmartThemeBodyColor, #fff);';
        optDel.addEventListener('mouseenter', () => optDel.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optDel.addEventListener('mouseleave', () => optDel.style.background = 'transparent');
        optDel.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const emptyTabs = allTabs.filter(tabName => {
                if (ttHandle && _muluStoreCache?.tabs) {
                    return !Object.values(_muluStoreCache.tabs).includes(tabName);
                }
                return !chatArray.some(msg => msg.extra && msg.extra.twtMuluTab === tabName);
            });
            if (emptyTabs.length === 0) {
                toastr.info('当前没有空的分组页签可供删除', '提示');
                closeAllMuluDropdowns();
                return;
            }

            const subDropdown = doc.createElement('div');
            subDropdown.id = 'twt-mulu-settings-sub-dropdown';
            subDropdown.style.cssText = `
                position: absolute;
                z-index: 1000001;
                background: ${opaqueBgColor || 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))'};
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
                border-radius: 6px;
                padding: 4px 0;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-size: 0.85em;
                min-width: 100px;
                color: var(--SmartThemeBodyColor, #fff);
            `;
            const subRect = optDel.getBoundingClientRect();
            
            // Prevent subDropdown exceeding viewport width
            const subWidth = 110;
            let subLeft = subRect.right - bodyRect.left + 4;
            if (subLeft + subWidth > viewportWidth - 10) {
                subLeft = subRect.left - bodyRect.left - subWidth - 4;
            }
            let subTop = subRect.top - bodyRect.top;
            subDropdown.style.left = `${subLeft}px`;
            subDropdown.style.top = `${subTop}px`;

            emptyTabs.forEach(tabName => {
                const subOpt = doc.createElement('div');
                subOpt.innerText = tabName;
                subOpt.style.cssText = 'padding: 6px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
                subOpt.addEventListener('mouseenter', () => subOpt.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
                subOpt.addEventListener('mouseleave', () => subOpt.style.background = 'transparent');
                subOpt.addEventListener('click', () => {
                    settings.muluChatTabs[chatTabsKey] = (settings.muluChatTabs[chatTabsKey] || []).filter(t => t !== tabName);
                    if (context && typeof context.saveSettingsDebounced === 'function') {
                        context.saveSettingsDebounced();
                    }
                    if (currentActiveMuluTab === tabName) {
                        currentActiveMuluTab = '全部';
                    }
                    closeAllMuluDropdowns();
                    showMuluModal();
                });
                subDropdown.appendChild(subOpt);
            });

            parentDoc.body.appendChild(subDropdown);

            const closeSub = (event) => {
                if (!subDropdown.contains(event.target) && event.target !== optDel) {
                    subDropdown.remove();
                    parentDoc.removeEventListener('click', closeSub);
                }
            };
            setTimeout(() => {
                parentDoc.addEventListener('click', closeSub);
            }, 0);
        });
        dropdown.appendChild(optDel);

        // 3. 工具调用楼层显示模式子菜单
        const optTc = doc.createElement('div');
        const modeLabels = { hide: '完全隐藏', merge: '合并显示', show: '独立显示' };
        const curTcMode = settings.muluToolCallMode || 'hide';
        optTc.innerHTML = `<i class="fa-solid fa-wrench" style="margin-right:6px;"></i>工具调用: ${modeLabels[curTcMode] || '完全隐藏'}<i class="fa-solid fa-chevron-right" style="float:right;margin-top:3px;font-size:0.8em;opacity:0.6;"></i>`;
        optTc.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1)); color: var(--SmartThemeBodyColor, #fff);';
        optTc.addEventListener('mouseenter', () => optTc.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optTc.addEventListener('mouseleave', () => optTc.style.background = 'transparent');
        optTc.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const existingTcSub = doc.getElementById('twt-mulu-tc-sub-dropdown');
            if (existingTcSub) {
                existingTcSub.remove();
                return;
            }

            const tcSub = doc.createElement('div');
            tcSub.id = 'twt-mulu-tc-sub-dropdown';
            tcSub.style.cssText = `
                position: absolute;
                z-index: 1000002;
                background: ${opaqueBgColor || 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))'};
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
                border-radius: 6px;
                padding: 4px 0;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-size: 0.85em;
                min-width: 140px;
                color: var(--SmartThemeBodyColor, #fff);
            `;

            const bodyRect = parentDoc.body.getBoundingClientRect();
            const viewportWidth = parentDoc.documentElement.clientWidth;
            const subRect = optTc.getBoundingClientRect();

            const subWidth = 140;
            let subLeft = subRect.right - bodyRect.left + 4;
            if (subLeft + subWidth > viewportWidth - 10) {
                subLeft = subRect.left - bodyRect.left - subWidth - 4;
            }
            let subTop = subRect.top - bodyRect.top;
            tcSub.style.left = `${subLeft}px`;
            tcSub.style.top = `${subTop}px`;

            const tcModes = [
                { id: 'hide', label: '完全隐藏 (推荐)' },
                { id: 'merge', label: '合并显示 (相邻合并)' },
                { id: 'show', label: '独立显示' },
            ];

            tcModes.forEach(m => {
                const subItem = doc.createElement('div');
                subItem.style.cssText = 'padding: 6px 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--SmartThemeBodyColor, #fff); transition: background 0.15s;';
                subItem.innerHTML = `<span>${m.label}</span>${curTcMode === m.id ? '<i class="fa-solid fa-check" style="font-size:10px;color:var(--SmartThemeUnderlineColor,#007aff);"></i>' : ''}`;
                subItem.addEventListener('mouseenter', () => subItem.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
                subItem.addEventListener('mouseleave', () => subItem.style.background = 'transparent');
                subItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    settings.muluToolCallMode = m.id;
                    if (context && typeof context.saveSettingsDebounced === 'function') {
                        context.saveSettingsDebounced();
                    }
                    closeAllMuluDropdowns();
                    showMuluModal();
                });
                tcSub.appendChild(subItem);
            });

            parentDoc.body.appendChild(tcSub);

            const closeTcSub = (event) => {
                if (!tcSub.contains(event.target) && event.target !== optTc) {
                    tcSub.remove();
                    parentDoc.removeEventListener('click', closeTcSub);
                }
            };
            setTimeout(() => {
                parentDoc.addEventListener('click', closeTcSub);
            }, 0);
        });
        dropdown.appendChild(optTc);

        parentDoc.body.appendChild(dropdown);

        const closeDropdown = (evt) => {
            if (!dropdown.contains(evt.target) && evt.target !== settingsBtn) {
                closeAllMuluDropdowns();
                parentDoc.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            parentDoc.addEventListener('click', closeDropdown);
        }, 0);
    });

    const closeBtn = doc.createElement('button');
    closeBtn.className = 'menu_button';
    closeBtn.style.cssText = iconBtnStyle;
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', closeMuluModal);

    // 将日志按钮(btnLog)常态化放置在“批量生成段评”按钮的前面(左侧)
    if (settings.commentsEnabled) {
        headerActions.appendChild(btnLog);
        headerActions.appendChild(batchSelectBtn);
    }
    headerActions.appendChild(settingsBtn);
    headerActions.appendChild(sortBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(searchInput);
    header.appendChild(batchActionsContainer);
    header.appendChild(headerActions);
    modal.appendChild(header);

    // 创建分组页签栏
    const tabRow = doc.createElement('div');
    tabRow.className = 'twt-mulu-tabs';

    // “全部” 页签
    const tabAll = doc.createElement('button');
    tabAll.className = 'twt-mulu-tab-btn';
    if (currentActiveMuluTab === '全部') tabAll.classList.add('active');
    tabAll.innerText = '全部';
    tabAll.addEventListener('click', (e) => {
        e.stopPropagation();
        currentActiveMuluTab = '全部';
        showMuluModal();
    });
    tabRow.appendChild(tabAll);

    // 各个自定义页签 (No pre-defined tabs, all capsule styling)
    allTabs.forEach(tabName => {
        const tabBtn = doc.createElement('button');
        tabBtn.className = 'twt-mulu-tab-btn';
        if (currentActiveMuluTab === tabName) tabBtn.classList.add('active');
        
        const textSpan = doc.createElement('span');
        textSpan.innerText = tabName;
        tabBtn.appendChild(textSpan);

        tabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentActiveMuluTab = tabName;
            showMuluModal();
        });
        tabRow.appendChild(tabBtn);
    });

    modal.appendChild(tabRow);

    // 根据选中的标签筛选目录
    let filteredTocItems = tocItems;
    if (currentActiveMuluTab !== '全部') {
        filteredTocItems = tocItems.filter(item => {
            const msg = chatArray[item.mesId];
            return msg && msg.extra && msg.extra.twtMuluTab === currentActiveMuluTab;
        });
    }

    // Right-click / Long press context menu definition
    function showRowContextMenu(clientX, clientY, mesId, itemTitle, msgObj) {
        closeAllMuluDropdowns();

        const dropdown = doc.createElement('div');
        dropdown.id = 'twt-mulu-tag-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            z-index: 1000000;
            background: ${opaqueBgColor || 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))'};
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 6px;
            padding: 4px 0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 0.85em;
            min-width: 130px;
            color: var(--SmartThemeBodyColor, #fff);
        `;

        const bodyRect = parentDoc.body.getBoundingClientRect();
        
        // Prevent exceeding viewport width/height
        const dropdownWidth = 140;
        const dropdownHeight = 160;
        const viewportWidth = parentDoc.documentElement.clientWidth;
        const viewportHeight = parentDoc.documentElement.clientHeight;

        let left = clientX - bodyRect.left;
        if (left + dropdownWidth > viewportWidth - 10) {
            left = viewportWidth - dropdownWidth - 10;
        }
        if (left < 10) left = 10;

        let top = clientY - bodyRect.top;
        if (top + dropdownHeight > viewportHeight - 10) {
            top = viewportHeight - dropdownHeight - 10;
        }
        if (top < 10) top = 10;

        dropdown.style.left = `${left}px`;
        dropdown.style.top = `${top}px`;

        // 1. 自定义命名
        const optRename = doc.createElement('div');
        optRename.innerHTML = '<i class="fa-regular fa-pen-to-square" style="margin-right:6px;width:12px;"></i>自定义命名...';
        optRename.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
        optRename.addEventListener('mouseenter', () => optRename.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optRename.addEventListener('mouseleave', () => optRename.style.background = 'transparent');
        optRename.addEventListener('click', () => {
            closeAllMuluDropdowns();
            const currentCustomName = msgObj.extra?.twtMuluTitle || '';
            const newName = prompt('请输入该楼层在目录中的自定义名称 (留空恢复默认):', currentCustomName || itemTitle);
            if (newName !== null) {
                msgObj.extra = msgObj.extra || {};
                if (newName.trim() === '') {
                    delete msgObj.extra.twtMuluTitle;
                } else {
                    msgObj.extra.twtMuluTitle = newName.trim();
                }
                if (context && typeof context.saveChat === 'function') {
                    context.saveChat().then(() => {
                        showMuluModal();
                    });
                } else {
                    showMuluModal();
                }
            }
        });
        dropdown.appendChild(optRename);

        // 分割线
        const divider = doc.createElement('div');
        divider.style.cssText = 'height: 1px; background: var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); margin: 4px 0;';
        dropdown.appendChild(divider);

        // 2. 移出分组
        const optUncat = doc.createElement('div');
        optUncat.innerHTML = '<i class="fa-solid fa-folder-minus" style="margin-right:6px;width:12px;"></i>移出当前分组';
        optUncat.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
        optUncat.addEventListener('mouseenter', () => optUncat.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
        optUncat.addEventListener('mouseleave', () => optUncat.style.background = 'transparent');
        optUncat.addEventListener('click', async () => {
            if (msgObj && msgObj.extra) {
                delete msgObj.extra.twtMuluTab;
            }
            if (context && typeof context.saveChat === 'function') {
                await context.saveChat();
            }
            closeAllMuluDropdowns();
            showMuluModal();
        });
        dropdown.appendChild(optUncat);

        // 3. 归类至各个页签
        allTabs.forEach(tab => {
            const optTab = doc.createElement('div');
            optTab.innerHTML = `<i class="fa-regular fa-folder" style="margin-right:6px;width:12px;"></i>归类至：${tab}`;
            optTab.style.cssText = 'padding: 8px 12px; cursor: pointer; transition: background 0.15s; color: var(--SmartThemeBodyColor, #fff);';
            optTab.addEventListener('mouseenter', () => optTab.style.background = 'var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.08))');
            optTab.addEventListener('mouseleave', () => optTab.style.background = 'transparent');
            optTab.addEventListener('click', async () => {
                if (msgObj) {
                    msgObj.extra = msgObj.extra || {};
                    msgObj.extra.twtMuluTab = tab;
                }
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
                closeAllMuluDropdowns();
                showMuluModal();
            });
            dropdown.appendChild(optTab);
        });

        parentDoc.body.appendChild(dropdown);

        const closeDropdown = (evt) => {
            if (!dropdown.contains(evt.target)) {
                closeAllMuluDropdowns();
                parentDoc.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            parentDoc.addEventListener('click', closeDropdown);
        }, 0);
    }

    function bindRowContextAndLongPress(rowEl, mesId, itemTitle, msgObj) {
        // Desktop Right Click
        rowEl.addEventListener('contextmenu', (e) => {
            if (isBatchMode) return;
            e.preventDefault();
            e.stopPropagation();
            showRowContextMenu(e.clientX, e.clientY, mesId, itemTitle, msgObj);
        });

        // Mobile Long Press
        let touchTimer = null;
        let startX = 0;
        let startY = 0;
        let isLongPress = false;

        rowEl.addEventListener('touchstart', (e) => {
            if (isBatchMode) return;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            isLongPress = false;
            
            touchTimer = setTimeout(() => {
                isLongPress = true;
                e.preventDefault();
                showRowContextMenu(touch.clientX, touch.clientY, mesId, itemTitle, msgObj);
            }, 600);
        }, { passive: false });

        rowEl.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const moveDist = Math.hypot(touch.clientX - startX, touch.clientY - startY);
            if (moveDist > 10) {
                clearTimeout(touchTimer);
            }
        }, { passive: true });

        rowEl.addEventListener('touchend', (e) => {
            clearTimeout(touchTimer);
            if (isLongPress) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    const rowFragment = doc.createDocumentFragment();

    filteredTocItems.forEach(item => {
        const row = doc.createElement('div');
        row.className = 'twt-mulu-row interactable';
        row.setAttribute('data-text', item.title);
        row.setAttribute('data-full-text', item.fullText);
        row.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding: 10px 15px;
            cursor: pointer;
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.05));
            transition: background-color 0.2s;
            box-sizing: border-box;
            width: 100%;
            overflow: hidden;
        `;

        const leftSpan = doc.createElement('span');
        const msgObj = chatArray[item.mesId];
        const isHidden = msgObj ? (msgObj.is_system || msgObj.extra?.is_system) : false;
        
        if (item.isToolCall) {
            leftSpan.innerHTML = `<i class="fa-solid fa-wrench" style="margin-right:6px;opacity:0.75;font-size:0.85em;color:var(--SmartThemeEmColor,var(--SmartThemeUnderlineColor,#00afff));"></i><span>${escapeHtml(item.title)}</span>`;
            leftSpan.style.cssText = `
                flex: 0 1 auto;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
                opacity: 0.85;
            `;
        } else if (isHidden) {
            leftSpan.innerText = item.title + ' [已隐藏]';
            leftSpan.style.cssText = `
                flex: 0 1 auto;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
                opacity: 0.55;
                text-decoration: line-through;
            `;
        } else {
            leftSpan.innerText = item.title;
            leftSpan.style.cssText = `
                flex: 0 1 auto;
                min-width: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
            `;
        }

        const actionContainer = doc.createElement('div');
        actionContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            margin-left: auto;
            flex-shrink: 0;
        `;

        const rightSpan = doc.createElement('span');
        rightSpan.innerText = item.endMesId && item.endMesId !== item.mesId
            ? `#${item.mesId}-${item.endMesId}`
            : `#${item.mesId}`;
        rightSpan.style.cssText = `
            color: var(--SmartThemeEmColor, var(--SmartThemeUnderlineColor, #00afff));
            font-size: 0.85em;
            opacity: 0.8;
            white-space: nowrap;
            flex-shrink: 0;
        `;

        // Highlight rightSpan or row if categorized in target active tab
        const itemTab = ttHandle ? _muluStoreCache?.tabs?.[String(item.mesId)] : msgObj?.extra?.twtMuluTab;
        if (itemTab) {
            rightSpan.style.color = 'var(--SmartThemeUnderlineColor, #007aff)';
            rightSpan.style.opacity = '1';
        }

        actionContainer.appendChild(rightSpan);

        // 自定义勾选框 div
        const checkbox = doc.createElement('div');
        checkbox.className = 'twt-mulu-checkbox';
        checkbox.setAttribute('data-id', item.mesId);
        checkbox.dataset.checked = 'false';
        checkbox.style.cssText = `
            margin-right: 10px;
            cursor: pointer;
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            display: none;
            border: 2px solid var(--SmartThemeUnderlineColor, #007aff);
            border-radius: 3px;
            background: transparent;
            align-items: center;
            justify-content: center;
            color: var(--SmartThemeUnderlineColor, #007aff);
            font-size: 11px;
            box-sizing: border-box;
            transition: background 0.15s;
            user-select: none;
        `;

        row.appendChild(checkbox);
        row.appendChild(leftSpan);
        row.appendChild(actionContainer);

        row.addEventListener('mouseover', () => {
            row.style.backgroundColor = 'var(--SmartThemeBotMesBlurTintColor, rgba(255, 255, 255, 0.05))';
        });
        row.addEventListener('mouseout', () => {
            row.style.backgroundColor = 'transparent';
        });

        // Bind right click and long press
        bindRowContextAndLongPress(row, item.mesId, item.title, msgObj);

        // 统一的 toggle 函数
        const toggleCheckbox = () => {
            const nowChecked = checkbox.dataset.checked !== 'true';
            checkbox.dataset.checked = String(nowChecked);
            checkbox.innerHTML = nowChecked ? '<i class="fa-solid fa-check" style="font-size:11px;"></i>' : '';
            checkbox.style.background = nowChecked ? 'rgba(var(--SmartThemeUnderlineColor-rgb, 0, 122, 255), 0.15)' : 'transparent';
        };

        row.addEventListener('click', async (e) => {
            if (isBatchMode) {
                toggleCheckbox();
                return;
            }
            closeMuluModal();
            await scrollToMessageOrNearest(item.mesId);
        });

        rowFragment.appendChild(row);
    });

    listContainer.appendChild(rowFragment);
    modal.appendChild(listContainer);

    const footer = doc.createElement('div');
    footer.style.cssText = `
        padding: 8px 15px;
        font-size: 0.8em;
        opacity: 0.6;
        text-align: right;
        border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.05));
        background: transparent;
    `;
    footer.innerText = currentActiveMuluTab === '全部'
        ? `共 ${tocItems.length} 条目录`
        : `当前页签: ${filteredTocItems.length} 条 / 共 ${tocItems.length} 条`;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    doc.body.appendChild(overlay);
}

function closeAllMuluDropdowns() {
    const doc = getDoc();
    const dropdowns = [
        'twt-mulu-settings-dropdown',
        'twt-mulu-settings-sub-dropdown',
        'twt-mulu-tc-sub-dropdown',
        'twt-mulu-tag-dropdown',
        'twt-mulu-batch-tag-dropdown'
    ];
    dropdowns.forEach(id => {
        const el = doc.getElementById(id);
        if (el) el.remove();
    });
}

function closeMuluModal() {
    const doc = getDoc();
    const overlay = doc.getElementById('twt-mulu-overlay');
    if (overlay) overlay.remove();
    closeAllMuluDropdowns();
}

function getCleanText(mesText) {
    if (!mesText) return '';
    return mesText
        .replace(/<\/?[^>]+(>|$)/g, "") 
        .replace(/[\#\*\_`~\[\]\(\)\{\}\-\+\!]/g, "") 
        .trim();
}

function extractDirectoryTitle(text, regexStr) {
    if (!regexStr || regexStr.trim() === '') {
        return null;
    }
    try {
        const regex = new RegExp(regexStr, 'm');
        const match = text.match(regex);
        if (match) {
            if (match[1]) {
                return match[1].trim();
            }
            return match[0].trim();
        }
    } catch (e) {
        console.error('Regex match error:', e);
    }
    return null;
}

function scrollToMessage(mes) {
    if (!mes) return;
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;
    
    if (doc.body.classList.contains('twt-reading-mode')) {
        if (typeof activateWindowForMessage === 'function') activateWindowForMessage(mes);
        chatContainer.scrollTop = 0;
        const chatRect = chatContainer.getBoundingClientRect();
        const step = (typeof getColStep === 'function' ? getColStep(chatContainer) : 0) || chatContainer.clientWidth || 1;
        const currentScrollLeft = chatContainer.scrollLeft;
        const rect = mes.getBoundingClientRect();
        const absoluteLeft = rect.left - chatRect.left + currentScrollLeft;
        const targetPage = Math.max(0, Math.floor(absoluteLeft / step));
        chatContainer.scrollLeft = targetPage * step;
        setLastUserPage(targetPage);
        chatContainer.scrollTop = 0;
        if (typeof updateActiveReadingAnchor === 'function') updateActiveReadingAnchor();
    } else {
        mes.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
}

async function scrollToMessageOrNearest(mesId) {
    const doc = getDoc();
    const chatContainer = doc.getElementById('chat');
    if (!chatContainer) return;

    let targetMes = await ensureMessageLoaded(mesId);
    // Check if element exists and is visible (height > 0)
    if (targetMes && targetMes.getBoundingClientRect().height > 0) {
        scrollToMessage(targetMes);
        return;
    }

    // Find the nearest visible message element in DOM
    const context = typeof getContext === 'function' ? getContext() : null;
    const chatArray = context ? context.chat : window.chat;
    if (!chatArray) return;

    let nearestMesId = -1;
    let minDiff = Infinity;

    for (let i = 0; i < chatArray.length; i++) {
        const mesEl = doc.querySelector(`#chat .mes[mesid="${i}"]`);
        if (!mesEl) continue;
        const isExplicitlyHidden = mesEl.style.display === 'none' || (mesEl.classList.contains('twt-toolcall-mes') && doc.body.classList.contains('twt-toolcall-hide'));
        if (!isExplicitlyHidden) {
            const diff = Math.abs(i - mesId);
            if (diff < minDiff) {
                minDiff = diff;
                nearestMesId = i;
            }
        }
    }

    if (nearestMesId !== -1) {
        const nearestMes = doc.querySelector(`#chat .mes[mesid="${nearestMesId}"]`);
        if (nearestMes) {
            scrollToMessage(nearestMes);
            toastr.info(`该消息已隐藏，已为您定位到邻近的第 ${nearestMesId} 条消息`, '提示');
            return;
        }
    }
    toastr.error('无法定位消息元素');
}

export function applyMuluSettings() {
    const settings = extension_settings.twt;
    if (!settings) return;

    const enabled = settings.muluEnabled;
    const qrInject = settings.qrInjectEnabled !== false;
    const doc = getDoc();
    
    const toggleBtn = (id, show, title, icon, action, dblAction = null) => {
        let btn = doc.getElementById(id);
        if (enabled && show && qrInject) {
            if (!btn) {
                btn = createButton(id, title, icon, action, dblAction);
                const btnContainer = doc.querySelector('#qr--bar .qr--buttons') || doc.getElementById('qr--bar');
                if (btnContainer) {
                    btnContainer.prepend(btn);
                }
            }
        } else {
            if (btn) btn.remove();
        }
    };

    toggleBtn(BTN_END_ID, settings.muluBtnEnd, '跳至结尾 / 下一条 (双击直达最末)', 'fa-angle-right', () => scrollToMessageEdge('end'), () => scrollToAbsoluteEdge('end'));
    toggleBtn(BTN_TOC_ID, settings.muluBtnToc, '阅读目录', 'fa-book', showMuluModal);
    toggleBtn(BTN_START_ID, settings.muluBtnStart, '跳至开头 / 上一条 (双击直达最初)', 'fa-angle-left', () => scrollToMessageEdge('start'), () => scrollToAbsoluteEdge('start'));
}

export function jumpToStart(absolute = false) {
    if (absolute) scrollToAbsoluteEdge('start');
    else scrollToMessageEdge('start');
}

export function jumpToEnd(absolute = false) {
    if (absolute) scrollToAbsoluteEdge('end');
    else scrollToMessageEdge('end');
}

export function openMuluModal() {
    showMuluModal();
}

export function initMulu() {
    const doc = getDoc();
    const win = getWin();
    const MutationObserverClass = win.MutationObserver || win.parent?.MutationObserver || window.MutationObserver;
    let muluObsTimer = null;
    const observer = new MutationObserverClass(() => {
        if (muluObsTimer) return;
        muluObsTimer = setTimeout(() => {
            muluObsTimer = null;
            const settings = extension_settings?.twt;
            if (!settings?.muluEnabled || settings.qrInjectEnabled === false) return;
            const needsBtn = (settings.muluBtnToc && !doc.getElementById(BTN_TOC_ID)) ||
                             (settings.muluBtnStart && !doc.getElementById(BTN_START_ID)) ||
                             (settings.muluBtnEnd && !doc.getElementById(BTN_END_ID));
            if (needsBtn && doc.querySelector('#qr--bar .qr--buttons')) {
                applyMuluSettings();
            }
        }, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    
    setTimeout(applyMuluSettings, 1000);
}
