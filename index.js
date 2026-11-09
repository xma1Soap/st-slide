// @ts-nocheck
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { applyPaginationMode, initPaginationEvent, resetPaginationBinding, realignPagination, handleMoreMessagesLoaded, handleNewMessageRendered, updateActiveReadingAnchor, handleUserMessageSent, handleMessageSwiped, handleGenerationStarted, handleGenerationEnded, handleMessageDeleted, autoNormalizeBubbleTheme, cleanupBubbleThemeNormalization, generateBubbleThemePatchCss, updateDiagPanelVisibility } from './src/pagination/pagination.js?v=1.0.26';
import { applyVisualMode } from './src/visual/visual.js?v=1.0.26';
import { setClass } from './src/utils/class_guard.js?v=1.0.26';
import { saveFontToStorage, getFontBlobUrl, deleteFontFromStorage } from './src/visual/font_storage.js?v=1.0.26';
import { initMulu, applyMuluSettings } from './src/mulu/mulu.js?v=1.0.26';
import { initMenu, applyMenuMode, applyFullscreenMode } from './src/menu/menu.js?v=1.0.26';
import { initHtmlPopup, applyHtmlPopupSettings, registerHtmlPopupEvents } from './src/html_popup/html_popup.js?v=1.0.26';
import { registerSlashCommands } from './src/slash_commands.js?v=1.0.26';

let parentDoc = document;
try {
    if (window.parent && window.parent.document) {
        parentDoc = window.parent.document;
    }
} catch (e) {
    console.warn("TwT: Cannot access window.parent.document", e);
}

function getAllDocs() {
    const docs = [document];
    try {
        if (window.parent && window.parent.document && !docs.includes(window.parent.document)) {
            docs.push(window.parent.document);
        }
    } catch (e) {}
    try {
        if (window.top && window.top.document && !docs.includes(window.top.document)) {
            docs.push(window.top.document);
        }
    } catch (e) {}
    return docs;
}

let isExcerptModeActive = false;

// ============================================================
// 拓展更新后自动刷新酒馆页面 (顶层立即挂载)
// ============================================================
let isAutoReloading = false;
function autoReloadApp(reason) {
    if (isAutoReloading) return;
    isAutoReloading = true;
    console.log(`[TwT] ${reason}，准备自动刷新页面...`);
    if (typeof toastr !== 'undefined') {
        toastr.info('拓展更新完成，正在为您自动刷新页面...', '自动刷新', { timeOut: 2000 });
    }
    setTimeout(() => {
        try {
            if (window.top && window.top.location && typeof window.top.location.reload === 'function') {
                window.top.location.reload();
                return;
            }
        } catch (e) {}
        try {
            if (window.parent && window.parent.location && typeof window.parent.location.reload === 'function') {
                window.parent.location.reload();
                return;
            }
        } catch (e) {}
        window.location.reload();
    }, 1200);
}

function hookFetch(targetWin) {
    try {
        if (!targetWin || !targetWin.fetch || targetWin.fetch.__twt_hooked__) return;
        const origFetch = targetWin.fetch;
        const hooked = async function (...args) {
            const res = await origFetch.apply(this, args);
            try {
                let url = '';
                if (args[0]) {
                    if (typeof args[0] === 'string') url = args[0];
                    else if (typeof args[0] === 'object' && args[0].url) url = String(args[0].url);
                    else url = String(args[0]);
                }
                url = url.toLowerCase();
                if (url.includes('/api/extensions/') && (
                    url.includes('update') || url.includes('download') || url.includes('install') || url.includes('switch')
                )) {
                    if (res && (res.ok || res.status === 200 || res.status === 304)) {
                        autoReloadApp('检测到拓展更新完成');
                    }
                }
            } catch (e) {}
            return res;
        };
        hooked.__twt_hooked__ = true;
        targetWin.fetch = hooked;
    } catch(e) {}
}

try { hookFetch(window); } catch(e) {}
try { if (window.parent && window.parent !== window) hookFetch(window.parent); } catch(e) {}
try { if (window.top && window.top !== window) hookFetch(window.top); } catch(e) {}


function getEl(selector) {
    for (const doc of getAllDocs()) {
        try {
            const $found = $(doc).find(selector);
            if ($found.length) return $found;
        } catch (e) {}
    }
    return $(selector);
}

const escapeHtml = (str) => (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const extensionName = 'TwT';

// 插件实际安装的文件夹（如 third-party/st-slide）。酒馆安装扩展时用仓库名当文件夹名，
// 写死 'third-party/TwT' 的话，仓库改名或装成别的名字后设置面板会加载失败（404）。
const extensionFolder = (() => {
    try {
        const dir = decodeURIComponent(new URL('.', import.meta.url).pathname);
        const m = dir.match(/\/scripts\/extensions\/(third-party\/[^/]+)\/?$/);
        if (m) return m[1];
    } catch {}
    return 'third-party/TwT';
})();

const defaultSettings = {
    enabled: true,
    diagLogEnabled: false,
    qrInjectEnabled: true,
    swipeEnabled: true,
    messagePageEnabled: false,
    autoBubbleThemeEnabled: true,
    autoScrollNewMessage: true,
    autoRestoreReadingPosition: false,
    htmlPageBreakEnabled: true,
    htmlPopupEnabled: true,
    htmlPopupTriggerMode: 'qr',
    htmlPopupFallbackEnabled: false,
    htmlPopupSelector: 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app',
    htmlPopupTitleMap: 'TH-message=剧情摘要\napp-stat=角色状态',
    htmlPopupWhitelist: '',
    avatarLayoutMode: 'float',
    customWhitelist: '.mes_reasoning_details, .thought-block',
    toolCallMode: 'minimal',
    toolCallNoPageBreak: true,
    toolCallPreventFlip: true,
    toolCallSelector: '.mes.toolCall, .mes[is_system="true"].toolCall',
    menuEnabled: false,
    menuOptRegenerate: true,
    menuOptSwipe: true,
    menuOptManage: true,
    menuOptEdit: true,
    menuOptFullEdit: true,
    menuOptRealign: true,
    paragraphToolbarBottom: 15,
    paragraphIconSize: 20,
    paragraphXmlWhitelist: 'thought, TavernThought, reasoning, details',
    menuOptEditFiltered: false,
    menuOptExcerpt: false,
    excerptTopOffset: 0,
    excerptFontSize: 12,
    menuOptFullscreen: true,
    menuOptFullscreenHideSendForm: false,
    menuOptApi: false,
    menuOptPurifier: false,
    menuOptPurifierDiff: false,
    menuOptNewChat: true,
    menuOptCloseChat: true,
    menuOptPromptViewer: false,
    menuOptRandomInspect: false,
    menuOptImageTag: true,
    menuOrder: [
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
    ],
    isFullscreen: false,
    menuInvokeMethod: 'longpress',
    menuLongpressDelay: 500,
    menuDirection: 'bottom-right',
    menuStyle: 'grid',
    menuFontSize: 14,
    visualEnabled: false, 
    muluEnabled: false,
    muluBtnStart: true,
    muluBtnToc: true,
    muluBtnEnd: true,
    muluToolCallMode: 'hide',
    paddingTop: 0,
    paddingBottom: 60,
    paddingLeft: 15,
    paddingRight: 15,
    fontSize: 16,
    lineHeight: 1.6,
    textIndent: 0,           // 首行缩进字符数（0 = 不缩进）
    textAlign: 'left',       // 对齐方式：left | justify | center | right
    paragraphSpacing: 0,     // 段落间距 px
    letterSpacing: 0,        // 字间距 px
    fontWeight: 'normal',    // 文本粗细
    fontFamily: 'inherit',   // 字体选择
    customFonts: {},         // 自定义字体库
    visualPresets: {}, 

    currentPreset: 'custom',
    presetThemeLinks: {},
    presetTagLinks: {},
    
    // New Mulu Regex settings
    muluRegexPresets: {
        '章节 (第X章/第X回)': '第[一二三四五六七八九十百千万\\\\d]+[章节回卷折幕篇][^\\\\n]*',
        'Markdown 标题': '^\\\\s*#+\\\\s+([^\\\\n]+)',
        '括号标题 【X】': '【([^】]+)】',
        '数字标题 (1. X)': '^\\\\s*\\\\d+[、.．\\\\s]+([^\\\\n]+)'
    },
    currentMuluRegexPreset: '章节 (第X章/第X回)',
    customMuluRegex: '第[一二三四五六七八九十百千万\\d]+[章节回卷折幕篇][^\\n]*',
    muluSortOrder: 'asc',

    // CSS Custom Optimization settings
    optimizeEnabled: false,
    optimizePatches: {},
    optimizeFolders: ['界面调整', '手势与选择'],

    // Comments settings
    commentsEnabled: true,
    commentsSelectedApiId: 'main',
    commentsApis: [],
    commentsPromptPresets: {
        '网络读者弹幕吐槽': [
            { role: 'system', content: '你是一个小说读者，正在小说网站上阅读小说。请针对以下带编号的段落，写一些像真实读者留下的评论吐槽（俗称“本章说”、“间贴”、“弹幕”）。\n\n【要求】\n1. 吐槽数量：不需要每一段都写，挑选 2~4 个最精彩、最想让人吐槽的段落。\n2. 吐槽内容：符合小说读者的语气，包含剧情猜测、吐槽、玩梗、情感发泄（如甜死我了、虐心、前方高能、男主太帅了）等，保持简短（通常 15~35 字）。\n3. 网友网名：结合你吐槽的内容和小说背景，为每个吐槽生成一个个性化的网友网名（例如：纯爱战神_123、催更狂魔_456、催泪弹收割机、列文虎克等）。', enabled: true, name: '系统角色指令' },
            { role: 'user', content: '【前文剧情】\n{{context_history}}\n\n【上下文背景】\n主角姓名（用户）：{{user}}\nNPC姓名（角色）：{{char}}\n\n【待阅读小说片段】\n{{paragraphs_input}}', enabled: true, name: '前文与段落输入' },
            { role: 'system', content: '必须以 JSON 数组格式返回，不要有任何前言、后记或解释，格式如下：\n[\n  { "para_id": 0, "author": "个性化的网友网名", "comment": "吐槽内容" },\n  { "para_id": 2, "author": "个性化的网友网名", "comment": "吐槽内容" }\n]', enabled: true, name: '输出格式控制' }
        ],
        '理性剧情分析': [
            { role: 'system', content: '你是一个非常理性的网络小说评论家。请阅读以下小说片段，挑选 1~2 个段落进行专业分析，并给出简短的书评吐槽。\n\n【要求】\n1. 网友网名：结合你分析的内容 and 小说背景，为每个分析生成一个个性化的专业网友网名（例如：剧情分析师_99、细节怪、伏笔回收站等）。\n2. 字数控制在 50 字以内。', enabled: true, name: '系统分析师指令' },
            { role: 'user', content: '【前文剧情】\n{{context_history}}\n\n【待阅读小说片段】\n{{paragraphs_input}}', enabled: true, name: '前文与段落输入' },
            { role: 'system', content: '必须以 JSON 数组格式返回，格式如下：\n[\n  { "para_id": 1, "author": "个性化的网友网名", "comment": "分析吐槽" }\n]', enabled: true, name: '输出格式控制' }
        ]
    },
    commentsCurrentPreset: '网络读者弹幕吐槽',
    commentsRegexFilters: [
        { id: 'filter_thought', name: '排除 AI 思考过程 (thought/details)', pattern: '<(thought|TavernThought|details|reasoning)[^>]*>[\\s\\S]*?<\\/\\1>', action: 'remove', enabled: true },
        { id: 'filter_markdown', name: '排除 Markdown 样式标记 (*和_)', pattern: '[*_]', action: 'remove', enabled: false }
    ],
    commentsDrawerPosition: 'right', // left, right, center
    commentsDrawerWidth: 35 // default width percentage
};

const defaultPatches = {
    '隐藏滚动条': {
        active: false,
        folder: '界面调整',
        code: `/* 隐藏全局滚动条及聊天区域滚动条 */\n::-webkit-scrollbar {\n    display: none !important;\n    width: 0 !important;\n    height: 0 !important;\n}\nbody, html, #chat, #chat-container, .twt-mulu-list {\n    scrollbar-width: none !important; /* Firefox */\n    -ms-overflow-style: none !important; /* IE/Edge */\n}`
    },
    '禁用聊天区域长按菜单': {
        active: false,
        folder: '手势与选择',
        code: `/* 禁用聊天区域文本选中与移动端长按呼出菜单 */\n#chat {\n    -webkit-touch-callout: none !important; /* 禁用iOS长按菜单 */\n    -webkit-user-select: none !important;   /* 禁用选中 */\n    user-select: none !important;\n}\n/* 如果有输入框在聊天区内，允许选中 */\n#chat input, #chat textarea {\n    -webkit-touch-callout: default !important;\n    -webkit-user-select: text !important;\n    user-select: text !important;\n}`
    },
    '收藏栏左侧图标缩小': {
        active: false,
        folder: '界面调整',
        code: `/* 收藏栏左侧图标缩小 */\nbody #rm_button_characters {\n    font-size: 16px !important;\n    width: 32px !important;\n    height: 32px !important;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}`
    },
    '收藏栏下方空隙缩小': {
        active: false,
        folder: '界面调整',
        code: `/* 收藏栏下方空隙缩小 */\nbody #CharListButtonAndHotSwaps {\n    margin-bottom: -20px;\n}`
    },
    'Spreset': {
        active: false,
        folder: '界面调整',
        code: `.spreset-button-container {\n  display: none;\n}`
    }
};

function ensureSettingsInitialized() {
    if (!extension_settings.twt) {
        extension_settings.twt = Object.assign({}, defaultSettings);
        extension_settings.twt.optimizePatches = Object.assign({}, defaultPatches);
    } else {
        for (const key in defaultSettings) {
            if (extension_settings.twt[key] === undefined) {
                extension_settings.twt[key] = defaultSettings[key];
            }
        }
        if (!extension_settings.twt.visualPresets) {
            extension_settings.twt.visualPresets = {};
        }
        if (!extension_settings.twt.muluRegexPresets) {
            extension_settings.twt.muluRegexPresets = Object.assign({}, defaultSettings.muluRegexPresets);
        }
        if (!extension_settings.twt.optimizePatches || typeof extension_settings.twt.optimizePatches !== 'object') {
            extension_settings.twt.optimizePatches = {};
        }
        // 注入默认预设的补丁
        for (const [key, val] of Object.entries(defaultPatches)) {
            if (extension_settings.twt.optimizePatches[key] === undefined) {
                extension_settings.twt.optimizePatches[key] = Object.assign({}, val);
            } else if (extension_settings.twt.optimizePatches[key].folder === undefined && val.folder) {
                extension_settings.twt.optimizePatches[key].folder = val.folder;
            }
        }
        if (!extension_settings.twt.commentsApis) {
            extension_settings.twt.commentsApis = [];
        }
        if (extension_settings.twt.commentsSelectedApiId === undefined) {
            extension_settings.twt.commentsSelectedApiId = 'main';
        }
        if (!extension_settings.twt.commentsPromptPresets || typeof extension_settings.twt.commentsPromptPresets !== 'object' || Object.keys(extension_settings.twt.commentsPromptPresets).length === 0) {
            extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets));
        }
        
        // 迁移旧版字符串提示词为新版结构化数组提示词
        for (const key in extension_settings.twt.commentsPromptPresets) {
            const val = extension_settings.twt.commentsPromptPresets[key];
            if (typeof val === 'string') {
                if (key === '网络读者弹幕吐槽' && defaultSettings.commentsPromptPresets['网络读者弹幕吐槽']) {
                    extension_settings.twt.commentsPromptPresets[key] = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets['网络读者弹幕吐槽']));
                } else if (key === '理性剧情分析' && defaultSettings.commentsPromptPresets['理性剧情分析']) {
                    extension_settings.twt.commentsPromptPresets[key] = JSON.parse(JSON.stringify(defaultSettings.commentsPromptPresets['理性剧情分析']));
                } else {
                    extension_settings.twt.commentsPromptPresets[key] = [
                        { role: 'user', content: val, enabled: true }
                    ];
                }
            }
        }
        
        if (!extension_settings.twt.commentsCurrentPreset || !extension_settings.twt.commentsPromptPresets[extension_settings.twt.commentsCurrentPreset]) {
            extension_settings.twt.commentsCurrentPreset = Object.keys(extension_settings.twt.commentsPromptPresets)[0] || '网络读者弹幕吐槽';
        }
        if (!extension_settings.twt.commentsRegexFilters) {
            extension_settings.twt.commentsRegexFilters = JSON.parse(JSON.stringify(defaultSettings.commentsRegexFilters));
        }
        if (extension_settings.twt.commentsDrawerPosition === undefined) {
            extension_settings.twt.commentsDrawerPosition = defaultSettings.commentsDrawerPosition;
        }
        if (extension_settings.twt.commentsDrawerWidth === undefined) {
            extension_settings.twt.commentsDrawerWidth = defaultSettings.commentsDrawerWidth;
        }

        if (!extension_settings.twt.menuOrder) {
            extension_settings.twt.menuOrder = [...defaultSettings.menuOrder];
        } else {
            defaultSettings.menuOrder.forEach(key => {
                if (!extension_settings.twt.menuOrder.includes(key)) {
                    extension_settings.twt.menuOrder.push(key);
                }
            });
        }
    }
}
ensureSettingsInitialized();


function updateTabVisibility(btnId, contentId, isEnabled) {
    const $tabBtn = $(btnId);
    const $tabContent = $(contentId);
    
    if (isEnabled) {
        $tabBtn.show();
    } else {
        $tabBtn.hide();
        if ($tabBtn.hasClass('active')) {
            $tabBtn.removeClass('active');
            $tabContent.hide().removeClass('active');
            $('[data-tab="twt-tab-settings"]').addClass('active');
            $('#twt-tab-settings').show().addClass('active');
        }
    }
}

function updatePageTabVisibility() { updateTabVisibility('#tab-btn-page', '#twt-tab-page', extension_settings.twt.enabled); }
function updateMenuTabVisibility() { updateTabVisibility('#tab-btn-menu', '#twt-tab-menu', extension_settings.twt.menuEnabled); }
function updateVisualTabVisibility() { updateTabVisibility('#tab-btn-visual', '#twt-tab-visual', extension_settings.twt.visualEnabled); }
function updateMuluTabVisibility() { updateTabVisibility('#tab-btn-mulu', '#twt-tab-mulu', extension_settings.twt.muluEnabled); }
function updateCommentsTabVisibility() { updateTabVisibility('#tab-btn-comments', '#twt-tab-comments', extension_settings.twt.commentsEnabled); }

function renderCommentsPresetList() {
    const $select = $('#twt_comments_preset');
    if (!$select.length) return;
    $select.empty();
    const presets = extension_settings.twt.commentsPromptPresets || {};
    for (const presetName of Object.keys(presets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    const current = extension_settings.twt.commentsCurrentPreset || Object.keys(presets)[0] || '';
    $select.val(current);
    $('#twt_comments_prompt').val(presets[current] || '');
}

function updateParagraphSubOptionsVisibility() {
    const $subOptions = $('#twt_paragraph_edit_sub_options');
    if (extension_settings.twt.menuOptEdit) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

function updateExcerptSubOptionsVisibility() {
    const $subOptions = $('#twt_excerpt_sub_options');
    if (extension_settings.twt.menuOptExcerpt) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

function updateFullscreenSubOptionsVisibility() {
    const $subOptions = $('#twt_fullscreen_sub_options');
    if (extension_settings.twt.menuOptFullscreen) {
        $subOptions.show();
    } else {
        $subOptions.hide();
    }
}

function updateLiveExcerptBar() {
    const bar = parentDoc.getElementById('twt-excerpt-float-bar');
    if (bar) {
        const topOffset = extension_settings.twt.excerptTopOffset !== undefined ? extension_settings.twt.excerptTopOffset : 0;
        const fontSize = extension_settings.twt.excerptFontSize !== undefined ? extension_settings.twt.excerptFontSize : 12;
        bar.style.top = `${topOffset}px`;
        bar.style.fontSize = `${fontSize}px`;
        if (topOffset === 0) {
            bar.style.borderTop = 'none';
            bar.style.borderRadius = '0 0 10px 10px';
        } else {
            bar.style.borderTop = '1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15))';
            bar.style.borderRadius = '10px';
        }
    }
}

let currentlyEditingPatchName = null;
const collapsedFolders = {};
let optimizeSearchTimeout = null;
let currentOptimizeSearchQuery = '';

function renderOptimizePatchList() {
    const $list = $('#twt_optimize_list');
    $list.empty();

    const patches = extension_settings.twt.optimizePatches || {};
    const folders = extension_settings.twt.optimizeFolders || [];
    const patchNames = Object.keys(patches);

    if (patchNames.length === 0) {
        $list.append(`
            <div id="twt_optimize_empty_hint" style="text-align: center; opacity: 0.5; padding: 15px; font-size: 0.9em; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; width: 100%; box-sizing: border-box;">
                暂无自定义补丁，点击“新建补丁”开始吧！
            </div>
        `);
        return;
    }

    // Helper function to build a patch item element
    const buildPatchItemHtml = (name, patch) => {
        const isEditingThis = currentlyEditingPatchName === name;
        return `
            <div class="twt-optimize-item" data-name="${escapeHtml(name)}" style="display: flex; flex-direction: column; background: rgba(0,0,0,0.15); padding: 8px 10px; border-radius: 6px; border: 1px solid ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'var(--SmartThemeBorderColor)'}; gap: 6px; width: 100%; box-sizing: border-box; box-shadow: none !important;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; box-shadow: none !important;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; min-width: 0; margin: 0; user-select: none; box-shadow: none !important;">
                        <input type="checkbox" class="twt-patch-checkbox" ${patch.active ? 'checked' : ''} style="margin: 0; flex-shrink: 0; box-shadow: none !important;" />
                        <span class="twt-patch-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 0.95em; ${isEditingThis ? 'font-weight: bold; color: var(--SmartThemeUnderlineColor, #fff);' : ''}">${escapeHtml(name)}</span>
                    </label>
                    <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; box-shadow: none !important;">
                        <div style="position: relative; display: inline-block; box-shadow: none !important;">
                            <button class="twt-patch-move menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important; display: flex; align-items: center; justify-content: center;" title="移动分类">
                                <i class="fa-solid fa-folder"></i>
                            </button>
                            <select class="twt-patch-folder-select" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0; padding: 0; border: none; outline: none; -webkit-appearance: none; -moz-appearance: none; appearance: none;">
                                <option value="" ${!patch.folder ? 'selected' : ''}>未分类</option>
                                ${folders.map(f => `<option value="${escapeHtml(f)}" ${patch.folder === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                            </select>
                        </div>
                        <button class="twt-patch-edit" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: ${isEditingThis ? 'var(--SmartThemeUnderlineColor)' : 'rgba(255, 255, 255, 0.08)'}; color: ${isEditingThis ? 'var(--SmartThemeDarkColor)' : 'var(--SmartThemeBodyColor)'}; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="编辑代码"><i class="fa-solid fa-code"></i></button>
                        <button class="twt-patch-rename" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="重命名补丁"><i class="fa-solid fa-pen"></i></button>
                        <button class="twt-patch-delete" style="padding: 3px 6px; margin: 0; font-size: 0.8em; background: rgba(255, 255, 255, 0.08); color: #ff4444; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; cursor: pointer; box-shadow: none !important;" title="删除补丁"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    };

    // Group patches by folder
    const folderGroups = {};
    const uncategorizedPatches = [];

    // Initialize groups
    folders.forEach(f => {
        folderGroups[f] = [];
    });

    Object.keys(patches).forEach(name => {
        const patch = patches[name];
        if (patch.folder && folderGroups[patch.folder]) {
            folderGroups[patch.folder].push({ name, patch });
        } else {
            uncategorizedPatches.push({ name, patch });
        }
    });

    let hasAnyMatch = false;

    // Render defined folders
    folders.forEach(folderName => {
        let listItems = folderGroups[folderName];
        let isFolderMatched = false;
        if (currentOptimizeSearchQuery) {
            isFolderMatched = folderName.toLowerCase().includes(currentOptimizeSearchQuery);
            if (!isFolderMatched) {
                listItems = listItems.filter(item => item.name.toLowerCase().includes(currentOptimizeSearchQuery));
            }
        }

        if (currentOptimizeSearchQuery && !isFolderMatched && listItems.length === 0) {
            return; // skip rendering this folder
        }

        hasAnyMatch = true;
        const isCollapsed = currentOptimizeSearchQuery ? false : (collapsedFolders[folderName] !== false);
        const patchCount = listItems.length;
        
        const $folderEl = $(`
            <div class="twt-optimize-folder" data-folder="${escapeHtml(folderName)}" style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-bottom: 4px;">
                <div class="twt-optimize-folder-header" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px; cursor: pointer; user-select: none; border: 1px solid rgba(255,255,255,0.08);">
                    <div class="twt-folder-title-wrap" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-down twt-folder-chevron" style="font-size: 0.8em; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                        <i class="fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} twt-folder-icon" style="color: #e0a96d; font-size: 0.95em;"></i>
                        <span style="font-weight: bold; font-size: 0.9em;">${escapeHtml(folderName)}</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="twt-folder-count" style="font-size: 0.8em; opacity: 0.5;">(${patchCount})</span>
                        <button class="twt-folder-add-patch menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important;" title="在该分类下新建补丁"><i class="fa-solid fa-plus"></i></button>
                        <button class="twt-folder-rename menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important;" title="重命名分类"><i class="fa-solid fa-pen"></i></button>
                        <button class="twt-folder-delete menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important; color: #ff4444 !important;" title="删除分类"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="twt-optimize-folder-content" style="display: ${isCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 6px; padding: 4px 0 4px 12px; border-left: 1px dashed rgba(255,255,255,0.15); margin-left: 14px;">
                    <!-- Items will be placed here -->
                </div>
            </div>
        `);
        
        const $content = $folderEl.find('.twt-optimize-folder-content');
        if (listItems.length === 0) {
            $content.append(`<div style="font-size:0.85em; opacity:0.35; padding: 4px;">无补丁</div>`);
        } else {
            listItems.forEach(item => {
                $content.append(buildPatchItemHtml(item.name, item.patch));
            });
        }
        $list.append($folderEl);
    });

    // Render Uncategorized section (only if there are uncategorized patches or folders are empty)
    let filteredUncat = uncategorizedPatches;
    let isUncatMatched = false;
    if (currentOptimizeSearchQuery) {
        isUncatMatched = "未分类".includes(currentOptimizeSearchQuery);
        if (!isUncatMatched) {
            filteredUncat = filteredUncat.filter(item => item.name.toLowerCase().includes(currentOptimizeSearchQuery));
        }
    }

    if (filteredUncat.length > 0 || (folders.length === 0 && !currentOptimizeSearchQuery)) {
        hasAnyMatch = true;
        const isCollapsed = currentOptimizeSearchQuery ? false : (collapsedFolders[''] !== false);
        const patchCount = filteredUncat.length;
        const $uncatEl = $(`
            <div class="twt-optimize-folder" data-folder="" style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-bottom: 4px;">
                <div class="twt-optimize-folder-header" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 6px; cursor: pointer; user-select: none; border: 1px solid rgba(255,255,255,0.08);">
                    <div class="twt-folder-title-wrap" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-down twt-folder-chevron" style="font-size: 0.8em; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                        <i class="fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} twt-folder-icon" style="color: #a0a0a0; font-size: 0.95em;"></i>
                        <span style="font-weight: bold; font-size: 0.9em; opacity: 0.85;">未分类</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="twt-folder-count" style="font-size: 0.8em; opacity: 0.5;">(${patchCount})</span>
                        <button class="twt-folder-add-patch menu_button" style="padding: 2px 5px !important; margin: 0 !important; font-size: 0.75em !important; height: auto !important; min-height: unset !important;" title="在未分类下新建补丁"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                <div class="twt-optimize-folder-content" style="display: ${isCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 6px; padding: 4px 0 4px 12px; border-left: 1px dashed rgba(255,255,255,0.15); margin-left: 14px;">
                    <!-- Items will be placed here -->
                </div>
            </div>
        `);
        
        const $content = $uncatEl.find('.twt-optimize-folder-content');
        if (uncategorizedPatches.length === 0) {
            $content.append(`<div style="font-size:0.85em; opacity:0.35; padding: 4px;">无补丁</div>`);
        } else {
            filteredUncat.forEach(item => {
                $content.append(buildPatchItemHtml(item.name, item.patch));
            });
        }
        $list.append($uncatEl);
    }

    if (currentOptimizeSearchQuery && !hasAnyMatch) {
        $list.append(`
            <div id="twt_optimize_no_results" style="text-align: center; opacity: 0.5; padding: 15px; font-size: 0.9em; border: 1px dashed var(--SmartThemeBorderColor); border-radius: 6px; width: 100%; box-sizing: border-box;">
                未找到与 “${escapeHtml(currentOptimizeSearchQuery)}” 相关的补丁或分类
            </div>
        `);
    }
}

function openOptimizeEditor(name) {
    const patches = extension_settings.twt.optimizePatches || {};
    const patch = patches[name];
    if (!patch) return;

    currentlyEditingPatchName = name;
    getEl('#twt_optimize_editor_title').text(`正在编辑: ${name}`);
    getEl('#twt_optimize_code').val(patch.code || '');
    getEl('#twt-optimize-editor-modal').css('display', 'flex');
    
    renderOptimizePatchList();
}

function closeOptimizeEditor() {
    currentlyEditingPatchName = null;
    getEl('#twt-optimize-editor-modal').css('display', 'none');
    renderOptimizePatchList();
}

function openOptimizeCreateModal(preselectedFolder = '') {
    const $modal = getEl('#twt-optimize-create-modal');
    const $folderSelect = getEl('#twt_optimize_create_folder');
    const $newFolderInput = getEl('#twt_optimize_create_new_folder');
    const $nameInput = getEl('#twt_optimize_create_name');

    $folderSelect.empty();
    const folders = extension_settings.twt.optimizeFolders || [];

    // 填充已有分组选项
    folders.forEach(f => {
        $folderSelect.append($('<option></option>').val(f).text(f));
    });
    $folderSelect.append(`<option value="">(未分类)</option>`);
    $folderSelect.append(`<option value="__new__">＋ 新建分组...</option>`);

    if (preselectedFolder !== undefined && preselectedFolder !== null && (folders.includes(preselectedFolder) || preselectedFolder === '')) {
        $folderSelect.val(preselectedFolder);
        $newFolderInput.hide().val('');
    } else if (folders.length > 0) {
        $folderSelect.val(folders[0]);
        $newFolderInput.hide().val('');
    } else {
        $folderSelect.val('');
        $newFolderInput.hide().val('');
    }

    $nameInput.val('');
    $modal.css('display', 'flex');
    setTimeout(() => {
        $nameInput.focus();
    }, 50);
}

function closeOptimizeCreateModal() {
    getEl('#twt-optimize-create-modal').css('display', 'none');
}

function handleConfirmCreatePatch() {
    const $folderSelect = getEl('#twt_optimize_create_folder');
    const $newFolderInput = getEl('#twt_optimize_create_new_folder');
    const $nameInput = getEl('#twt_optimize_create_name');

    let selectedFolder = $folderSelect.val();
    if (selectedFolder === '__new__') {
        const newFolderName = $newFolderInput.val().trim();
        if (!newFolderName) {
            toastr.warning('请输入新分组名称！', '提示');
            $newFolderInput.focus();
            return;
        }
        if (!extension_settings.twt.optimizeFolders) {
            extension_settings.twt.optimizeFolders = [];
        }
        if (!extension_settings.twt.optimizeFolders.includes(newFolderName)) {
            extension_settings.twt.optimizeFolders.push(newFolderName);
        }
        selectedFolder = newFolderName;
    }

    const patchName = $nameInput.val().trim();
    if (!patchName) {
        toastr.warning('请输入补丁名称！', '提示');
        $nameInput.focus();
        return;
    }

    if (!extension_settings.twt.optimizePatches) {
        extension_settings.twt.optimizePatches = {};
    }

    if (extension_settings.twt.optimizePatches[patchName]) {
        toastr.warning(`补丁 "${patchName}" 已存在！`, '提示');
        $nameInput.focus();
        return;
    }

    // 确保所属分组处于展开状态
    collapsedFolders[selectedFolder] = false;

    // 创建新补丁
    extension_settings.twt.optimizePatches[patchName] = {
        code: '',
        active: true,
        folder: selectedFolder
    };

    // 同步到视觉预设：在当前选中的预设中标记为启用，其余所有预设中默认为不启用状态
    const curPreset = extension_settings.twt.currentPreset;
    const presets = extension_settings.twt.visualPresets || {};
    for (const [pName, pData] of Object.entries(presets)) {
        if (pData && typeof pData === 'object') {
            if (!pData.optimizePatches || typeof pData.optimizePatches !== 'object') {
                pData.optimizePatches = {};
            }
            if (curPreset && curPreset !== 'custom' && pName === curPreset) {
                pData.optimizePatches[patchName] = true;
            } else {
                pData.optimizePatches[patchName] = false;
            }
        }
    }

    getContext().saveSettingsDebounced();
    closeOptimizeCreateModal();
    renderOptimizePatchList();
    openOptimizeEditor(patchName);
    updateInjectedStyles();
    logWork(`新建 CSS 补丁 [${patchName}]，所属分组: [${selectedFolder || '未分类'}]`);
    if (typeof toastr !== 'undefined') {
        toastr.success(`已创建补丁 "${patchName}"（分组：${selectedFolder || '未分类'}）`, '创建成功');
    }
}

export function updateInjectedStyles(notify = false) {
    const docs = getAllDocs();
    const patches = extension_settings?.twt?.optimizePatches || {};
    let activeCount = 0;
    const activeNames = [];
    const activePatchesMap = {};

    for (const [name, patch] of Object.entries(patches)) {
        if (patch && patch.active && patch.code && typeof patch.code === 'string' && patch.code.trim().length > 0) {
            activeCount++;
            activeNames.push(name);
            activePatchesMap[name] = patch.code;
        }
    }

    docs.forEach(doc => {
        try {
            if (!doc) return;
            const target = doc.head || doc.body || doc.documentElement;
            if (!target) return;

            // Remove legacy single style element if present
            const legacyStyle = doc.getElementById('twt-optimize-styles');
            if (legacyStyle) {
                legacyStyle.remove();
            }

            // Find all existing patch style elements in this document
            const existingElements = Array.from(doc.querySelectorAll('style[data-twt-patch]'));
            existingElements.forEach(el => {
                const patchName = el.getAttribute('data-twt-patch');
                if (!activePatchesMap[patchName]) {
                    el.remove();
                }
            });

            // Insert or update each active patch in its own isolated <style> tag
            for (const [name, code] of Object.entries(activePatchesMap)) {
                let styleEl = Array.from(doc.querySelectorAll('style[data-twt-patch]')).find(el => el.getAttribute('data-twt-patch') === name);
                if (!styleEl) {
                    styleEl = doc.createElement('style');
                    styleEl.setAttribute('type', 'text/css');
                    styleEl.setAttribute('data-twt-patch', name);
                    target.appendChild(styleEl);
                } else {
                    const parent = styleEl.parentNode;
                    if (parent && parent.lastElementChild !== styleEl) {
                        parent.appendChild(styleEl);
                    }
                }
                if (styleEl.textContent !== code) {
                    styleEl.textContent = code;
                }
            }
        } catch (e) {
            console.warn('[TwT] Failed to inject isolated patch styles into document:', e);
        }
    });

    if (notify && typeof toastr !== 'undefined') {
        toastr.success(`已重新应用 ${activeCount} 个已启用 CSS 补丁`, 'CSS 优化');
    }
    return { count: activeCount, names: activeNames };
}

const BUILTIN_FONTS = {
    'Huiwen-mincho': {
        name: '汇文明朝',
        family: 'Huiwen-mincho',
        url: 'https://fontsapi.zeoseven.com/256/main/result.css'
    },
    'Noto Serif CJK': {
        name: '思源宋体',
        family: 'Noto Serif CJK',
        url: 'https://fontsapi.zeoseven.com/285/main/result.css'
    }
};

function getValidCustomFonts() {
    const raw = extension_settings.twt?.customFonts;
    if (!raw || typeof raw !== 'object') return {};
    const valid = {};
    for (const [key, fontData] of Object.entries(raw)) {
        if (!fontData || typeof fontData !== 'object') continue;
        if (fontData.storage === 'idb' || fontData.url || (fontData.css && typeof fontData.css === 'string' && fontData.css.trim().length > 0)) {
            valid[key] = fontData;
        }
    }
    return valid;
}

async function updateCustomFontsStyle() {
    const customFonts = getValidCustomFonts();
    const currentFont = extension_settings.twt?.fontFamily || 'inherit';

    // 1. Determine active remote stylesheet URL (on-demand loading)
    let activeRemoteUrl = '';
    if (BUILTIN_FONTS[currentFont]) {
        activeRemoteUrl = BUILTIN_FONTS[currentFont].url;
    } else if (customFonts[currentFont]?.url) {
        activeRemoteUrl = customFonts[currentFont].url;
    } else {
        for (const fontData of Object.values(customFonts)) {
            if (fontData.family === currentFont && fontData.url) {
                activeRemoteUrl = fontData.url;
                break;
            }
        }
    }

    // 2. Build local/custom @font-face CSS
    let fontFaceCss = '';
    for (const [fontName, fontData] of Object.entries(customFonts)) {
        if (!fontData) continue;
        if (fontData.storage === 'idb') {
            try {
                const blobUrl = await getFontBlobUrl(fontName);
                if (blobUrl) {
                    const ext = (fontData.ext || 'ttf').toLowerCase();
                    const format = ext === 'woff2' ? 'woff2' : (ext === 'woff' ? 'woff' : (ext === 'otf' ? 'opentype' : 'truetype'));
                    fontFaceCss += `@font-face {\n  font-family: "${fontData.family || fontName}";\n  src: url("${blobUrl}") format("${format}");\n  font-display: swap;\n}\n\n`;
                }
            } catch (e) {
                console.warn('[TwT] Failed to load local font from IndexedDB:', fontName, e);
            }
        } else if (fontData.css) {
            const snippet = fontData.css.trim();
            if (/@font-face/i.test(snippet)) {
                fontFaceCss += `/* Custom Font: ${fontName} */\n${snippet}\n\n`;
            } else if (snippet.startsWith('@import')) {
                const importMatch = snippet.match(/@import\s+url\((["']?)([^"')]+)\1\);?/i);
                if (importMatch && (fontData.family === currentFont || fontName === currentFont)) {
                    if (!activeRemoteUrl) activeRemoteUrl = importMatch[2];
                } else if (!activeRemoteUrl && (fontData.family === currentFont || fontName === currentFont)) {
                    fontFaceCss += `${snippet}\n\n`;
                }
            } else {
                fontFaceCss += `/* Custom Font: ${fontName} */\n${snippet}\n\n`;
            }
        }
    }

    // 3. Inject into all docs
    const docs = getAllDocs();
    docs.forEach(doc => {
        try {
            // Manage external <link> for active font (on demand)
            let link = doc.getElementById('twt-active-font-link');
            if (activeRemoteUrl) {
                if (!link) {
                    link = doc.createElement('link');
                    link.id = 'twt-active-font-link';
                    link.rel = 'stylesheet';
                    const target = doc.head || doc.body || doc.documentElement;
                    if (target) target.appendChild(link);
                }
                if (link && link.getAttribute('href') !== activeRemoteUrl) {
                    link.href = activeRemoteUrl;
                }
            } else if (link) {
                link.remove();
            }

            // Manage inline <style> for @font-face
            let style = doc.getElementById('twt-custom-fonts-style');
            if (fontFaceCss.trim().length > 0) {
                if (!style) {
                    style = doc.createElement('style');
                    style.id = 'twt-custom-fonts-style';
                    const target = doc.head || doc.body || doc.documentElement;
                    if (target) target.appendChild(style);
                }
                if (style && style.textContent !== fontFaceCss) {
                    style.textContent = fontFaceCss;
                }
            } else if (style) {
                style.textContent = '';
            }
        } catch (e) {
            console.warn('[TwT] Failed to inject custom font style into document:', e);
        }
    });
}

function getFontDetails(fontFamilyValue) {
    const target = fontFamilyValue || extension_settings.twt?.fontFamily || 'inherit';
    if (!target || target === 'inherit') {
        return {
            name: '系统默认',
            type: '系统默认',
            family: 'inherit (系统或全局主题默认)',
            code: '/* 沿用系统或酒馆全局主题内置字体 */'
        };
    }
    if (BUILTIN_FONTS[target]) {
        return {
            name: BUILTIN_FONTS[target].name,
            type: '内置网络字体',
            family: BUILTIN_FONTS[target].family,
            code: `@import url("${BUILTIN_FONTS[target].url}");`
        };
    }
    const customFonts = getValidCustomFonts();
    let found = null;
    let foundKey = '';
    for (const [k, v] of Object.entries(customFonts)) {
        if (k === target || (v && (v.family === target || v.name === target))) {
            found = v;
            foundKey = k;
            break;
        }
    }
    if (found) {
        let typeStr = '自定义字体';
        let codeStr = found.css || '';
        if (found.storage === 'idb') {
            typeStr = '本地文件 (IndexedDB)';
            codeStr = `/* 本地字体文件\n存储位置: 浏览器本地 IndexedDB (twt_font_db)\n文件格式: .${found.ext || 'ttf'}\n特点: 极速加载且不膨胀 settings.json 配置文件 */`;
        } else if (found.url) {
            typeStr = '网络外链 CSS';
            codeStr = found.css || `@import url("${found.url}");`;
        } else if (/@font-face/i.test(found.css || '')) {
            typeStr = '自定义 @font-face';
        }
        return {
            name: found.name || foundKey,
            type: typeStr,
            family: found.family || foundKey,
            code: codeStr
        };
    }
    return {
        name: target,
        type: '自定义字体',
        family: target,
        code: `font-family: "${target}";`
    };
}

function updateFontSummaryHint() {
    const details = getFontDetails();
    const $summary = $('#twt_font_summary_text');
    if ($summary.length) {
        $summary.text(`当前：${details.name} [${details.type} | 族名: ${details.family}]`);
    }
}

function renderFontFamilyOptions() {
    const $select = $('#twt_font_family');
    if (!$select.length) return;
    $select.empty();
    $select.append(`<option value="inherit">系统默认</option>`);
    for (const [key, fontObj] of Object.entries(BUILTIN_FONTS)) {
        $select.append($('<option></option>').val(fontObj.family).text(fontObj.name));
    }
    const customFonts = getValidCustomFonts();
    extension_settings.twt.customFonts = customFonts;
    for (const [fontKey, fontObj] of Object.entries(customFonts)) {
        if (BUILTIN_FONTS[fontKey] || BUILTIN_FONTS[fontObj.family]) continue;
        const displayName = fontObj.name || fontKey;
        const familyVal = fontObj.family || fontKey;
        $select.append($('<option></option>').val(familyVal).text(`${displayName} (自定义)`));
    }
    $select.val(extension_settings.twt.fontFamily || 'inherit');
    updateFontSummaryHint();
}


function renderPresetList() {
    const $select = $('#twt_visual_preset');
    $select.empty();
    $select.append(`<option value="custom">自定义</option>`);
    for (const presetName of Object.keys(extension_settings.twt.visualPresets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    $select.val(extension_settings.twt.currentPreset);
}

function applyPreset(presetName) {
    if (presetName === 'custom') return;
    const preset = extension_settings.twt.visualPresets[presetName];
    if (preset) {
        // Page margins
        if (preset.paddingTop !== undefined) extension_settings.twt.paddingTop = preset.paddingTop;
        if (preset.paddingBottom !== undefined) extension_settings.twt.paddingBottom = preset.paddingBottom;
        if (preset.paddingLeft !== undefined) extension_settings.twt.paddingLeft = preset.paddingLeft;
        if (preset.paddingRight !== undefined) extension_settings.twt.paddingRight = preset.paddingRight;
        
        $('#twt_padding_top').val(extension_settings.twt.paddingTop);
        $('#twt_padding_bottom').val(extension_settings.twt.paddingBottom);
        $('#twt_padding_left').val(extension_settings.twt.paddingLeft);
        $('#twt_padding_right').val(extension_settings.twt.paddingRight);

        if (preset.avatarLayoutMode !== undefined) extension_settings.twt.avatarLayoutMode = preset.avatarLayoutMode;
        else extension_settings.twt.avatarLayoutMode = 'float';
        $('#twt_avatar_layout_mode').val(extension_settings.twt.avatarLayoutMode);

        if (preset.autoBubbleThemeEnabled !== undefined) extension_settings.twt.autoBubbleThemeEnabled = !!preset.autoBubbleThemeEnabled;
        else extension_settings.twt.autoBubbleThemeEnabled = true;
        $('#twt_auto_bubble_theme_enabled').prop('checked', extension_settings.twt.autoBubbleThemeEnabled);
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
        
        // Typography
        if (preset.fontSize !== undefined) extension_settings.twt.fontSize = preset.fontSize;
        if (preset.lineHeight !== undefined) extension_settings.twt.lineHeight = preset.lineHeight;
        if (preset.textIndent !== undefined) extension_settings.twt.textIndent = preset.textIndent;
        if (preset.textAlign !== undefined) extension_settings.twt.textAlign = preset.textAlign;
        if (preset.paragraphSpacing !== undefined) extension_settings.twt.paragraphSpacing = preset.paragraphSpacing;
        if (preset.letterSpacing !== undefined) extension_settings.twt.letterSpacing = preset.letterSpacing;
        if (preset.fontWeight !== undefined) extension_settings.twt.fontWeight = preset.fontWeight;
        if (preset.fontFamily !== undefined) extension_settings.twt.fontFamily = preset.fontFamily;
        else extension_settings.twt.fontFamily = 'inherit';
        updateCustomFontsStyle();
        renderFontFamilyOptions();
        
        $('#twt_font_size').val(extension_settings.twt.fontSize);
        $('#twt_line_height').val(extension_settings.twt.lineHeight);
        $('#twt_text_indent').val(extension_settings.twt.textIndent);
        $('#twt_text_align').val(extension_settings.twt.textAlign);
        $('#twt_paragraph_spacing').val(extension_settings.twt.paragraphSpacing);
        $('#twt_letter_spacing').val(extension_settings.twt.letterSpacing);
        $('#twt_font_weight').val(extension_settings.twt.fontWeight || 'normal');
        
        // CSS Optimization Patches: apply saved patch active states if defined in preset
        const patches = extension_settings.twt.optimizePatches || {};
        if (!preset.optimizePatches || typeof preset.optimizePatches !== 'object') {
            preset.optimizePatches = {};
        }
        for (const [key, patch] of Object.entries(patches)) {
            if (key in preset.optimizePatches) {
                patch.active = !!preset.optimizePatches[key];
            } else {
                // 其余预设中该补丁默认为不启用状态
                patch.active = false;
                preset.optimizePatches[key] = false;
            }
        }
        renderOptimizePatchList();
        updateInjectedStyles();
        
        getContext().saveSettingsDebounced();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    }
}

function applyVisualSettingsStateAndUI(s) {
    if (!s || typeof s !== 'object') return;
    if (s.paddingTop !== undefined) extension_settings.twt.paddingTop = Number(s.paddingTop);
    if (s.paddingBottom !== undefined) extension_settings.twt.paddingBottom = Number(s.paddingBottom);
    if (s.paddingLeft !== undefined) extension_settings.twt.paddingLeft = Number(s.paddingLeft);
    if (s.paddingRight !== undefined) extension_settings.twt.paddingRight = Number(s.paddingRight);
    if (s.avatarLayoutMode !== undefined) extension_settings.twt.avatarLayoutMode = s.avatarLayoutMode;
    if (s.autoBubbleThemeEnabled !== undefined) extension_settings.twt.autoBubbleThemeEnabled = !!s.autoBubbleThemeEnabled;

    if (s.fontSize !== undefined) extension_settings.twt.fontSize = Number(s.fontSize);
    if (s.lineHeight !== undefined) extension_settings.twt.lineHeight = Number(s.lineHeight);
    if (s.textIndent !== undefined) extension_settings.twt.textIndent = Number(s.textIndent);
    if (s.textAlign !== undefined) extension_settings.twt.textAlign = s.textAlign;
    if (s.paragraphSpacing !== undefined) extension_settings.twt.paragraphSpacing = Number(s.paragraphSpacing);
    if (s.letterSpacing !== undefined) extension_settings.twt.letterSpacing = Number(s.letterSpacing);
    if (s.fontWeight !== undefined) extension_settings.twt.fontWeight = s.fontWeight;
    if (s.fontFamily !== undefined) extension_settings.twt.fontFamily = s.fontFamily;

    $('#twt_padding_top').val(extension_settings.twt.paddingTop);
    $('#twt_padding_bottom').val(extension_settings.twt.paddingBottom);
    $('#twt_padding_left').val(extension_settings.twt.paddingLeft);
    $('#twt_padding_right').val(extension_settings.twt.paddingRight);
    $('#twt_avatar_layout_mode').val(extension_settings.twt.avatarLayoutMode || 'float');
    $('#twt_auto_bubble_theme_enabled').prop('checked', extension_settings.twt.autoBubbleThemeEnabled !== false);

    $('#twt_font_size').val(extension_settings.twt.fontSize);
    $('#twt_line_height').val(extension_settings.twt.lineHeight);
    $('#twt_text_indent').val(extension_settings.twt.textIndent);
    $('#twt_text_align').val(extension_settings.twt.textAlign);
    $('#twt_paragraph_spacing').val(extension_settings.twt.paragraphSpacing);
    $('#twt_letter_spacing').val(extension_settings.twt.letterSpacing);
    $('#twt_font_weight').val(extension_settings.twt.fontWeight || 'normal');

    renderFontFamilyOptions();
    applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    updateCustomFontsStyle();
}

function saveCurrentToPreset(name) {
    const presetData = {
        paddingTop: extension_settings.twt.paddingTop,
        paddingBottom: extension_settings.twt.paddingBottom,
        paddingLeft: extension_settings.twt.paddingLeft,
        paddingRight: extension_settings.twt.paddingRight,
        fontSize: extension_settings.twt.fontSize,
        lineHeight: extension_settings.twt.lineHeight,
        textIndent: extension_settings.twt.textIndent,
        textAlign: extension_settings.twt.textAlign,
        paragraphSpacing: extension_settings.twt.paragraphSpacing,
        letterSpacing: extension_settings.twt.letterSpacing,
        fontWeight: extension_settings.twt.fontWeight || 'normal',
        fontFamily: extension_settings.twt.fontFamily || 'inherit',
        avatarLayoutMode: extension_settings.twt.avatarLayoutMode || 'float',
        autoBubbleThemeEnabled: extension_settings.twt.autoBubbleThemeEnabled !== false
    };

    presetData.optimizePatches = {};
    const patches = extension_settings.twt.optimizePatches || {};
    for (const patchName of Object.keys(patches)) {
        presetData.optimizePatches[patchName] = !!patches[patchName].active;
    }

    extension_settings.twt.visualPresets[name] = presetData;
    extension_settings.twt.currentPreset = name;
    getContext().saveSettingsDebounced();
    renderPresetList();
}


function renderMuluRegexPresetList() {
    const $select = $('#twt_mulu_regex_preset');
    $select.empty();
    $select.append(`<option value="custom">自定义</option>`);
    for (const presetName of Object.keys(extension_settings.twt.muluRegexPresets)) {
        const $opt = $('<option></option>').val(presetName).text(presetName);
        $select.append($opt);
    }
    $select.val(extension_settings.twt.currentMuluRegexPreset);
}

function applyMuluRegexPreset(presetName) {
    if (presetName === 'custom') return;
    const regexPattern = extension_settings.twt.muluRegexPresets[presetName];
    if (regexPattern !== undefined) {
        extension_settings.twt.customMuluRegex = regexPattern;
        $('#twt_mulu_regex_input').val(regexPattern);
        getContext().saveSettingsDebounced();
    }
}

function saveCurrentToMuluRegexPreset(name) {
    extension_settings.twt.muluRegexPresets[name] = extension_settings.twt.customMuluRegex;
    extension_settings.twt.currentMuluRegexPreset = name;
    getContext().saveSettingsDebounced();
    renderMuluRegexPresetList();
}

let workLogs = [];

function logWork(message) {
    const timeStr = new Date().toLocaleTimeString();
    const text = `[${timeStr}] ${message}`;
    const entry = { time: Date.now(), text };
    workLogs.push(entry);
    if (workLogs.length > 60) workLogs.shift();
    
    console.log('[TwT WorkLog]', text);

    // 仅在日志容器当前处于展开显示状态时才更新 DOM，折叠时 0 性能与重绘开销
    const $container = getEl('#twt-work-logs');
    if ($container.length && $container.is(':visible')) {
        if ($container.children().length === 1 && $container.text().includes('暂无工作日志记录')) {
            $container.empty();
        }
        $container.append(`<div style="line-height:1.3; font-size:0.95em;">${escapeHtml(text)}</div>`);
        $container.scrollTop($container[0].scrollHeight);
    }
}

function renderWorkLogs() {
    const $container = getEl('#twt-work-logs');
    if (!$container.length) return;
    $container.empty();
    if (workLogs.length === 0) {
        $container.append('<div style="line-height:1.4; opacity:0.5; font-style:italic;">暂无工作日志记录</div>');
    } else {
        const html = workLogs.map(e => `<div style="line-height:1.3; font-size:0.95em;">${escapeHtml(e.text)}</div>`).join('');
        $container.html(html);
        $container.scrollTop($container[0].scrollHeight);
    }
}

function cleanOldLogs() {
    const halfHourAgo = Date.now() - 30 * 60 * 1000;
    const initialLen = workLogs.length;
    workLogs = workLogs.filter(log => log.time >= halfHourAgo);
    
    if (workLogs.length !== initialLen) {
        const $container = getEl('#twt-work-logs');
        if ($container.length && $container.is(':visible')) {
            renderWorkLogs();
        }
    }
}

// 每过半小时自动清理超期日志
setInterval(cleanOldLogs, 30 * 60 * 1000);

// 统一归一化主题名称（带 Map 内存缓存，避免重复正则消耗）
const _themeNormCache = new Map();
function normalizeThemeName(name) {
    if (!name) return '';
    let cached = _themeNormCache.get(name);
    if (cached !== undefined) return cached;
    let s = String(name).trim();
    try { s = decodeURIComponent(s); } catch (e) {}
    cached = s
        .replace(/\\/g, '/')
        .replace(/^.*\//, '')
        .replace(/\.(json|css)$/i, '')
        .trim()
        .toLowerCase();
    _themeNormCache.set(name, cached);
    return cached;
}

// 缓存的全局美化主题列表
let cachedGlobalThemes = [];

// 同步从当前宿主环境中提取已注册主题列表（纯内存与 DOM 提取，0 延时与 0 网络开销）
function getGlobalThemesSync() {
    const themes = [];
    const seen = new Set();

    const addTheme = (val, name) => {
        if (!val) return;
        const cleanVal = String(val).trim();
        const cleanName = String(name || val).trim();
        const norm = normalizeThemeName(cleanVal);
        if (!cleanVal || !norm || seen.has(norm)) return;
        seen.add(norm);
        themes.push({ val: cleanVal, name: cleanName });
    };

    // 1. 读取 #themes 下拉框已渲染的 option
    for (const doc of getAllDocs()) {
        try {
            const select = doc.getElementById('themes');
            if (select && select.options && select.options.length > 0) {
                for (const opt of select.options) {
                    if (opt.value) addTheme(opt.value, opt.text || opt.value);
                }
            }
        } catch (e) {}
    }

    // 2. 检查全局 window.themes 与 context.powerUserSettings
    try {
        if (typeof window !== 'undefined' && Array.isArray(window.themes)) {
            window.themes.forEach(t => {
                if (t && (t.name || t.value)) addTheme(t.value || t.name, t.name || t.value);
            });
        }
    } catch (e) {}
    try {
        const ctx = getContext();
        if (Array.isArray(ctx?.powerUserSettings?.themes)) {
            ctx.powerUserSettings.themes.forEach(t => {
                if (t && (t.name || t.value)) addTheme(t.value || t.name, t.name || t.value);
            });
        }
    } catch (e) {}

    // 3. 检查 window.themeManager 标签中挂载的主题
    try {
        if (window.themeManager && typeof window.themeManager.getTags === 'function') {
            const tags = window.themeManager.getTags() || [];
            if (Array.isArray(tags)) {
                tags.forEach(tag => {
                    if (Array.isArray(tag.themes)) {
                        tag.themes.forEach(th => { if (th) addTheme(th, th); });
                    }
                });
            }
        }
    } catch (e) {}

    // 4. 结合已有内存缓存
    if (cachedGlobalThemes && cachedGlobalThemes.length > 0) {
        cachedGlobalThemes.forEach(t => addTheme(t.val, t.name));
    }

    themes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (themes.length > 0) {
        cachedGlobalThemes = themes;
    }
    return themes;
}

// 仅在本地主题列表为空时按需触发的异步轻量兜底获取
async function fetchGlobalThemesLazy() {
    let themes = getGlobalThemesSync();
    if (themes.length > 0) return themes;

    try {
        const ctx = getContext();
        const headers = (typeof ctx?.getRequestHeaders === 'function') ? ctx.getRequestHeaders() : {};
        const res = await fetch('/api/settings/get', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.themes) && data.themes.length > 0) {
                const seen = new Set(themes.map(t => normalizeThemeName(t.val)));
                data.themes.forEach(t => {
                    const val = t.name || t.value;
                    const norm = normalizeThemeName(val);
                    if (val && norm && !seen.has(norm)) {
                        seen.add(norm);
                        themes.push({ val: String(val).trim(), name: String(t.name || val).trim() });
                    }
                });
                themes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
                cachedGlobalThemes = themes;
            }
        }
    } catch (e) {
        console.warn('[TwT] 按需拉取美化主题失败:', e);
    }
    return themes;
}

// 兼容老调用签名的同步主题获取函数
function getGlobalThemes() {
    return getGlobalThemesSync();
}

// 高效获取当前宿主激活的全局美化主题名称（纯内存与单点属性查询）
function getCurrentActiveTheme() {
    try {
        const ctx = getContext();
        if (ctx?.powerUserSettings?.theme) {
            return ctx.powerUserSettings.theme;
        }
    } catch (e) {}

    const el = document.getElementById('themes');
    if (el && el.value) return el.value;

    try {
        if (typeof power_user !== 'undefined' && power_user?.theme) {
            return power_user.theme;
        }
    } catch (e) {}

    return null;
}

function findLinkedPreset(themeVal) {
    if (!themeVal) return null;
    const themeLinks = extension_settings.twt.presetThemeLinks || {};
    const norm = normalizeThemeName(themeVal);

    // 1. 尝试原始路径直接匹配
    if (themeLinks[themeVal]) return themeLinks[themeVal];

    // 2. 尝试归一化纯文件名匹配（不区分大小写、兼容二级路径及 .json / .css 后缀差异）
    for (const [linkThemeKey, presetName] of Object.entries(themeLinks)) {
        if (normalizeThemeName(linkThemeKey) === norm) {
            return presetName;
        }
    }

    // 3. 尝试 themeManager 标签关联（支持多级标签、深度优先特化与祖先继承）
    if (window.themeManager) {
        try {
            const allTags = typeof window.themeManager.getTags === 'function' ? (window.themeManager.getTags() || []) : [];
            const tagsById = new Map();
            if (Array.isArray(allTags)) {
                allTags.forEach(t => {
                    if (t && t.id) tagsById.set(t.id, t);
                });
            }

            // 获取主题直接关联的标签列表 (多通道容错匹配)
            const directTagIdSet = new Set();
            if (typeof window.themeManager.getThemeTags === 'function') {
                const apiTags1 = window.themeManager.getThemeTags(themeVal) || [];
                const apiTags2 = window.themeManager.getThemeTags(norm) || [];
                apiTags1.concat(apiTags2).forEach(tid => directTagIdSet.add(tid));
            }
            if (Array.isArray(allTags)) {
                allTags.forEach(t => {
                    if (Array.isArray(t.themes)) {
                        const hit = t.themes.some(th => th && (th === themeVal || normalizeThemeName(th) === norm));
                        if (hit) directTagIdSet.add(t.id);
                    }
                });
            }
            const directTagIds = Array.from(directTagIdSet);

            // 计算指定标签在多级体系下的深度
            const getTagDepth = (tagId) => {
                let depth = 0;
                let curr = tagsById.get(tagId);
                const visited = new Set([tagId]);
                while (curr && curr.parentId && tagsById.has(curr.parentId) && !visited.has(curr.parentId)) {
                    visited.add(curr.parentId);
                    curr = tagsById.get(curr.parentId);
                    if (curr) depth++;
                }
                return depth;
            };

            const tagLinks = extension_settings.twt.presetTagLinks || {};
            const candidateMap = new Map();

            directTagIds.forEach((tagId, idx) => {
                if (!candidateMap.has(tagId)) {
                    candidateMap.set(tagId, {
                        tagId,
                        depth: getTagDepth(tagId),
                        isDirect: true,
                        order: idx
                    });
                }
                let curr = tagsById.get(tagId);
                const visited = new Set([tagId]);
                while (curr && curr.parentId && tagsById.has(curr.parentId) && !visited.has(curr.parentId)) {
                    visited.add(curr.parentId);
                    const pId = curr.parentId;
                    if (!candidateMap.has(pId)) {
                        candidateMap.set(pId, {
                            tagId: pId,
                            depth: getTagDepth(pId),
                            isDirect: false,
                            order: idx + 1000
                        });
                    }
                    curr = tagsById.get(pId);
                }
            });

            const candidates = [];
            for (const item of candidateMap.values()) {
                const presetName = tagLinks[item.tagId];
                if (presetName && extension_settings.twt.visualPresets && extension_settings.twt.visualPresets[presetName]) {
                    candidates.push({
                        ...item,
                        presetName
                    });
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => {
                    if (b.depth !== a.depth) return b.depth - a.depth;
                    if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
                    return a.order - b.order;
                });
                return candidates[0].presetName;
            }
        } catch (err) {
            console.error('[TwT] 获取主题关联标签失败:', err);
        }
    }

    return null;
}

// 纯事件驱动的全局美化主题关联监听器（零定时器轮询，低 CPU/内存占用）
function initThemeLinkListener() {
    let lastDetectedTheme = '';

    const handleThemeChange = (themeVal, isStartup = false) => {
        if (!themeVal) return;

        const normTheme = normalizeThemeName(themeVal);
        const normSavedLastTheme = normalizeThemeName(extension_settings.twt.lastActiveTheme);

        if (isStartup && normSavedLastTheme && normTheme === normSavedLastTheme) {
            return;
        }

        const targetPreset = findLinkedPreset(themeVal);
        extension_settings.twt.lastActiveTheme = themeVal;
        getContext().saveSettingsDebounced();

        if (targetPreset && extension_settings.twt.visualPresets && extension_settings.twt.visualPresets[targetPreset]) {
            if (isStartup && extension_settings.twt.currentPreset === targetPreset) {
                return;
            }
            logWork(`主题 [${themeVal}] 切换，自动载入关联预设 [${targetPreset}]`);
            extension_settings.twt.currentPreset = targetPreset;
            getEl('#twt_visual_preset').val(targetPreset);
            applyPreset(targetPreset);
        } else if (!isStartup) {
            logWork(`主题 [${themeVal}] 未关联预设，保持当前预设 [${extension_settings.twt.currentPreset || '无'}]`);
        }

        updateCommentsBgSolid();
        // 直接原地更新气泡自适应补丁，避免先 remove 再延时 100ms 重建造成多列排版二次剧烈重排与跳页
        autoNormalizeBubbleTheme(extension_settings?.twt);
        setTimeout(() => autoNormalizeBubbleTheme(extension_settings?.twt), 100);
    };

    const checkCurrentTheme = (force = false) => {
        const curTheme = getCurrentActiveTheme();
        if (!curTheme) return;
        const normCur = normalizeThemeName(curTheme);
        const normLast = normalizeThemeName(lastDetectedTheme);
        if (force || normCur !== normLast) {
            lastDetectedTheme = curTheme;
            handleThemeChange(curTheme, false);
        }
    };

    // 1. 事件驱动：通过 jQuery 委托高效监听 #themes 的 change 事件 (覆盖原生及 themeManager 触发的事件)
    $(document).off('change.twt_theme', '#themes').on('change.twt_theme', '#themes', function() {
        const val = $(this).val();
        if (val) {
            lastDetectedTheme = val;
            handleThemeChange(val, false);
        }
    });

    // 2. 事件驱动：监听 SillyTavern 事件总线
    try {
        const ctx = getContext();
        if (ctx?.eventSource && ctx?.eventTypes) {
            if (ctx.eventTypes.SETTINGS_UPDATED) {
                ctx.eventSource.on(ctx.eventTypes.SETTINGS_UPDATED, () => {
                    checkCurrentTheme();
                });
            }
            if (ctx.eventTypes.CHAT_CHANGED) {
                ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
                    setTimeout(checkCurrentTheme, 150);
                });
            }
        }
    } catch (e) {}

    // 3. 事件驱动：监听 themeManager 标签变化与自定义事件
    if (window.themeManager && typeof window.themeManager.onTagsChanged === 'function') {
        window.themeManager.onTagsChanged(() => checkCurrentTheme(true));
    }
    document.addEventListener('themeManager:tagsChanged', () => checkCurrentTheme(true));

    // 4. 防抖 MutationObserver：仅在 documentElement 发生类或样式变更时防抖 200ms 检测，避免频繁微操作卡顿
    let themeMutationTimer = null;
    const themeObserver = new MutationObserver(() => {
        if (themeMutationTimer) clearTimeout(themeMutationTimer);
        themeMutationTimer = setTimeout(() => {
            updateCommentsBgSolid();
            checkCurrentTheme();
        }, 200);
    });
    if (document.documentElement) {
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    // 5. 启动时即时静默自检（0 网络请求，轻量读取已加载项）
    const initialTheme = getCurrentActiveTheme();
    if (initialTheme) {
        lastDetectedTheme = initialTheme;
        handleThemeChange(initialTheme, true);
    }
}


// ============================================================
// 拓展更新后自动刷新酒馆机制
// ============================================================
function bindUI() {
    const $enabled = $('#twt_enabled');
    const $diagEnabled = $('#twt_diag_enabled, #twt_page_diag_enabled');
    const $qrInjectEnabled = $('#twt_qr_inject_enabled');
    const $swipeEnabled = $('#twt_swipe_enabled');
    const $messagePageEnabled = $('#twt_message_page_enabled');
    const $autoBubbleThemeEnabled = $('#twt_auto_bubble_theme_enabled');
    const $autoScrollNewMessage = $('#twt_auto_scroll_new_message');
    const $autoRestoreReadingPosition = $('#twt_auto_restore_reading_position');
    const $htmlPageBreakEnabled = $('#twt_html_page_break_enabled');
    const $htmlPopupEnabled = $('#twt_html_popup_enabled');
    const $htmlPopupTriggerMode = $('#twt_html_popup_trigger_mode');
    const $htmlPopupFallbackEnabled = $('#twt_html_popup_fallback_enabled');
    const $htmlPopupSelector = $('#twt_html_popup_selector');
    const $htmlPopupTitleMap = $('#twt_html_popup_title_map');
    const $htmlPopupWhitelist = $('#twt_html_popup_whitelist');
    const $avatarLayoutMode = $('#twt_avatar_layout_mode');
    const $customWhitelist = $('#twt_custom_whitelist');
    const $toolCallMode = $('#twt_tool_call_mode');
    const $toolCallNoPageBreak = $('#twt_tool_call_no_page_break');
    const $toolCallPreventFlip = $('#twt_tool_call_prevent_flip');
    const $toolCallSelector = $('#twt_tool_call_selector');
    const $menuEnabled = $('#twt_menu_enabled');
    const $menuInvokeMethod = $('#twt_menu_invoke_method');
    const $menuLongpressDelay = $('#twt_menu_longpress_delay');
    const $menuDirection = $('#twt_menu_direction');
    const $menuOptRegenerate = $('#twt_menu_opt_regenerate');
    const $menuOptSwipe = $('#twt_menu_opt_swipe');
    const $menuOptManage = $('#twt_menu_opt_manage');
    const $menuOptEdit = $('#twt_menu_opt_edit');
    const $menuOptFullEdit = $('#twt_menu_opt_full_edit');
    const $paragraphToolbarBottom = $('#twt_paragraph_toolbar_bottom');
    const $paragraphIconSize = $('#twt_paragraph_icon_size');
    const $paragraphXmlWhitelist = $('#twt_paragraph_xml_whitelist');
    const $menuOptEditFiltered = $('#twt_menu_opt_edit_filtered');
    const $menuOptExcerpt = $('#twt_menu_opt_excerpt');
    const $excerptTopOffset = $('#twt_excerpt_top_offset');
    const $excerptFontSize = $('#twt_excerpt_font_size');
    const $menuOptFullscreen = $('#twt_menu_opt_fullscreen');
    const $menuOptFullscreenHideSendForm = $('#twt_menu_opt_fullscreen_hide_send_form');
    const $menuOptApi = $('#twt_menu_opt_api');
    const $menuOptPurifier = $('#twt_menu_opt_purifier');
    const $menuOptPurifierDiff = $('#twt_menu_opt_purifier_diff');
    const $menuOptNewChat = $('#twt_menu_opt_new_chat');
    const $menuOptCloseChat = $('#twt_menu_opt_close_chat');
    const $menuOptRealign = $('#twt_menu_opt_realign');
    const $menuOptPromptViewer = $('#twt_menu_opt_prompt_viewer');
    const $menuOptRandomInspect = $('#twt_menu_opt_random_inspect');
    const $menuOptImageTag = $('#twt_menu_opt_image_tag');
    const $menuOptScreenshot = $('#twt_menu_opt_screenshot');
    const $menuStyle = $('#twt_menu_style');
    const $menuFontSize = $('#twt_menu_font_size');
    const $visualEnabled = $('#twt_visual_enabled');
    const $muluEnabled = $('#twt_mulu_enabled');
    
    const $paddingTop = $('#twt_padding_top');
    const $paddingBottom = $('#twt_padding_bottom');
    const $paddingLeft = $('#twt_padding_left');
    const $paddingRight = $('#twt_padding_right');
    const $fontSize = $('#twt_font_size');
    const $lineHeight = $('#twt_line_height');
    const $textIndent = $('#twt_text_indent');
    const $textAlign = $('#twt_text_align');
    const $paragraphSpacing = $('#twt_paragraph_spacing');
    const $letterSpacing = $('#twt_letter_spacing');
    const $fontWeight = $('#twt_font_weight');

    const $muluBtnStart = $('#twt_mulu_btn_start');
    const $muluBtnToc = $('#twt_mulu_btn_toc');
    const $muluBtnEnd = $('#twt_mulu_btn_end');
    const $muluToolCallMode = $('#twt_mulu_tool_call_mode');

    // UI初始化
    $enabled.prop('checked', extension_settings.twt.enabled);
    $diagEnabled.prop('checked', extension_settings.twt.diagLogEnabled === true);
    $qrInjectEnabled.prop('checked', extension_settings.twt.qrInjectEnabled !== false);
    $swipeEnabled.prop('checked', extension_settings.twt.swipeEnabled);
    $messagePageEnabled.prop('checked', extension_settings.twt.messagePageEnabled);
    $autoBubbleThemeEnabled.prop('checked', extension_settings.twt.autoBubbleThemeEnabled !== false);
    $autoScrollNewMessage.prop('checked', extension_settings.twt.autoScrollNewMessage !== false);
    $autoRestoreReadingPosition.prop('checked', extension_settings.twt.autoRestoreReadingPosition !== false);
    $htmlPageBreakEnabled.prop('checked', extension_settings.twt.htmlPageBreakEnabled);
    $htmlPopupEnabled.prop('checked', extension_settings.twt.htmlPopupEnabled !== false);
    $htmlPopupTriggerMode.val(extension_settings.twt.htmlPopupTriggerMode || 'qr');
    $htmlPopupFallbackEnabled.prop('checked', extension_settings.twt.htmlPopupFallbackEnabled === true);
    $htmlPopupSelector.val(extension_settings.twt.htmlPopupSelector || 'iframe, .twt-custom-app, [data-app-container], .rendered-html-app');
    $htmlPopupTitleMap.val(extension_settings.twt.htmlPopupTitleMap || '');
    $htmlPopupWhitelist.val(extension_settings.twt.htmlPopupWhitelist || '');
    $avatarLayoutMode.val(extension_settings.twt.avatarLayoutMode || 'float');
    $customWhitelist.val(extension_settings.twt.customWhitelist || '');
    $toolCallMode.val(extension_settings.twt.toolCallMode || 'minimal');
    $toolCallNoPageBreak.prop('checked', extension_settings.twt.toolCallNoPageBreak !== false);
    $toolCallPreventFlip.prop('checked', extension_settings.twt.toolCallPreventFlip !== false);
    $toolCallSelector.val(extension_settings.twt.toolCallSelector !== undefined ? extension_settings.twt.toolCallSelector : '.mes.toolCall, .mes[is_system="true"].toolCall');
    $menuEnabled.prop('checked', extension_settings.twt.menuEnabled);
    $menuInvokeMethod.val(extension_settings.twt.menuInvokeMethod || 'longpress');
    $menuLongpressDelay.val(extension_settings.twt.menuLongpressDelay || 500);
    $menuDirection.val(extension_settings.twt.menuDirection || 'bottom-right');
    $menuOptRegenerate.prop('checked', extension_settings.twt.menuOptRegenerate);
    $menuOptSwipe.prop('checked', extension_settings.twt.menuOptSwipe);
    $menuOptManage.prop('checked', extension_settings.twt.menuOptManage);
    $menuOptEdit.prop('checked', extension_settings.twt.menuOptEdit);
    $menuOptFullEdit.prop('checked', extension_settings.twt.menuOptFullEdit !== false);
    $paragraphToolbarBottom.val(extension_settings.twt.paragraphToolbarBottom !== undefined ? extension_settings.twt.paragraphToolbarBottom : 15);
    $paragraphIconSize.val(extension_settings.twt.paragraphIconSize !== undefined ? extension_settings.twt.paragraphIconSize : 20);
    $paragraphXmlWhitelist.val(extension_settings.twt.paragraphXmlWhitelist !== undefined ? extension_settings.twt.paragraphXmlWhitelist : 'thought, TavernThought, reasoning, details');
    $menuOptEditFiltered.prop('checked', extension_settings.twt.menuOptEditFiltered ?? false);
    $menuOptExcerpt.prop('checked', extension_settings.twt.menuOptExcerpt);
    $excerptTopOffset.val(extension_settings.twt.excerptTopOffset !== undefined ? extension_settings.twt.excerptTopOffset : 0);
    $excerptFontSize.val(extension_settings.twt.excerptFontSize !== undefined ? extension_settings.twt.excerptFontSize : 12);
    $menuOptFullscreen.prop('checked', extension_settings.twt.menuOptFullscreen);
    $menuOptFullscreenHideSendForm.prop('checked', extension_settings.twt.menuOptFullscreenHideSendForm ?? false);
    $menuOptApi.prop('checked', extension_settings.twt.menuOptApi);
    $menuOptPurifier.prop('checked', extension_settings.twt.menuOptPurifier);
    $menuOptPurifierDiff.prop('checked', extension_settings.twt.menuOptPurifierDiff);
    $menuOptNewChat.prop('checked', extension_settings.twt.menuOptNewChat);
    $menuOptCloseChat.prop('checked', extension_settings.twt.menuOptCloseChat);
    $menuOptRealign.prop('checked', extension_settings.twt.menuOptRealign !== false);
    $menuOptPromptViewer.prop('checked', extension_settings.twt.menuOptPromptViewer);
    $menuOptRandomInspect.prop('checked', extension_settings.twt.menuOptRandomInspect);
    $menuOptImageTag.prop('checked', extension_settings.twt.menuOptImageTag !== false);
    $menuOptScreenshot.prop('checked', extension_settings.twt.menuOptScreenshot !== false);
    $menuStyle.val(extension_settings.twt.menuStyle || 'grid');
    $menuFontSize.val(extension_settings.twt.menuFontSize !== undefined ? extension_settings.twt.menuFontSize : 14);
    
    updateParagraphSubOptionsVisibility();
    updateExcerptSubOptionsVisibility();
    updateFullscreenSubOptionsVisibility();
    
    const updateHtmlPopupSubOptionsVisibility = () => {
        const isPopupOn = $htmlPopupEnabled.prop('checked');
        $('#twt_html_popup_trigger_mode_row').toggle(isPopupOn);
        $('#twt_html_popup_trigger_mode_hint').toggle(isPopupOn);
    };
    updateHtmlPopupSubOptionsVisibility();
    
    const updateLongpressDelayRow = () => {
        if ($menuInvokeMethod.val() === 'longpress') {
            $('#twt_menu_longpress_delay_row').show();
        } else {
            $('#twt_menu_longpress_delay_row').hide();
        }
    };
    updateLongpressDelayRow();

    $visualEnabled.prop('checked', extension_settings.twt.visualEnabled);
    $muluEnabled.prop('checked', extension_settings.twt.muluEnabled);


    $paddingTop.val(extension_settings.twt.paddingTop);
    $paddingBottom.val(extension_settings.twt.paddingBottom);
    $paddingLeft.val(extension_settings.twt.paddingLeft);
    $paddingRight.val(extension_settings.twt.paddingRight);
    $fontSize.val(extension_settings.twt.fontSize);
    $lineHeight.val(extension_settings.twt.lineHeight);
    $textIndent.val(extension_settings.twt.textIndent ?? 0);
    $textAlign.val(extension_settings.twt.textAlign ?? 'left');
    $paragraphSpacing.val(extension_settings.twt.paragraphSpacing ?? 0);
    $letterSpacing.val(extension_settings.twt.letterSpacing ?? 0);
    $fontWeight.val(extension_settings.twt.fontWeight ?? 'normal');

    $muluBtnStart.prop('checked', extension_settings.twt.muluBtnStart);
    $muluBtnToc.prop('checked', extension_settings.twt.muluBtnToc);
    $muluBtnEnd.prop('checked', extension_settings.twt.muluBtnEnd);
    $muluToolCallMode.val(extension_settings.twt.muluToolCallMode || 'hide');

    updateCustomFontsStyle();
    renderFontFamilyOptions();
    renderPresetList();
    renderMuluRegexPresetList();
    if (extension_settings.twt.currentPreset && extension_settings.twt.currentPreset !== 'custom' && extension_settings.twt.visualPresets?.[extension_settings.twt.currentPreset]) {
        applyPreset(extension_settings.twt.currentPreset);
    } else {
        renderOptimizePatchList();
    }

    $('#twt_mulu_regex_input').val(extension_settings.twt.customMuluRegex);

    // 预设相关
    $('#twt_visual_preset').on('change', function() {
        const val = $(this).val();
        extension_settings.twt.currentPreset = val;
        getContext().saveSettingsDebounced();
        applyPreset(val);
    });

    // 辅助切换页签方法
    const switchTab = (activeTab) => {
        if (activeTab === 'themes') {
            getEl('#twt-panel-themes').css('display', 'flex');
            getEl('#twt-panel-tags').css('display', 'none');
            getEl('#twt-tab-themes').css({
                'border-bottom': '2px solid var(--SmartThemeUnderlineColor, #007aff)',
                'font-weight': 'bold',
                'opacity': '1'
            });
            getEl('#twt-tab-tags').css({
                'border-bottom': 'none',
                'font-weight': 'normal',
                'opacity': '0.6'
            });
        } else {
            getEl('#twt-panel-themes').css('display', 'none');
            getEl('#twt-panel-tags').css('display', 'flex');
            getEl('#twt-tab-tags').css({
                'border-bottom': '2px solid var(--SmartThemeUnderlineColor, #007aff)',
                'font-weight': 'bold',
                'opacity': '1'
            });
            getEl('#twt-tab-themes').css({
                'border-bottom': 'none',
                'font-weight': 'normal',
                'opacity': '0.6'
            });
        }
    };

    // 绑定页签点击事件
    getEl('#twt-tab-themes').off('click').on('click', function(e) {
        e.stopPropagation();
        switchTab('themes');
    });

    getEl('#twt-tab-tags').off('click').on('click', function(e) {
        e.stopPropagation();
        switchTab('tags');
    });

    getEl('#twt_preset_link').off('click').on('click', async function() {
        const currentPresetName = extension_settings.twt.currentPreset;
        if (!currentPresetName || currentPresetName === 'custom') {
            toastr.warning('“自定义”状态不可进行关联。请先选择一个视觉预设。', '提示');
            return;
        }
        
        getEl('#twt-link-preset-name').text(currentPresetName);
        getEl('#twt-theme-search').val('');
        getEl('#twt-tag-search').val('');
        
        // 渲染主题列表的通用方法 (支持即时渲染已有 + 异步拉取完成后热更新)
        const $themeContainer = getEl('#twt-theme-checkboxes-container');
        const renderThemesList = (themeList, isLoading = false) => {
            $themeContainer.empty();
            if (isLoading && (!themeList || themeList.length === 0)) {
                $themeContainer.append(`
                    <div style="font-size:0.9em; opacity:0.6; text-align:center; padding:15px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <i class="fa-solid fa-spinner fa-spin"></i> 正在读取全部美化主题...
                    </div>
                `);
                return;
            }
            if (!themeList || themeList.length === 0) {
                $themeContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px;">未找到可用的全局美化主题。</div>`);
                return;
            }

            const links = extension_settings.twt.presetThemeLinks || {};
            themeList.forEach(theme => {
                const normVal = normalizeThemeName(theme.val);
                let linkedPreset = links[theme.val];
                if (!linkedPreset && normVal) {
                    for (const [k, p] of Object.entries(links)) {
                        if (normalizeThemeName(k) === normVal) {
                            linkedPreset = p;
                            break;
                        }
                    }
                }
                const isChecked = linkedPreset === currentPresetName;
                const otherPreset = (!isChecked && linkedPreset) ? linkedPreset : null;

                let badgeHtml = '';
                if (isChecked) {
                    badgeHtml = `<span style="color: var(--SmartThemeUnderlineColor, #007aff); font-size: 0.75em; margin-left: auto; padding: 1px 5px; border-radius: 3px; background: rgba(0,122,255,0.15); flex-shrink: 0;">当前预设</span>`;
                } else if (otherPreset) {
                    badgeHtml = `<span style="opacity: 0.55; font-size: 0.75em; margin-left: auto; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.08); flex-shrink: 0;" title="当前已关联到预设: ${escapeHtml(otherPreset)}">已关联: ${escapeHtml(otherPreset)}</span>`;
                }

                $themeContainer.append(`
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; font-size:0.95em; padding:4px 0; user-select:none;">
                        <input type="checkbox" class="twt-theme-link-cb" value="${escapeHtml(theme.val)}" ${isChecked ? 'checked' : ''} style="margin:0; flex-shrink:0;" />
                        <span class="theme-name-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(theme.name)}">${escapeHtml(theme.name)}</span>
                        ${badgeHtml}
                    </label>
                `);
            });
        };

        // 1. 同步即时初次渲染（纯内存与 DOM 提取，0 延迟、0 网络消耗）
        const initialThemes = getGlobalThemesSync();
        renderThemesList(initialThemes, initialThemes.length === 0);

        // 打开弹窗
        getEl('#twt-link-theme-modal').css('display', 'flex');

        // 2. 仅当本地 DOM 与内存尚未填充主题时，才触发轻量兜底请求
        if (initialThemes.length === 0) {
            fetchGlobalThemesLazy().then(freshThemes => {
                renderThemesList(freshThemes, false);
                if (freshThemes.length > 0) {
                    logWork(`已载入全局美化主题列表，共 ${freshThemes.length} 项`);
                }
            }).catch(err => {
                console.error('[TwT] 按需拉取美化主题失败:', err);
                logWork(`读取全局美化主题异常: ${err.message || err}`);
            });
        }
        
        // 渲染标签多级树状列表 (如果 themeManager 可用)
        const $tagContainer = getEl('#twt-tag-checkboxes-container');
        $tagContainer.empty();
        getEl('#twt-tag-search').val('');
        
        if (window.themeManager) {
            getEl('#twt-link-tabs').css('display', 'flex');
            switchTab('themes'); // 默认展示主题页签
            
            try {
                const tags = (typeof window.themeManager.getTags === 'function' ? window.themeManager.getTags() : []) || [];
                if (!Array.isArray(tags) || tags.length === 0) {
                    $tagContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px;">未找到可用的主题标签。</div>`);
                } else {
                    const tagLinks = extension_settings.twt.presetTagLinks || {};
                    const tagsById = new Map(tags.map(t => [t.id, t]));
                    const childrenMap = new Map();

                    // 构建父子级联映射
                    tags.forEach(t => {
                        if (t && t.parentId && tagsById.has(t.parentId)) {
                            if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
                            childrenMap.get(t.parentId).push(t);
                        }
                    });

                    // 根节点（没有 parentId 或 parentId 不在当前列表的顶级标签）
                    const rootTags = tags.filter(t => !t.parentId || !tagsById.has(t.parentId));

                    // 获取面包屑完整路径（如：暗黑模式 / 极黑风格）
                    const getTagFullPath = (tag) => {
                        const parts = [tag.name];
                        let curr = tag;
                        const visited = new Set([tag.id]);
                        while (curr && curr.parentId && tagsById.has(curr.parentId) && !visited.has(curr.parentId)) {
                            visited.add(curr.parentId);
                            curr = tagsById.get(curr.parentId);
                            if (curr) parts.unshift(curr.name);
                        }
                        return parts.join(' / ');
                    };

                    // 递归渲染多级树节点
                    const renderTagNode = (tag, depth = 0) => {
                        const children = childrenMap.get(tag.id) || [];
                        const hasChildren = children.length > 0;
                        const fullPath = getTagFullPath(tag);
                        const isChecked = tagLinks[tag.id] === currentPresetName;
                        const otherPreset = (!isChecked && tagLinks[tag.id]) ? tagLinks[tag.id] : null;
                        const themeCount = Array.isArray(tag.themes) ? tag.themes.length : 0;

                        let badgeHtml = '';
                        if (isChecked) {
                            badgeHtml = `<span style="color: var(--SmartThemeUnderlineColor, #007aff); font-size: 0.75em; margin-left: auto; padding: 1px 5px; border-radius: 3px; background: rgba(0,122,255,0.15); flex-shrink: 0;">当前预设</span>`;
                        } else if (otherPreset) {
                            badgeHtml = `<span style="opacity: 0.55; font-size: 0.75em; margin-left: auto; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.08); flex-shrink: 0;" title="当前已关联到预设: ${escapeHtml(otherPreset)}">已关联: ${escapeHtml(otherPreset)}</span>`;
                        }

                        let nodeHtml = `
                            <div class="twt-tag-tree-node" data-tag-id="${tag.id}" data-parent-id="${tag.parentId || ''}" data-depth="${depth}" style="display: flex; flex-direction: column;">
                                <div class="twt-tag-row" style="display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px ${depth * 18 + 4}px; border-radius: 4px; user-select: none; font-size: 0.95em;">
                                    ${hasChildren ? `
                                        <span class="twt-tag-fold-btn" data-tag-id="${tag.id}" style="cursor: pointer; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.85em; opacity: 0.85; color: var(--SmartThemeQuoteColor, #007aff);" title="点击折叠/展开子标签">
                                            <i class="fa-solid fa-caret-down"></i>
                                        </span>
                                    ` : `
                                        <span style="width: 16px; flex-shrink: 0; display: inline-block;"></span>
                                    `}
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; flex: 1; min-width: 0;">
                                        <input type="checkbox" class="twt-tag-link-cb" value="${tag.id}" ${isChecked ? 'checked' : ''} style="margin: 0; flex-shrink: 0;" />
                                        <i class="${hasChildren ? 'fa-solid fa-folder-open' : 'fa-solid fa-tag'}" style="${hasChildren ? 'color: var(--SmartThemeQuoteColor, #007aff);' : 'opacity: 0.6; font-size: 0.85em;'} flex-shrink: 0;"></i>
                                        <span class="tag-name-text" style="font-weight: ${depth === 0 ? '600' : 'normal'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(fullPath)}">${escapeHtml(tag.name)}</span>
                                        ${themeCount > 0 ? `<span style="opacity: 0.45; font-size: 0.8em; flex-shrink: 0;">(${themeCount})</span>` : ''}
                                        ${badgeHtml}
                                    </label>
                                </div>
                                ${hasChildren ? `
                                    <div class="twt-tag-children-container" data-parent-id="${tag.id}" style="display: flex; flex-direction: column;">
                                        ${children.map(child => renderTagNode(child, depth + 1)).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                        return nodeHtml;
                    };

                    const treeHtml = rootTags.map(rootTag => renderTagNode(rootTag, 0)).join('');
                    $tagContainer.html(treeHtml);

                    // 绑定折叠 / 展开单节点点击事件
                    $tagContainer.find('.twt-tag-fold-btn').off('click').on('click', function(e) {
                        e.stopPropagation();
                        e.preventDefault();
                        const tagId = $(this).attr('data-tag-id');
                        const $childContainer = $tagContainer.find(`.twt-tag-children-container[data-parent-id="${tagId}"]`);
                        const $caretIcon = $(this).find('i');
                        const $folderIcon = $(this).siblings('label').find('.fa-folder, .fa-folder-open');
                        
                        if ($childContainer.css('display') === 'none') {
                            $childContainer.css('display', 'flex');
                            $caretIcon.removeClass('fa-caret-right').addClass('fa-caret-down');
                            $folderIcon.removeClass('fa-folder').addClass('fa-folder-open');
                        } else {
                            $childContainer.css('display', 'none');
                            $caretIcon.removeClass('fa-caret-down').addClass('fa-caret-right');
                            $folderIcon.removeClass('fa-folder-open').addClass('fa-folder');
                        }
                    });

                    // 绑定顶部【全部展开 / 折叠】切换按钮事件
                    getEl('#twt-tag-toggle-expand').off('click').on('click', function(e) {
                        e.stopPropagation();
                        const $allChildren = $tagContainer.find('.twt-tag-children-container');
                        const hasHidden = $allChildren.filter(function() { return $(this).css('display') === 'none'; }).length > 0;
                        if (hasHidden) {
                            // 全部展开
                            $allChildren.css('display', 'flex');
                            $tagContainer.find('.twt-tag-fold-btn i').removeClass('fa-caret-right').addClass('fa-caret-down');
                            $tagContainer.find('.twt-tag-row .fa-folder').removeClass('fa-folder').addClass('fa-folder-open');
                        } else {
                            // 全部折叠
                            $allChildren.css('display', 'none');
                            $tagContainer.find('.twt-tag-fold-btn i').removeClass('fa-caret-down').addClass('fa-caret-right');
                            $tagContainer.find('.twt-tag-row .fa-folder-open').removeClass('fa-folder-open').addClass('fa-folder');
                        }
                    });
                }
            } catch (err) {
                console.error('[TwT] 获取主题管理器标签失败:', err);
                $tagContainer.append(`<div style="font-size:0.9em; opacity:0.5; text-align:center; padding:10px; color:var(--SmartThemeErrorColor);">获取标签失败。</div>`);
            }
        } else {
            // 没有主题管理器，隐藏页签直接展示主题列表
            getEl('#twt-link-tabs').css('display', 'none');
            switchTab('themes');
        }
        
        getEl('#twt-link-theme-modal').css('display', 'flex');
    });

    // 主题搜索过滤事件 (防抖延迟 250ms 触发)
    let themeSearchTimeout;
    getEl('#twt-theme-search').off('input').on('input', function() {
        clearTimeout(themeSearchTimeout);
        const query = $(this).val().toLowerCase();
        themeSearchTimeout = setTimeout(() => {
            getEl('#twt-theme-checkboxes-container label').each(function() {
                const text = $(this).find('.theme-name-text').text().toLowerCase();
                if (text.includes(query)) {
                    $(this).css('display', 'flex');
                } else {
                    $(this).css('display', 'none');
                }
            });
        }, 250);
    });

    // 标签多级搜索过滤事件 (支持名称与层级路径搜索，自动展开匹配路径)
    let tagSearchTimeout;
    getEl('#twt-tag-search').off('input').on('input', function() {
        clearTimeout(tagSearchTimeout);
        const query = $(this).val().trim().toLowerCase();
        tagSearchTimeout = setTimeout(() => {
            const $allNodes = getEl('#twt-tag-checkboxes-container .twt-tag-tree-node');
            const $allContainers = getEl('#twt-tag-checkboxes-container .twt-tag-children-container');
            
            if (!query) {
                $allNodes.css('display', 'flex');
                $allContainers.css('display', 'flex');
                getEl('#twt-tag-checkboxes-container .twt-tag-fold-btn i').removeClass('fa-caret-right').addClass('fa-caret-down');
                getEl('#twt-tag-checkboxes-container .twt-tag-row .fa-folder').removeClass('fa-folder').addClass('fa-folder-open');
                return;
            }

            if (!window.themeManager) return;
            const tags = (typeof window.themeManager.getTags === 'function' ? window.themeManager.getTags() : []) || [];
            const tagsById = new Map(tags.map(t => [t.id, t]));
            const childrenMap = new Map();
            tags.forEach(t => {
                if (t && t.parentId && tagsById.has(t.parentId)) {
                    if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
                    childrenMap.get(t.parentId).push(t);
                }
            });

            const getTagFullPath = (tag) => {
                const parts = [tag.name];
                let curr = tag;
                const visited = new Set([tag.id]);
                while (curr && curr.parentId && tagsById.has(curr.parentId) && !visited.has(curr.parentId)) {
                    visited.add(curr.parentId);
                    curr = tagsById.get(curr.parentId);
                    if (curr) parts.unshift(curr.name);
                }
                return parts.join(' / ');
            };

            const visibleTagIds = new Set();
            const expandParentIds = new Set();

            tags.forEach(tag => {
                const name = (tag.name || '').toLowerCase();
                const fullPath = getTagFullPath(tag).toLowerCase();
                if (name.includes(query) || fullPath.includes(query)) {
                    visibleTagIds.add(tag.id);

                    // 祖先链全部标记为可见并展开
                    let curr = tag;
                    const visited = new Set([tag.id]);
                    while (curr && curr.parentId && tagsById.has(curr.parentId) && !visited.has(curr.parentId)) {
                        visited.add(curr.parentId);
                        visibleTagIds.add(curr.parentId);
                        expandParentIds.add(curr.parentId);
                        curr = tagsById.get(curr.parentId);
                    }

                    // 命中的父节点其所有子孙也一并展示
                    const queue = [tag.id];
                    while (queue.length > 0) {
                        const currId = queue.shift();
                        const cList = childrenMap.get(currId) || [];
                        cList.forEach(c => {
                            visibleTagIds.add(c.id);
                            queue.push(c.id);
                        });
                    }
                }
            });

            $allNodes.each(function() {
                const tid = $(this).attr('data-tag-id');
                if (visibleTagIds.has(tid)) {
                    $(this).css('display', 'flex');
                } else {
                    $(this).css('display', 'none');
                }
            });

            $allContainers.each(function() {
                const pid = $(this).attr('data-parent-id');
                if (expandParentIds.has(pid)) {
                    $(this).css('display', 'flex');
                    const $caret = $(this).siblings('.twt-tag-row').find('.twt-tag-fold-btn i');
                    $caret.removeClass('fa-caret-right').addClass('fa-caret-down');
                    const $folder = $(this).siblings('.twt-tag-row').find('.fa-folder');
                    $folder.removeClass('fa-folder').addClass('fa-folder-open');
                }
            });
        }, 250);
    });

    getEl('#twt_link_theme_cancel').off('click').on('click', function(e) {
        e.stopPropagation();
        getEl('#twt-link-theme-modal').css('display', 'none');
    });

    getEl('#twt_link_theme_save').off('click').on('click', function(e) {
        e.stopPropagation();
        const currentPresetName = extension_settings.twt.currentPreset;
        if (!extension_settings.twt.presetThemeLinks) {
            extension_settings.twt.presetThemeLinks = {};
        }
        if (!extension_settings.twt.presetTagLinks) {
            extension_settings.twt.presetTagLinks = {};
        }
        
        const checkedThemes = [];
        getEl('#twt-theme-checkboxes-container .twt-theme-link-cb').each(function() {
            const val = $(this).val();
            const checked = $(this).prop('checked');
            const norm = normalizeThemeName(val);
            if (checked) {
                extension_settings.twt.presetThemeLinks[val] = currentPresetName;
                checkedThemes.push(val);
            } else {
                for (const [k, p] of Object.entries(extension_settings.twt.presetThemeLinks)) {
                    if (p === currentPresetName && (k === val || normalizeThemeName(k) === norm)) {
                        delete extension_settings.twt.presetThemeLinks[k];
                    }
                }
            }
        });

        const checkedTags = [];
        if (window.themeManager) {
            getEl('#twt-tag-checkboxes-container .twt-tag-link-cb').each(function() {
                const val = $(this).val();
                const checked = $(this).prop('checked');
                if (checked) {
                    extension_settings.twt.presetTagLinks[val] = currentPresetName;
                    checkedTags.push(val);
                } else {
                    if (extension_settings.twt.presetTagLinks[val] === currentPresetName) {
                        delete extension_settings.twt.presetTagLinks[val];
                    }
                }
            });
        }
        
        getContext().saveSettingsDebounced();
        logWork(`更新预设 [${currentPresetName}] 关联：主题[${checkedThemes.join(', ') || '无'}], 标签[${checkedTags.join(', ') || '无'}]`);
        toastr.success(`已保存预设 [${currentPresetName}] 的全局美化关联`, '关联成功');
        getEl('#twt-link-theme-modal').css('display', 'none');

        // 立即比对当前生效的全局主题，若在新关联中，即刻无缝载入新预设
        const curTheme = getCurrentActiveTheme();
        if (curTheme) {
            const targetPreset = findLinkedPreset(curTheme);
            if (targetPreset && targetPreset !== extension_settings.twt.currentPreset) {
                logWork(`当前主题 [${curTheme}] 匹配新关联预设 [${targetPreset}]，立即切换`);
                extension_settings.twt.currentPreset = targetPreset;
                getEl('#twt_visual_preset').val(targetPreset);
                applyPreset(targetPreset);
            }
        }
    });

    getEl('#twt-link-theme-modal').off('click mousedown mouseup pointerdown pointerup touchstart').on('click mousedown mouseup pointerdown pointerup touchstart', function(e) {
        if (e.type === 'click' && e.target === this) {
            getEl('#twt-link-theme-modal').css('display', 'none');
        }
        e.stopPropagation();
    });

    // 新增预设
    $('#twt_preset_add').on('click', function() {
        const name = prompt('请输入新预设名称：', '新预设');
        if (name && name.trim().length > 0) {
            const trimmedName = name.trim();
            if (extension_settings.twt.visualPresets[trimmedName]) {
                if (!confirm(`预设 "${trimmedName}" 已存在，是否覆盖它？`)) {
                    return;
                }
            }
            saveCurrentToPreset(trimmedName);
            toastr.success(`已成功保存为新预设 "${trimmedName}"`, '提示');
        }
    });

    // 覆盖当前预设
    $('#twt_preset_save').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current && current !== 'custom') {
            saveCurrentToPreset(current);
            toastr.success(`已成功覆盖预设 "${current}"`, '提示');
        } else {
            toastr.warning('当前为“自定义”状态，请先点击“新增”创建预设。', '提示');
        }
    });

    $('#twt_preset_rename').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current !== 'custom') {
            const newName = prompt('重命名预设为：', current);
            if (newName && newName.trim().length > 0 && newName.trim() !== current) {
                const trimmedName = newName.trim();
                extension_settings.twt.visualPresets[trimmedName] = extension_settings.twt.visualPresets[current];
                delete extension_settings.twt.visualPresets[current];

                // 同步更新关联映射中的预设名称引用
                if (extension_settings.twt.presetTagLinks) {
                    for (const [tId, pName] of Object.entries(extension_settings.twt.presetTagLinks)) {
                        if (pName === current) extension_settings.twt.presetTagLinks[tId] = trimmedName;
                    }
                }
                if (extension_settings.twt.presetThemeLinks) {
                    for (const [thKey, pName] of Object.entries(extension_settings.twt.presetThemeLinks)) {
                        if (pName === current) extension_settings.twt.presetThemeLinks[thKey] = trimmedName;
                    }
                }

                extension_settings.twt.currentPreset = trimmedName;
                getContext().saveSettingsDebounced();
                renderPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可重命名。', '提示');
        }
    });

    $('#twt_preset_delete').on('click', function() {
        const current = extension_settings.twt.currentPreset;
        if (current !== 'custom') {
            if (confirm(`确定要删除预设 "${current}" 吗？`)) {
                delete extension_settings.twt.visualPresets[current];

                // 清理被删除预设的关联映射
                if (extension_settings.twt.presetTagLinks) {
                    for (const [tId, pName] of Object.entries(extension_settings.twt.presetTagLinks)) {
                        if (pName === current) delete extension_settings.twt.presetTagLinks[tId];
                    }
                }
                if (extension_settings.twt.presetThemeLinks) {
                    for (const [thKey, pName] of Object.entries(extension_settings.twt.presetThemeLinks)) {
                        if (pName === current) delete extension_settings.twt.presetThemeLinks[thKey];
                    }
                }

                extension_settings.twt.currentPreset = 'custom';
                getContext().saveSettingsDebounced();
                renderPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可删除。', '提示');
        }
    });

    // ============================================================
    // 视觉模块：按细分模块采集并生成生效 CSS
    // ============================================================
    function getModuleCssMap() {
        const settings = extension_settings?.twt || {};
        const currentPreset = settings.currentPreset || 'custom';
        const cssMap = {
            all: '',
            layout: '',
            typography: '',
            font: '',
            patches: '',
            bubble: ''
        };
        const titleMap = {
            all: '全部生效 CSS',
            layout: '页面边距设置',
            typography: '文本排版设置',
            font: '字体设置',
            patches: '自定义 CSS 优化补丁',
            bubble: '气泡拼接美化自适应补丁'
        };

        // 1. 字体
        const fontFamily = settings.fontFamily;
        if (fontFamily && fontFamily !== 'inherit') {
            const fontBlocks = [];
            if (typeof BUILTIN_FONTS !== 'undefined' && BUILTIN_FONTS[fontFamily]?.url) {
                fontBlocks.push(`@import url("${BUILTIN_FONTS[fontFamily].url}");`);
            }
            if (typeof getValidCustomFonts === 'function') {
                const customFonts = getValidCustomFonts();
                if (customFonts[fontFamily]) {
                    const fontData = customFonts[fontFamily];
                    if (fontData.url) fontBlocks.push(`@import url("${fontData.url}");`);
                    else if (fontData.css) fontBlocks.push(fontData.css.trim());
                }
            }

            const cleanFont = String(fontFamily).replace(/['"]/g, '').trim();
            const isSerif = /mincho|serif|song|ming|kai|明朝|宋体|楷体/i.test(cleanFont);
            const fallback = isSerif
                ? '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif'
                : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
            const fullFontStack = `"${cleanFont}", ${fallback}`;

            fontBlocks.push(`:root {\n    --twt-global-font-family: ${fullFontStack};\n}`);
            fontBlocks.push(`body #chat, body #chat .mes_text {\n    --twt-font-family: ${fullFontStack} !important;\n    font-family: ${fullFontStack} !important;\n}`);
            cssMap.font = `/* === [TwT 字体设置: ${fontFamily}] === */\n${fontBlocks.join('\n\n')}`;
        } else {
            cssMap.font = `/* 当前使用系统默认字体，未配置独立自定义字体 */`;
        }

        // 2. 页面边距
        const pTop = settings.paddingTop ?? 0;
        const pBottom = settings.paddingBottom ?? 60;
        const pLeft = settings.paddingLeft ?? 15;
        const pRight = settings.paddingRight ?? 15;
        cssMap.layout = [
            `/* === [TwT 页面边距设置] === */`,
            `#chat {`,
            `    --twt-padding-top: ${pTop}px !important;`,
            `    --twt-padding-bottom: ${pBottom}px !important;`,
            `    --twt-padding-left: ${pLeft}px !important;`,
            `    --twt-padding-right: ${pRight}px !important;`,
            `    padding-top: ${pTop}px !important;`,
            `    padding-bottom: ${pBottom}px !important;`,
            `}`,
            `#chat .mes_text {`,
            `    padding-left: ${Math.max(0, pLeft)}px !important;`,
            `    padding-right: ${Math.max(0, pRight)}px !important;`,
            `    margin-left: ${Math.min(0, pLeft)}px !important;`,
            `    margin-right: ${Math.min(0, pRight)}px !important;`,
            `}`
        ].join('\n');

        // 3. 文本排版
        const fSize = settings.fontSize ?? 16;
        const lHeight = settings.lineHeight ?? 1.6;
        const tIndent = settings.textIndent ?? 0;
        const tAlign = settings.textAlign || 'left';
        const pSpacing = Number(settings.paragraphSpacing) || 0;
        const lSpacing = settings.letterSpacing ?? 0;
        const fWeight = settings.fontWeight || 'normal';
        cssMap.typography = [
            `/* === [TwT 文本排版设置] === */`,
            `#chat {`,
            `    --twt-font-size: ${fSize}px !important;`,
            `    --twt-line-height: ${lHeight} !important;`,
            `    --twt-text-indent: ${tIndent}em !important;`,
            `    --twt-text-align: ${tAlign} !important;`,
            ...(pSpacing > 0 ? [`    --twt-paragraph-spacing: ${pSpacing}px !important;`] : []),
            `    --twt-letter-spacing: ${lSpacing}px !important;`,
            `    --twt-font-weight: ${fWeight} !important;`,
            `}`,
            `#chat .mes_text {`,
            `    font-size: ${fSize}px !important;`,
            `    line-height: ${lHeight} !important;`,
            `    text-align: ${tAlign} !important;`,
            `    letter-spacing: ${lSpacing}px !important;`,
            `    font-weight: ${fWeight} !important;`,
            `}`,
            `#chat .mes_text p {`,
            `    font-size: inherit !important;`,
            `    line-height: inherit !important;`,
            `    letter-spacing: inherit !important;`,
            `    font-weight: ${fWeight} !important;`,
            `    text-indent: ${tIndent}em;`,
            ...(pSpacing > 0 ? [`    margin-bottom: ${pSpacing}px !important;`] : []),
            `}`
        ].join('\n');

        // 4. 自定义 CSS 优化补丁
        const patches = settings.optimizePatches || {};
        const activePatches = [];
        for (const [name, patch] of Object.entries(patches)) {
            if (patch && patch.active && patch.code && typeof patch.code === 'string' && patch.code.trim().length > 0) {
                activePatches.push({ name, folder: patch.folder || '默认', code: patch.code.trim() });
            }
        }
        if (activePatches.length > 0) {
            cssMap.patches = `/* === [TwT 自定义 CSS 优化补丁 (共 ${activePatches.length} 个启用)] === */\n\n` +
                activePatches.map(p => `/* --- 补丁: ${p.name} (分类: ${p.folder}) --- */\n${p.code}`).join('\n\n');
        } else {
            cssMap.patches = `/* 当前没有处于启用状态的自定义 CSS 优化补丁 */`;
        }

        // 5. 气泡拼接自适应
        if (settings.autoBubbleThemeEnabled !== false && typeof generateBubbleThemePatchCss === 'function') {
            try {
                const bubbleCss = generateBubbleThemePatchCss();
                if (bubbleCss && bubbleCss.trim().length > 0) {
                    cssMap.bubble = `/* === [TwT 气泡拼接美化智能自适应补丁] === */\n${bubbleCss.trim()}`;
                } else {
                    cssMap.bubble = `/* 当前未检测到需要坐标重构的负外边距气泡拼接美化 */`;
                }
            } catch (e) {
                cssMap.bubble = `/* 气泡拼接自适应计算暂不可用 */`;
            }
        } else {
            cssMap.bubble = `/* 气泡拼接美化智能自适应未开启 */`;
        }

        // 6. 全部汇总
        const sectionsAll = [
            cssMap.font,
            cssMap.layout,
            cssMap.typography,
            activePatches.length > 0 ? cssMap.patches : '',
            settings.autoBubbleThemeEnabled !== false && !cssMap.bubble.includes('未开启') && !cssMap.bubble.includes('未检测到') ? cssMap.bubble : ''
        ].filter(s => s && s.trim().length > 0 && !s.startsWith('/* 当前使用系统默认字体'));

        const headerAll = [
            `/* ============================================================`,
            ` * TwT 视觉模块生效 CSS 汇总导出`,
            ` * 导出时间: ${new Date().toLocaleString()}`,
            ` * 当前预设: ${currentPreset}`,
            ` * ============================================================ */`
        ].join('\n');

        cssMap.all = `${headerAll}\n\n${sectionsAll.join('\n\n')}\n`;

        return { cssMap, titleMap, activePatchesCount: activePatches.length };
    }

    let currentSelectedCssTab = 'all';

    function renderVisualCssModal(tab = 'all') {
        currentSelectedCssTab = tab;
        const { cssMap, titleMap } = getModuleCssMap();
        const content = cssMap[tab] || '';
        const lines = content.trim() ? content.split('\n').length : 0;

        // 更新 Tab 按钮激活高亮
        $('.twt-css-tab-btn').each(function() {
            const t = $(this).attr('data-tab');
            if (t === tab) {
                $(this).css({
                    'background': 'var(--SmartThemeUnderlineColor, #007aff)',
                    'color': '#fff',
                    'font-weight': 'bold'
                });
            } else {
                $(this).css({
                    'background': 'rgba(255,255,255,0.08)',
                    'color': 'inherit',
                    'font-weight': 'normal'
                });
            }
        });

        // 更新提示与文本框
        const tabTitle = titleMap[tab] || 'CSS 样式';
        $('#twt_visual_css_hint_text').html(`<i class="fa-solid fa-layer-group"></i> 当前查看：<b>${tabTitle}</b>`);
        $('#twt_visual_css_lines_count').text(`共 ${lines} 行`);
        $('#twt_visual_css_preview_text').val(content);

        // 更新复制按钮标签
        if (tab === 'all') {
            $('#twt_visual_css_copy_cur_label').text('复制当前项');
        } else {
            const shortName = tab === 'layout' ? '边距' : (tab === 'typography' ? '排版' : (tab === 'font' ? '字体' : (tab === 'patches' ? '补丁' : '气泡')));
            $('#twt_visual_css_copy_cur_label').text(`复制${shortName}`);
        }
    }

    // 点击小图标按钮：打开预览弹窗
    $('#twt_visual_copy_all_css').on('click', function() {
        renderVisualCssModal('all');
        $('#twt-visual-css-preview-modal').fadeIn(150);
    });

    // 切换 Tab 分类
    $(document).on('click', '.twt-css-tab-btn', function() {
        const tab = $(this).attr('data-tab');
        renderVisualCssModal(tab);
    });

    function closeVisualCssPreviewModal() {
        $('#twt-visual-css-preview-modal').fadeOut(150);
    }

    $('#twt_visual_css_preview_close, #twt_visual_css_cancel_btn').on('click', closeVisualCssPreviewModal);

    $('#twt-visual-css-preview-modal').on('click', function(e) {
        if (e.target === this) closeVisualCssPreviewModal();
    });

    function execCopyToClipboard(text, successMsg) {
        if (!text || !text.trim()) {
            if (typeof toastr !== 'undefined') toastr.warning('当前模块无可用 CSS 代码', '提示');
            return;
        }

        const onDone = () => {
            if (typeof toastr !== 'undefined') {
                toastr.success(successMsg, '复制成功');
            } else {
                alert(successMsg);
            }
            closeVisualCssPreviewModal();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onDone).catch(() => {
                fallbackCopy(text, onDone);
            });
        } else {
            fallbackCopy(text, onDone);
        }
    }

    function fallbackCopy(text, cb) {
        const $ta = $('#twt_visual_css_preview_text');
        $ta.focus().select();
        try {
            document.execCommand('copy');
            cb();
        } catch (e) {
            alert('复制失败，请手动在文本框中全选复制。');
        }
    }

    // 复制当前分类项
    $('#twt_visual_css_copy_cur_btn').on('click', function() {
        const { cssMap, titleMap } = getModuleCssMap();
        const text = cssMap[currentSelectedCssTab] || '';
        const title = titleMap[currentSelectedCssTab] || '当前项';
        execCopyToClipboard(text, `已复制「${title}」到剪贴板！`);
    });

    // 复制全部
    $('#twt_visual_css_copy_all_btn').on('click', function() {
        const { cssMap } = getModuleCssMap();
        const text = cssMap.all || '';
        execCopyToClipboard(text, '已复制「全部生效 CSS」到剪贴板！');
    });

    // 导出视觉设置/预设
    $('#twt_visual_export').on('click', function() {
        const currentPreset = extension_settings.twt.currentPreset || 'custom';
        const currentSettings = {
            paddingTop: extension_settings.twt.paddingTop ?? 0,
            paddingBottom: extension_settings.twt.paddingBottom ?? 60,
            paddingLeft: extension_settings.twt.paddingLeft ?? 15,
            paddingRight: extension_settings.twt.paddingRight ?? 15,
            avatarLayoutMode: extension_settings.twt.avatarLayoutMode || 'float',
            fontSize: extension_settings.twt.fontSize ?? 16,
            lineHeight: extension_settings.twt.lineHeight ?? 1.6,
            textIndent: extension_settings.twt.textIndent ?? 0,
            textAlign: extension_settings.twt.textAlign || 'left',
            paragraphSpacing: extension_settings.twt.paragraphSpacing ?? 0,
            letterSpacing: extension_settings.twt.letterSpacing ?? 0,
            fontWeight: extension_settings.twt.fontWeight || 'normal',
            fontFamily: extension_settings.twt.fontFamily || 'inherit'
        };

        const hasPresets = Object.keys(extension_settings.twt.visualPresets || {}).length > 0;
        let exportAll = false;
        if (hasPresets || currentPreset !== 'custom') {
            exportAll = confirm(`点击【确定】导出整个视觉模块的完整配置包（含所有自定义预设、补丁与当前设置）；\n点击【取消】仅导出当前视觉配置/预设【${currentPreset}】。`);
        }

        let exportData;
        let filename;

        if (exportAll) {
            exportData = {
                type: 'twt_visual_bundle',
                version: 1,
                exportedAt: new Date().toISOString(),
                currentPreset: currentPreset,
                currentSettings: currentSettings,
                visualPresets: extension_settings.twt.visualPresets || {},
                presetThemeLinks: extension_settings.twt.presetThemeLinks || {},
                presetTagLinks: extension_settings.twt.presetTagLinks || {},
                optimizePatches: extension_settings.twt.optimizePatches || {},
                optimizeFolders: extension_settings.twt.optimizeFolders || []
            };
            filename = `twt_visual_backup_${new Date().toISOString().slice(0, 10)}.json`;
        } else {
            const singlePresetPatches = {};
            const patches = extension_settings.twt.optimizePatches || {};
            for (const pName of Object.keys(patches)) {
                singlePresetPatches[pName] = !!patches[pName].active;
            }
            exportData = {
                type: 'twt_visual_preset',
                name: currentPreset,
                ...currentSettings,
                optimizePatches: singlePresetPatches
            };
            filename = `twt_visual_${currentPreset !== 'custom' ? currentPreset : 'settings'}.json`;
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 4));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", filename);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        if (typeof toastr !== 'undefined') toastr.success(`视觉配置已成功导出为 "${filename}"！`, '导出成功');
        logWork(`导出视觉配置: ${filename}`);
    });

    // 导入视觉设置/预设
    $('#twt_visual_import').on('click', function() {
        $('#twt_visual_import_file').trigger('click');
    });

    $('#twt_visual_import_file').on('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(event) {
            try {
                const data = JSON.parse(event.target.result);
                if (!data || typeof data !== 'object') {
                    throw new Error('无效的 JSON 格式');
                }

                if (!extension_settings.twt.visualPresets) extension_settings.twt.visualPresets = {};

                // 情况 1：完整视觉模块配置包 (bundle)
                if (data.type === 'twt_visual_bundle' || (data.visualPresets && typeof data.visualPresets === 'object')) {
                    let countPresets = 0;
                    if (data.visualPresets) {
                        for (const [pName, pVal] of Object.entries(data.visualPresets)) {
                            if (pVal && typeof pVal === 'object') {
                                extension_settings.twt.visualPresets[pName] = pVal;
                                countPresets++;
                            }
                        }
                    }

                    if (data.presetThemeLinks && typeof data.presetThemeLinks === 'object') {
                        extension_settings.twt.presetThemeLinks = Object.assign({}, extension_settings.twt.presetThemeLinks || {}, data.presetThemeLinks);
                    }
                    if (data.presetTagLinks && typeof data.presetTagLinks === 'object') {
                        extension_settings.twt.presetTagLinks = Object.assign({}, extension_settings.twt.presetTagLinks || {}, data.presetTagLinks);
                    }

                    if (data.optimizePatches && typeof data.optimizePatches === 'object') {
                        if (!extension_settings.twt.optimizePatches) extension_settings.twt.optimizePatches = {};
                        for (const [pKey, pVal] of Object.entries(data.optimizePatches)) {
                            extension_settings.twt.optimizePatches[pKey] = Object.assign({}, extension_settings.twt.optimizePatches[pKey] || {}, pVal);
                        }
                    }

                    if (Array.isArray(data.optimizeFolders)) {
                        const existingFolders = new Set(extension_settings.twt.optimizeFolders || []);
                        data.optimizeFolders.forEach(f => existingFolders.add(f));
                        extension_settings.twt.optimizeFolders = Array.from(existingFolders);
                    }

                    const settingsToApply = data.currentSettings || (data.fontSize !== undefined ? data : null);
                    if (settingsToApply) {
                        applyVisualSettingsStateAndUI(settingsToApply);
                    }

                    if (data.currentPreset && extension_settings.twt.visualPresets[data.currentPreset]) {
                        extension_settings.twt.currentPreset = data.currentPreset;
                        applyPreset(data.currentPreset);
                    }

                    renderPresetList();
                    renderOptimizePatchList();
                    updateInjectedStyles();
                    getContext().saveSettingsDebounced();

                    const msg = `成功导入视觉配置包（包含 ${countPresets} 个预设）！`;
                    if (typeof toastr !== 'undefined') toastr.success(msg, '导入成功');
                    logWork(msg);
                }
                // 情况 2：单预设导入或单项设置导入
                else {
                    let pName = data.name || data.presetName;
                    if (!pName || pName === 'custom') {
                        const defaultName = file.name.replace(/\.[^/.]+$/, '').replace(/^twt_visual_/, '') || '导入预设';
                        pName = prompt('检测到单项视觉配置，请输入保存的预设名称：', defaultName);
                    }
                    if (!pName || !pName.trim()) {
                        return;
                    }
                    const trimmedName = pName.trim();

                    const presetData = {
                        paddingTop: data.paddingTop !== undefined ? Number(data.paddingTop) : (extension_settings.twt.paddingTop ?? 0),
                        paddingBottom: data.paddingBottom !== undefined ? Number(data.paddingBottom) : (extension_settings.twt.paddingBottom ?? 60),
                        paddingLeft: data.paddingLeft !== undefined ? Number(data.paddingLeft) : (extension_settings.twt.paddingLeft ?? 15),
                        paddingRight: data.paddingRight !== undefined ? Number(data.paddingRight) : (extension_settings.twt.paddingRight ?? 15),
                        fontSize: data.fontSize !== undefined ? Number(data.fontSize) : (extension_settings.twt.fontSize ?? 16),
                        lineHeight: data.lineHeight !== undefined ? Number(data.lineHeight) : (extension_settings.twt.lineHeight ?? 1.6),
                        textIndent: data.textIndent !== undefined ? Number(data.textIndent) : (extension_settings.twt.textIndent ?? 0),
                        textAlign: data.textAlign || (extension_settings.twt.textAlign ?? 'left'),
                        paragraphSpacing: data.paragraphSpacing !== undefined ? Number(data.paragraphSpacing) : (extension_settings.twt.paragraphSpacing ?? 0),
                        letterSpacing: data.letterSpacing !== undefined ? Number(data.letterSpacing) : (extension_settings.twt.letterSpacing ?? 0),
                        fontWeight: data.fontWeight || (extension_settings.twt.fontWeight ?? 'normal'),
                        fontFamily: data.fontFamily || (extension_settings.twt.fontFamily ?? 'inherit'),
                        avatarLayoutMode: data.avatarLayoutMode || (extension_settings.twt.avatarLayoutMode ?? 'float'),
                        autoBubbleThemeEnabled: data.autoBubbleThemeEnabled !== undefined ? !!data.autoBubbleThemeEnabled : (extension_settings.twt.autoBubbleThemeEnabled !== false)
                    };

                    if (data.optimizePatches && typeof data.optimizePatches === 'object') {
                        presetData.optimizePatches = data.optimizePatches;
                    }

                    extension_settings.twt.visualPresets[trimmedName] = presetData;
                    extension_settings.twt.currentPreset = trimmedName;

                    renderPresetList();
                    applyPreset(trimmedName);
                    getContext().saveSettingsDebounced();

                    const msg = `已成功导入并应用视觉预设 "${trimmedName}"！`;
                    if (typeof toastr !== 'undefined') toastr.success(msg, '导入成功');
                    logWork(msg);
                }
            } catch (err) {
                console.error('[TwT] 导入视觉配置失败:', err);
                if (typeof toastr !== 'undefined') toastr.error(`导入失败：${err.message || '文件解析错误'}`, '错误');
                else alert('导入失败：' + (err.message || '文件解析错误'));
            } finally {
                $('#twt_visual_import_file').val('');
            }
        };
        reader.readAsText(file);
    });

    // 一键清空所有初始化设置
    $('#twt_visual_reset').on('click', function() {
        if (!confirm('确定要一键清空视觉模块设置并恢复初始默认值吗？\n\n此操作将重置：\n- 页面留白与边距 (恢复为默认)\n- 字体大小、行高、缩进、对齐与粗细 (恢复为默认)\n- 字体选择 (恢复为系统默认)\n- CSS优化补丁 (恢复为默认初始状态)')) {
            return;
        }

        const hasPresets = Object.keys(extension_settings.twt.visualPresets || {}).length > 0;
        if (hasPresets) {
            if (confirm('是否同时清空所有已保存的视觉自定义预设及美化关联？\n\n点击【确定】清空所有预设；\n点击【取消】保留预设列表，仅重置当前页面设置。')) {
                extension_settings.twt.visualPresets = {};
                extension_settings.twt.presetThemeLinks = {};
                extension_settings.twt.presetTagLinks = {};
            }
        }

        // 重置视觉模块的所有状态为 defaultSettings 中的初始值
        extension_settings.twt.paddingTop = defaultSettings.paddingTop;
        extension_settings.twt.paddingBottom = defaultSettings.paddingBottom;
        extension_settings.twt.paddingLeft = defaultSettings.paddingLeft;
        extension_settings.twt.paddingRight = defaultSettings.paddingRight;
        extension_settings.twt.avatarLayoutMode = defaultSettings.avatarLayoutMode;
        extension_settings.twt.autoBubbleThemeEnabled = defaultSettings.autoBubbleThemeEnabled !== false;
        extension_settings.twt.fontSize = defaultSettings.fontSize;
        extension_settings.twt.lineHeight = defaultSettings.lineHeight;
        extension_settings.twt.textIndent = defaultSettings.textIndent;
        extension_settings.twt.textAlign = defaultSettings.textAlign;
        extension_settings.twt.paragraphSpacing = defaultSettings.paragraphSpacing;
        extension_settings.twt.letterSpacing = defaultSettings.letterSpacing;
        extension_settings.twt.fontWeight = defaultSettings.fontWeight;
        extension_settings.twt.fontFamily = defaultSettings.fontFamily;
        extension_settings.twt.currentPreset = 'custom';

        // 重置 CSS 补丁为默认初始补丁
        extension_settings.twt.optimizePatches = JSON.parse(JSON.stringify(defaultPatches));
        extension_settings.twt.optimizeFolders = ['界面调整', '手势与选择'];

        // 同步更新 DOM UI 元素
        $('#twt_padding_top').val(defaultSettings.paddingTop);
        $('#twt_padding_bottom').val(defaultSettings.paddingBottom);
        $('#twt_padding_left').val(defaultSettings.paddingLeft);
        $('#twt_padding_right').val(defaultSettings.paddingRight);
        $('#twt_avatar_layout_mode').val(defaultSettings.avatarLayoutMode);
        $('#twt_auto_bubble_theme_enabled').prop('checked', defaultSettings.autoBubbleThemeEnabled !== false);

        $('#twt_font_size').val(defaultSettings.fontSize);
        $('#twt_line_height').val(defaultSettings.lineHeight);
        $('#twt_text_indent').val(defaultSettings.textIndent);
        $('#twt_text_align').val(defaultSettings.textAlign);
        $('#twt_paragraph_spacing').val(defaultSettings.paragraphSpacing);
        $('#twt_letter_spacing').val(defaultSettings.letterSpacing);
        $('#twt_font_weight').val(defaultSettings.fontWeight);
        $('#twt_font_family').val(defaultSettings.fontFamily);
        updateFontSummaryHint();

        renderPresetList();
        renderOptimizePatchList();
        updateInjectedStyles();
        updateCustomFontsStyle();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);

        getContext().saveSettingsDebounced();
        logWork('一键清空视觉模块设置并恢复初始默认状态');
        if (typeof toastr !== 'undefined') {
            toastr.success('视觉模块所有初始化设置已成功恢复！', '已恢复初始设置');
        }
    });

    // 目录正则相关事件绑定
    $('#twt_mulu_regex_preset').on('change', function() {
        const val = $(this).val();
        extension_settings.twt.currentMuluRegexPreset = val;
        getContext().saveSettingsDebounced();
        applyMuluRegexPreset(val);
    });

    $('#twt_mulu_regex_save').on('click', function() {
        const currentName = extension_settings.twt.currentMuluRegexPreset !== 'custom' ? extension_settings.twt.currentMuluRegexPreset : '新正则预设';
        const name = prompt('请输入正则预设名称：', currentName);
        if (name && name.trim().length > 0) {
            saveCurrentToMuluRegexPreset(name.trim());
        }
    });

    $('#twt_mulu_regex_rename').on('click', function() {
        const current = extension_settings.twt.currentMuluRegexPreset;
        if (current !== 'custom') {
            const newName = prompt('重命名正则预设为：', current);
            if (newName && newName.trim().length > 0 && newName.trim() !== current) {
                const trimmedName = newName.trim();
                extension_settings.twt.muluRegexPresets[trimmedName] = extension_settings.twt.muluRegexPresets[current];
                delete extension_settings.twt.muluRegexPresets[current];
                extension_settings.twt.currentMuluRegexPreset = trimmedName;
                getContext().saveSettingsDebounced();
                renderMuluRegexPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可重命名。', '提示');
        }
    });

    $('#twt_mulu_regex_delete').on('click', function() {
        const current = extension_settings.twt.currentMuluRegexPreset;
        if (current !== 'custom') {
            if (confirm(`确定要删除正则预设 "${current}" 吗？`)) {
                delete extension_settings.twt.muluRegexPresets[current];
                extension_settings.twt.currentMuluRegexPreset = 'custom';
                getContext().saveSettingsDebounced();
                renderMuluRegexPresetList();
            }
        } else {
            toastr.warning('“自定义”状态不可删除。', '提示');
        }
    });

    $('#twt_mulu_regex_input').on('input', function() {
        extension_settings.twt.customMuluRegex = $(this).val();
        if (extension_settings.twt.currentMuluRegexPreset !== 'custom') {
            extension_settings.twt.currentMuluRegexPreset = 'custom';
            $('#twt_mulu_regex_preset').val('custom');
        }
        getContext().saveSettingsDebounced();
    });

    // 搜索补丁与分类绑定
    $('#twt_optimize_search_toggle').on('click', function(e) {
        e.preventDefault();
        const $container = $('#twt_optimize_search_container');
        $container.slideToggle(150, function() {
            if ($container.is(':hidden')) {
                $('#twt_optimize_search_input').val('');
                currentOptimizeSearchQuery = '';
                renderOptimizePatchList();
            } else {
                $('#twt_optimize_search_input').focus();
            }
        });
    });

    $('#twt_optimize_search_input').on('input', function() {
        clearTimeout(optimizeSearchTimeout);
        const query = $(this).val().trim().toLowerCase();
        optimizeSearchTimeout = setTimeout(() => {
            currentOptimizeSearchQuery = query;
            renderOptimizePatchList();
        }, 1000); // 1s debounce
    });

    // 优化补丁事件绑定
    $('#twt_optimize_reapply').on('click', function(e) {
        e.preventDefault();
        const res = updateInjectedStyles(true);
        renderOptimizePatchList();
        logWork(`手动刷新 CSS 优化补丁，已重新应用 ${res.count} 个补丁: ${res.names.join(', ') || '无'}`);
    });

    $('#twt_optimize_add').on('click', function(e) {
        e.preventDefault();
        openOptimizeCreateModal();
    });

    $('#twt_optimize_list').on('click', '.twt-folder-add-patch', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const folder = $(this).closest('.twt-optimize-folder').attr('data-folder') || '';
        openOptimizeCreateModal(folder);
    });

    // 新建分类文件夹
    $('#twt_optimize_add_folder').on('click', function() {
        const name = prompt('请输入新分类/文件夹名称：');
        if (name && name.trim().length > 0) {
            const trimmedName = name.trim();
            if (!extension_settings.twt.optimizeFolders) {
                extension_settings.twt.optimizeFolders = [];
            }
            if (extension_settings.twt.optimizeFolders.includes(trimmedName)) {
                toastr.warning('同名分类已存在！', '提示');
                return;
            }
            extension_settings.twt.optimizeFolders.push(trimmedName);
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹重命名
    $('#twt_optimize_list').on('click', '.twt-folder-rename', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $folder = $(this).closest('.twt-optimize-folder');
        const oldName = $folder.attr('data-folder');
        if (!oldName) return; // 未分类不能重命名
        
        const newName = prompt('请输入新的分类名称：', oldName);
        if (newName && newName.trim().length > 0 && newName.trim() !== oldName) {
            const trimmed = newName.trim();
            if (!extension_settings.twt.optimizeFolders) {
                extension_settings.twt.optimizeFolders = [];
            }
            if (extension_settings.twt.optimizeFolders.includes(trimmed)) {
                toastr.warning('同名分类已存在！', '提示');
                return;
            }
            
            const idx = extension_settings.twt.optimizeFolders.indexOf(oldName);
            if (idx !== -1) {
                extension_settings.twt.optimizeFolders[idx] = trimmed;
            }
            
            // 更新补丁引用
            const patches = extension_settings.twt.optimizePatches || {};
            for (const key of Object.keys(patches)) {
                if (patches[key] && patches[key].folder === oldName) {
                    patches[key].folder = trimmed;
                }
            }
            
            // 迁移折叠记录
            if (oldName in collapsedFolders) {
                collapsedFolders[trimmed] = collapsedFolders[oldName];
                delete collapsedFolders[oldName];
            }
            
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹删除
    $('#twt_optimize_list').on('click', '.twt-folder-delete', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $folder = $(this).closest('.twt-optimize-folder');
        const folderName = $folder.attr('data-folder');
        if (!folderName) return; // 未分类不能删除
        
        if (confirm(`确定要删除分类 "${folderName}" 吗？该分类下的补丁将移至“未分类”。`)) {
            const idx = extension_settings.twt.optimizeFolders.indexOf(folderName);
            if (idx !== -1) {
                extension_settings.twt.optimizeFolders.splice(idx, 1);
            }
            
            // 将此分类下补丁的 folder 清空
            const patches = extension_settings.twt.optimizePatches || {};
            for (const key of Object.keys(patches)) {
                if (patches[key] && patches[key].folder === folderName) {
                    patches[key].folder = '';
                }
            }
            
            if (folderName in collapsedFolders) {
                delete collapsedFolders[folderName];
            }
            
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    // 绑定分类文件夹收起/折叠点击
    $('#twt_optimize_list').on('click', '.twt-optimize-folder-header', function(e) {
        if ($(e.target).closest('button').length) return; // 忽略对操作按钮的点击
        const $folder = $(this).closest('.twt-optimize-folder');
        const folderName = $folder.attr('data-folder') || '';
        const $content = $folder.find('.twt-optimize-folder-content');
        const $chevron = $(this).find('.twt-folder-chevron');
        const $folderIcon = $(this).find('.twt-folder-icon');
        
        $content.slideToggle(150, () => {
            const isHidden = $content.is(':hidden');
            collapsedFolders[folderName] = isHidden;
            if (isHidden) {
                $chevron.css('transform', 'rotate(-90deg)');
                $folderIcon.removeClass('fa-folder-open').addClass('fa-folder');
            } else {
                $chevron.css('transform', 'none');
                $folderIcon.removeClass('fa-folder').addClass('fa-folder-open');
            }
        });
    });

    // 移动补丁至新分类
    $('#twt_optimize_list').on('change', '.twt-patch-folder-select', function() {
        const $item = $(this).closest('.twt-optimize-item');
        const patchName = $item.data('name');
        const targetFolder = $(this).val();
        
        if (extension_settings.twt.optimizePatches[patchName]) {
            extension_settings.twt.optimizePatches[patchName].folder = targetFolder;
            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
        }
    });

    getEl('#twt_optimize_close_editor').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeOptimizeEditor();
    });

    getEl('#twt_optimize_save_editor').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (currentlyEditingPatchName) {
            const name = currentlyEditingPatchName;
            const code = getEl('#twt_optimize_code').val();
            if (extension_settings.twt.optimizePatches[name]) {
                extension_settings.twt.optimizePatches[name].code = code;
                getContext().saveSettingsDebounced();
                updateInjectedStyles();
            }
        }
        closeOptimizeEditor();
    });

    getEl('#twt-optimize-editor-modal').off('click mousedown mouseup pointerdown pointerup touchstart').on('click mousedown mouseup pointerdown pointerup touchstart', function(e) {
        e.stopPropagation();
        if ($(e.target).is('#twt-optimize-editor-modal')) {
            e.preventDefault();
            closeOptimizeEditor();
        }
    });

    getEl('#twt_optimize_create_close, #twt_optimize_create_cancel').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeOptimizeCreateModal();
    });

    getEl('#twt_optimize_create_confirm').off('click').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        handleConfirmCreatePatch();
    });

    $(parentDoc).off('change', '#twt_optimize_create_folder').on('change', '#twt_optimize_create_folder', function() {
        const val = $(this).val();
        const $newFolderInput = getEl('#twt_optimize_create_new_folder');
        if (val === '__new__') {
            $newFolderInput.show().focus();
        } else {
            $newFolderInput.hide().val('');
        }
    });

    $(parentDoc).off('keydown', '#twt_optimize_create_name, #twt_optimize_create_new_folder').on('keydown', '#twt_optimize_create_name, #twt_optimize_create_new_folder', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirmCreatePatch();
        }
    });

    getEl('#twt-optimize-create-modal').off('click mousedown mouseup pointerdown pointerup touchstart').on('click mousedown mouseup pointerdown pointerup touchstart', function(e) {
        e.stopPropagation();
        if ($(e.target).is('#twt-optimize-create-modal')) {
            e.preventDefault();
            closeOptimizeCreateModal();
        }
    });

    $('#twt_optimize_list').on('change', '.twt-patch-checkbox', function() {
        const $item = $(this).closest('.twt-optimize-item');
        const name = $item.data('name');
        const active = $(this).prop('checked');
        if (extension_settings.twt.optimizePatches[name]) {
            extension_settings.twt.optimizePatches[name].active = active;

            // 若当前处于特定预设，同步更新该预设中的补丁启用状态
            const currentPreset = extension_settings.twt.currentPreset;
            if (currentPreset && currentPreset !== 'custom' && extension_settings.twt.visualPresets?.[currentPreset]) {
                if (!extension_settings.twt.visualPresets[currentPreset].optimizePatches) {
                    extension_settings.twt.visualPresets[currentPreset].optimizePatches = {};
                }
                extension_settings.twt.visualPresets[currentPreset].optimizePatches[name] = active;
            }

            getContext().saveSettingsDebounced();
            updateInjectedStyles();
        }
    });

    $('#twt_optimize_list').on('click', '.twt-patch-edit', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const name = $item.data('name');
        openOptimizeEditor(name);
    });

    $('#twt_optimize_list').on('click', '.twt-patch-rename', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const current = $item.data('name');
        const newName = prompt('重命名补丁为：', current);
        if (newName && newName.trim().length > 0 && newName.trim() !== current) {
            const trimmedName = newName.trim();
            if (extension_settings.twt.optimizePatches[trimmedName]) {
                toastr.warning('同名补丁已存在！', '提示');
                return;
            }
            extension_settings.twt.optimizePatches[trimmedName] = extension_settings.twt.optimizePatches[current];
            delete extension_settings.twt.optimizePatches[current];
            if (currentlyEditingPatchName === current) {
                currentlyEditingPatchName = trimmedName;
                getEl('#twt_optimize_editor_title').text(`正在编辑: ${trimmedName}`);
            }

            // 同步预设中的补丁名称
            const presets = extension_settings.twt.visualPresets || {};
            for (const pData of Object.values(presets)) {
                if (pData?.optimizePatches && current in pData.optimizePatches) {
                    pData.optimizePatches[trimmedName] = pData.optimizePatches[current];
                    delete pData.optimizePatches[current];
                }
            }

            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            updateInjectedStyles();
        }
    });

    $('#twt_optimize_list').on('click', '.twt-patch-delete', function(e) {
        e.preventDefault();
        const $item = $(this).closest('.twt-optimize-item');
        const current = $item.data('name');
        if (confirm(`确定要删除补丁 "${current}" 吗？`)) {
            delete extension_settings.twt.optimizePatches[current];
            if (currentlyEditingPatchName === current) {
                closeOptimizeEditor();
            }

            // 同步清理预设中的补丁
            const presets = extension_settings.twt.visualPresets || {};
            for (const pData of Object.values(presets)) {
                if (pData?.optimizePatches && current in pData.optimizePatches) {
                    delete pData.optimizePatches[current];
                }
            }

            getContext().saveSettingsDebounced();
            renderOptimizePatchList();
            updateInjectedStyles();
        }
    });

    const handleVisualChange = () => {
        getContext().saveSettingsDebounced();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
        updateCustomFontsStyle();
    };

    // 开关相关
    
    $diagEnabled.on('change', function () {
        const val = $(this).prop('checked');
        extension_settings.twt.diagLogEnabled = val;
        $diagEnabled.prop('checked', val);
        getContext().saveSettingsDebounced();
        updateDiagPanelVisibility(extension_settings.twt);
    });

    $enabled.on('change', function () {
        extension_settings.twt.enabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updatePageTabVisibility();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $qrInjectEnabled.on('change', function () {
        extension_settings.twt.qrInjectEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
        applyHtmlPopupSettings();
    });

    $swipeEnabled.on('change', function () {
        extension_settings.twt.swipeEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $messagePageEnabled.on('change', function () {
        extension_settings.twt.messagePageEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $autoBubbleThemeEnabled.on('change', function () {
        extension_settings.twt.autoBubbleThemeEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
        handleVisualChange();
    });

    $('#twt_copy_bubble_patch_css').on('click', function (e) {
        e.preventDefault();
        const css = generateBubbleThemePatchCss();
        if (!css) {
            if (typeof toastr !== 'undefined') {
                toastr.info('当前美化主题未检测到气泡拼接规则或无需补丁', 'TwT');
            } else {
                alert('当前美化主题未检测到气泡拼接规则或无需补丁');
            }
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(css).then(() => {
                if (typeof toastr !== 'undefined') {
                    toastr.success('已复制气泡拼接自适应 CSS 到剪贴板！', '复制成功');
                } else {
                    alert('已复制气泡拼接自适应 CSS 到剪贴板！');
                }
            }).catch(() => {
                fallbackCopyText(css);
            });
        } else {
            fallbackCopyText(css);
        }
    });

    function fallbackCopyText(text) {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.top = '0';
            textArea.style.left = '0';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) {
                if (typeof toastr !== 'undefined') {
                    toastr.success('已复制气泡拼接自适应 CSS 到剪贴板！', '复制成功');
                } else {
                    alert('已复制气泡拼接自适应 CSS 到剪贴板！');
                }
            } else {
                alert('复制失败，请手动选择复制');
            }
        } catch (err) {
            alert('复制失败：' + (err.message || err));
        }
    }

    $autoScrollNewMessage.on('change', function () {
        extension_settings.twt.autoScrollNewMessage = $(this).prop('checked');
        if (!extension_settings.twt.autoScrollNewMessage) {
            updateActiveReadingAnchor();
        }
        getContext().saveSettingsDebounced();
    });

    $autoRestoreReadingPosition.on('change', function () {
        extension_settings.twt.autoRestoreReadingPosition = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $htmlPageBreakEnabled.on('change', function () {
        extension_settings.twt.htmlPageBreakEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $htmlPopupEnabled.on('change', function () {
        extension_settings.twt.htmlPopupEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateHtmlPopupSubOptionsVisibility();
        applyHtmlPopupSettings();
    });

    $htmlPopupTriggerMode.on('change', function () {
        extension_settings.twt.htmlPopupTriggerMode = $(this).val();
        getContext().saveSettingsDebounced();
        applyHtmlPopupSettings();
    });

    $htmlPopupFallbackEnabled.on('change', function () {
        extension_settings.twt.htmlPopupFallbackEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $htmlPopupSelector.on('input', function () {
        extension_settings.twt.htmlPopupSelector = $(this).val();
        getContext().saveSettingsDebounced();
        applyHtmlPopupSettings();
    });

    $htmlPopupTitleMap.on('input', function () {
        extension_settings.twt.htmlPopupTitleMap = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $htmlPopupWhitelist.on('input', function () {
        extension_settings.twt.htmlPopupWhitelist = $(this).val();
        getContext().saveSettingsDebounced();
        if (typeof hideMessageHtmlApps === 'function') {
            hideMessageHtmlApps(true);
        }
    });

    $avatarLayoutMode.on('change', function () {
        extension_settings.twt.avatarLayoutMode = $(this).val();
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $customWhitelist.on('input', function () {
        extension_settings.twt.customWhitelist = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $toolCallMode.on('change', function () {
        extension_settings.twt.toolCallMode = $(this).val();
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $toolCallNoPageBreak.on('change', function () {
        extension_settings.twt.toolCallNoPageBreak = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $toolCallPreventFlip.on('change', function () {
        extension_settings.twt.toolCallPreventFlip = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $toolCallSelector.on('input', function () {
        extension_settings.twt.toolCallSelector = $(this).val();
        getContext().saveSettingsDebounced();
        applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    });

    $menuEnabled.on('change', function () {
        extension_settings.twt.menuEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateMenuTabVisibility();
        applyMenuMode(extension_settings.twt.menuEnabled, extension_settings.twt);
    });

    $menuInvokeMethod.on('change', function () {
        extension_settings.twt.menuInvokeMethod = $(this).val();
        getContext().saveSettingsDebounced();
        updateLongpressDelayRow();
    });

    $menuDirection.on('change', function () {
        extension_settings.twt.menuDirection = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuLongpressDelay.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.menuLongpressDelay = val;
            getContext().saveSettingsDebounced();
        }
    });

    $menuOptRegenerate.on('change', function () {
        extension_settings.twt.menuOptRegenerate = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptSwipe.on('change', function () {
        extension_settings.twt.menuOptSwipe = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptManage.on('change', function () {
        extension_settings.twt.menuOptManage = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptEdit.on('change', function () {
        extension_settings.twt.menuOptEdit = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateParagraphSubOptionsVisibility();
    });

    $paragraphToolbarBottom.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.paragraphToolbarBottom = val;
            getContext().saveSettingsDebounced();
            const $toolbar = $('#twt-paragraph-toolbar');
            if ($toolbar.length) {
                $toolbar.css('bottom', val + 'px');
            }
        }
    });

    $paragraphIconSize.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.paragraphIconSize = val;
            getContext().saveSettingsDebounced();
            const $toolbar = $('#twt-paragraph-toolbar');
            if ($toolbar.length) {
                $toolbar.css('--twt-paragraph-icon-size', val + 'px');
            }
        }
    });

    $paragraphXmlWhitelist.on('input', function () {
        extension_settings.twt.paragraphXmlWhitelist = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuOptEditFiltered.on('change', function () {
        extension_settings.twt.menuOptEditFiltered = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptExcerpt.on('change', function () {
        extension_settings.twt.menuOptExcerpt = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateExcerptSubOptionsVisibility();
    });

    $excerptTopOffset.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.excerptTopOffset = val;
            getContext().saveSettingsDebounced();
            updateLiveExcerptBar();
        }
    });

    $excerptFontSize.on('input', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.excerptFontSize = val;
            getContext().saveSettingsDebounced();
            updateLiveExcerptBar();
        }
    });



    $menuOptFullscreen.on('change', function () {
        extension_settings.twt.menuOptFullscreen = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateFullscreenSubOptionsVisibility();
    });

    $menuOptFullscreenHideSendForm.on('change', function () {
        extension_settings.twt.menuOptFullscreenHideSendForm = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        if (extension_settings.twt.isFullscreen) {
            applyFullscreenMode(true);
        }
    });

    $menuOptApi.on('change', function () {
        extension_settings.twt.menuOptApi = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptPurifier.on('change', function () {
        extension_settings.twt.menuOptPurifier = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptPurifierDiff.on('change', function () {
        extension_settings.twt.menuOptPurifierDiff = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptNewChat.on('change', function () {
        extension_settings.twt.menuOptNewChat = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptCloseChat.on('change', function () {
        extension_settings.twt.menuOptCloseChat = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptRealign.on('change', function () {
        extension_settings.twt.menuOptRealign = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $('#twt_realign_now_btn').on('click', function (e) {
        e.preventDefault();
        realignPagination(true);
    });

    $menuOptPromptViewer.on('change', function () {
        extension_settings.twt.menuOptPromptViewer = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptRandomInspect.on('change', function () {
        extension_settings.twt.menuOptRandomInspect = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuOptImageTag.on('change', function () {
        extension_settings.twt.menuOptImageTag = $(this).prop('checked');
        getContext().saveSettingsDebounced();
    });

    $menuStyle.on('change', function () {
        extension_settings.twt.menuStyle = $(this).val();
        getContext().saveSettingsDebounced();
    });

    $menuFontSize.on('input change', function () {
        const val = parseInt($(this).val());
        if (!isNaN(val)) {
            extension_settings.twt.menuFontSize = val;
            getContext().saveSettingsDebounced();
        }
    });

    $visualEnabled.on('change', function () {
        extension_settings.twt.visualEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateVisualTabVisibility();
        applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
        updateInjectedStyles();
    });

    $('.twt-collapsible-header').off('click').on('click', function () {
        const $content = $(this).next('.twt-collapsible-content');
        const $icon = $(this).find('.twt-collapsible-icon');
        $content.slideToggle(150);
        $icon.toggleClass('rotated');
        if ($(this).text().includes('工作日志')) {
            renderWorkLogs();
        }
    });

    $muluEnabled.on('change', function () {
        extension_settings.twt.muluEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateMuluTabVisibility();
        applyMuluSettings();
    });

    $muluBtnStart.on('change', function () {
        extension_settings.twt.muluBtnStart = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    $muluBtnToc.on('change', function () {
        extension_settings.twt.muluBtnToc = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    $muluBtnEnd.on('change', function () {
        extension_settings.twt.muluBtnEnd = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        applyMuluSettings();
    });

    $muluToolCallMode.on('change', function () {
        extension_settings.twt.muluToolCallMode = $(this).val();
        getContext().saveSettingsDebounced();
    });

    // 视觉输入框
    $paddingTop.on('input', function () {
        const val = parseInt($paddingTop.val());
        if (!isNaN(val)) { extension_settings.twt.paddingTop = val; handleVisualChange(); }
    });

    $paddingBottom.on('input', function () {
        const val = parseInt($paddingBottom.val());
        if (!isNaN(val)) { extension_settings.twt.paddingBottom = val; handleVisualChange(); }
    });

    $paddingLeft.on('input', function () {
        const val = parseInt($paddingLeft.val());
        if (!isNaN(val)) { extension_settings.twt.paddingLeft = val; handleVisualChange(); }
    });

    $paddingRight.on('input', function () {
        const val = parseInt($paddingRight.val());
        if (!isNaN(val)) { extension_settings.twt.paddingRight = val; handleVisualChange(); }
    });

    $fontSize.on('input', function () {
        const val = parseInt($fontSize.val());
        if (!isNaN(val)) { extension_settings.twt.fontSize = val; handleVisualChange(); }
    });

    $lineHeight.on('input', function () {
        const val = parseFloat($lineHeight.val());
        if (!isNaN(val)) { extension_settings.twt.lineHeight = val; handleVisualChange(); }
    });

    $textIndent.on('input', function () {
        const val = parseFloat($textIndent.val());
        if (!isNaN(val)) { extension_settings.twt.textIndent = val; handleVisualChange(); }
    });

    $textAlign.on('change', function () {
        extension_settings.twt.textAlign = $(this).val();
        handleVisualChange();
    });

    $paragraphSpacing.on('input', function () {
        const val = parseFloat($paragraphSpacing.val());
        if (!isNaN(val)) {
            extension_settings.twt.paragraphSpacing = val;
        } else {
            delete extension_settings.twt.paragraphSpacing;
        }
        handleVisualChange();
    });

    $letterSpacing.on('input', function () {
        const val = parseFloat($letterSpacing.val());
        if (!isNaN(val)) { extension_settings.twt.letterSpacing = val; handleVisualChange(); }
    });

    $fontWeight.on('change', function () {
        extension_settings.twt.fontWeight = $(this).val();
        handleVisualChange();
    });

    $('#twt_font_family').on('change', async function () {
        extension_settings.twt.fontFamily = $(this).val();
        updateFontSummaryHint();
        await updateCustomFontsStyle();
        handleVisualChange();
    });

    function openFontInfoModal() {
        const currentVal = $('#twt_font_family').val();
        const details = getFontDetails(currentVal);
        const $modal = $(parentDoc).find('#twt-font-info-modal');
        $modal.find('#twt_font_info_name').text(details.name);
        $modal.find('#twt_font_info_type').text(details.type);
        $modal.find('#twt_font_info_family').text(details.family);
        $modal.find('#twt_font_info_code').val(details.code);
        
        const cleanFam = String(details.family).split(',')[0].replace(/['"]/g, '').trim();
        const fontStyle = (cleanFam && !cleanFam.startsWith('inherit')) ? `"${cleanFam}", sans-serif` : 'inherit';
        $modal.find('#twt_font_info_preview_box').css('font-family', fontStyle);
        $modal.fadeIn(150);
    }

    $('#twt_font_info, #twt_font_view_details_btn').on('click', function (e) {
        e.preventDefault();
        openFontInfoModal();
    });

    $(parentDoc).on('click', '#twt_font_info_close, #twt_font_info_ok', function () {
        $(parentDoc).find('#twt-font-info-modal').fadeOut(150);
    });

    $(parentDoc).on('click', '#twt_font_info_copy_code', function () {
        const code = $(parentDoc).find('#twt_font_info_code').val();
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => {
                if (typeof toastr !== 'undefined') toastr.success('字体引用代码已复制到剪贴板！', 'TwT 字体');
            }).catch(() => {
                alert('复制失败，请手动全选复制');
            });
        } else {
            alert('当前浏览器环境不支持自动复制，请手动选中复制');
        }
    });

    $('#twt_font_import_file').on('click', function () {
        $('#twt_font_file_input').trigger('click');
    });

    $('#twt_font_file_input').on('change', async function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (file.size > 50 * 1024 * 1024) {
            alert('字体文件过大（超过 50MB），请选择更小或经过子集化压缩的字体文件！');
            $(this).val('');
            return;
        }

        const defaultName = file.name.replace(/\.[^/.]+$/, '');
        const fontName = prompt('请输入字体显示名称：', defaultName);
        if (!fontName || !fontName.trim()) {
            $(this).val('');
            return;
        }
        const trimmedName = fontName.trim();
        const ext = file.name.split('.').pop().toLowerCase();

        const mimeMap = {
            ttf: 'font/ttf',
            otf: 'font/otf',
            woff: 'font/woff',
            woff2: 'font/woff2',
            eot: 'application/vnd.ms-fontobject'
        };
        const mime = mimeMap[ext] || 'font/ttf';

        try {
            const buffer = await file.arrayBuffer();
            // 保存至 IndexedDB，绝不膨胀 settings.json
            await saveFontToStorage(trimmedName, buffer, mime);

            if (!extension_settings.twt.customFonts) extension_settings.twt.customFonts = {};
            extension_settings.twt.customFonts[trimmedName] = {
                name: trimmedName,
                family: trimmedName,
                storage: 'idb',
                ext: ext
            };
            extension_settings.twt.fontFamily = trimmedName;

            await updateCustomFontsStyle();
            renderFontFamilyOptions();
            handleVisualChange();
            if (typeof toastr !== 'undefined') toastr.success(`字体 "${trimmedName}" 导入成功！`, 'TwT 字体');
        } catch (err) {
            console.error('[TwT] 字体保存失败:', err);
            alert('保存字体文件失败，请查看控制台日志：' + err.message);
        } finally {
            $('#twt_font_file_input').val('');
        }
    });

    // 智能解析 CSS / URL 代码片段
    function parseFontInput(raw) {
        const input = (raw || '').trim();
        let url = '';
        let family = '';
        let fontFaceCss = '';

        // 1. <link href="..."> 标签
        const linkMatch = input.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
        if (linkMatch) {
            url = linkMatch[1].trim();
        }

        // 2. @import url("...") 或 @import '...'
        if (!url) {
            const importMatch = input.match(/@import\s+(?:url\(['"]?([^"')]+)['"]?\)|['"]([^'"]+)['"]);?/i);
            if (importMatch) {
                url = (importMatch[1] || importMatch[2]).trim();
            }
        }

        // 3. 直接以 http/https 开头的独立 URL
        if (!url && /^(https?:\/\/[^\s]+)$/i.test(input)) {
            url = input.trim();
        }

        // 4. 从样式规则提取 font-family
        const famMatch = input.match(/font-family\s*:\s*([^;}\r\n]+)/i);
        if (famMatch) {
            const rawFam = famMatch[1].split(',')[0].trim();
            family = rawFam.replace(/['"]/g, '').trim();
        }

        // 5. 提取完整 @font-face 块（支持多字重多块）
        if (/@font-face/i.test(input)) {
            const faces = input.match(/@font-face\s*\{[\s\S]*?\}/gi);
            if (faces && faces.length > 0) {
                fontFaceCss = faces.join('\n\n');
                if (!family) {
                    const subFam = fontFaceCss.match(/font-family\s*:\s*([^;}\r\n]+)/i);
                    if (subFam) {
                        family = subFam[1].split(',')[0].trim().replace(/['"]/g, '').trim();
                    }
                }
            }
        }

        // 6. Google Fonts URL 自动嗅探 family 参数
        if (!family && url) {
            const gFontMatch = url.match(/[?&]family=([^&:+]+)/i);
            if (gFontMatch) {
                family = decodeURIComponent(gFontMatch[1]).replace(/\+/g, ' ').trim();
            }
        }

        return { url, family, fontFaceCss, raw: input };
    }

    $('#twt_font_import_css').on('click', function () {
        const $modal = $(parentDoc).find('#twt-font-import-modal');
        $modal.find('#twt_font_import_code').val('');
        $modal.find('#twt_font_import_display_name').val('');
        $modal.find('#twt_font_import_family_name').val('');
        $modal.fadeIn(150);
    });

    $(parentDoc).on('click', '#twt_font_import_close, #twt_font_import_cancel', function () {
        $(parentDoc).find('#twt-font-import-modal').fadeOut(150);
    });

    $(parentDoc).on('input', '#twt_font_import_code', function () {
        const parsed = parseFontInput($(this).val());
        if (parsed.family) {
            const $modal = $(parentDoc).find('#twt-font-import-modal');
            const $fam = $modal.find('#twt_font_import_family_name');
            const $disp = $modal.find('#twt_font_import_display_name');
            if (!$fam.val()) $fam.val(parsed.family);
            if (!$disp.val()) $disp.val(parsed.family);
        }
    });

    $(parentDoc).on('click', '#twt_font_import_confirm', async function () {
        const $modal = $(parentDoc).find('#twt-font-import-modal');
        const rawCode = $modal.find('#twt_font_import_code').val().trim();
        const displayName = $modal.find('#twt_font_import_display_name').val().trim();
        const familyName = $modal.find('#twt_font_import_family_name').val().trim();

        if (!rawCode) {
            alert('请输入字体 CSS 代码或网络 URL');
            return;
        }
        if (!displayName) {
            alert('请输入字体显示名称');
            return;
        }
        if (!familyName) {
            alert('请输入实际 font-family 名称（与 CSS 定义一致）');
            return;
        }

        const parsed = parseFontInput(rawCode);
        const cleanFamily = familyName.replace(/['"]/g, '').trim();

        let finalCss = '';
        let finalUrl = parsed.url || '';

        if (parsed.fontFaceCss) {
            finalCss = parsed.fontFaceCss;
        } else if (finalUrl) {
            finalCss = `@import url("${finalUrl}");`;
        } else {
            finalCss = rawCode;
        }

        if (!extension_settings.twt.customFonts) extension_settings.twt.customFonts = {};
        extension_settings.twt.customFonts[displayName] = {
            name: displayName,
            family: cleanFamily,
            url: finalUrl || undefined,
            css: finalCss,
            source: finalUrl ? 'url' : 'css'
        };

        extension_settings.twt.fontFamily = cleanFamily;
        $modal.fadeOut(150);

        await updateCustomFontsStyle();
        renderFontFamilyOptions();
        handleVisualChange();
        if (typeof toastr !== 'undefined') toastr.success(`网络字体 "${displayName}" 导入成功！`, 'TwT 字体');
    });

    $('#twt_font_delete').on('click', async function () {
        const currentFont = $('#twt_font_family').val();
        if (!currentFont || currentFont === 'inherit' || BUILTIN_FONTS[currentFont]) {
            alert('系统默认及内置字体不可删除');
            return;
        }
        const customFonts = extension_settings.twt.customFonts || {};
        let keyToDelete = null;
        for (const [k, v] of Object.entries(customFonts)) {
            if (k === currentFont || (v && (v.family === currentFont || v.name === currentFont))) {
                keyToDelete = k;
                break;
            }
        }
        if (keyToDelete && customFonts[keyToDelete]) {
            const dispName = customFonts[keyToDelete].name || keyToDelete;
            if (confirm(`确定要删除自定义字体 "${dispName}" 吗？`)) {
                if (customFonts[keyToDelete].storage === 'idb') {
                    await deleteFontFromStorage(keyToDelete);
                }
                delete customFonts[keyToDelete];
                if (extension_settings.twt.fontFamily === currentFont || extension_settings.twt.fontFamily === keyToDelete) {
                    extension_settings.twt.fontFamily = 'inherit';
                }
                await updateCustomFontsStyle();
                renderFontFamilyOptions();
                handleVisualChange();
                if (typeof toastr !== 'undefined') toastr.success(`已删除自定义字体 "${dispName}"`, 'TwT 字体');
            }
        } else {
            alert('未找到选中的自定义字体');
        }
    });



    $('#twt-settings').on('click', '.twt-tab', function() {
        $('#twt-settings .twt-tab').removeClass('active');
        $('#twt-settings .twt-tab-content').hide().removeClass('active');

        $(this).addClass('active');
        const targetId = $(this).data('tab');
        $('#' + targetId).show().addClass('active');
    });

    const $commentsEnabled = $('#twt_comments_enabled');
    $commentsEnabled.prop('checked', extension_settings.twt.commentsEnabled);
    
    const updateCommentsBtnVisibilityLocal = () => {
        if ($commentsEnabled.prop('checked')) {
            $('#twt_comments_btn_row').show();
        } else {
            $('#twt_comments_btn_row').hide();
        }
    };
    updateCommentsBtnVisibilityLocal();

    $commentsEnabled.on('change', function () {
        extension_settings.twt.commentsEnabled = $(this).prop('checked');
        getContext().saveSettingsDebounced();
        updateCommentsTabVisibility();
        updateCommentsBtnVisibilityLocal();
        if (window.twtRefreshComments) {
            window.twtRefreshComments();
        }
    });

    // Wire up comments settings overlay button
    $('#twt_comments_open_editor_btn').on('click', () => {
        initCommentsEditor();
    });

    renderMenuOrderList();
    renderWorkLogs();
}

function renderMenuOrderList() {
    const $container = $('#twt_menu_order_list');
    if (!$container.length) return;
    $container.empty();

    const order = extension_settings.twt.menuOrder || [
        'menuOptRegenerate',
        'menuOptSwipe',
        'menuOptManage',
        'menuOptEdit',
        'menuOptRealign',
        'menuOptNewChat',
        'menuOptCloseChat',
        'menuOptExcerpt',
        'menuOptFullscreen',
        'menuOptApi',
        'menuOptPurifier',
        'menuOptPurifierDiff',
        'menuOptPromptViewer',
        'menuOptRandomInspect'
    ];

    if (!extension_settings.twt.menuOrder.includes('menuOptFullEdit')) {
        const editIdx = extension_settings.twt.menuOrder.indexOf('menuOptEdit');
        if (editIdx !== -1) {
            extension_settings.twt.menuOrder.splice(editIdx + 1, 0, 'menuOptFullEdit');
        } else {
            extension_settings.twt.menuOrder.push('menuOptFullEdit');
        }
    }

    if (!extension_settings.twt.menuOrder.includes('menuOptRandomInspect')) {
        extension_settings.twt.menuOrder.push('menuOptRandomInspect');
    }

    if (!extension_settings.twt.menuOrder.includes('menuOptImageTag')) {
        extension_settings.twt.menuOrder.push('menuOptImageTag');
    }

    const labels = {
        menuOptRegenerate: '重新生成',
        menuOptSwipe: '滑动',
        menuOptManage: '管理消息',
        menuOptEdit: '分段编辑',
        menuOptFullEdit: '全文编辑',
        menuOptRealign: '翻页归正',
        menuOptNewChat: '新对话',
        menuOptCloseChat: '关闭',
        menuOptExcerpt: '摘抄',
        menuOptFullscreen: '全屏',
        menuOptApi: 'API',
        menuOptPurifier: '净化词汇映射',
        menuOptPurifierDiff: '净化前文透视',
        menuOptPromptViewer: '提示词',
        menuOptRandomInspect: '注入透视',
        menuOptImageTag: '生成生图tag'
    };

    order.forEach((key, index) => {
        const label = labels[key] || key;
        const $row = $(`
            <div class="twt-order-row" data-key="${key}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--SmartThemeDarkColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; margin-bottom: 5px;">
                <span>${label}</span>
                <div style="display: flex; gap: 8px;">
                    <button class="twt-order-up menu_button" style="padding: 2px 6px; font-size: 0.85em; cursor: pointer;" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button class="twt-order-down menu_button" style="padding: 2px 6px; font-size: 0.85em; cursor: pointer;" ${index === order.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
            </div>
        `);

        $row.find('.twt-order-up').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (index > 0) {
                const temp = order[index];
                order[index] = order[index - 1];
                order[index - 1] = temp;
                extension_settings.twt.menuOrder = order;
                getContext().saveSettingsDebounced();
                renderMenuOrderList();
            }
        });

        $row.find('.twt-order-down').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (index < order.length - 1) {
                const temp = order[index];
                order[index] = order[index + 1];
                order[index + 1] = temp;
                extension_settings.twt.menuOrder = order;
                getContext().saveSettingsDebounced();
                renderMenuOrderList();
            }
        });

        $container.append($row);
    });
}

function initCommentsEditor() {
    const $overlay = getEl('#twt-comments-editor-overlay');
    const $closeBtn = getEl('#twt_comments_editor_close');
    
    updateCommentsBgSolid();
    $overlay.fadeIn(200);

    // Sub-tab switching inside the editor
    $overlay.find('.twt-editor-subtab').off('click').on('click', function() {
        $overlay.find('.twt-editor-subtab').removeClass('active');
        $overlay.find('.twt-subtab-content').hide();
        
        $(this).addClass('active');
        const targetId = $(this).data('subtab');
        $overlay.find('#' + targetId).show();
    });

    $closeBtn.off('click').on('click', () => {
        $overlay.fadeOut(200);
    });

    // ==========================================
    // API Tab Management
    // ==========================================
    let currentlySelectedApiId = extension_settings.twt.commentsSelectedApiId || 'main';
    let localApis = JSON.parse(JSON.stringify(extension_settings.twt.commentsApis || []));

    function renderApisTab() {
        const $select = $('#twt_comments_api_select');
        $select.empty();
        
        $select.append($('<option></option>').val('main').text('沿用酒馆当前主 API'));
        localApis.forEach(api => {
            $select.append($('<option></option>').val(api.id).text(api.name));
        });
        
        $select.val(currentlySelectedApiId);
        
        if (currentlySelectedApiId === 'main') {
            $('#twt_comments_api_edit_section').hide();
        } else {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                $('#twt_comments_api_edit_section').show();
                $('#twt_comments_api_form_title').text(`编辑 API 接口: ${api.name}`);
                $('#twt_comments_api_name').val(api.name);
                $('#twt_comments_api_url').val(api.url);
                $('#twt_comments_api_key').val(api.key);
                $('#twt_comments_api_model').val(api.model);
                $('#twt_comments_api_model_select').hide();
                $('#twt_api_test_status').hide();
            } else {
                $('#twt_comments_api_edit_section').hide();
            }
        }
    }

    $('#twt_comments_api_select').off('change').on('change', function() {
        currentlySelectedApiId = $(this).val();
        renderApisTab();
    });

    $('#twt_comments_api_add_btn').off('click').on('click', () => {
        const id = 'api_' + Date.now();
        const newApi = {
            id: id,
            name: '未命名接口',
            url: 'http://localhost:11434/v1',
            key: '',
            model: 'qwen2.5'
        };
        localApis.push(newApi);
        currentlySelectedApiId = id;
        renderApisTab();
    });

    $('#twt_comments_api_delete_btn').off('click').on('click', () => {
        if (currentlySelectedApiId === 'main') return;
        if (confirm('确定要删除这个 API 接口配置吗？')) {
            localApis = localApis.filter(a => a.id !== currentlySelectedApiId);
            currentlySelectedApiId = 'main';
            renderApisTab();
        }
    });

    $('#twt_comments_api_save_btn').off('click').on('click', () => {
        if (currentlySelectedApiId !== 'main') {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                api.name = $('#twt_comments_api_name').val().trim() || '未命名接口';
                api.url = $('#twt_comments_api_url').val().trim();
                api.key = $('#twt_comments_api_key').val().trim();
                api.model = $('#twt_comments_api_model').val().trim();
            }
        }
        extension_settings.twt.commentsApis = JSON.parse(JSON.stringify(localApis));
        extension_settings.twt.commentsSelectedApiId = currentlySelectedApiId;
        getContext().saveSettingsDebounced();
        toastr.success('API 接口配置保存成功！', '成功');
        renderApisTab();
    });

    $('#twt_comments_api_test_btn').off('click').on('click', async () => {
        const url = $('#twt_comments_api_url').val().trim();
        const key = $('#twt_comments_api_key').val().trim();
        const $status = $('#twt_api_test_status');
        
        if (!url) {
            toastr.warning('请先输入 API Base URL！', '提示');
            return;
        }

        $status.show().css('color', 'var(--SmartThemeBodyColor)').html('<i class="fa-solid fa-spinner fa-spin"></i> 测试中...');

        try {
            const headers = { 'Accept': 'application/json' };
            if (key) {
                headers['Authorization'] = `Bearer ${key}`;
            }

            const response = await fetch(`${url}/models`, {
                method: 'GET',
                headers: headers
            });

            if (response.ok) {
                $status.css('color', '#4caf50').html('<i class="fa-solid fa-circle-check"></i> 连接成功');
                toastr.success('连接测试成功！', '成功');
            } else {
                const errText = await response.text();
                $status.css('color', '#ff4444').html('<i class="fa-solid fa-circle-xmark"></i> 连接失败');
                toastr.error(`连接失败 (${response.status}): ${errText.substring(0, 100)}`, '错误');
            }
        } catch (err) {
            console.error('API connection test failed:', err);
            $status.css('color', '#ff4444').html('<i class="fa-solid fa-circle-xmark"></i> 连接出错');
            toastr.error(`连接出错: ${err.message || err}`, '错误');
        }
    });

    $('#twt_comments_api_fetch_models_btn').off('click').on('click', async () => {
        const url = $('#twt_comments_api_url').val().trim();
        const key = $('#twt_comments_api_key').val().trim();
        const $select = $('#twt_comments_api_model_select');
        
        if (!url) {
            toastr.warning('请先输入 API Base URL！', '提示');
            return;
        }

        toastr.info('正在获取可用模型列表...', '提示');

        try {
            const headers = { 'Accept': 'application/json' };
            if (key) {
                headers['Authorization'] = `Bearer ${key}`;
            }

            const response = await fetch(`${url}/models`, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
            }

            const json = await response.json();
            const models = (json.data || []).map(m => m.id);

            if (models.length === 0) {
                toastr.info('获取成功，但未找到任何可用模型。', '提示');
                return;
            }

            $select.empty().show();
            $select.append($('<option></option>').val('').text('-- 选择模型 --'));
            models.forEach(model => {
                $select.append($('<option></option>').val(model).text(model));
            });

            $select.off('change').on('change', function() {
                const val = $(this).val();
                if (val) {
                    $('#twt_comments_api_model').val(val);
                }
            });

            toastr.success(`成功拉取到 ${models.length} 个模型！`, '成功');
        } catch (err) {
            console.error('Fetch models failed:', err);
            toastr.error(`获取模型失败: ${err.message || err}`, '错误');
        }
    });

    // ==========================================
    // Prompts Preset Tab Management
    // ==========================================
    let currentPresetName = extension_settings.twt.commentsCurrentPreset || '网络读者弹幕吐槽';
    let localPresets = JSON.parse(JSON.stringify(extension_settings.twt.commentsPromptPresets || {}));

    function renderPromptsTab() {
        const $select = $('#twt_comments_preset_select');
        $select.empty();
        
        Object.keys(localPresets).forEach(name => {
            $select.append($('<option></option>').val(name).text(name));
        });
        
        if (!localPresets[currentPresetName]) {
            currentPresetName = Object.keys(localPresets)[0] || '网络读者弹幕吐槽';
        }
        $select.val(currentPresetName);
        
        renderPromptItemsList();
    }

    $('#twt_comments_preset_select').off('change').on('change', function() {
        saveCurrentPromptItemsToMemory();
        currentPresetName = $(this).val();
        renderPromptsTab();
    });

    $('#twt_comments_preset_add_btn').off('click').on('click', () => {
        const name = prompt('请输入新提示词预设名称：');
        if (name && name.trim().length > 0) {
            saveCurrentPromptItemsToMemory();
            const trimmed = name.trim();
            localPresets[trimmed] = [
                { role: 'system', content: '你是一个小说读者。', enabled: true }
            ];
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_dup_btn').off('click').on('click', () => {
        const name = prompt('请输入复制后的预设名称：', currentPresetName + '_copy');
        if (name && name.trim().length > 0) {
            saveCurrentPromptItemsToMemory();
            const trimmed = name.trim();
            localPresets[trimmed] = JSON.parse(JSON.stringify(localPresets[currentPresetName] || []));
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_rename_btn').off('click').on('click', () => {
        const name = prompt('请输入预设的新名称：', currentPresetName);
        if (name && name.trim().length > 0 && name.trim() !== currentPresetName) {
            const trimmed = name.trim();
            localPresets[trimmed] = localPresets[currentPresetName];
            delete localPresets[currentPresetName];
            currentPresetName = trimmed;
            renderPromptsTab();
        }
    });

    $('#twt_comments_preset_del_btn').off('click').on('click', () => {
        const keys = Object.keys(localPresets);
        if (keys.length <= 1) {
            toastr.warning('必须保留至少一个提示词预设。', '提示');
            return;
        }
        if (confirm(`确定要删除预设 "${currentPresetName}" 吗？`)) {
            delete localPresets[currentPresetName];
            currentPresetName = Object.keys(localPresets)[0];
            renderPromptsTab();
        }
    });

    // 导出预设
    $('#twt_comments_preset_export_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        const presetData = {
            name: currentPresetName,
            messages: localPresets[currentPresetName] || []
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presetData, null, 4));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href",     dataStr);
        downloadAnchor.setAttribute("download", `twt_preset_${currentPresetName}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        toastr.success(`预设 "${currentPresetName}" 已成功导出！`, '导出成功');
    });

    // 导入预设
    $('#twt_comments_preset_import_btn').off('click').on('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (!imported || typeof imported.name !== 'string' || !Array.isArray(imported.messages)) {
                        throw new Error('JSON 格式不正确。必须包含 name 和 messages 属性。');
                    }
                    
                    let importName = imported.name.trim();
                    if (!importName) {
                        importName = '未命名导入预设';
                    }
                    
                    // 如果重名，重命名
                    let finalName = importName;
                    let counter = 1;
                    while (localPresets[finalName]) {
                        finalName = `${importName}_${counter}`;
                        counter++;
                    }
                    
                    localPresets[finalName] = imported.messages;
                    currentPresetName = finalName;
                    
                    // 保存到酒馆设置中并重新渲染
                    saveCurrentPromptItemsToMemory();
                    extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(localPresets));
                    extension_settings.twt.commentsCurrentPreset = currentPresetName;
                    getContext().saveSettingsDebounced();

                    renderPromptsTab();
                    toastr.success(`成功导入预设 "${finalName}"！`, '导入成功');
                } catch (err) {
                    console.error('导入预设失败:', err);
                    toastr.error(`导入失败：${err.message || '文件解析错误'}`, '错误');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    function saveCurrentPromptItemsToMemory() {
        const items = [];
        $('#twt-comments-prompt-items-container .twt-prompt-item-card').each(function() {
            const role = $(this).find('.twt-prompt-item-role-select').val();
            const enabled = $(this).find('.twt-prompt-item-enable-toggle').prop('checked');
            const name = $(this).find('.twt-prompt-item-name-input').val();
            const content = $(this).find('.twt-prompt-item-textarea').val();
            const collapsed = $(this).hasClass('collapsed');
            items.push({ role, enabled, name, content, collapsed });
        });
        if (currentPresetName) {
            localPresets[currentPresetName] = items;
        }
    }

    function renderPromptItemsList() {
        const container = $('#twt-comments-prompt-items-container');
        container.empty();
        
        const items = localPresets[currentPresetName] || [];
        items.forEach((item, index) => {
            const isCollapsed = item.collapsed !== false; // Default to true (collapsed)
            const collapsedClass = isCollapsed ? 'collapsed' : '';
            const textareaStyle = isCollapsed ? 'display: none;' : '';
            const caretIcon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
            
            const card = $(`
                <div class="twt-prompt-item-card ${collapsedClass}" data-index="${index}" style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="twt-prompt-item-row" style="cursor: pointer; user-select: none;">
                        <div class="twt-prompt-item-left">
                            <span class="twt-prompt-item-toggle-collapse" style="cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;"><i class="fa-solid ${caretIcon}"></i></span>
                            <span style="font-weight: bold; font-size: 0.85em; opacity: 0.5;">#${index + 1}</span>
                            <select class="twt-prompt-item-role-select" style="background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; padding: 3px; font-size: 0.85em; width: auto; max-width: 110px;">
                                <option value="system" ${item.role === 'system' ? 'selected' : ''}>System (系统)</option>
                                <option value="user" ${item.role === 'user' ? 'selected' : ''}>User (用户)</option>
                                <option value="assistant" ${item.role === 'assistant' ? 'selected' : ''}>Assistant (AI)</option>
                            </select>
                            <input type="text" class="twt-prompt-item-name-input" placeholder="条目名称，如：背景上下文" value="${item.name || ''}" style="flex: 1; min-width: 100px; max-width: 250px; font-size: 0.85em; padding: 3px 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;" />
                        </div>
                        <div class="twt-prompt-item-right">
                            <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer; margin: 0; white-space: nowrap;">
                                <input type="checkbox" class="twt-prompt-item-enable-toggle" ${item.enabled !== false ? 'checked' : ''} /> 启用
                            </label>
                            <button class="twt-prompt-item-fullscreen-btn menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="全屏编辑这行内容"><i class="fa-solid fa-expand"></i> 全屏</button>
                            <button class="twt-prompt-item-dup-btn menu_button" style="padding: 3px 6px; margin: 0; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="复制此条目"><i class="fa-regular fa-copy"></i> 复制</button>
                            <button class="twt-prompt-item-del-btn menu_button" style="padding: 3px 6px; margin: 0; color: #ff4444; font-size: 0.8em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="删除此条目"><i class="fa-solid fa-trash"></i> 删除</button>
                        </div>
                    </div>
                    <textarea class="twt-prompt-item-textarea" placeholder="消息内容..." style="width: 100%; height: 80px; box-sizing: border-box; padding: 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; resize: vertical; ${textareaStyle}">${item.content || ''}</textarea>
                </div>
            `);
            
            // Prevent event bubbling when clicking inside input, select, label or buttons in header
            card.find('.twt-prompt-item-role-select, .twt-prompt-item-name-input, .twt-prompt-item-enable-toggle, .menu_button').on('click', (e) => {
                e.stopPropagation();
            });

            // Expand/collapse toggling (Accordion style)
            const toggleCollapse = () => {
                const isCollapsed = card.hasClass('collapsed');
                if (isCollapsed) {
                    // Collapse all other sibling items first
                    card.siblings('.twt-prompt-item-card').each(function() {
                        const $sibling = $(this);
                        if (!$sibling.hasClass('collapsed')) {
                            $sibling.addClass('collapsed');
                            $sibling.find('.twt-prompt-item-textarea').slideUp(150);
                            $sibling.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
                        }
                    });
                    
                    // Expand this item
                    card.removeClass('collapsed');
                    card.find('.twt-prompt-item-textarea').slideDown(150);
                    card.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-right').addClass('fa-chevron-down');
                } else {
                    // Collapse this item
                    card.addClass('collapsed');
                    card.find('.twt-prompt-item-textarea').slideUp(150);
                    card.find('.twt-prompt-item-toggle-collapse i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
                }
                saveCurrentPromptItemsToMemory();
            };

            card.find('.twt-prompt-item-row').on('click', (e) => {
                if ($(e.target).closest('.twt-prompt-item-role-select, .twt-prompt-item-name-input, .twt-prompt-item-enable-toggle, .menu_button').length) return;
                toggleCollapse();
            });
            
            card.find('.twt-prompt-item-fullscreen-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                
                const $textarea = card.find('.twt-prompt-item-textarea');
                const currentContent = $textarea.val();
                
                const $fsOverlay = getEl('#twt-comments-text-fullscreen-overlay');
                const $fsTextarea = getEl('#twt_comments_fullscreen_textarea');
                
                $fsTextarea.val(currentContent);
                $fsOverlay.fadeIn(200);
                
                getEl('#twt_comments_fullscreen_save').off('click').on('click', () => {
                    const editedContent = $fsTextarea.val();
                    $textarea.val(editedContent);
                    saveCurrentPromptItemsToMemory();
                    $fsOverlay.fadeOut(200);
                });
                
                getEl('#twt_comments_fullscreen_cancel').off('click').on('click', () => {
                    $fsOverlay.fadeOut(200);
                });
            });

            card.find('.twt-prompt-item-del-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                localPresets[currentPresetName].splice(index, 1);
                renderPromptItemsList();
            });

            card.find('.twt-prompt-item-dup-btn').on('click', (e) => {
                e.stopPropagation();
                saveCurrentPromptItemsToMemory();
                const copiedItem = JSON.parse(JSON.stringify(localPresets[currentPresetName][index]));
                localPresets[currentPresetName].splice(index + 1, 0, copiedItem);
                renderPromptItemsList();
            });

            container.append(card);
        });
    }

    $('#twt_comments_prompt_add_item_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        if (!localPresets[currentPresetName]) {
            localPresets[currentPresetName] = [];
        }
        localPresets[currentPresetName].push({
            role: 'user',
            content: '',
            enabled: true
        });
        renderPromptItemsList();
        
        setTimeout(() => {
            const container = document.getElementById('twt-comments-prompt-items-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 50);
    });

    $('#twt_comments_prompt_save_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        extension_settings.twt.commentsPromptPresets = JSON.parse(JSON.stringify(localPresets));
        extension_settings.twt.commentsCurrentPreset = currentPresetName;
        getContext().saveSettingsDebounced();
        toastr.success('提示词预设保存成功！', '成功');
    });

    // ==========================================
    // Request Preview Dialog
    // ==========================================
    $('#twt_comments_prompt_preview_btn').off('click').on('click', () => {
        saveCurrentPromptItemsToMemory();
        const mockParagraphsInput = JSON.stringify([
            { id: 0, text: "这是小说中被选中进行点评的第一个段落，用来测试 AI 是否能在此处生成有趣的网络读者吐槽。" },
            { id: 1, text: "这是紧接着的第二个段落，通常 AI 需要同时分析这两个段落的上下文来进行对比点评。" }
        ], null, 4);
        const activePreset = localPresets[currentPresetName] || [];
        const enabledMessages = activePreset.filter(m => m.enabled !== false);
        
        if (enabledMessages.length === 0) {
            toastr.warning('当前预设中没有任何已启用的消息条目！', '提示');
            return;
        }

        const context = getContext();
        const userVal = context.name1 || 'User';
        const charVal = context.name2 || 'Char';
        function applyCommentsRegexFilters(text) {
            if (!text) return '';
            const filters = extension_settings.twt.commentsRegexFilters || [];
            let result = text;
            filters.forEach(filter => {
                if (filter.enabled === false || !filter.pattern) return;
                try {
                    const regex = new RegExp(filter.pattern, 'g');
                    if (filter.action === 'remove') {
                        result = result.replace(regex, '');
                    }
                } catch (e) {
                    console.warn(`[TwT Regex Filter Error] Pattern "${filter.pattern}":`, e);
                }
            });
            return result;
        }

        // Get actual chat history context (last 5 messages before preview context)
        let rawContextHistory = '';
        if (context.chat && context.chat.length > 0) {
            // Preview relative to the current chat session or end of chat
            const lastMessages = context.chat.slice(-5);
            rawContextHistory = lastMessages.map(msg => {
                const sender = msg.is_user ? (context.name1 || 'User') : (context.name2 || 'Char');
                return `${sender}: ${msg.mes || ''}`;
            }).join('\n\n');
        } else {
            rawContextHistory = `User: 这是一个测试的前文故事开头。\nChar: 这是一个测试的AI回复内容，里面包含一些需要排除的思考过程 <thought>AI正在思考如何回应用户...</thought> 思考完毕。`;
        }

        const filteredContextHistory = applyCommentsRegexFilters(rawContextHistory);

        const finalMessages = enabledMessages.map(m => {
            let replacedContent = (m.content || '')
                .replace(/{{paragraphs_input}}/g, mockParagraphsInput)
                .replace(/{{context_history}}/g, filteredContextHistory)
                .replace(/{{user}}/g, userVal)
                .replace(/{{char}}/g, charVal);
            return {
                role: m.role,
                content: replacedContent
            };
        });

        let endpointUrl = '';
        let headersStr = '';
        let modelStr = '';

        if (currentlySelectedApiId === 'main') {
            const STModel = (typeof context.getChatCompletionModel === 'function') ? context.getChatCompletionModel(context.chatCompletionSettings) : '酒馆当前主模型';
            endpointUrl = '/api/backends/chat-completions/generate';
            headersStr = JSON.stringify({
                'Content-Type': 'application/json',
                'X-Source': 'SillyTavern-TwT-Extension'
            }, null, 2);
            modelStr = STModel;
        } else {
            const api = localApis.find(a => a.id === currentlySelectedApiId);
            if (api) {
                endpointUrl = `${api.url}/chat/completions`;
                headersStr = JSON.stringify({
                    'Content-Type': 'application/json',
                    'Authorization': api.key ? `Bearer ${api.key.substring(0, 4)}...${api.key.substring(Math.max(0, api.key.length - 4))}` : 'None'
                }, null, 2);
                modelStr = api.model;
            } else {
                endpointUrl = '未知接口';
                headersStr = '无';
                modelStr = '无';
            }
        }

        getEl('#twt_comments_preview_url').text(endpointUrl);
        getEl('#twt_comments_preview_headers').text(headersStr);
        getEl('#twt_comments_preview_model').text(modelStr);

        const $payloadContainer = getEl('#twt_comments_preview_payload_container');
        $payloadContainer.empty();

        finalMessages.forEach(msg => {
            const roleClass = msg.role;
            const $msgDiv = $(`
                <div class="twt-preview-payload-msg">
                    <span class="twt-preview-payload-role ${roleClass}">${msg.role.toUpperCase()}</span>
                    <div class="twt-preview-payload-content">${escapeHtml(msg.content)}</div>
                </div>
            `);
            $payloadContainer.append($msgDiv);
        });

        getEl('#twt-comments-preview-modal').fadeIn(200);
    });

    getEl('#twt_comments_preview_close').off('click').on('click', () => {
        getEl('#twt-comments-preview-modal').fadeOut(200);
    });

    // ==========================================
    // Regex Filters Tab Management
    // ==========================================
    let localFilters = JSON.parse(JSON.stringify(extension_settings.twt.commentsRegexFilters || []));

    function renderRegexFiltersTab() {
        const container = $('#twt-comments-regex-rules-container');
        container.empty();

        localFilters.forEach((filter, index) => {
            const card = $(`
                <div class="twt-prompt-item-card" data-index="${index}" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; background: rgba(255,255,255,0.02);">
                    <div class="twt-prompt-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                        <div class="twt-prompt-item-left" style="display: flex; gap: 6px; align-items: center; flex: 1; min-width: 200px;">
                            <span style="font-weight: bold; font-size: 0.85em; opacity: 0.5;">#${index + 1}</span>
                            <input type="text" class="twt-regex-name-input" placeholder="规则名称" value="${filter.name || ''}" style="flex: 1; min-width: 100px; max-width: 200px; font-size: 0.85em; padding: 3px 6px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;" />
                            <select class="twt-regex-action-select" style="background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; padding: 3px; font-size: 0.85em;">
                                <option value="remove" ${filter.action === 'remove' ? 'selected' : ''}>排除/清除移除</option>
                            </select>
                        </div>
                        <div class="twt-prompt-item-right" style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; white-space: nowrap;">
                            <label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em; cursor: pointer; margin: 0; white-space: nowrap;">
                                <input type="checkbox" class="twt-regex-enable-toggle" ${filter.enabled !== false ? 'checked' : ''} /> 启用
                            </label>
                            <button class="twt-regex-del-btn menu_button" style="padding: 3px 6px; margin: 0; color: #ff4444; font-size: 0.85em; white-space: nowrap !important; display: inline-flex !important; align-items: center !important; gap: 2px !important;" title="删除此规则"><i class="fa-solid fa-trash"></i> 删除</button>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                        <span style="font-size: 0.8em; opacity: 0.6;">正则表达式 (Regular Expression Pattern)：</span>
                        <input type="text" class="twt-regex-pattern-input" placeholder="例如：<thought[^>]*>[\\s\\S]*?<\\/thought>" value="${filter.pattern || ''}" style="width: 100%; font-size: 0.9em; padding: 5px; background: var(--SmartThemeDarkColor); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace;" />
                    </div>
                </div>
            `);

            card.find('.twt-regex-del-btn').on('click', () => {
                saveCurrentFiltersToMemory();
                localFilters.splice(index, 1);
                renderRegexFiltersTab();
            });

            container.append(card);
        });
    }

    function saveCurrentFiltersToMemory() {
        const filters = [];
        $('#twt-comments-regex-rules-container .twt-prompt-item-card').each(function() {
            const name = $(this).find('.twt-regex-name-input').val().trim();
            const action = $(this).find('.twt-regex-action-select').val();
            const enabled = $(this).find('.twt-regex-enable-toggle').prop('checked');
            const pattern = $(this).find('.twt-regex-pattern-input').val();
            const id = 'filter_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            filters.push({ id, name, action, enabled, pattern });
        });
        localFilters = filters;
    }

    $('#twt_comments_regex_add_btn').off('click').on('click', () => {
        saveCurrentFiltersToMemory();
        localFilters.push({
            id: 'filter_' + Date.now(),
            name: '新规则',
            pattern: '',
            action: 'remove',
            enabled: true
        });
        renderRegexFiltersTab();
    });

    $('#twt_comments_regex_save_btn').off('click').on('click', () => {
        saveCurrentFiltersToMemory();
        extension_settings.twt.commentsRegexFilters = JSON.parse(JSON.stringify(localFilters));
        getContext().saveSettingsDebounced();
        toastr.success('正则过滤规则保存成功！', '成功');
    });

    // ==========================================
    // Layout settings Tab Management
    // ==========================================
    function renderLayoutTab() {
        const currentPos = extension_settings.twt.commentsDrawerPosition || 'right';
        const currentWidth = extension_settings.twt.commentsDrawerWidth || 35; // Default 35%
        
        $('#twt_comments_drawer_position_select').val(currentPos);
        $('#twt_comments_drawer_width_range').val(currentWidth);
        
        $('#twt_comments_drawer_width_display').text(currentWidth + '%');
    }

    // Bind slider input change
    $('#twt_comments_drawer_width_range').off('input').on('input', function() {
        const val = $(this).val();
        $('#twt_comments_drawer_width_display').text(val + '%');
    });

    $('#twt_comments_layout_save_btn').off('click').on('click', () => {
        const pos = $('#twt_comments_drawer_position_select').val();
        const width = parseInt($('#twt_comments_drawer_width_range').val(), 10) || 35;
        
        extension_settings.twt.commentsDrawerPosition = pos;
        extension_settings.twt.commentsDrawerWidth = width;
        
        getContext().saveSettingsDebounced();
        toastr.success('界面布局设置保存成功！', '成功');
    });

    // ==========================================
    // Help Tutorials Modals Logic
    // ==========================================
    const showHelpModal = (title, content) => {
        getEl('#twt_help_modal_title').text(title);
        getEl('#twt_help_modal_content').html(content);
        getEl('#twt-comments-help-modal').fadeIn(200);
    };

    const closeHelpModal = () => {
        getEl('#twt-comments-help-modal').fadeOut(200);
    };

    getEl('#twt_help_modal_close').off('click').on('click', closeHelpModal);
    getEl('#twt-comments-help-modal').off('click').on('click', function(e) {
        if (e.target === this) {
            closeHelpModal();
        }
    });

    // 提示词帮助教程文本
    const promptHelpText = `
<div style="font-weight: bold; font-size: 1.1em; margin-bottom: 10px; color: var(--SmartThemeUnderlineColor, #007aff);">提示词编写指南</div>
您可以通过添加多条“系统 (system)”和“用户 (user)”消息来构建发送给 AI 的提示词预设。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【支持的占位符】</div>
在发送请求给 AI 时，系统会自动将消息中的以下占位符替换为实际内容：
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{paragraphs_input}}</code>
  <span style="opacity: 0.85;"><b>(必填)</b> 代表当前选中的需要进行点评的小说段落数据，为 JSON 格式。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{context_history}}</code>
  <span style="opacity: 0.85;">代表当前场景的<b>前文聊天历史</b>（默认取最近 5 条消息）。该内容会自动经过您的“正则过滤规则”处理，清除无关的杂质。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{char}}</code>
  <span style="opacity: 0.85;">自动替换为酒馆当前 AI 角色名称。</span>
• <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{user}}</code>
  <span style="opacity: 0.85;">自动替换为您的用户名称。</span>

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【编写建议】</div>
建议在提示词中明确要求 AI 输出包含作者（author）和点评（comment）字段的 JSON 数组。
例如：
<pre style="background: rgba(0,0,0,0.25); border: 1px solid var(--SmartThemeBorderColor); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.9em; white-space: pre-wrap; margin-top: 5px; color: #a6e22e;">
[
  {
    "author": "热心书友",
    "comment": "这段写得真好！"
  }
]
</pre>
`;

    // 正则过滤帮助教程文本
    const regexHelpText = `
<div style="font-weight: bold; font-size: 1.1em; margin-bottom: 10px; color: var(--SmartThemeUnderlineColor, #007aff);">正则过滤配置指南</div>
当您在提示词中使用 <code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; color: #ff7b72;">{{context_history}}</code> 引入上下文剧情时，前文通常会带有很多无助于 AI 进行段评生成的杂质数据（例如思考过程、系统设定提示等）。

您可以使用正则过滤规则在发送给 API 之前，对前文进行一轮自动清洗和简化。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【规则参数说明】</div>
• <b>正则表达式</b>：标准的 JavaScript 正则语法。
• <b>动作 (Action)</b>：
  - <b>排除/清除 (remove)</b>：将正则表达式所匹配到的所有文本，从前文故事文本中直接擦除。
• <b>启用开关</b>：可随时启用或禁用单条规则。
• <b>规则顺序</b>：规则将按照从上至下的顺序依次应用。

<div style="font-weight: bold; margin-top: 15px; margin-bottom: 5px;">【常见正则表达式示例】</div>
• <b>过滤 AI 的思考过程</b>（即清除 &lt;thought&gt; 标签及其包裹的内容）：
  <code style="display: block; background: rgba(0,0,0,0.25); padding: 6px 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace; margin: 5px 0; color: #66d9ef;">&lt;thought&gt;([\\s\\S]*?)&lt;\\/thought&gt;</code>
• <b>过滤括弧内的动作旁白描述</b>：
  <code style="display: block; background: rgba(0,0,0,0.25); padding: 6px 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-family: monospace; margin: 5px 0; color: #66d9ef;">\\([^)]*\\) 或 \\*[^*]*\\*</code>
`;

    $('#twt_prompt_help_icon').off('click').on('click', () => {
        showHelpModal('提示词预设编写教程', promptHelpText);
    });

    $('#twt_regex_help_icon').off('click').on('click', () => {
        showHelpModal('正则过滤规则教程', regexHelpText);
    });

    // Render tabs initially
    renderApisTab();
    renderPromptsTab();
    renderRegexFiltersTab();
    renderLayoutTab();
}

function updateCommentsBgSolid() {
    try {
        const tempEl = document.createElement('div');
        tempEl.style.color = 'var(--SmartThemeBlurTintColor)';
        document.body.appendChild(tempEl);
        const computedColor = getComputedStyle(tempEl).color;
        document.body.removeChild(tempEl);
        
        const match = computedColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const r = match[1];
            const g = match[2];
            const b = match[3];
            const solidColor = `rgb(${r}, ${g}, ${b})`;
            document.documentElement.style.setProperty('--twt-comments-bg-solid', solidColor);
            if (parentDoc && parentDoc.documentElement && parentDoc !== document) {
                parentDoc.documentElement.style.setProperty('--twt-comments-bg-solid', solidColor);
            }
        } else {
            document.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
            if (parentDoc && parentDoc.documentElement && parentDoc !== document) {
                parentDoc.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
            }
        }
    } catch (e) {
        console.warn("TwT: Failed to parse SmartThemeBlurTintColor:", e);
        document.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
        if (parentDoc && parentDoc.documentElement && parentDoc !== document) {
            parentDoc.documentElement.style.setProperty('--twt-comments-bg-solid', 'var(--SmartThemeBlurTintColor)');
        }
    }
}

jQuery(async () => {
    const html = await renderExtensionTemplateAsync(extensionFolder, 'index');
    $('#extensions_settings').append(html);

    // Teleport editor, text editing, preview, and help overlays to parentDoc.body to escape transform containment
    $('#twt-comments-editor-overlay').appendTo(parentDoc.body);
    $('#twt-comments-text-fullscreen-overlay').appendTo(parentDoc.body);
    $('#twt-comments-preview-modal').appendTo(parentDoc.body);
    $('#twt-comments-help-modal').appendTo(parentDoc.body);
    $('#twt-link-theme-modal').appendTo(parentDoc.body);
    $('#twt-optimize-create-modal').appendTo(parentDoc.body);
    $('#twt-optimize-editor-modal').appendTo(parentDoc.body);
    $('#twt-font-import-modal').appendTo(parentDoc.body);
    $('#twt-font-info-modal').appendTo(parentDoc.body);

    updateCommentsBgSolid();
    bindUI();
    updatePageTabVisibility();
    updateMenuTabVisibility();
    updateVisualTabVisibility();
    updateMuluTabVisibility();
    updateCommentsTabVisibility();
    
    applyPaginationMode(extension_settings.twt.enabled, extension_settings.twt);
    applyVisualMode(extension_settings.twt.visualEnabled, extension_settings.twt);
    applyMenuMode(extension_settings.twt.menuEnabled, extension_settings.twt);
    applyFullscreenMode(extension_settings.twt.isFullscreen);
    updateInjectedStyles();
    initMulu();
    initHtmlPopup();
    registerSlashCommands();
    try {
        const ctx = getContext();
        registerHtmlPopupEvents(ctx);
    } catch (e) {
        console.warn('[TwT] Register html popup events failed:', e);
    }
    initThemeLinkListener();
    initPaginationEvent(() => extension_settings.twt);
    initMenu(() => extension_settings.twt, (active) => {
        isExcerptModeActive = active;
        setClass(document.body, 'twt-excerpt-active', active);
        if (parentDoc && parentDoc.body) {
            setClass(parentDoc.body, 'twt-excerpt-active', active);
        }
        updateInjectedStyles();
    });
    const handleContextMenuBlock = (e) => {
        const patches = extension_settings?.twt?.optimizePatches || {};
        const isEnabled = patches['禁用聊天区域长按菜单']?.active;
        if (!isEnabled) return;

        const docs = getAllDocs();
        for (const d of docs) {
            const chat = d.getElementById('chat');
            if (chat && chat.contains(e.target)) {
                const tagName = e.target.tagName ? e.target.tagName.toLowerCase() : '';
                if (tagName !== 'input' && tagName !== 'textarea') {
                    e.preventDefault();
                    return;
                }
            }
        }
    };
    getAllDocs().forEach(d => {
        d.removeEventListener('contextmenu', handleContextMenuBlock, true);
        d.addEventListener('contextmenu', handleContextMenuBlock, true);
    });

    // 聊天切换与应用就绪时重新应用视觉美化与自定义CSS，并重绑翻页事件
    try {
        const ctx = getContext();
        if (ctx && ctx.eventSource && ctx.eventTypes) {
            const reapplyVisualAndStyles = () => {
                ensureSettingsInitialized();
                applyVisualMode(extension_settings.twt?.visualEnabled, extension_settings.twt);
                updateInjectedStyles();
                updateCustomFontsStyle();
            };

            // 聊天切换与加载更多历史消息时仅需同步 #chat 容器上的 CSS 变量，无需重复读取 IndexedDB 字体或重写全局 <style> 标签，彻底避免移动端主线程阻塞与字体重新解析引起的二次排版跳页
            const reapplyChatVisualVarsOnly = () => {
                ensureSettingsInitialized();
                applyVisualMode(extension_settings.twt?.visualEnabled, extension_settings.twt);
            };

            ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
                reapplyChatVisualVarsOnly();
                if (extension_settings.twt?.enabled) {
                    resetPaginationBinding(() => extension_settings.twt);
                }
            });

            if (ctx.eventTypes.MORE_MESSAGES_LOADED) {
                ctx.eventSource.on(ctx.eventTypes.MORE_MESSAGES_LOADED, () => {
                    reapplyChatVisualVarsOnly();
                    if (extension_settings.twt?.enabled) {
                        handleMoreMessagesLoaded();
                    }
                });
            }

            let currentGenType = 'normal';
            if (ctx.eventTypes.MESSAGE_SENT) {
                ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, () => {
                    if (extension_settings.twt?.enabled) handleUserMessageSent(extension_settings.twt);
                });
            }
            if (ctx.eventTypes.MESSAGE_SWIPED) {
                ctx.eventSource.on(ctx.eventTypes.MESSAGE_SWIPED, (mesId) => {
                    if (extension_settings.twt?.enabled) handleMessageSwiped(mesId);
                });
            }
            if (ctx.eventTypes.GENERATION_STARTED) {
                ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, (type) => {
                    currentGenType = type || 'normal';
                    if (extension_settings.twt?.enabled) handleGenerationStarted(type, extension_settings.twt);
                });
            }
            const onGenDone = () => {
                if (extension_settings.twt?.enabled) handleGenerationEnded(extension_settings.twt);
                currentGenType = 'normal';
            };
            if (ctx.eventTypes.GENERATION_STOPPED) ctx.eventSource.on(ctx.eventTypes.GENERATION_STOPPED, onGenDone);
            if (ctx.eventTypes.GENERATION_ENDED) ctx.eventSource.on(ctx.eventTypes.GENERATION_ENDED, onGenDone);
            if (ctx.eventTypes.USER_MESSAGE_RENDERED) {
                ctx.eventSource.on(ctx.eventTypes.USER_MESSAGE_RENDERED, (mesId) => {
                    if (extension_settings.twt?.enabled) handleNewMessageRendered(mesId, extension_settings.twt, 'normal');
                });
            }
            if (ctx.eventTypes.CHARACTER_MESSAGE_RENDERED) {
                ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, (mesId, type) => {
                    if (extension_settings.twt?.enabled) handleNewMessageRendered(mesId, extension_settings.twt, type || currentGenType);
                });
            }
            if (ctx.eventTypes.MESSAGE_DELETED) {
                ctx.eventSource.on(ctx.eventTypes.MESSAGE_DELETED, () => {
                    if (extension_settings.twt?.enabled) handleMessageDeleted();
                    reapplyVisualAndStyles();
                });
            }

            const lifecycleEvents = [
                ctx.eventTypes.APP_READY,
                ctx.eventTypes.CHARACTER_PAGE_LOADED,
                ctx.eventTypes.SETTINGS_LOADED,
                ctx.eventTypes.SETTINGS_UPDATED,
                ctx.eventTypes.EXTENSION_SETTINGS_LOADED,
                ctx.eventTypes.EXTENSIONS_FIRST_LOAD
            ].filter(Boolean);

            lifecycleEvents.forEach(evt => {
                ctx.eventSource.on(evt, reapplyVisualAndStyles);
            });
        }
    } catch (e) {
        console.warn('[TwT] Failed to register lifecycle listeners for visual styles:', e);
    }

    // ============================================================
    
    // ============================================================
    // 拓展面板更新扩展后自动刷新酒馆页面
    // ============================================================
    let isAutoReloading = false;

    function autoReloadApp(reason) {
        if (isAutoReloading) return;
        isAutoReloading = true;
        console.log(`[TwT] ${reason}，准备自动刷新页面...`);
        if (typeof toastr !== 'undefined') {
            toastr.info('拓展更新完成，正在为您自动刷新页面...', '自动刷新', { timeOut: 2000 });
        }
        setTimeout(() => {
            try {
                if (window.top && window.top.location && typeof window.top.location.reload === 'function') {
                    window.top.location.reload();
                    return;
                }
            } catch (e) {}
            try {
                if (window.parent && window.parent.location && typeof window.parent.location.reload === 'function') {
                    window.parent.location.reload();
                    return;
                }
            } catch (e) {}
            window.location.reload();
        }, 1200);
    }

    // 1. 监听扩展更新相关的 AJAX 请求完成
    try {
        const rootDoc = (window.parent && window.parent.document) ? window.parent.document : document;
        const $root = window.parent && window.parent.jQuery ? window.parent.jQuery(rootDoc) : $(document);

        $root.ajaxComplete((event, xhr, settings) => {
            if (!settings || !settings.url) return;
            const url = String(settings.url).toLowerCase();
            if (url.includes('/api/extensions/update') || url.includes('/api/extensions/download') || url.includes('/api/extensions/install')) {
                if (xhr && (xhr.status === 200 || xhr.status === 304)) {
                    autoReloadApp('检测到拓展更新完成');
                }
            }
        });
    } catch (e) {
        console.warn('[TwT] Register extension update ajax listener failed:', e);
    }

    // 2. 监听扩展更新 EventSource 事件
    try {
        const ctx = getContext();
        if (ctx && ctx.eventSource && ctx.eventTypes) {
            const extEventTypes = [
                ctx.eventTypes.EXTENSION_UPDATED,
                ctx.eventTypes.EXTENSION_INSTALLED,
                ctx.eventTypes.EXTENSIONS_UPDATED
            ].filter(Boolean);

            extEventTypes.forEach(eventType => {
                ctx.eventSource.on(eventType, () => {
                    autoReloadApp('收到拓展更新事件');
                });
            });
        }
    } catch (e) {
        console.warn('[TwT] Register extension update eventSource listener failed:', e);
    }
});
