// @ts-nocheck
import { extension_settings, getContext } from '../../../../extensions.js';
import { jumpToStart, jumpToEnd, openMuluModal } from './mulu/mulu.js?v=1.0.30';
import { toggleHtmlAppPopup } from './html_popup/html_popup.js?v=1.0.30';
import { realignPagination } from './pagination/pagination.js?v=1.0.30';
import { applyFullscreenMode } from './menu/menu.js?v=1.0.30';

function parseUnnamedArg(unnamedArgs) {
    if (Array.isArray(unnamedArgs)) {
        return unnamedArgs.map(x => String(x || '').trim()).join(' ');
    }
    return String(unnamedArgs || '').trim();
}

/**
 * 注册 TwT 拓展所有功能键对应的 ST 斜杠命令
 */
export async function registerSlashCommands() {
    let SlashCommand = null;
    let SlashCommandParser = null;

    try {
        const ctx = typeof getContext === 'function' ? getContext() : (window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null);
        if (ctx?.SlashCommand && ctx?.SlashCommandParser) {
            SlashCommand = ctx.SlashCommand;
            SlashCommandParser = ctx.SlashCommandParser;
        }
    } catch (e) {}

    if (!SlashCommand || !SlashCommandParser) {
        try {
            const scModule = await import('/scripts/slash-commands/SlashCommand.js');
            const scpModule = await import('/scripts/slash-commands/SlashCommandParser.js');
            SlashCommand = scModule.SlashCommand;
            SlashCommandParser = scpModule.SlashCommandParser;
        } catch (e) {
            try {
                const scModule = await import('../../../../slash-commands/SlashCommand.js');
                const scpModule = await import('../../../../slash-commands/SlashCommandParser.js');
                SlashCommand = scModule.SlashCommand;
                SlashCommandParser = scpModule.SlashCommandParser;
            } catch (err) {
                if (window.SlashCommand && window.SlashCommandParser) {
                    SlashCommand = window.SlashCommand;
                    SlashCommandParser = window.SlashCommandParser;
                } else if (window.parent?.SlashCommand && window.parent?.SlashCommandParser) {
                    SlashCommand = window.parent.SlashCommand;
                    SlashCommandParser = window.parent.SlashCommandParser;
                }
            }
        }
    }

    if (!SlashCommand || !SlashCommandParser || typeof SlashCommandParser.addCommandObject !== 'function') {
        console.warn('[TwT] SlashCommandParser 不可用，跳过斜杠命令注册');
        return;
    }

    try {
        // 1. 跳至开头 / 上一条 (/twt-start)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-start',
            aliases: ['twt-top', 'twt-prev', 'twt-first'],
            helpString: 'TwT阅读模式：跳至开头或上一条消息。传入参数 absolute、top 或 all 可直达最开头。',
            callback: (namedArgs, unnamedArgs) => {
                const arg = parseUnnamedArg(unnamedArgs).toLowerCase();
                const isAbsolute = arg === 'absolute' || arg === 'top' || arg === 'first' || arg === 'all';
                jumpToStart(isAbsolute);
                return '';
            },
        }));

        // 2. 跳至结尾 / 下一条 (/twt-end)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-end',
            aliases: ['twt-bottom', 'twt-next', 'twt-last'],
            helpString: 'TwT阅读模式：跳至结尾或下一条消息。传入参数 absolute、bottom 或 all 可直达最末尾。',
            callback: (namedArgs, unnamedArgs) => {
                const arg = parseUnnamedArg(unnamedArgs).toLowerCase();
                const isAbsolute = arg === 'absolute' || arg === 'bottom' || arg === 'last' || arg === 'all';
                jumpToEnd(isAbsolute);
                return '';
            },
        }));

        // 3. 阅读目录 (/twt-toc)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-toc',
            aliases: ['twt-mulu', 'twt-catalog', 'twt-menu-toc'],
            helpString: 'TwT阅读模式：召出或打开阅读目录与章节列表。',
            callback: () => {
                openMuluModal();
                return '';
            },
        }));

        // 4. HTML 应用独立召出/收回 (/twt-app)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-app',
            aliases: ['twt-html', 'twt-popup'],
            helpString: 'TwT阅读模式：召出或收回当前可视楼层的 HTML/Iframe 独立应用弹窗。',
            callback: () => {
                toggleHtmlAppPopup();
                return '';
            },
        }));

        // 5. 重新校准对齐排版 (/twt-realign)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-realign',
            aliases: ['twt-align'],
            helpString: 'TwT阅读模式：立即重新校准与对齐分页排版。',
            callback: () => {
                realignPagination(true);
                if (typeof toastr !== 'undefined') toastr.success('已重新校准排版与分页', 'TwT 排版');
                return '';
            },
        }));

        // 6. 全屏阅读模式 (/twt-fullscreen)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt-fullscreen',
            aliases: ['twt-zen'],
            helpString: 'TwT阅读模式：切换全屏沉浸阅读模式。',
            callback: () => {
                const current = !!extension_settings?.twt?.isFullscreen;
                if (extension_settings?.twt) {
                    extension_settings.twt.isFullscreen = !current;
                }
                const ctx = typeof getContext === 'function' ? getContext() : null;
                if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
                    ctx.saveSettingsDebounced();
                }
                applyFullscreenMode(!current);
                return '';
            },
        }));

        // 7. 综合统一指令 (/twt)
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'twt',
            aliases: ['twt-cmd'],
            helpString: 'TwT阅读模式命令调度中心。用法：/twt <start|end|toc|app|realign|fullscreen>',
            callback: (namedArgs, unnamedArgs) => {
                const action = parseUnnamedArg(unnamedArgs).toLowerCase();
                if (action === 'start' || action === 'top' || action === 'prev' || action === 'first') {
                    jumpToStart(action === 'top' || action === 'first');
                } else if (action === 'end' || action === 'bottom' || action === 'next' || action === 'last') {
                    jumpToEnd(action === 'bottom' || action === 'last');
                } else if (action === 'toc' || action === 'mulu' || action === 'catalog') {
                    openMuluModal();
                } else if (action === 'app' || action === 'html' || action === 'popup') {
                    toggleHtmlAppPopup();
                } else if (action === 'realign' || action === 'align') {
                    realignPagination(true);
                    if (typeof toastr !== 'undefined') toastr.success('已重新校准排版与分页', 'TwT 排版');
                } else if (action === 'fullscreen' || action === 'zen') {
                    const current = !!extension_settings?.twt?.isFullscreen;
                    if (extension_settings?.twt) {
                        extension_settings.twt.isFullscreen = !current;
                    }
                    const ctx = typeof getContext === 'function' ? getContext() : null;
                    if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
                        ctx.saveSettingsDebounced();
                    }
                    applyFullscreenMode(!current);
                } else {
                    if (typeof toastr !== 'undefined') {
                        toastr.info('可用指令: /twt <start|end|toc|app|realign|fullscreen>，也可使用独立指令 /twt-toc, /twt-app, /twt-start, /twt-end', 'TwT 帮助');
                    }
                }
                return '';
            },
        }));

        console.log('[TwT] 成功注册功能键对应的 ST 斜杠命令 (/twt, /twt-toc, /twt-app, /twt-start, /twt-end, /twt-realign, /twt-fullscreen)');
    } catch (e) {
        console.error('[TwT] 注册斜杠命令时出错:', e);
    }
}
