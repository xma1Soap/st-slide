import { setClass } from '../utils/class_guard.js?v=1.0.28';
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

export function applyVisualMode(enabled, settings) {
    const docs = getAllDocs();
    docs.forEach(doc => {
        try {
            if (enabled) {
                setClass(doc.body, 'twt-visual-mode', true);
                const chatContainer = doc.getElementById('chat');
                if (chatContainer) {
                    chatContainer.style.setProperty('--twt-padding-top', `${settings.paddingTop}px`, 'important');
                    chatContainer.style.setProperty('--twt-padding-bottom', `${settings.paddingBottom}px`, 'important');
                    chatContainer.style.setProperty('--twt-padding-left', `${settings.paddingLeft}px`, 'important');
                    chatContainer.style.setProperty('--twt-padding-right', `${settings.paddingRight}px`, 'important');
                    chatContainer.style.setProperty('--twt-font-size', `${settings.fontSize}px`, 'important');
                    chatContainer.style.setProperty('--twt-line-height', `${settings.lineHeight}`, 'important');
                    chatContainer.style.setProperty('--twt-text-indent', `${settings.textIndent ?? 0}em`, 'important');
                    chatContainer.style.setProperty('--twt-text-align', `${settings.textAlign ?? 'left'}`, 'important');

                    const pSpacing = Number(settings.paragraphSpacing);
                    if (!isNaN(pSpacing) && settings.paragraphSpacing !== '' && settings.paragraphSpacing !== null && settings.paragraphSpacing !== undefined) {
                        chatContainer.style.setProperty('--twt-paragraph-spacing', `${pSpacing}px`, 'important');
                    } else {
                        chatContainer.style.removeProperty('--twt-paragraph-spacing');
                    }

                    chatContainer.style.setProperty('--twt-letter-spacing', `${settings.letterSpacing ?? 0}px`, 'important');
                    chatContainer.style.setProperty('--twt-font-weight', `${settings.fontWeight ?? 'normal'}`, 'important');
                }
                if (settings.fontFamily && settings.fontFamily !== 'inherit') {
                    const cleanFont = String(settings.fontFamily).replace(/['"]/g, '').trim();
                    const isSerif = /mincho|serif|song|ming|kai|明朝|宋体|楷体/i.test(cleanFont);
                    const fallback = isSerif
                        ? '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif'
                        : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
                    const fullFontStack = `"${cleanFont}", ${fallback}`;

                    if (doc.documentElement) {
                        doc.documentElement.style.setProperty('--twt-global-font-family', fullFontStack);
                    }
                    if (chatContainer) {
                        chatContainer.style.setProperty('--twt-font-family', fullFontStack, 'important');
                    }
                    setClass(doc.body, 'twt-custom-font-active', true);
                } else {
                    if (doc.documentElement) {
                        doc.documentElement.style.removeProperty('--twt-global-font-family');
                    }
                    if (chatContainer) {
                        chatContainer.style.removeProperty('--twt-font-family');
                    }
                    setClass(doc.body, 'twt-custom-font-active', false);
                }
            } else {
                // 每次切换聊天、加载历史都会走到这里，先判断再写，避免触发酒馆整页按钮扫描
                setClass(doc.body, 'twt-visual-mode', false);
                setClass(doc.body, 'twt-custom-font-active', false);
                if (doc.documentElement) {
                    doc.documentElement.style.removeProperty('--twt-global-font-family');
                }
                const chatContainer = doc.getElementById('chat');
                if (chatContainer) {
                    chatContainer.style.removeProperty('--twt-font-family');
                }
            }
        } catch (e) {
            console.warn('[TwT] applyVisualMode failed for document:', e);
        }
    });
}

