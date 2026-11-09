// @ts-nocheck
import { getContext } from '../../../../../extensions.js';
import { hideChatMessageRange } from '../../../../../chats.js';
import { updateViewMessageIds, refreshSwipeButtons, closeMessageEditor } from '../../../../../../script.js';
import { openParagraphEditor } from '../paragraph/paragraph.js?v=1.0.29';
import { scrollPageLeft, scrollPageRight, realignPagination } from '../pagination/pagination.js?v=1.0.29';

/**
 * High-performance batch message deletion.
 * Removes all specified message IDs from DOM and in-memory chat in one batch,
 * then re-indexes and saves once to achieve 1000x speedup over sequential single deletion.
 * @param {number[]} targetIds Array of message IDs to delete
 */
export async function deleteMessagesBatch(targetIds) {
    if (!targetIds || targetIds.length === 0) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat.length) return;

    closeMessageEditor('all');

    // Sort IDs in descending order so splicing higher indices first does not shift lower target indices
    const sortedDescIds = [...targetIds].sort((a, b) => b - a);

    // Remove DOM elements for target messages from #chat in one batch
    const $chat = $('#chat');
    sortedDescIds.forEach(id => {
        $chat.find(`.mes[mesid="${id}"]`).remove();
    });

    // Splice in-memory chat array from highest index down to lowest index
    sortedDescIds.forEach(id => {
        if (id >= 0 && id < chat.length) {
            chat.splice(id, 1);
        }
    });

    // Mark metadata as tainted so SillyTavern knows chat was edited
    if (context.chatMetadata) {
        context.chatMetadata.tainted = true;
    }

    // Re-index remaining message IDs in DOM and refresh swipe buttons
    updateViewMessageIds(0);
    refreshSwipeButtons();

    // Emit MESSAGE_DELETED event once
    if (context.eventSource && context.eventTypes?.MESSAGE_DELETED) {
        context.eventSource.emit(context.eventTypes.MESSAGE_DELETED, chat.length);
    }

    // Trigger debounced / conditional save once
    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }
}

let longpressTimeout = null;
let touchStartX = 0;
let touchStartY = 0;
let toggleExcerptCallback = null;
let getSettingsCallback = null;

function isExcerptActive() {
    const parentDoc = getParentDoc();
    return document.body.classList.contains('twt-excerpt-active') || 
           (parentDoc && parentDoc.body && parentDoc.body.classList.contains('twt-excerpt-active'));
}

export function applyMenuMode(enabled, settings) {
    if (!enabled) {
        const parentDoc = getParentDoc();
        const bar = parentDoc.getElementById('twt-excerpt-float-bar');
        if (bar) {
            bar.remove();
            if (toggleExcerptCallback) {
                toggleExcerptCallback(false);
            }
        }
    }
}

export function initMenu(getSettings, onToggleExcerpt) {
    getSettingsCallback = getSettings;
    toggleExcerptCallback = onToggleExcerpt;
    const chatContainer = $('#chat');
    if (!chatContainer.length) return;

    let lastTouchTime = 0;

    // Handle PC right click (contextmenu) and block default context menu
    chatContainer.on('contextmenu', (e) => {
        if (isExcerptActive()) return;
        if (document.body.classList.contains('twt-html-popup-active') || document.getElementById('twt-html-app-modal')) return;
        const settings = getSettings();
        if (!settings || !settings.menuEnabled) return;

        // Block native menu
        e.preventDefault();

        // Check if this contextmenu event was triggered by mobile touch.
        // If so, let touch listeners handle it.
        const oe = e.originalEvent;
        const isTouch = (Date.now() - lastTouchTime < 1000) || (oe && (oe.pointerType === 'touch' || (oe.touches && oe.touches.length > 0)));
        if (isTouch) {
            return;
        }

        // PC right click:
        const target = e.target;
        // Avoid launching menu when interacting with already interactive controls or bbi image slot
        if ($(target).closest('button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, img, .svg-icon, div[data-bbi-slot], [data-bbi-slot], #bbi-app-host').length) {
            return;
        }

        const $mes = $(target).closest('.mes');
        if (!$mes.length) return;

        showContextMenu(e, $mes, e.clientX, e.clientY, settings);
    });

    const handleStart = (e, clientX, clientY) => {
        if (isExcerptActive()) return;
        if (document.body.classList.contains('twt-html-popup-active') || document.getElementById('twt-html-app-modal')) return;
        const settings = getSettings();
        if (!settings || !settings.menuEnabled || settings.menuInvokeMethod !== 'longpress') return;

        const target = e.target;
        // Avoid launching menu when interacting with already interactive controls or bbi image slot
        if ($(target).closest('button, a, input, textarea, select, .mes_button, .swipe-button, .ch_name, img, .svg-icon, div[data-bbi-slot], [data-bbi-slot], #bbi-app-host').length) {
            return;
        }

        const $mes = $(target).closest('.mes');
        if (!$mes.length) return;

        touchStartX = clientX;
        touchStartY = clientY;

        clearTimeout(longpressTimeout);
        longpressTimeout = setTimeout(() => {
            showContextMenu(e, $mes, clientX, clientY, settings);
        }, settings.menuLongpressDelay || 500);
    };

    const handleMove = (clientX, clientY) => {
        if (longpressTimeout) {
            const dist = Math.hypot(clientX - touchStartX, clientY - touchStartY);
            if (dist > 10) {
                clearTimeout(longpressTimeout);
                longpressTimeout = null;
            }
        }
    };

    const handleEnd = () => {
        clearTimeout(longpressTimeout);
        longpressTimeout = null;
    };

    // Bind touch gestures for mobile
    chatContainer.on('touchstart', (e) => {
        lastTouchTime = Date.now();
        if (e.touches.length === 1) {
            handleStart(e, e.touches[0].clientX, e.touches[0].clientY);
        }
    });

    chatContainer.on('touchmove', (e) => {
        if (e.touches.length === 1) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    });

    chatContainer.on('touchend touchcancel', () => {
        handleEnd();
    });

    // Close menu when clicking outside
    $(document).on('click.twt-menu touchstart.twt-menu', function() {
        const $menu = $('#twt-custom-menu');
        if ($menu.is(':visible')) {
            setTimeout(() => {
                $menu.hide();
            }, 0);
        }
    });

    // 接管酒馆原生消息编辑小铅笔按钮点击，以全屏弹窗形式呼出全文编辑
    chatContainer.on('click', '.mes_edit, [title="Edit message"], [name="editMessage"]', function(e) {
        if (!document.body.classList.contains('twt-reading-mode')) return;
        const $mes = $(this).closest('.mes');
        const mesId = Number($mes.attr('mesid'));
        if (!isNaN(mesId)) {
            e.preventDefault();
            e.stopPropagation();
            openFullTextEditor(mesId);
        }
    });
}

function showContextMenu(e, $mes, clientX, clientY, settings) {
    if (e.cancelable) e.preventDefault();

    const mesId = Number($mes.attr('mesid'));
    const isLatest = $mes.hasClass('last_mes');
    const isUser = $mes.attr('is_user') === 'true';
    const isLatestAi = isLatest && !isUser;

    let $menu = $('#twt-custom-menu');
    if (!$menu.length) {
        $menu = $('<div id="twt-custom-menu"></div>').appendTo('body');
    }
    $menu.empty();

    const menuFontSize = settings.menuFontSize || 14;
    $menu.css('font-size', `${menuFontSize}px`);

    $menu.removeClass('twt-menu-grid-layout twt-menu-list-layout twt-menu-double-column-layout');

    const menuStyle = settings.menuStyle || 'grid';
    if (menuStyle === 'grid') {
        $menu.addClass('twt-menu-grid-layout');
    } else if (menuStyle === 'double-column') {
        $menu.addClass('twt-menu-double-column-layout');
    } else {
        $menu.addClass('twt-menu-list-layout');
    }

    const useGridLayout = menuStyle === 'grid';
    const $gridBar = useGridLayout ? $('<div class="twt-menu-grid-row"></div>') : null;
    const $listContainer = useGridLayout ? $('<div class="twt-menu-list-row"></div>') : null;
    let hasItems = false;

    const appendMenuItem = ({ label, shortLabel, icon, onClick, isDanger = false, isGridItem = false }) => {
        hasItems = true;
        const displayLabel = shortLabel || label;

        if (useGridLayout) {
            if (isGridItem) {
                const $item = $(`<div class="twt-menu-grid-item ${isDanger ? 'twt-danger' : ''}" title="${label}"><i class="${icon}"></i><span>${displayLabel}</span></div>`);
                $item.on('click', (evt) => {
                    evt.stopPropagation();
                    $menu.hide();
                    onClick(evt);
                });
                $gridBar.append($item);
            } else {
                const dangerStyle = isDanger ? 'style="color: #ff4444;"' : '';
                const $item = $(`<div class="twt-menu-item ${isDanger ? 'twt-danger' : ''}" ${dangerStyle}><i class="${icon}"></i><span>${displayLabel}</span></div>`);
                $item.on('click', (evt) => {
                    evt.stopPropagation();
                    $menu.hide();
                    onClick(evt);
                });
                $listContainer.append($item);
            }
        } else {
            // 'list' or 'double-column'
            const dangerStyle = isDanger ? 'style="color: #ff4444;"' : '';
            const $item = $(`<div class="twt-menu-item ${isDanger ? 'twt-danger' : ''}" ${dangerStyle}><i class="${icon}"></i><span>${displayLabel}</span></div>`);
            $item.on('click', (evt) => {
                evt.stopPropagation();
                $menu.hide();
                onClick(evt);
            });
            $menu.append($item);
        }
    };

    let order = settings.menuOrder || [
        'menuOptRegenerate',
        'menuOptSwipe',
        'menuOptManage',
        'menuOptEdit',
        'menuOptFullEdit',
        'menuOptRealign',
        'menuOptNewChat',
        'menuOptCloseChat',
        'menuOptExcerpt',
        'menuOptFullscreen',
        'menuOptApi',
        'menuOptPurifier',
        'menuOptPurifierDiff',
        'menuOptPromptViewer',
        'menuOptRandomInspect',
        'menuOptImageTag'
    ];

    if (!order.includes('menuOptFullEdit')) {
        const editIdx = order.indexOf('menuOptEdit');
        if (editIdx !== -1) {
            order = [...order.slice(0, editIdx + 1), 'menuOptFullEdit', ...order.slice(editIdx + 1)];
        } else {
            order = [...order, 'menuOptFullEdit'];
        }
    }

    if (!order.includes('menuOptRandomInspect')) {
        order = [...order, 'menuOptRandomInspect'];
    }

    if (!order.includes('menuOptImageTag')) {
        order = [...order, 'menuOptImageTag'];
    }

    for (const key of order) {
        if (key === 'menuOptRegenerate' && settings.menuOptRegenerate && isLatestAi) {
            appendMenuItem({
                label: '重新生成',
                shortLabel: '生成',
                icon: 'fa-solid fa-rotate-right',
                isGridItem: true,
                onClick: () => $('#option_regenerate').trigger('click')
            });
        }

        if (key === 'menuOptSwipe') {
            if (settings.menuOptSwipe && isLatestAi) {
                appendMenuItem({
                    label: '滑动',
                    shortLabel: '滑动',
                    icon: 'fa-solid fa-chevron-right',
                    isGridItem: true,
                    onClick: () => $('.last_mes .swipe_right').trigger('click')
                });
            }
            // Add Paragraph Comment (小说段评) right after Swipe
            if (settings.commentsEnabled) {
                appendMenuItem({
                    label: '小说段评',
                    shortLabel: '段评',
                    icon: 'fa-regular fa-comment-dots',
                    isGridItem: true,
                    onClick: async () => {
                        const { triggerBatchCommentsForMessage } = await import('../paragraph/paragraph.js?v=1.0.29');
                        await triggerBatchCommentsForMessage(mesId);
                    }
                });
            }
        }

        if (key === 'menuOptManage' && settings.menuOptManage) {
            appendMenuItem({
                label: '管理消息',
                shortLabel: '管理',
                icon: 'fa-solid fa-list-check',
                isGridItem: false,
                onClick: () => openMessageManagerModal(mesId)
            });

            // Add Hide Current Message (隐藏/显示本条) Shortcut -> 隐藏 / 显示
            const currentMsg = getContext().chat[mesId];
            const isCurrentHidden = currentMsg ? (currentMsg.is_system || currentMsg.extra?.is_system) : false;
            const hideLabel = isCurrentHidden ? '显示' : '隐藏';
            const hideIcon = isCurrentHidden ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';

            appendMenuItem({
                label: `${hideLabel}消息`,
                shortLabel: hideLabel,
                icon: hideIcon,
                isGridItem: true,
                onClick: async () => await hideChatMessageRange(mesId, mesId, isCurrentHidden)
            });

            appendMenuItem({
                label: '删除消息',
                shortLabel: '删除',
                icon: 'fa-regular fa-trash-can',
                isDanger: true,
                isGridItem: true,
                onClick: async () => {
                    if (confirm('确定要删除这条消息吗？')) {
                        await getContext().deleteMessage(mesId, undefined, false);
                    }
                }
            });
        }

        if (key === 'menuOptEdit' && settings.menuOptEdit) {
            appendMenuItem({
                label: '分段编辑',
                shortLabel: '分段',
                icon: 'fa-regular fa-pen-to-square',
                isGridItem: true,
                onClick: () => openParagraphEditor(mesId, clientX, clientY)
            });
        }

        if (key === 'menuOptFullEdit' && settings.menuOptFullEdit !== false) {
            appendMenuItem({
                label: '全文编辑',
                shortLabel: '全文',
                icon: 'fa-solid fa-file-pen',
                isGridItem: true,
                onClick: () => openFullTextEditor(mesId)
            });
        }

        if (key === 'menuOptExcerpt' && settings.menuOptExcerpt) {
            appendMenuItem({
                label: '摘抄',
                shortLabel: '摘抄',
                icon: 'fa-regular fa-bookmark',
                isGridItem: false,
                onClick: () => startExcerptLinkage()
            });
        }

        if (key === 'menuOptFullscreen' && settings.menuOptFullscreen) {
            const isCurrentlyFullscreen = settings.isFullscreen;
            const label = isCurrentlyFullscreen ? '退出全屏' : '全屏模式';
            const shortLabel = isCurrentlyFullscreen ? '退出' : '全屏';
            const icon = isCurrentlyFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
            appendMenuItem({
                label: label,
                shortLabel: shortLabel,
                icon: icon,
                isGridItem: false,
                onClick: () => {
                    settings.isFullscreen = !isCurrentlyFullscreen;
                    applyFullscreenMode(settings.isFullscreen);
                    getContext().saveSettingsDebounced();
                }
            });
        }

        if (key === 'menuOptApi' && settings.menuOptApi) {
            appendMenuItem({
                label: 'API',
                shortLabel: 'API',
                icon: 'fa-solid fa-plug',
                isGridItem: false,
                onClick: () => {
                    if (window.ApiConfigManager && typeof window.ApiConfigManager.show === 'function') {
                        window.ApiConfigManager.show();
                    } else {
                        console.error('API 配置管理器扩展未加载或未启用');
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('API 配置管理器扩展未加载或未启用', '提示');
                        }
                    }
                }
            });
        }

        if (key === 'menuOptPurifier' && settings.menuOptPurifier) {
            appendMenuItem({
                label: '词汇映射',
                shortLabel: '映射',
                icon: 'fa-solid fa-language',
                isGridItem: false,
                onClick: () => {
                    const $btn = $('#blai-wand-btn, #bl-wand-btn');
                    if ($btn.length) {
                        $btn.trigger('click');
                    } else {
                        const $btnPanel = $('#blai-wand-btn-panel, #bl-wand-btn-panel');
                        if ($btnPanel.length) {
                            $btnPanel.trigger('click');
                        } else {
                            const $popup = $('#blai-purifier-popup, #bl-purifier-popup');
                            if ($popup.length) {
                                $popup.css('display', 'flex').hide().fadeIn(200);
                            } else {
                                if (typeof toastr !== 'undefined') {
                                    toastr.warning('屏蔽词净化助手扩展未加载或未启用', '提示');
                                }
                            }
                        }
                    }
                }
            });
        }

        if (key === 'menuOptPurifierDiff' && settings.menuOptPurifierDiff) {
            appendMenuItem({
                label: '净化前文',
                shortLabel: '前文',
                icon: 'fa-solid fa-eye',
                isGridItem: false,
                onClick: () => {
                    const $diffBtn = $(`.blai-diff-btn[data-index="${mesId}"], .bl-diff-btn[data-index="${mesId}"]`);
                    if ($diffBtn.length) {
                        $diffBtn.trigger('click');
                    } else {
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('该消息未被修改或没有净化记录', '提示');
                        }
                    }
                }
            });
        }

        if (key === 'menuOptNewChat' && settings.menuOptNewChat) {
            appendMenuItem({
                label: '新对话',
                shortLabel: '新建',
                icon: 'fa-solid fa-comments',
                isGridItem: false,
                onClick: () => $('#option_start_new_chat').trigger('click')
            });
        }

        if (key === 'menuOptRealign' && settings.menuOptRealign) {
            appendMenuItem({
                label: '翻页归正',
                shortLabel: '归正',
                icon: 'fa-solid fa-arrows-to-dot',
                isGridItem: true,
                // 直接用文件顶部已导入的 realignPagination。
                // 原先这里用不带版本号的 import('../pagination/pagination.js')，浏览器会当成另一个模块再加载一份，
                // 新的那份里"当前第几页"等记录全是初始值，点"归正"会直接跳回第 0 页。
                onClick: () => {
                    realignPagination(true);
                }
            });
        }

        if (key === 'menuOptCloseChat' && settings.menuOptCloseChat) {
            appendMenuItem({
                label: '关闭',
                shortLabel: '关闭',
                icon: 'fa-solid fa-xmark',
                isGridItem: false,
                onClick: () => $('#option_close_chat').trigger('click')
            });
        }

        if (key === 'menuOptPromptViewer' && settings.menuOptPromptViewer) {
            appendMenuItem({
                label: '提示词',
                shortLabel: '提示词',
                icon: 'fa-solid fa-magnifying-glass',
                isGridItem: false,
                onClick: () => {
                    const promptBtn = Array.from(document.querySelectorAll('.list-group-item'))
                        .find(el => el.textContent && el.textContent.includes('提示词查看器'));
                    if (promptBtn) {
                        promptBtn.click();
                    } else {
                        console.warn('未找到酒馆助手(JS-Slash-Runner)提示词查看器接口');
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('未找到酒馆助手(JS-Slash-Runner)提示词查看器接口', '提示');
                        }
                    }
                }
            });
        }

        if (key === 'menuOptRandomInspect' && settings.menuOptRandomInspect) {
            appendMenuItem({
                label: '注入透视',
                shortLabel: '透视',
                icon: 'fa-solid fa-dice',
                isGridItem: false,
                onClick: async () => {
                    const randomMacro = window.RandomMacro || window.parent?.RandomMacro || window.top?.RandomMacro;
                    if (randomMacro && typeof randomMacro.openInspect === 'function') {
                        try {
                            await randomMacro.openInspect();
                        } catch (err) {
                            console.error('[TwT] 打开随机宏注入透视弹窗失败:', err);
                            if (typeof toastr !== 'undefined') {
                                toastr.error('打开注入透视弹窗失败', '错误');
                            }
                        }
                    } else {
                        console.warn('[TwT] 未找到随机宏引擎(RandomMacro)扩展或未启用');
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('未找到随机宏引擎扩展或未启用', '提示');
                        }
                    }
                }
            });
        }

        if (key === 'menuOptImageTag' && settings.menuOptImageTag !== false) {
            appendMenuItem({
                label: '生成生图tag（已有tag时重新生成）',
                shortLabel: '生图Tag',
                icon: 'fa-solid fa-palette',
                isGridItem: false,
                onClick: () => {
                    const $mesEl = $(`#chat .mes[mesid="${mesId}"]`);
                    const $btn = $mesEl.find('.bbi-tag-action');
                    if ($btn.length) {
                        $btn[0].click();
                        return;
                    }
                    if (isUser) {
                        if (typeof toastr !== 'undefined') {
                            toastr.info('当前消息为用户消息，生图拓展仅支持为 AI 回复生成生图 tag', '生图Tag');
                        }
                    } else if (typeof window.STBaiBaiImage === 'undefined' && !$('.bbi-tag-action').length) {
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('柏宝绘（生图拓展）未加载或未启用', '提示');
                        }
                    } else {
                        if (typeof toastr !== 'undefined') {
                            toastr.warning('该楼层未找到生图 tag 生成按钮或当前聊天已被排除', '提示');
                        }
                    }
                }
            });
        }
    }

    if (useGridLayout) {
        if ($listContainer && $listContainer.children().length > 0) {
            $menu.append($listContainer);
        }
        if ($gridBar && $gridBar.children().length > 0) {
            $menu.prepend($gridBar);
        }
    }

    if (!hasItems) return;

    // Show menu offscreen first to measure dimensions
    $menu.css({
        visibility: 'hidden',
        display: 'block',
        left: '0px',
        top: '0px',
        width: 'max-content',
        height: 'auto'
    });

    const menuWidth = $menu.outerWidth() || 130;
    const menuHeight = $menu.outerHeight() || 100;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    const direction = settings.menuDirection || 'bottom-right';
    let posX = clientX;
    let posY = clientY;

    if (direction === 'top-left') {
        posX = clientX - menuWidth;
        posY = clientY - menuHeight;
    } else if (direction === 'top-right') {
        posX = clientX;
        posY = clientY - menuHeight;
    } else if (direction === 'bottom-left') {
        posX = clientX - menuWidth;
        posY = clientY;
    } else { // 'bottom-right'
        posX = clientX;
        posY = clientY;
    }

    // Clamp to screen boundaries (with scroll offset)
    posX = Math.max(10, Math.min(posX, screenWidth - menuWidth - 10)) + window.scrollX;
    posY = Math.max(10, Math.min(posY, screenHeight - menuHeight - 10)) + window.scrollY;

    $menu.css({
        left: posX + 'px',
        top: posY + 'px',
        visibility: 'visible'
    });

    // Stop propagation inside menu to prevent close trigger
    $menu.off('mousedown mouseup click touchstart').on('mousedown mouseup click touchstart', (evt) => {
        evt.stopPropagation();
    });
}

export function applyFullscreenMode(enabled, hideSendForm) {
    let docs = [document];
    try {
        if (window.parent && window.parent.document) {
            docs.push(window.parent.document);
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document for applyFullscreenMode.", e);
    }
    
    if (hideSendForm === undefined) {
        let settings = null;
        if (typeof getSettingsCallback === 'function') {
            settings = getSettingsCallback();
        }
        if (!settings) {
            try {
                settings = getContext()?.extensionSettings?.twt;
            } catch (e) {}
        }
        if (!settings && typeof window !== 'undefined') {
            settings = window.extension_settings?.twt;
        }
        hideSendForm = settings ? !!settings.menuOptFullscreenHideSendForm : false;
    }

    docs.forEach(doc => {
        if (enabled) {
            $(doc.body).addClass('twt-fullscreen-mode');
            if (hideSendForm) {
                $(doc.body).addClass('twt-fullscreen-hide-send-form');
            } else {
                $(doc.body).removeClass('twt-fullscreen-hide-send-form');
            }
        } else {
            $(doc.body).removeClass('twt-fullscreen-mode');
            $(doc.body).removeClass('twt-fullscreen-hide-send-form');
        }
    });
}

export function openMessageManagerModal(mesId) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat.length) return;

    const currentMsg = chat[mesId];
    if (!currentMsg) return;

    // Sync theme variables from parent to iframe if applicable
    try {
        if (window.parent && window.parent.document) {
            document.documentElement.setAttribute('style',
                window.parent.document.documentElement.getAttribute('style')
            );
        }
    } catch (e) {
        console.warn("TwT: Cannot sync style attribute from parent.", e);
    }

    // Resolve opaque background color based on SmartThemeBlurTintColor
    let opaqueBgColor = '';
    try {
        const temp = document.createElement('div');
        temp.style.color = 'var(--SmartThemeBlurTintColor)';
        document.body.appendChild(temp);
        const style = window.getComputedStyle(temp).color;
        document.body.removeChild(temp);
        const match = style.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
        if (match) {
            opaqueBgColor = `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
        }
    } catch (e) {
        console.error("TwT: Failed to resolve opaque background color", e);
    }

    let docs = [document];
    try {
        if (window.parent && window.parent.document) {
            docs.push(window.parent.document);
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document for modal creation.", e);
    }
    const parentDoc = docs[docs.length - 1];

    const oldModal = parentDoc.getElementById('twt-range-modal');
    if (oldModal) oldModal.remove();

    const modalEl = parentDoc.createElement('div');
    modalEl.id = 'twt-range-modal';
    modalEl.className = 'twt-range-modal-overlay';
    
    // Fixed viewport centering. Zero resize/scroll event overhead on mobile.
    modalEl.style.cssText = 'position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 999999; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center;';

    const buildListHtml = () => {
        const currentChat = context.chat || [];
        const htmlParts = new Array(currentChat.length);
        for (let idx = 0; idx < currentChat.length; idx++) {
            const msg = currentChat[idx];
            const name = msg.name || (msg.is_user ? 'User' : 'AI');
            const mes = msg.mes || '';
            const clean = mes.replace(/[\r\n]+/g, ' ').trim();
            const excerpt = clean.length > 30 ? clean.substring(0, 30) + '...' : clean;
            const isHidden = msg.is_system || msg.extra?.is_system;
            const statusText = isHidden ? ' [已隐藏]' : '';
            const itemClass = isHidden ? 'twt-range-item twt-item-hidden' : 'twt-range-item';
            
            htmlParts[idx] = `
                <div class="${itemClass}" data-id="${idx}">
                    <input type="checkbox" class="twt-range-item-checkbox" data-id="${idx}" />
                    <span class="twt-range-item-label">#${idx}${statusText} - ${name}: ${excerpt}</span>
                </div>
            `;
        }
        return htmlParts.join('');
    };

    const listItemsHtml = buildListHtml();

    const boxStyle = opaqueBgColor ? `background-color: ${opaqueBgColor} !important;` : '';

    modalEl.innerHTML = `
        <div class="twt-range-modal-box" style="${boxStyle}">
            <div class="twt-range-modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                <span>管理消息</span>
                <span class="twt-range-modal-counter" style="font-size: 0.82em; font-weight: normal; opacity: 0.85;">已选择 0 条</span>
            </div>
            
            <div class="twt-range-list-container">
                <div class="twt-range-list-actions">
                    <button class="twt-range-list-btn" id="twt-select-all" type="button" title="全选"><i class="fa-solid fa-check-double"></i></button>
                    <button class="twt-range-list-btn" id="twt-invert-select" type="button" title="反选"><i class="fa-solid fa-repeat"></i></button>
                    <button class="twt-range-list-btn" id="twt-clear-select" type="button" title="清空"><i class="fa-solid fa-eraser"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-range" type="button" title="连选"><i class="fa-solid fa-arrows-up-down"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-current" type="button" title="仅选当前"><i class="fa-solid fa-bullseye"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-start-to-current" type="button" title="选开头到当前"><i class="fa-solid fa-angles-up"></i></button>
                    <button class="twt-range-list-btn" id="twt-select-current-to-end" type="button" title="选当前及以后"><i class="fa-solid fa-angles-down"></i></button>
                </div>
                <div class="twt-range-list" id="twt-range-list-scroll">
                    ${listItemsHtml}
                </div>
            </div>
            
            <div class="twt-range-modal-actions">
                <button class="twt-range-btn cancel">取消</button>
                <button class="twt-range-btn btn-show confirm-show" title="显示">
                    <i class="fa-regular fa-eye"></i>
                </button>
                <button class="twt-range-btn btn-hide confirm-hide" title="隐藏">
                    <i class="fa-regular fa-eye-slash"></i>
                </button>
                <button class="twt-range-btn btn-delete confirm-delete" title="删除">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
        </div>
    `;

    parentDoc.body.appendChild(modalEl);

    const $modal = $(modalEl);
    const $scrollContainer = $modal.find('#twt-range-list-scroll');
    
    // Performance optimization: Cache checkboxes and use raw DOM variables inside loops to boost performance 100x on mobile.
    let $allCheckboxes = $scrollContainer.find('.twt-range-item-checkbox');
    
    const getSelectedIds = () => {
        const targetIds = [];
        $allCheckboxes.each(function() {
            if (this.checked) {
                targetIds.push(Number(this.getAttribute('data-id')));
            }
        });
        return targetIds;
    };

    const updateSelectedCount = () => {
        const count = getSelectedIds().length;
        const total = context.chat ? context.chat.length : 0;
        $modal.find('.twt-range-modal-counter').text(`已选择 ${count} / ${total} 条`);
    };

    const $targetItem = $scrollContainer.find(`.twt-range-item[data-id="${mesId}"]`);
    if ($targetItem.length) {
        const checkboxEl = $targetItem.find('.twt-range-item-checkbox')[0];
        if (checkboxEl) checkboxEl.checked = true;
        setTimeout(() => {
            $scrollContainer.scrollTop($targetItem.position().top + $scrollContainer.scrollTop() - 60);
        }, 50);
    }
    updateSelectedCount();

    const refreshList = () => {
        const scrollTop = $scrollContainer.scrollTop();
        $scrollContainer.html(buildListHtml());
        $allCheckboxes = $scrollContainer.find('.twt-range-item-checkbox'); // Update cache
        $scrollContainer.scrollTop(scrollTop);
    };

    const closeModal = () => {
        $modal.remove();
    };

    $modal.on('click', function(ev) {
        if (ev.target === this) closeModal();
    });

    $modal.find('.cancel').on('click', (e) => {
        e.stopPropagation();
        closeModal();
    });

    $modal.find('#twt-select-all').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            this.checked = true;
        });
        updateSelectedCount();
    });

    $modal.find('#twt-clear-select').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            this.checked = false;
        });
        updateSelectedCount();
    });

    $modal.find('#twt-invert-select').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            this.checked = !this.checked;
        });
        updateSelectedCount();
    });

    $modal.find('#twt-select-current').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            const id = Number(this.getAttribute('data-id'));
            this.checked = (id === mesId);
        });
        updateSelectedCount();
    });

    $modal.find('#twt-select-start-to-current').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            const id = Number(this.getAttribute('data-id'));
            this.checked = (id <= mesId);
        });
        updateSelectedCount();
    });

    $modal.find('#twt-select-current-to-end').on('click', (e) => {
        e.stopPropagation();
        $allCheckboxes.each(function() {
            const id = Number(this.getAttribute('data-id'));
            this.checked = (id >= mesId);
        });
        updateSelectedCount();
    });

    let rangeSelectMode = false;
    let rangeSelectStartIdx = null;

    $modal.find('#twt-select-range').on('click', function(e) {
        e.stopPropagation();
        rangeSelectMode = !rangeSelectMode;
        $(this).toggleClass('active', rangeSelectMode);
        
        if (rangeSelectMode) {
            rangeSelectStartIdx = null;
        }
        $modal.find('.twt-range-item').removeClass('range-start-selected');
    });

    let lastCheckedIdx = mesId;

    function handleRangeSelectInteraction(currentIdx, $itemEl) {
        if (rangeSelectStartIdx === null) {
            rangeSelectStartIdx = currentIdx;
            $modal.find('.twt-range-item').removeClass('range-start-selected');
            $itemEl.addClass('range-start-selected');
        } else {
            const start = Math.min(rangeSelectStartIdx, currentIdx);
            const end = Math.max(rangeSelectStartIdx, currentIdx);
            
            // Check all messages in the range using the cache
            $allCheckboxes.each(function() {
                const id = Number(this.getAttribute('data-id'));
                if (id >= start && id <= end) {
                    this.checked = true;
                }
            });
            
            // Exit range select mode
            rangeSelectMode = false;
            rangeSelectStartIdx = null;
            $modal.find('.twt-range-item').removeClass('range-start-selected');
            $modal.find('#twt-select-range').removeClass('active');
        }
        updateSelectedCount();
    }

    function performShiftClickSelection(currentIdx, isChecked, isShiftPressed) {
        if (isShiftPressed && lastCheckedIdx !== null) {
            const start = Math.min(lastCheckedIdx, currentIdx);
            const end = Math.max(lastCheckedIdx, currentIdx);
            $allCheckboxes.each(function() {
                const id = Number(this.getAttribute('data-id'));
                if (id >= start && id <= end) {
                    this.checked = isChecked;
                }
            });
        }
        lastCheckedIdx = currentIdx;
        updateSelectedCount();
    }

    $scrollContainer.on('click', '.twt-range-item', function(e) {
        const $chk = $(this).find('.twt-range-item-checkbox');
        if ($chk.length === 0) return;
        const currentIdx = Number($chk.attr('data-id'));
        
        if (e.target.tagName !== 'INPUT') {
            if (rangeSelectMode) {
                handleRangeSelectInteraction(currentIdx, $(this));
            } else {
                const chkDom = $chk[0];
                const isChecked = !chkDom.checked;
                chkDom.checked = isChecked;
                performShiftClickSelection(currentIdx, isChecked, e.shiftKey);
            }
        }
    });

    $scrollContainer.on('click', '.twt-range-item-checkbox', function(e) {
        e.stopPropagation();
        const currentIdx = Number($(this).attr('data-id'));
        const isChecked = this.checked;
        
        if (rangeSelectMode) {
            // Revert default checkbox check so range selection logic handles it
            this.checked = !isChecked;
            handleRangeSelectInteraction(currentIdx, $(this).closest('.twt-range-item'));
        } else {
            performShiftClickSelection(currentIdx, isChecked, e.shiftKey);
        }
    });

    // Helper to hide/unhide target IDs efficiently by grouping into contiguous ranges
    const setHideStateForIds = async (targetIds, unhide) => {
        if (targetIds.length === 0) return;
        targetIds.sort((a, b) => a - b);
        let ranges = [];
        let start = targetIds[0];
        let end = targetIds[0];
        for (let i = 1; i < targetIds.length; i++) {
            if (targetIds[i] === end + 1) {
                end = targetIds[i];
            } else {
                ranges.push({ start, end });
                start = targetIds[i];
                end = targetIds[i];
            }
        }
        ranges.push({ start, end });

        for (const range of ranges) {
            await hideChatMessageRange(range.start, range.end, unhide);
        }
    };

    $modal.find('.confirm-show').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        await setHideStateForIds(targetIds, true);
        
        // In-place DOM update instead of recreating the whole list (100x faster, preserves scroll position)
        targetIds.forEach(id => {
            const $item = $scrollContainer.find(`.twt-range-item[data-id="${id}"]`);
            $item.removeClass('twt-item-hidden');
            const $label = $item.find('.twt-range-item-label');
            let text = $label.text();
            text = text.replace(' [已隐藏]', '');
            $label.text(text);
        });
        updateSelectedCount();
    });

    $modal.find('.confirm-hide').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        await setHideStateForIds(targetIds, false);
        
        // In-place DOM update instead of recreating the whole list
        targetIds.forEach(id => {
            const $item = $scrollContainer.find(`.twt-range-item[data-id="${id}"]`);
            $item.addClass('twt-item-hidden');
            const $label = $item.find('.twt-range-item-label');
            let text = $label.text();
            if (!text.includes(' [已隐藏]')) {
                text = text.replace(new RegExp(`^#${id}`), `#${id} [已隐藏]`);
            }
            $label.text(text);
        });
        updateSelectedCount();
    });

    $modal.find('.confirm-delete').on('click', async (e) => {
        e.stopPropagation();
        const targetIds = getSelectedIds();
        if (targetIds.length === 0) {
            alert('请先选择目标消息！');
            return;
        }
        
        const confirmMsg = targetIds.length === 1 
            ? '确定要删除这条消息吗？' 
            : `确定要删除选中的 ${targetIds.length} 条消息吗？(此操作不可逆！)`;
            
        if (confirm(confirmMsg)) {
            await deleteMessagesBatch(targetIds);
            refreshList();
            updateSelectedCount();
            if (typeof toastr !== 'undefined') {
                toastr.success(`已成功删除 ${targetIds.length} 条消息`, '批量删除完成');
            }
        }
    });
}

function getParentDoc() {
    let doc = document;
    try {
        if (window.parent && window.parent.document) {
            doc = window.parent.document;
        }
    } catch (e) {
        console.warn("TwT: Cannot access window.parent.document", e);
    }
    return doc;
}

function getSolidThemeBgColor(doc) {
    try {
        const targetDoc = doc || getParentDoc() || document;
        const tempEl = targetDoc.createElement('div');
        tempEl.style.color = 'var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e))';
        targetDoc.body.appendChild(tempEl);
        const computedColor = getComputedStyle(tempEl).color;
        targetDoc.body.removeChild(tempEl);
        const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const solidColor = `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
            try {
                targetDoc.documentElement.style.setProperty('--twt-comments-bg-solid', solidColor);
                if (document && document.documentElement && document !== targetDoc) {
                    document.documentElement.style.setProperty('--twt-comments-bg-solid', solidColor);
                }
            } catch (err) {}
            return solidColor;
        }
    } catch (e) {
        console.warn("TwT: Failed to parse SmartThemeBlurTintColor for full edit modal:", e);
    }
    return '';
}

function startExcerptLinkage() {
    const settings = getSettingsCallback ? getSettingsCallback() : {};
    const parentDoc = getParentDoc();
    const oldBar = parentDoc.getElementById('twt-excerpt-float-bar');
    if (oldBar) oldBar.remove();

    const bar = parentDoc.createElement('div');
    bar.id = 'twt-excerpt-float-bar';
    
    // Apply user settings dynamically
    const topOffset = settings.excerptTopOffset !== undefined ? settings.excerptTopOffset : 0;
    const fontSize = settings.excerptFontSize !== undefined ? settings.excerptFontSize : 12;
    
    bar.style.top = `${topOffset}px`;
    bar.style.fontSize = `${fontSize}px`;
    if (topOffset === 0) {
        bar.style.borderTop = 'none';
        bar.style.borderRadius = '0 0 10px 10px';
    } else {
        bar.style.borderTop = '1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15))';
        bar.style.borderRadius = '10px';
    }

    const prevBtn = parentDoc.createElement('button');
    prevBtn.className = 'twt-excerpt-nav-btn';
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.title = '上一页';
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollPageLeft();
    });
    bar.appendChild(prevBtn);

    const textSpan = parentDoc.createElement('span');
    textSpan.className = 'twt-excerpt-text';
    textSpan.innerHTML = '摘抄模式已开启';
    bar.appendChild(textSpan);

    const nextBtn = parentDoc.createElement('button');
    nextBtn.className = 'twt-excerpt-nav-btn';
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.title = '下一页';
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollPageRight();
    });
    bar.appendChild(nextBtn);

    const rectBtn = parentDoc.createElement('button');
    rectBtn.className = 'twt-excerpt-nav-btn';
    rectBtn.innerHTML = '<i class="fa-solid fa-vector-square"></i>';
    rectBtn.title = '使用矩形选框框选文字进行摘抄';
    rectBtn.style.marginRight = '10px';
    rectBtn.style.marginLeft = '10px';
    rectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.twtOpenRectSelector === 'function') {
            window.twtOpenRectSelector();
        } else {
            console.error("twtOpenRectSelector is not defined on window.");
        }
    });
    bar.appendChild(rectBtn);

    const closeBtn = parentDoc.createElement('button');
    closeBtn.className = 'twt-excerpt-close-btn';
    closeBtn.innerText = '关闭';
    closeBtn.addEventListener('click', () => {
        bar.remove();
        if (toggleExcerptCallback) {
            toggleExcerptCallback(false);
        }
    });
    bar.appendChild(closeBtn);

    parentDoc.body.appendChild(bar);

    if (toggleExcerptCallback) {
        toggleExcerptCallback(true);
    }
}

// ============================================================
// 纯净聊天界面截图 (仅截取 #chat 消息内容，去顶栏和底栏)
// ============================================================
const H2C_CDN_URLS = [
    'https://cdn.staticfile.org/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.bootcdn.net/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
];

let _h2cPromise = null;
function ensureHtml2CanvasLoaded() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (window.parent && window.parent.html2canvas) return Promise.resolve(window.parent.html2canvas);
    if (_h2cPromise) return _h2cPromise;

    _h2cPromise = new Promise((resolve) => {
        let idx = 0;
        function tryNext() {
            if (idx >= H2C_CDN_URLS.length) { resolve(null); return; }
            const script = document.createElement('script');
            script.src = H2C_CDN_URLS[idx++];
            script.onload = () => resolve(window.html2canvas || null);
            script.onerror = () => tryNext();
            document.head.appendChild(script);
        }
        tryNext();
    });
    return _h2cPromise;
}

export async function captureChatScreenshot() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    if (typeof toastr !== 'undefined') {
        toastr.info('正在截取当前聊天界面...', '截图', { timeOut: 1500 });
    }

    const h2c = await ensureHtml2CanvasLoaded();
    if (!h2c) {
        if (typeof toastr !== 'undefined') toastr.error('无法加载截图引擎 (html2canvas)', '截图失败');
        return;
    }

    $('#twt-custom-menu').hide();

    try {
        const isReadingMode = document.body.classList.contains('twt-reading-mode');
        const bg = window.getComputedStyle(chat).backgroundColor || 'var(--SmartThemeDarkColor, #1e1e1e)';
        const dpr = Math.max(window.devicePixelRatio || 1, 2);

        let canvas;
        if (isReadingMode) {
            const cw = chat.clientWidth || chat.offsetWidth;
            const ch = chat.clientHeight || chat.offsetHeight;
            canvas = await h2c(chat, {
                backgroundColor: bg,
                scale: dpr,
                useCORS: true,
                allowTaint: true,
                logging: false,
                x: chat.scrollLeft,
                y: 0,
                width: cw,
                height: ch
            });
        } else {
            canvas = await h2c(chat, {
                backgroundColor: bg,
                scale: dpr,
                useCORS: true,
                allowTaint: true,
                logging: false
            });
        }

        showScreenshotPreviewModal(canvas);
    } catch (e) {
        console.error('[TwT] 截图生成失败:', e);
        if (typeof toastr !== 'undefined') toastr.error(`截图生成失败: ${e.message || e}`, '错误');
    }
}

function showScreenshotPreviewModal(canvas) {
    const parentDoc = getParentDoc();
    const oldModal = parentDoc.getElementById('twt-screenshot-modal');
    if (oldModal) oldModal.remove();

    const dataUrl = canvas.toDataURL('image/png');

    const modal = parentDoc.createElement('div');
    modal.id = 'twt-screenshot-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 1000005;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 20px; box-sizing: border-box;
        font-family: var(--monoFontFamily, sans-serif);
    `;

    const container = parentDoc.createElement('div');
    container.style.cssText = `
        background: var(--SmartThemeBlurTintColor, var(--SmartThemePanelColor, #1e1e1e));
        border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
        border-radius: 12px;
        padding: 16px;
        max-width: 90vw; max-height: 85vh;
        display: flex; flex-direction: column;
        align-items: center;
        box-shadow: 0 12px 36px rgba(0,0,0,0.6);
    `;

    const titleRow = parentDoc.createElement('div');
    titleRow.style.cssText = 'width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--SmartThemeBodyColor, #fff); font-weight: bold; font-size: 1.1em;';
    titleRow.innerHTML = '<span><i class="fa-solid fa-camera" style="margin-right:8px;"></i>聊天截图预览</span>';

    const imgWrapper = parentDoc.createElement('div');
    imgWrapper.style.cssText = 'flex: 1; overflow: auto; max-width: 100%; max-height: 65vh; border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1)); background: rgba(0,0,0,0.3);';

    const img = parentDoc.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'display: block; max-width: 100%; height: auto; margin: 0 auto;';
    imgWrapper.appendChild(img);

    const btnRow = parentDoc.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 12px; margin-top: 16px; width: 100%; justify-content: flex-end;';

    const downloadBtn = parentDoc.createElement('button');
    downloadBtn.className = 'menu_button';
    downloadBtn.innerHTML = '<i class="fa-solid fa-download" style="margin-right:6px;"></i>下载保存';
    downloadBtn.addEventListener('click', () => {
        const a = parentDoc.createElement('a');
        a.href = dataUrl;
        a.download = `TwT_Chat_Screenshot_${Date.now()}.png`;
        a.click();
        if (typeof toastr !== 'undefined') toastr.success('图片已保存！', '成功');
    });

    const copyBtn = parentDoc.createElement('button');
    copyBtn.className = 'menu_button';
    copyBtn.innerHTML = '<i class="fa-solid fa-copy" style="margin-right:6px;"></i>复制到剪贴板';
    copyBtn.addEventListener('click', async () => {
        try {
            canvas.toBlob(async (blob) => {
                if (!blob) throw new Error('Blob Error');
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                if (typeof toastr !== 'undefined') toastr.success('截图已复制到剪贴板！', '成功');
            });
        } catch (err) {
            console.warn('[TwT] Clipboard copy failed:', err);
            if (typeof toastr !== 'undefined') toastr.warning('复制到剪贴板失败，请使用下载功能', '提示');
        }
    });

    const closeBtn = parentDoc.createElement('button');
    closeBtn.className = 'menu_button';
    closeBtn.innerText = '关闭';
    closeBtn.addEventListener('click', () => modal.remove());

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(downloadBtn);
    btnRow.appendChild(closeBtn);

    container.appendChild(titleRow);
    container.appendChild(imgWrapper);
    container.appendChild(btnRow);
    modal.appendChild(container);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    parentDoc.body.appendChild(modal);
}


// ============================================================
// 全屏全文编辑弹窗 (对接酒馆原生编辑与消息更新)
// ============================================================
export function openFullTextEditor(mesId) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || !chat.length) return;

    const message = chat[mesId];
    if (!message) return;

    const parentDoc = getParentDoc();
    const oldModal = parentDoc.getElementById('twt-full-edit-modal');
    if (oldModal) oldModal.remove();

    const rawContent = message.mes || '';
    const charName = message.name || (message.is_user ? 'User' : 'AI');

    const modal = parentDoc.createElement('div');
    modal.id = 'twt-full-edit-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 1000005;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 20px; box-sizing: border-box;
        font-family: var(--monoFontFamily, sans-serif);
    `;

    const solidBg = getSolidThemeBgColor(parentDoc);
    const bgStyle = solidBg
        ? `var(--twt-comments-bg-solid, ${solidBg})`
        : 'var(--twt-comments-bg-solid, var(--SmartThemeBlurTintColor, #1e1e1e))';

    const container = parentDoc.createElement('div');
    container.style.cssText = `
        background: ${bgStyle};
        border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
        border-radius: 12px;
        padding: 18px 20px;
        width: 90vw;
        max-width: 1000px;
        height: 85vh;
        display: flex; flex-direction: column;
        box-shadow: 0 16px 48px rgba(0,0,0,0.6);
        box-sizing: border-box;
    `;

    const titleRow = parentDoc.createElement('div');
    titleRow.style.cssText = 'width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--SmartThemeBodyColor, #fff); font-weight: bold; font-size: 1.1em;';
    
    const titleLeft = parentDoc.createElement('div');
    titleLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    titleLeft.innerHTML = `<i class="fa-solid fa-file-pen" style="color: var(--SmartThemeQuoteColor, #4a9eff);"></i><span>全文编辑 <small style="opacity: 0.7; font-weight: normal;">(#${mesId} - ${charName})</small></span>`;

    const titleRight = parentDoc.createElement('div');
    titleRight.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 0.85em; opacity: 0.9; font-weight: normal;';
    
    const charCounter = parentDoc.createElement('span');
    charCounter.style.cssText = 'margin-right: 6px; opacity: 0.75; font-size: 0.95em;';
    charCounter.innerText = `字数: ${rawContent.length}`;

    const scrollTopBtn = parentDoc.createElement('button');
    scrollTopBtn.className = 'menu_button';
    scrollTopBtn.title = '一键回顶';
    scrollTopBtn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; padding: 4px 8px; font-size: 0.95em; cursor: pointer; border-radius: 4px;';
    scrollTopBtn.innerHTML = '<i class="fa-solid fa-angles-up"></i>';
    scrollTopBtn.addEventListener('click', () => {
        textarea.scrollTo({ top: 0, behavior: 'smooth' });
        textarea.focus();
        textarea.setSelectionRange(0, 0);
    });

    const scrollBottomBtn = parentDoc.createElement('button');
    scrollBottomBtn.className = 'menu_button';
    scrollBottomBtn.title = '一键回底';
    scrollBottomBtn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; padding: 4px 8px; font-size: 0.95em; cursor: pointer; border-radius: 4px;';
    scrollBottomBtn.innerHTML = '<i class="fa-solid fa-angles-down"></i>';
    scrollBottomBtn.addEventListener('click', () => {
        textarea.scrollTo({ top: textarea.scrollHeight, behavior: 'smooth' });
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
    });

    const closeIcon = parentDoc.createElement('i');
    closeIcon.className = 'fa-solid fa-xmark interactable';
    closeIcon.title = '关闭';
    closeIcon.style.cssText = 'cursor: pointer; font-size: 1.25em; padding: 4px 6px; margin-left: 4px; opacity: 0.85;';
    closeIcon.addEventListener('click', () => {
        if (textarea.value !== rawContent) {
            if (confirm('内容尚未保存，确定要退出编辑吗？')) modal.remove();
        } else {
            modal.remove();
        }
    });

    titleRight.appendChild(charCounter);
    titleRight.appendChild(scrollTopBtn);
    titleRight.appendChild(scrollBottomBtn);
    titleRight.appendChild(closeIcon);
    titleRow.appendChild(titleLeft);
    titleRow.appendChild(titleRight);

    const textareaWrapper = parentDoc.createElement('div');
    textareaWrapper.style.cssText = 'flex: 1; display: flex; width: 100%; min-height: 0; margin-bottom: 14px;';

    const textarea = parentDoc.createElement('textarea');
    textarea.className = 'twt-full-edit-textarea';
    textarea.placeholder = '输入消息内容...';
    textarea.value = rawContent;
    textarea.style.cssText = `
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 14px 16px;
        background: var(--SmartThemeDarkColor, rgba(0, 0, 0, 0.3));
        color: var(--SmartThemeBodyColor, #ffffff);
        border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
        border-radius: 8px;
        font-family: inherit;
        font-size: 1.05em;
        line-height: 1.7;
        resize: none;
        outline: none;
        overflow-y: auto;
    `;

    textarea.addEventListener('input', () => {
        charCounter.innerText = `字数: ${textarea.value.length}`;
    });

    textareaWrapper.appendChild(textarea);

    const btnRow = parentDoc.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; align-items: center; width: 100%;';

    const cancelBtn = parentDoc.createElement('button');
    cancelBtn.className = 'menu_button';
    cancelBtn.title = '取消 (Esc)';
    cancelBtn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; padding: 6px 16px; font-size: 1.1em; cursor: pointer; border-radius: 6px;';
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    cancelBtn.addEventListener('click', () => {
        if (textarea.value !== rawContent) {
            if (confirm('内容尚未保存，确定要退出编辑吗？')) modal.remove();
        } else {
            modal.remove();
        }
    });

    const saveBtn = parentDoc.createElement('button');
    saveBtn.className = 'menu_button menu_button_primary';
    saveBtn.title = '保存 (Ctrl+Enter)';
    saveBtn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; padding: 6px 16px; font-size: 1.1em; cursor: pointer; border-radius: 6px;';
    saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>';

    const handleSave = async () => {
        const newContent = textarea.value;
        modal.remove();
        if (newContent !== rawContent) {
            message.mes = newContent;
            await context.updateMessageBlock(mesId, message, { rerenderMessage: true });
            await context.saveChat();
            if (typeof toastr !== 'undefined') {
                toastr.success('消息已保存', '全文编辑');
            }
            if (document.body.classList.contains('twt-reading-mode')) {
                realignPagination(false);
            }
        }
    };

    saveBtn.addEventListener('click', handleSave);

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    // Keyboard shortcuts
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (textarea.value !== rawContent) {
                if (confirm('内容尚未保存，确定要退出编辑吗？')) modal.remove();
            } else {
                modal.remove();
            }
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSave();
        }
    };
    textarea.addEventListener('keydown', handleKeyDown);

    container.appendChild(titleRow);
    container.appendChild(textareaWrapper);
    container.appendChild(btnRow);
    modal.appendChild(container);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            if (textarea.value !== rawContent) {
                if (confirm('内容尚未保存，确定要退出编辑吗？')) modal.remove();
            } else {
                modal.remove();
            }
        }
    });

    parentDoc.body.appendChild(modal);

    setTimeout(() => {
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
    }, 50);
}
