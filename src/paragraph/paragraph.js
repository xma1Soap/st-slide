// @ts-nocheck
import { extension_settings, getContext } from '../../../../../extensions.js';
import { scrollPageLeft, scrollPageRight } from '../pagination/pagination.js?v=1.0.29';
import { getRegexedString, regex_placement } from '../../../../regex/engine.js';


// 使用本地 document 作为 modal 的挂载目标，防止跨文档/跨域限制或弹窗被 iframe 遮挡
const parentDoc = document;

// 获取当前可见视口的几何中心及高度（兼容宿主 iframe 与带 transforms 容器的定位）
function getVisibleCenter() {
    let top = 0;
    let height = window.innerHeight;
    let isIframeCentering = false;

    try {
        if (window.parent && window.parent !== window && window.parent.document) {
            const iframe = window.frameElement;
            if (iframe) {
                const rect = iframe.getBoundingClientRect();
                const parentHeight = window.parent.innerHeight;
                
                const visibleTop = Math.max(0, -rect.top);
                const visibleBottom = Math.min(rect.height || document.documentElement.scrollHeight, parentHeight - rect.top);
                
                top = visibleTop;
                height = visibleBottom - visibleTop;
                isIframeCentering = true;
            }
        }
    } catch (e) {
        console.warn("TwT: Cannot access parent window geometry, falling back to local positioning.", e);
    }

    if (!isIframeCentering) {
        // 后备本地窗口定位，支持带有 CSS transform 的外部滚动定位
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
        top = scrollTop;
        height = window.innerHeight || document.documentElement.clientHeight;
    }

    return {
        centerY: top + height / 2,
        visibleTop: top,
        visibleHeight: height
    };
}

// 同步宿主页面主题样式到 iframe
try {
    if (window.parent) {
        const pDoc = window.parent.document;
        if (pDoc && pDoc !== document) {
            const parentStyle = pDoc.documentElement.getAttribute('style');
            if (parentStyle) {
                document.documentElement.setAttribute('style', parentStyle);
            }
        }
    }
} catch (e) {
    console.warn("TwT: Cannot sync theme style from parent.", e);
}

// 动态加载 CSS 到当前 iframe 及宿主 parent 页面（使用基于模块地址 of 绝对 URL 并追加时间戳以防缓存）
function injectStyles() {
    const baseCssUrl = new URL('./paragraph.css', import.meta.url).href;
    const cssUrl = `${baseCssUrl}?v=${Date.now()}`;
    console.log("TwT: Injecting stylesheet from URL:", cssUrl);
    
    // 清理所有旧的 paragraph.css link 标签
    $('link[href*="paragraph.css"]').remove();
    
    $('<link>', {
        rel: 'stylesheet',
        type: 'text/css',
        href: cssUrl
    }).appendTo('head');
    
    try {
        if (window.parent) {
            const pDoc = window.parent.document;
            if (pDoc && pDoc !== document) {
                // 在宿主页面中也清理旧的 paragraph.css link
                pDoc.querySelectorAll('link[href*="paragraph.css"]').forEach(el => el.remove());
                
                const link = pDoc.createElement('link');
                link.rel = 'stylesheet';
                link.type = 'text/css';
                link.href = cssUrl;
                pDoc.head.appendChild(link);
            }
        }
    } catch (e) {
        console.error("TwT: Failed to inject styles into parent document", e);
    }
}
injectStyles();

/**
 * 辅助方法：将 <p> 元素内部根据 <br> 切分为独立的 block-like inline 元素，且 100% 保持排版高度
 */
function splitParagraphsByBr($mesText) {
    $mesText.find('p').each(function() {
        const $p = $(this);
        if ($p.find('br').length === 0) return;
        
        const newContents = [];
        let currentGroup = [];
        
        $p.contents().each(function() {
            if (this.nodeType === Node.ELEMENT_NODE && this.nodeName.toUpperCase() === 'BR') {
                if (currentGroup.length > 0) {
                    const $line = $('<span class="twt-p-line-wrapper" style="display: block; margin: 0; padding: 0; position: relative;"></span>');
                    $line.append(currentGroup);
                    newContents.push($line[0]);
                    currentGroup = [];
                }
            } else {
                currentGroup.push(this);
            }
        });
        
        if (currentGroup.length > 0) {
            const $line = $('<span class="twt-p-line-wrapper" style="display: block; margin: 0; padding: 0; position: relative;"></span>');
            $line.append(currentGroup);
            newContents.push($line[0]);
        }
        
        $p.empty().append(newContents);
    });
}

/**
 * 获取可选择的 DOM 叶子块级元素（使用高效的自顶向下递归，避免大规模 closest 调用，极大地提升手机端响应速度）
 */
function getSelectableElements($mesText) {
    // 首先根据 <br> 进行换行切分
    splitParagraphsByBr($mesText);
    
    const list = [];
    
    function traverse(node) {
        const $node = $(node);
        
        // 匹配块级或行级可选元素
        if ($node.is('p, span.twt-p-line-wrapper, li, pre, blockquote, h1, h2, h3, h4, h5, h6, hr, .thought-block')) {
            if ($node.is('p') && $node.find('span.twt-p-line-wrapper').length > 0) {
                // 如果是 p 且内部有换行切分包装，则深层遍历它的直接子节点
                $node.children().each(function() {
                    traverse(this);
                });
            } else {
                // 否则直接作为独立的叶子可选块收集，停止向内深层递归，提高效率
                list.push($node);
            }
            return;
        }
        
        // 对于非目标容器节点（如 div, ul, ol），继续向下递归遍历其子节点
        $node.children().each(function() {
            traverse(this);
        });
    }
    
    $mesText.children().each(function() {
        traverse(this);
    });
    
    return list;
}

/**
 * 智能解析 Markdown 段落、代码块、引用块及列表项等
 */
export function parseMarkdownToBlocks(text, whitelist = []) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const blocks = [];
    
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // 1. 空行
        if (trimmed === '') {
            blocks.push({
                type: 'empty',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: false
            });
            i++;
            continue;
        }
        
        // 2. 代码块
        if (trimmed.startsWith('```')) {
            let codeLines = [line];
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                codeLines.push(subLine);
                if (subLine.trim().startsWith('```')) {
                    i++;
                    break;
                }
                i++;
            }
            const blockContent = codeLines.join('\n');
            blocks.push({
                type: 'code',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }

        // 3. XML标签白名单 (例如思考链)
        const openMatch = trimmed.match(/^<([a-zA-Z0-9_-]+)>$/);
        const isOpenTagInWhitelist = openMatch && whitelist.includes(openMatch[1].toLowerCase());
        if (isOpenTagInWhitelist) {
            const tagName = openMatch[1].toLowerCase();
            let xmlLines = [line];
            let openCount = 1;
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                const subTrim = subLine.trim();
                xmlLines.push(subLine);
                
                if (subTrim === `<${tagName}>`) {
                    openCount++;
                } else if (subTrim === `</${tagName}>`) {
                    openCount--;
                    if (openCount === 0) {
                        i++;
                        break;
                    }
                }
                i++;
            }
            const blockContent = xmlLines.join('\n');
            blocks.push({
                type: 'xml',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }
        
        // 4. 引用块
        if (trimmed.startsWith('>') || trimmed.startsWith('&gt;')) {
            let quoteLines = [line];
            i++;
            while (i < lines.length) {
                const subLine = lines[i];
                const subTrimmed = subLine.trim();
                if (subTrimmed.startsWith('>') || subTrimmed.startsWith('&gt;')) {
                    quoteLines.push(subLine);
                    i++;
                } else if (subTrimmed === '') {
                    let nextIsQuote = false;
                    let nextIdx = i + 1;
                    while (nextIdx < lines.length) {
                        const nextTrim = lines[nextIdx].trim();
                        if (nextTrim === '') {
                            nextIdx++;
                        } else {
                            if (nextTrim.startsWith('>') || nextTrim.startsWith('&gt;')) {
                                nextIsQuote = true;
                            }
                            break;
                        }
                    }
                    if (nextIsQuote) {
                        quoteLines.push(subLine);
                        i++;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            const blockContent = quoteLines.join('\n');
            blocks.push({
                type: 'quote',
                original: blockContent,
                current: blockContent,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            continue;
        }
        
        // 5. 标题
        if (trimmed.startsWith('#')) {
            blocks.push({
                type: 'header',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 6. 水平分割线
        if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
            blocks.push({
                type: 'hr',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 7. 列表项
        if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
            blocks.push({
                type: 'list-item',
                original: line,
                current: line,
                isEdited: false,
                isDeleted: false,
                isVisible: true
            });
            i++;
            continue;
        }
        
        // 8. 单行段落（不在上面规则内的，全部按独立单行作为段落处理，从而完美映射没有空行的单独段落）
        blocks.push({
            type: 'paragraph',
            original: line,
            current: line,
            isEdited: false,
            isDeleted: false,
            isVisible: true
        });
        i++;
    }
    
    return blocks;
}

/**
 * 原设计兼容：保留 parseParagraphs 方法
 */
export function parseParagraphs(text, whitelist = []) {
    return parseMarkdownToBlocks(text, whitelist).map(b => b.original);
}

/**
 * 辅助方法：清洗文本以提取核心文本指纹，方便进行相似度匹配
 */
function getCleanText(str) {
    if (!str) return '';
    return str.replace(/<\/?[^>]+(>|$)/g, "") // 移除 HTML 标签
              .replace(/[\s\r\n\p{P}\p{S}]/gu, "") // 移除所有空白、标点、特殊符号
              .toLowerCase();
}

/**
 * 辅助方法：计算 Markdown 块与 DOM 元素的相似度，带有类型匹配逻辑约束
 */
function getBlockDomSimilarity(block, $el) {
    const isXml = block.type === 'xml';
    const isCode = block.type === 'code';
    const isHr = block.type === 'hr';

    const isDomThought = $el.hasClass('thought-block') || $el.closest('.thought-block').length > 0 || $el.is('blockquote');
    const isDomPre = $el.is('pre') || $el.closest('pre').length > 0;
    const isDomHr = $el.is('hr');

    // 类型强约束：若类型不匹配，直接返回 0 相似度，防止错位匹配
    if (isXml && !isDomThought) return 0.0;
    if (!isXml && isDomThought) return 0.0;
    if (isCode && !isDomPre) return 0.0;
    if (!isCode && isDomPre) return 0.0;
    if (isHr && !isDomHr) return 0.0;
    if (!isHr && isDomHr) return 0.0;

    if (isHr && isDomHr) return 1.0;

    const blockText = block.current || block.original || '';
    const domText = $el.text() || '';

    const cleanBlock = getCleanText(blockText);
    const cleanDom = getCleanText(domText);

    if (cleanBlock === cleanDom) return 1.0;
    if (!cleanBlock || !cleanDom) return 0.0;

    // Jaccard 相似度（基于字符集合）
    const setBlock = new Set(cleanBlock);
    const setDom = new Set(cleanDom);
    let intersection = 0;
    for (const c of setBlock) {
        if (setDom.has(c)) intersection++;
    }
    const union = setBlock.size + setDom.size - intersection;
    return union === 0 ? 0.0 : intersection / union;
}

/**
 * 原地打开段落编辑器（零 Layout Shift 版）
 * @param {number} mesId 
 * @param {number} [clickX]
 * @param {number} [clickY]
 */
export function openParagraphEditor(mesId, clickX = null, clickY = null) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    const $mes = $(`.mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const $mesText = $mes.find('.mes_text');
    if (!$mesText.length) return;

    // 防止重复触发
    if (document.body.classList.contains('twt-paragraph-editing')) return;

    // 读取自定义设置与正则过滤标志
    const settings = extension_settings.twt || {};
    const useFiltered = settings.menuOptEditFiltered ?? false;
    const toolbarBottom = settings.paragraphToolbarBottom !== undefined ? settings.paragraphToolbarBottom : 15;
    const iconSize = settings.paragraphIconSize !== undefined ? settings.paragraphIconSize : 20;

    const whitelistStr = settings.paragraphXmlWhitelist || 'thought, TavernThought, reasoning, details';
    const whitelist = whitelistStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // 锁住 #chat 的高度，防止移动端键盘弹出时布局重排/自动翻页
    const $chat = $('#chat');
    let originalChatStyle = '';
    if ($chat.length) {
        originalChatStyle = $chat.attr('style') || '';
        const currentHeight = $chat.outerHeight();
        $chat.css('cssText', $chat.attr('style') + `; height: ${currentHeight}px !important; max-height: none !important;`);
    }

    // 保存原始消息内容（用于取消时恢复）
    const originalText = message.mes || '';
    
    // 保存原始 HTML 用于取消时恢复（注意：这是渲染后的 HTML，不是原始文本）
    const originalHtml = $mesText.html();
    
    // 解析原始文本的段落块
    const originalBlocks = parseMarkdownToBlocks(originalText, whitelist);
    
    // 构建 block 状态对象
    const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    let blocks = [];
    
    if (useFiltered) {
        // 先对整个文本应用正则过滤，保留完整的多行标签匹配
        const filteredWholeText = getRegexedString(originalText, placement, { isMarkdown: true });
        const filteredBlocks = parseMarkdownToBlocks(filteredWholeText, whitelist);
        
        const origVisible = originalBlocks.filter(b => b.isVisible);
        const filtVisible = filteredBlocks.filter(b => b.isVisible);
        
        const N = origVisible.length;
        const M = filtVisible.length;
        
        const getSimilarity = (a, b) => {
            if (a === b) return 1.0;
            if (!a || !b) return 0.0;
            const charsA = new Set(a);
            const charsB = new Set(b);
            let intersection = 0;
            for (const c of charsA) {
                if (charsB.has(c)) intersection++;
            }
            const union = charsA.size + charsB.size - intersection;
            if (union === 0) return 0.0;
            return intersection / union;
        };
        
        // dp[i][j] 记录最大匹配得分
        const dp = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
        const parent = Array.from({ length: N + 1 }, () => Array(M + 1).fill(''));
        
        for (let i = 1; i <= N; i++) {
            for (let j = 1; j <= M; j++) {
                const sim = getSimilarity(origVisible[i-1].original, filtVisible[j-1].original);
                let matchScore = -1;
                if (sim > 0.15) {
                    matchScore = dp[i-1][j-1] + sim;
                }
                const skipOrigScore = dp[i-1][j];
                const skipFiltScore = dp[i][j-1];
                
                if (matchScore >= skipOrigScore && matchScore >= skipFiltScore) {
                    dp[i][j] = matchScore;
                    parent[i][j] = 'match';
                } else if (skipOrigScore >= skipFiltScore) {
                    dp[i][j] = skipOrigScore;
                    parent[i][j] = 'skip_orig';
                } else {
                    dp[i][j] = skipFiltScore;
                    parent[i][j] = 'skip_filt';
                }
            }
        }
        
        let i = N, j = M;
        const alignment = new Array(N).fill(-1);
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && parent[i][j] === 'match') {
                alignment[i-1] = j-1;
                i--;
                j--;
            } else if (i > 0 && (j === 0 || parent[i][j] === 'skip_orig')) {
                alignment[i-1] = -1;
                i--;
            } else {
                j--;
            }
        }
        
        let visibleIdx = 0;
        blocks = originalBlocks.map((block) => {
            if (!block.isVisible) {
                return block;
            }
            const matchedIdx = alignment[visibleIdx];
            const isVisible = matchedIdx !== -1;
            const filtered = isVisible ? filtVisible[matchedIdx].original : '';
            visibleIdx++;
            return {
                ...block,
                filtered: filtered,
                current: filtered,
                isEdited: false,
                isDeleted: false,
                isVisible: isVisible
            };
        });
    } else {
        blocks = originalBlocks.map(block => {
            return {
                ...block,
                filtered: block.original,
                current: block.original,
                isEdited: false,
                isDeleted: false
            };
        });
    }

    // ── 将工具栏添加到 #chat 的父容器中，防止它跟随 #chat 横向翻页滚动 ──
    const $chatParent = $('#chat').parent();
    if ($chatParent.length && $chatParent.css('position') === 'static') {
        $chatParent.css('position', 'relative');
    }

    const $toolbar = $(`
        <div id="twt-paragraph-toolbar" class="twt-p-toolbar-wrap" style="bottom: ${toolbarBottom}px; --twt-paragraph-icon-size: ${iconSize}px;">
            <div class="twt-p-toolbar-inner">
                <button class="twt-p-btn twt-p-btn-page" id="twt-p-prev" title="上一页"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="twt-p-btn twt-p-btn-danger" id="twt-p-delete" title="删除所选段落"><i class="fa-solid fa-trash"></i></button>
                <button class="twt-p-btn twt-p-btn-normal" id="twt-p-edit" title="编辑所选段落"><i class="fa-solid fa-pen"></i></button>
                <button class="twt-p-btn twt-p-btn-normal" id="twt-p-cancel" title="取消编辑"><i class="fa-solid fa-xmark"></i></button>
                <button class="twt-p-btn twt-p-btn-primary" id="twt-p-save" title="确认保存"><i class="fa-solid fa-check"></i></button>
                <button class="twt-p-btn twt-p-btn-page" id="twt-p-next" title="下一页"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>
    `).appendTo($chatParent.length ? $chatParent : 'body');

    // ── 进入编辑模式 ─────────────────
    document.body.classList.add('twt-paragraph-editing');

    // 获取当前 HTML 中所有的块级元素并映射
    const $elements = getSelectableElements($mesText);
    
    const visibleBlocks = blocks.filter(b => b.isVisible);
    const N = visibleBlocks.length;
    const M = $elements.length;
    
    // DP 算法将 visibleBlocks 与 $elements 根据文本内容指纹相似度和类型约束进行全局最优对齐
    const dp = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
    const parent = Array.from({ length: N + 1 }, () => Array(M + 1).fill(''));
    
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            const block = visibleBlocks[i - 1];
            const $el = $elements[j - 1];
            
            const sim = getBlockDomSimilarity(block, $el);
            
            let matchScore = -1;
            // 设定一个相似度门槛（非常宽松），只要有基本的类型匹配和一定字符重合就可以
            if (sim > 0.05 || (block.type === 'hr' && sim > 0)) {
                matchScore = dp[i - 1][j - 1] + sim;
            }
            
            const skipBlockScore = dp[i - 1][j];
            const skipDomScore = dp[i][j - 1];
            
            if (matchScore >= skipBlockScore && matchScore >= skipDomScore) {
                dp[i][j] = matchScore;
                parent[i][j] = 'match';
            } else if (skipBlockScore >= skipDomScore) {
                dp[i][j] = skipBlockScore;
                parent[i][j] = 'skip_block';
            } else {
                dp[i][j] = skipDomScore;
                parent[i][j] = 'skip_dom';
            }
        }
    }
    
    let i = N;
    let j = M;
    const alignment = new Array(M).fill(-1);
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && parent[i][j] === 'match') {
            alignment[j - 1] = i - 1;
            i--;
            j--;
        } else if (i > 0 && (j === 0 || parent[i][j] === 'skip_block')) {
            i--;
        } else {
            j--;
        }
    }
    
    // 应用 data-twt-block-idx 映射
    for (let elementIdx = 0; elementIdx < M; elementIdx++) {
        const matchedIdx = alignment[elementIdx];
        if (matchedIdx !== -1) {
            const block = visibleBlocks[matchedIdx];
            const $el = $elements[elementIdx];
            $el.addClass('twt-p-selectable');
            const originalIdx = blocks.indexOf(block);
            $el.attr('data-twt-block-idx', originalIdx);
        }
    }

    // 如果传入了点击坐标，根据屏幕物理坐标计算并默认选中物理位置最近的段落块
    if (clickX !== null && clickY !== null) {
        let minDistance = Infinity;
        let $targetBlock = null;
        
        $elements.forEach(($el) => {
            if (!$el.hasClass('twt-p-selectable')) return;
            const rect = $el[0].getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.hypot(clickX - centerX, clickY - centerY);
            
            if (distance < minDistance) {
                minDistance = distance;
                $targetBlock = $el;
            }
        });
        
        if ($targetBlock) {
            $targetBlock.addClass('twt-p-selected');
            console.log(`TwT: Auto-selected closest paragraph at block index ${$targetBlock.attr('data-twt-block-idx')} via screen coordinates`);
        }
    }

    // 监听选择点击事件
    $mesText.off('.twt-paragraph-edit').on('click.twt-paragraph-edit', '.twt-p-selectable', function(e) {
        e.stopPropagation();
        if ($(e.target).closest('button, a, input, textarea, select, .twt-p-editor').length) return;
        $(this).toggleClass('twt-p-selected');
    });

    // ── 清理并退出编辑模式 ──────────────────────────────────────────
    function exitEditMode() {
        $mesText.off('.twt-paragraph-edit');
        document.body.classList.remove('twt-paragraph-editing');
        $toolbar.remove();
        const oldModal = parentDoc.getElementById('twt-p-modal');
        if (oldModal) {
            oldModal.remove();
        }
        if ($chat.length) {
            $chat.attr('style', originalChatStyle);
        }
    }

    // ── 更新 DOM 选择器上的删除、已编辑状态 ──
    function updateDomStates() {
        blocks.forEach((block, blockIdx) => {
            const $el = $mesText.find(`[data-twt-block-idx="${blockIdx}"]`);
            if ($el.length) {
                if (block.isDeleted || block.isEdited) {
                    $el.removeClass('twt-p-selected');
                }
                $el.toggleClass('twt-p-deleted', !!block.isDeleted);
                $el.toggleClass('twt-p-edited', !!block.isEdited);
            }
        });
    }

    // ── 左右翻页按钮动作 ─────────────────────────────────────────
    $toolbar.find('#twt-p-prev').on('click', (e) => {
        e.stopPropagation();
        scrollPageLeft();
    });

    $toolbar.find('#twt-p-next').on('click', (e) => {
        e.stopPropagation();
        scrollPageRight();
    });

    // ── 取消编辑 ───────────────────────────────────────────────────
    $toolbar.find('#twt-p-cancel').on('click', (e) => {
        e.stopPropagation();
        exitEditMode();
        $mesText.html(originalHtml);
    });

    // ── 删除段落 ───────────────────────────────────────────────────
    $toolbar.find('#twt-p-delete').on('click', (e) => {
        e.stopPropagation();

        const checkedIndices = [];
        $mesText.find('.twt-p-selectable.twt-p-selected').each(function() {
            checkedIndices.push(Number($(this).attr('data-twt-block-idx')));
        });

        if (checkedIndices.length === 0) {
            alert('请先点击选择需要删除的段落！');
            return;
        }

        if (confirm(`确定要删除选中的 ${checkedIndices.length} 个段落吗？`)) {
            checkedIndices.forEach(idx => {
                blocks[idx].isDeleted = true;
            });
            updateDomStates();
        }
    });

    // ── 段落修改编辑（支持单段落或相邻多段落合并编辑） ─────────────────
    $toolbar.find('#twt-p-edit').on('click', (e) => {
        e.stopPropagation();

        try {
            const $checked = $mesText.find('.twt-p-selectable.twt-p-selected');
            if ($checked.length === 0) {
                alert('请先点击选择需要编辑的段落！');
                return;
            }

            // 检查选中的段落是否在 DOM 中相邻（连续）
            const selectedDomIndices = [];
            $elements.forEach(($el, idx) => {
                if ($el.hasClass('twt-p-selected')) {
                    selectedDomIndices.push(idx);
                }
            });

            let isContiguous = true;
            for (let i = 1; i < selectedDomIndices.length; i++) {
                if (selectedDomIndices[i] !== selectedDomIndices[i - 1] + 1) {
                    isContiguous = false;
                    break;
                }
            }

            if (!isContiguous) {
                alert('仅支持合并编辑相邻的段落！');
                return;
            }

            // 收集选中段落的 blocks 索引并排序
            const sortedBlockIndices = [];
            $checked.each(function() {
                sortedBlockIndices.push(Number($(this).attr('data-twt-block-idx')));
            });
            sortedBlockIndices.sort((a, b) => a - b);

            // 合并选中段落的内容
            const mergedText = sortedBlockIndices.map(idx => blocks[idx].current).join('\n');

            // 移除可能已存在的旧弹窗
            const oldModal = parentDoc.getElementById('twt-p-modal');
            if (oldModal) {
                oldModal.remove();
            }

            // 创建弹窗元素
            const modalEl = parentDoc.createElement('div');
            modalEl.id = 'twt-p-modal';
            modalEl.className = 'twt-p-modal-overlay';
            modalEl.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; z-index: 999999; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);';
            modalEl.innerHTML = `
                <div class="twt-p-modal-box" style="position: absolute; left: 50%; transform: translate(-50%, -50%); width: calc(100% - 32px); max-width: 600px; padding: 20px; border-radius: 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; background: var(--twt-comments-bg-solid, var(--SmartThemeBlurTintColor, #1e1e2e)); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);">
                    <div class="twt-p-modal-header" style="font-size: 0.95em; font-weight: bold; opacity: 0.75; color: var(--SmartThemeBodyColor, #e0e0e0); padding-bottom: 6px; border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.12));">编辑段落</div>
                    <textarea class="twt-p-modal-textarea" style="width: 100%; box-sizing: border-box; background: var(--SmartThemeDarkColor, rgba(0,0,0,0.25)); color: var(--SmartThemeBodyColor, #ffffff); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)); border-radius: 8px; padding: 10px 12px; font-family: inherit; font-size: 1em; line-height: 1.6; resize: none; overflow-y: auto; min-height: 100px; outline: none;"></textarea>
                    <div class="twt-p-modal-actions" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
                        <button class="twt-p-modal-btn twt-p-modal-cancel" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px; font-size: 0.9em; cursor: pointer; border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2)); background: var(--SmartThemeDarkColor, rgba(255,255,255,0.08)); color: var(--SmartThemeBodyColor, #ffffff); outline: none;"><i class="fa-solid fa-xmark"></i> 取消</button>
                        <button class="twt-p-modal-btn twt-p-modal-confirm" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px; font-size: 0.9em; cursor: pointer; border: none; background: var(--SmartThemeUnderlineColor, var(--SmartThemePrimaryColor, #007aff)); color: #ffffff; font-weight: bold; outline: none;"><i class="fa-solid fa-check"></i> 确定</button>
                    </div>
                </div>
            `;
            parentDoc.body.appendChild(modalEl);

            const $modal = $(modalEl);
            const $textarea = $modal.find('.twt-p-modal-textarea');
            $textarea.val(mergedText);

            // 动态定位弹窗，使其完美垂直居中在用户的可见视口内
            const repositionModal = () => {
                const { centerY, visibleHeight } = getVisibleCenter();
                const docHeight = Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    window.innerHeight
                );
                modalEl.style.height = docHeight + 'px';
                
                const $box = $modal.find('.twt-p-modal-box');
                $box.css({
                    position: 'absolute',
                    top: centerY + 'px',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                });
                
                $textarea.css('height', 'auto');
                const sh = $textarea[0].scrollHeight;
                const maxTaHeight = Math.max(100, Math.min(sh + 2, visibleHeight * 0.4, 300));
                $textarea.css('height', maxTaHeight + 'px');
            };

            $textarea.on('input', repositionModal);

            const handleScrollResize = () => {
                requestAnimationFrame(repositionModal);
            };

            window.addEventListener('resize', handleScrollResize);
            window.addEventListener('scroll', handleScrollResize);
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.addEventListener('resize', handleScrollResize);
                    window.parent.addEventListener('scroll', handleScrollResize);
                }
            } catch (e) {
                console.warn("TwT: Cannot bind listener to window.parent", e);
            }
            
            // 支持 Ctrl+Enter 确认提交
            $textarea.on('keydown', (ev) => {
                if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                    ev.preventDefault();
                    $modal.find('.twt-p-modal-confirm').trigger('click');
                }
            });

            requestAnimationFrame(() => {
                repositionModal();
                $textarea[0].focus();
                const len = $textarea.val().length;
                $textarea[0].setSelectionRange(len, len);
            });

            const closeModal = () => {
                window.removeEventListener('resize', handleScrollResize);
                window.removeEventListener('scroll', handleScrollResize);
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.removeEventListener('resize', handleScrollResize);
                        window.parent.removeEventListener('scroll', handleScrollResize);
                    }
                } catch (e) {}
                $modal.remove();
            };

            // 点击遮罩层关闭
            $modal.on('click', function(ev) {
                if (ev.target === this) closeModal();
            });

            $modal.find('.twt-p-modal-cancel').on('click', (ev) => {
                ev.stopPropagation();
                closeModal();
            });

            $modal.find('.twt-p-modal-confirm').on('click', (ev) => {
                ev.stopPropagation();
                const newText = $textarea.val();
                
                // 将编辑后的合并文本写入第一个选中块中
                const targetIdx = sortedBlockIndices[0];
                blocks[targetIdx].current = newText;
                blocks[targetIdx].isEdited = true;
                blocks[targetIdx].isDeleted = false; // edited overrides deletion
                
                // 将其余被合并编辑的块以及中间的空白/空白行段落标记为删除，防止保存后产生多余空行
                const lastIdx = sortedBlockIndices[sortedBlockIndices.length - 1];
                for (let i = targetIdx + 1; i <= lastIdx; i++) {
                    if (sortedBlockIndices.includes(i) || blocks[i].current.trim() === '') {
                        blocks[i].isDeleted = true;
                    }
                }

                updateDomStates();
                closeModal();
            });
        } catch (err) {
            console.error("TwT: Error opening paragraph editor:", err);
            if (typeof toastr !== 'undefined') {
                toastr.error(`打开编辑器失败: ${err.message}`);
            } else {
                alert(`打开编辑器失败: ${err.message}`);
            }
        }
    });

    // ── 保存所有修改 ───────────────────────────────────────────────
    $toolbar.find('#twt-p-save').on('click', async (e) => {
        e.stopPropagation();

        const openModalEl = parentDoc.getElementById('twt-p-modal');
        if (openModalEl) {
            const $openModal = $(openModalEl);
            const $ta = $openModal.find('.twt-p-modal-textarea');
            const $sel = $mesText.find('.twt-p-selectable.twt-p-selected');
            if ($sel.length === 1) {
                const idx = Number($sel.attr('data-twt-block-idx'));
                if (!isNaN(idx)) {
                    blocks[idx].current = $ta.val();
                    blocks[idx].isEdited = true;
                    blocks[idx].isDeleted = false;
                }
            }
            openModalEl.remove();
        }

        // 重新组合成完整文本
        const finalBlocks = [];
        blocks.forEach(block => {
            if (block.isDeleted) return;
            if (block.isEdited) {
                finalBlocks.push(block.current);
            } else {
                finalBlocks.push(block.original);
            }
        });

        const finalContent = finalBlocks.join('\n');
        
        // 更新消息对象的原始文本
        message.mes = finalContent;

        // 退出编辑模式
        exitEditMode();
        
        // 让酒馆重新渲染消息块并保存
        await context.updateMessageBlock(mesId, message, { rerenderMessage: true });
        await context.saveChat();
    });
}

// ==========================================
// 小说段评 (本段说/吐槽) 功能模块
// ==========================================

function performDpAlignment(visibleBlocks, $elements) {
    const N = visibleBlocks.length;
    const M = $elements.length;
    const dp = Array.from({ length: N + 1 }, () => Array(M + 1).fill(0));
    const parent = Array.from({ length: N + 1 }, () => Array(M + 1).fill(''));
    
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            const block = visibleBlocks[i - 1];
            const $el = $elements[j - 1];
            const sim = getBlockDomSimilarity(block, $el);
            
            let matchScore = -1;
            if (sim > 0.05 || (block.type === 'hr' && sim > 0)) {
                matchScore = dp[i - 1][j - 1] + sim;
            }
            
            const skipBlockScore = dp[i - 1][j];
            const skipDomScore = dp[i][j - 1];
            
            if (matchScore >= skipBlockScore && matchScore >= skipDomScore) {
                dp[i][j] = matchScore;
                parent[i][j] = 'match';
            } else if (skipBlockScore >= skipDomScore) {
                dp[i][j] = skipBlockScore;
                parent[i][j] = 'skip_block';
            } else {
                dp[i][j] = skipDomScore;
                parent[i][j] = 'skip_dom';
            }
        }
    }
    
    let i = N;
    let j = M;
    const alignment = new Array(M).fill(-1);
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && parent[i][j] === 'match') {
            alignment[j - 1] = i - 1;
            i--;
            j--;
        } else if (i > 0 && (j === 0 || parent[i][j] === 'skip_block')) {
            i--;
        } else {
            j--;
        }
    }
    return alignment;
}

function getParagraphHash(str) {
    if (!str) return '';
    const clean = str.replace(/[\s\r\n\p{P}\p{S}]/gu, "").toLowerCase();
    return clean.substring(0, 30);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}

// 随机网友昵称生成器
const NETIZEN_NAMES = [
    '纯爱战神', '催更狂魔', '吃瓜群众', '咸鱼翻身', '熬夜修仙党',
    '中二少年', '路过的大佬', '佛系读者', '剧情分析师', '发刀片专业户',
    '细节怪', '列文虎克', '追更小达人', '前排卖瓜子', '狗粮收割机',
    '考据党', '暴风哭泣', '磕CP的', '代入感极强', '情绪管理失败',
    '今日份快乐', '通宵选手', '默默潜水', '冒泡冒泡', '预言家',
    '被虐到麻木', '甜党', '刀党', '氛围感拉满', '沉浸式阅读'
];

function getRandomNetizenName() {
    const name = NETIZEN_NAMES[Math.floor(Math.random() * NETIZEN_NAMES.length)];
    const num = Math.floor(10 + Math.random() * 989);
    return `${name}_${num}`;
}

/**
 * 获取消息的可见段落块（统一应用正则过滤）
 */
function getMessageVisibleBlocks(message, settings) {
    const useFiltered = settings.menuOptEditFiltered ?? false;
    let messageText = message.mes || '';
    if (useFiltered) {
        const placement = message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        messageText = getRegexedString(messageText, placement, { isMarkdown: true });
    }
    const whitelistStr = settings.paragraphXmlWhitelist || 'thought, TavernThought, reasoning, details';
    const whitelist = whitelistStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const blocks = parseMarkdownToBlocks(messageText, whitelist);
    return blocks.filter(b => b.isVisible);
}


export function renderCommentsForMessage(mesId) {
    const context = getContext();
    const message = context?.chat?.[mesId];
    if (!message) return;

    const settings = extension_settings.twt || {};
    const commentsList = message.extra?.twt_comments;
    const hasComments = Boolean(settings.commentsEnabled && Array.isArray(commentsList) && commentsList.length > 0);

    const mesEl = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (!mesEl) return;

    // 快速路径：若本条消息无段评，仅在确有残留角标时清理，彻底跳过 jQuery 包装与 DP 段落对齐计算
    if (!hasComments) {
        if (mesEl.querySelector('.twt-comment-badge')) {
            mesEl.querySelectorAll('.twt-comment-badge').forEach(b => b.remove());
        }
        return;
    }

    const $mes = $(mesEl);
    const $mesText = $mes.find('.mes_text');
    if (!$mesText.length) return;

    // 清理旧的气泡角标
    $mesText.find('.twt-comment-badge').remove();

    // 对齐 DOM
    const $elements = getSelectableElements($mesText);
    const visibleBlocks = getMessageVisibleBlocks(message, settings);

    const alignment = performDpAlignment(visibleBlocks, $elements);

    // 渲染各个段评的角标
    commentsList.forEach(entry => {
        if (!entry.comments || entry.comments.length === 0) return;

        let matchedBlockIdx = -1;
        if (entry.hash) {
            matchedBlockIdx = visibleBlocks.findIndex(b => getParagraphHash(b.original) === entry.hash);
        }
        if (matchedBlockIdx === -1 && entry.paragraph_index !== undefined) {
            if (entry.paragraph_index < visibleBlocks.length) {
                matchedBlockIdx = entry.paragraph_index;
            }
        }

        if (matchedBlockIdx !== -1) {
            const domIdx = alignment.indexOf(matchedBlockIdx);
            if (domIdx !== -1) {
                const $el = $elements[domIdx];
                if ($el && $el.length) {
                    if ($el.css('position') === 'static') {
                        $el.css('position', 'relative');
                    }
                    const count = entry.comments.length;
                    const $badge = $(`<span class="twt-comment-badge" data-mes-id="${mesId}" data-para-id="${matchedBlockIdx}" style="padding: 2px; border-radius: 50%; width: 18px; height: 18px; box-shadow: none; border: none; background: transparent;"><i class="fa-regular fa-comment-dots" style="font-size: 13px;"></i></span>`);
                    
                    $badge.on('click', (e) => {
                        e.stopPropagation();
                        openCommentDrawer(mesId, matchedBlockIdx);
                    });

                    $el.append($badge);
                }
            }
        }
    });
}

export function renderCommentsForAllVisibleMessages() {
    const visibleMesEls = document.querySelectorAll('#chat .mes:not([data-twt-win-hidden])');
    visibleMesEls.forEach(mesEl => {
        const mesId = parseInt(mesEl.getAttribute('mesid'));
        if (!isNaN(mesId)) {
            renderCommentsForMessage(mesId);
        }
    });
}
window.twtRenderCommentsForMes = renderCommentsForMessage;

// AI 接口请求模块
async function requestAICommentsForParagraphs(paragraphs, presetName) {
    const context = getContext();
    const settings = extension_settings.twt || {};
    const presetMessages = settings.commentsPromptPresets[presetName] || [];
    
    // 构造编号段落文本
    const formattedParagraphs = paragraphs.map(p => `[Para_ID: ${p.id}] ${p.text}`).join('\n');

    // 专属正则过滤规则应用函数
    function applyCommentsRegexFilters(text) {
        if (!text) return '';
        const filters = settings.commentsRegexFilters || [];
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

    // 获取实际前文历史（默认为最近的5条聊天记录）
    let rawContextHistory = '';
    if (context.chat && context.chat.length > 0) {
        const lastMessages = context.chat.slice(-5);
        rawContextHistory = lastMessages.map(msg => {
            const sender = msg.is_user ? (context.name1 || 'User') : (context.name2 || 'Char');
            return `${sender}: ${msg.mes || ''}`;
        }).join('\n\n');
    }

    const filteredContextHistory = applyCommentsRegexFilters(rawContextHistory);
    
    const messages = presetMessages
        .filter(m => m.enabled !== false)
        .map(m => {
            const content = (m.content || '')
                .replace(/{{paragraphs_input}}/g, formattedParagraphs)
                .replace(/{{context_history}}/g, filteredContextHistory)
                .replace(/{{char}}/g, context.name2 || '')
                .replace(/{{user}}/g, context.name1 || '');
            return {
                role: m.role,
                content: content
            };
        });

    if (messages.length === 0) {
        throw new Error('当前提示词预设没有包含任何已启用的消息项。');
    }

    const selectedApiId = settings.commentsSelectedApiId || 'main';
    let responseText = '';

    if (selectedApiId === 'main') {
        responseText = await getContext().generateRaw({
            prompt: messages,
            quietToLoud: false,
            instructOverride: true,
            systemPrompt: ''
        });
    } else {
        const apis = settings.commentsApis || [];
        const api = apis.find(a => a.id === selectedApiId);
        if (!api || !api.url) {
            throw new Error('未找到当前选中的独立 API 接口或接口 URL 为空，请在设置中检查！');
        }

        const headers = {
            'Content-Type': 'application/json'
        };
        if (api.key) {
            headers['Authorization'] = `Bearer ${api.key}`;
        }

        const response = await fetch(`${api.url}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: api.model,
                messages: messages,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`独立 API 失败 (${response.status}): ${errText}`);
        }

        const json = await response.json();
        responseText = json.choices?.[0]?.message?.content || '';
    }

    // 返回解析结果和实际发送的提示词消息列表（供日志记录用）
    return { comments: parseJsonComments(responseText), sentMessages: messages, rawResponse: responseText };
}

function parseJsonComments(text) {
    if (!text) return [];
    
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

    const startIdx = jsonStr.indexOf('[');
    const endIdx = jsonStr.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
    }

    try {
        const parsed = JSON.parse(jsonStr.trim());
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        console.warn('Failed to parse JSON comments directly, trying regex extraction:', e, text);
    }

    const results = [];
    // 更宽松的回退：逐个匹配 JSON 对象块，提取 para_id / author / comment
    const objRegex = /\{[^{}]*\}/g;
    let objMatch;
    while ((objMatch = objRegex.exec(text)) !== null) {
        const obj = objMatch[0];
        const idM = obj.match(/"para_id"\s*:\s*(\d+)/);
        const commentM = obj.match(/"comment"\s*:\s*"([^"]+)"/);
        const authorM = obj.match(/"author"\s*:\s*"([^"]+)"/);
        if (idM && commentM) {
            results.push({
                para_id: parseInt(idM[1]),
                author: authorM ? authorM[1] : undefined,
                comment: commentM[1]
            });
        }
    }
    return results;
}

export async function triggerBatchCommentsForMessage(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    if (typeof toastr !== 'undefined') {
        toastr.info('正在生成段评，请稍候...', '提示');
    }

    try {
        const settings = extension_settings.twt || {};
        const visibleBlocks = getMessageVisibleBlocks(message, settings);

        if (visibleBlocks.length === 0) {
            toastr.warning('本条消息中没有可生成段评的段落！', '提示');
            return;
        }

        const paragraphs = visibleBlocks.map((b, idx) => ({
            id: idx,
            text: b.original
        }));

        const presetName = settings.commentsCurrentPreset || '网络读者弹幕吐槽';
        const aiComments = await requestAICommentsForParagraphs(paragraphs, presetName);

        if (aiComments.length === 0) {
            toastr.info('AI 未针对本条消息的段落生成任何段评。', '提示');
            return;
        }

        if (!message.extra) message.extra = {};
        if (!message.extra.twt_comments) message.extra.twt_comments = [];

        aiComments.forEach(item => {
            const idx = parseInt(item.para_id);
            const text = item.comment;
            if (isNaN(idx) || idx < 0 || idx >= visibleBlocks.length || !text) return;

            const block = visibleBlocks[idx];
            const hash = getParagraphHash(block.original);

            let entry = message.extra.twt_comments.find(c => c.paragraph_index === idx || c.hash === hash);
            if (!entry) {
                entry = {
                    paragraph_index: idx,
                    hash: hash,
                    comments: []
                };
                message.extra.twt_comments.push(entry);
            }

            entry.comments.push({
                author: item.author || getRandomNetizenName(),
                text: text,
                timestamp: Date.now(),
                type: 'ai'
            });
        });

        await context.updateMessageBlock(mesId, message, { rerenderMessage: false });
        await context.saveChat();

        renderCommentsForMessage(mesId);
        toastr.success('段评生成完毕！', '成功');
    } catch (err) {
        console.error('Failed to generate comments:', err);
        toastr.error(`段评生成失败: ${err.message || err}`, '错误');
    }
}

export async function triggerBatchCommentsForMessages(selectedIds, onProgress, onLog) {
    const total = selectedIds.length;
    for (let i = 0; i < total; i++) {
        const mesId = selectedIds[i];
        if (typeof onProgress === 'function') {
            onProgress(i + 1, total);
        }
        const logEntry = await triggerBatchCommentsForMessageSilently(mesId);
        if (typeof onLog === 'function') {
            onLog(mesId, logEntry);
        }
    }
}

async function triggerBatchCommentsForMessageSilently(mesId) {
    const context = getContext();
    const message = context.chat[mesId];
    // 日志条目
    const logEntry = { mesId, status: 'ok', sentMessages: [], rawResponse: '', commentsCount: 0, error: null };
    if (!message) {
        logEntry.status = 'skip';
        logEntry.error = '消息不存在';
        return logEntry;
    }

    try {
        const settings = extension_settings.twt || {};
        const visibleBlocks = getMessageVisibleBlocks(message, settings);

        if (visibleBlocks.length === 0) {
            logEntry.status = 'skip';
            logEntry.error = '没有可见段落';
            return logEntry;
        }

        const paragraphs = visibleBlocks.map((b, idx) => ({
            id: idx,
            text: b.original
        }));

        const presetName = settings.commentsCurrentPreset || '网络读者弹幕吐槽';
        const result = await requestAICommentsForParagraphs(paragraphs, presetName);
        logEntry.sentMessages = result.sentMessages || [];
        logEntry.rawResponse = result.rawResponse || '';
        const aiComments = result.comments || [];

        if (aiComments.length === 0) {
            logEntry.status = 'empty';
            logEntry.error = 'AI 未返回任何有效段评';
            return logEntry;
        }

        if (!message.extra) message.extra = {};
        if (!message.extra.twt_comments) message.extra.twt_comments = [];

        aiComments.forEach(item => {
            const idx = parseInt(item.para_id);
            const text = item.comment;
            if (isNaN(idx) || idx < 0 || idx >= visibleBlocks.length || !text) return;

            const block = visibleBlocks[idx];
            const hash = getParagraphHash(block.original);

            let entry = message.extra.twt_comments.find(c => c.paragraph_index === idx || c.hash === hash);
            if (!entry) {
                entry = {
                    paragraph_index: idx,
                    hash: hash,
                    comments: []
                };
                message.extra.twt_comments.push(entry);
            }

            entry.comments.push({
                author: item.author || getRandomNetizenName(),
                text: text,
                timestamp: Date.now(),
                type: 'ai'
            });
            logEntry.commentsCount++;
        });

        await context.updateMessageBlock(mesId, message, { rerenderMessage: false });
        await context.saveChat();
        renderCommentsForMessage(mesId);
    } catch (err) {
        console.error(`Failed to generate comments for message #${mesId}:`, err);
        logEntry.status = 'error';
        logEntry.error = err.message || String(err);
    }
    return logEntry;
}

export function openCommentDrawer(mesId, paragraphIdx) {
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) return;

    let drawerEl = parentDoc.getElementById('twt-comment-drawer');
    if (drawerEl) {
        drawerEl.remove();
    }

    const settings = extension_settings.twt || {};
    const visibleBlocks = getMessageVisibleBlocks(message, settings);
    const blockText = visibleBlocks[paragraphIdx] ? visibleBlocks[paragraphIdx].original : '';
    const cleanText = blockText.trim();
    const excerpt = cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;

    drawerEl = parentDoc.createElement('div');
    drawerEl.id = 'twt-comment-drawer';
    drawerEl.className = 'twt-comment-drawer-overlay';
    
    // Read layout options
    const position = settings.commentsDrawerPosition || 'right';
    const widthPercentage = settings.commentsDrawerWidth || 35;

    // Apply layout positions & widths
    let overlayStyle = '';
    let boxStyle = '';
    
    if (position === 'left') {
        overlayStyle = 'justify-content: flex-start;';
        boxStyle = `width: ${widthPercentage}vw; max-width: none; border-right: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15)); border-left: none; transform: translate3d(-100%, 0, 0);`;
    } else if (position === 'center') {
        overlayStyle = 'justify-content: center; align-items: center;';
        boxStyle = `width: ${widthPercentage}vw; height: auto; max-height: 85vh; max-width: none; border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15)); border-radius: 12px; transform: scale(0.9); transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s; opacity: 0;`;
    } else {
        // default right
        overlayStyle = 'justify-content: flex-end;';
        boxStyle = `width: ${widthPercentage}vw; max-width: none; border-left: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15)); transform: translate3d(100%, 0, 0);`;
    }

    drawerEl.setAttribute('style', overlayStyle);

    drawerEl.innerHTML = `
        <div class="twt-comment-drawer-box" style="${boxStyle}">
            <div class="twt-comment-drawer-header">
                <div class="twt-comment-drawer-title">
                    <i class="fa-regular fa-comments"></i> 段评
                </div>
                <button class="twt-comment-drawer-close-btn" title="关闭"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="twt-comment-drawer-preview">
                “ ${excerpt} ”
            </div>
            <div class="twt-comment-drawer-list" id="twt-comment-list-container">
            </div>
            <div class="twt-comment-drawer-footer folded" style="padding: 6px 12px;">
                <!-- 折叠时显示的极其狭小、扁平的图标触控条 -->
                <div class="twt-comment-footer-toggle-bar" style="cursor: pointer; padding: 2px; text-align: center; font-size: 0.75em; opacity: 0.5; background: rgba(255,255,255,0.03); border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 4px; width: 32px; margin: 0 auto;">
                    <i class="fa-solid fa-chevron-up"></i>
                </div>
                <!-- 展开后显示的编辑与发送区域 -->
                <div class="twt-comment-footer-expanded-content" style="display: none; flex-direction: column; gap: 10px; width: 100%;">
                    <div class="twt-comment-input-row">
                        <textarea class="twt-comment-textarea" placeholder="写一句段评... (Ctrl+Enter 发送)"></textarea>
                    </div>
                    <div class="twt-comment-actions-row" style="display: flex; gap: 8px; justify-content: space-between; align-items: center;">
                        <button class="twt-comment-action-btn btn-ai" id="twt-btn-ai-single" title="用当前提示词生成AI吐槽" style="flex: 1;"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 吐槽</button>
                        <button class="twt-comment-action-btn btn-send" id="twt-btn-comment-send" style="flex: 1;"><i class="fa-solid fa-paper-plane"></i> 发送</button>
                        <button class="menu_button twt-comment-footer-collapse-btn" title="收起" style="padding: 4px 8px; margin: 0; background: transparent; border: 1px solid var(--SmartThemeBorderColor); display: inline-flex; align-items: center; justify-content: center; font-size: 0.8em; border-radius: 4px;"><i class="fa-solid fa-chevron-down"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    parentDoc.body.appendChild(drawerEl);

    const $drawer = $(drawerEl);
    requestAnimationFrame(() => {
        $drawer.addClass('active');
        if (position === 'center') {
            $drawer.find('.twt-comment-drawer-box').css({
                'transform': 'scale(1)',
                'opacity': '1'
            });
        } else {
            $drawer.find('.twt-comment-drawer-box').css('transform', 'translate3d(0, 0, 0)');
        }
    });

    const closeDrawer = () => {
        $drawer.removeClass('active');
        if (position === 'center') {
            $drawer.find('.twt-comment-drawer-box').css({
                'transform': 'scale(0.9)',
                'opacity': '0'
            });
        } else if (position === 'left') {
            $drawer.find('.twt-comment-drawer-box').css('transform', 'translate3d(-100%, 0, 0)');
        } else {
            $drawer.find('.twt-comment-drawer-box').css('transform', 'translate3d(100%, 0, 0)');
        }
        setTimeout(() => {
            $drawer.remove();
        }, 300);
    };

    $drawer.find('.twt-comment-drawer-close-btn').on('click', closeDrawer);
    $drawer.on('click', (e) => {
        if (e.target === drawerEl) {
            closeDrawer();
        }
    });

    const renderCommentsList = () => {
        const listContainer = $drawer.find('#twt-comment-list-container');
        listContainer.empty();

        const commentsData = message.extra?.twt_comments || [];
        const entry = commentsData.find(c => c.paragraph_index === paragraphIdx || c.hash === getParagraphHash(blockText));
        const list = entry ? entry.comments : [];

        if (list.length === 0) {
            listContainer.append(`
                <div class="twt-comment-empty-hint">
                    还没有人发表过吐槽，点击下方按钮或自己写一个吧！
                </div>
            `);
            return;
        }

        list.forEach((item, idx) => {
            // Filter out file name or character details brackets e.g. name (current_chat_file)
            let authorName = item.author || '匿名';
            authorName = authorName.replace(/\s*\([^)]*\)/g, '');
            const commentItem = $(`
                <div class="twt-comment-item">
                    <div class="twt-comment-item-header">
                        <span class="twt-comment-item-author">${authorName}</span>
                    </div>
                    <div class="twt-comment-item-body">
                        ${escapeHtml(item.text)}
                    </div>
                    <button class="twt-comment-item-delete" data-idx="${idx}" title="删除此吐槽"><i class="fa-regular fa-trash-can"></i></button>
                </div>
            `);

            commentItem.find('.twt-comment-item-delete').on('click', async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这条吐槽吗？')) {
                    list.splice(idx, 1);
                    if (list.length === 0) {
                        const index = commentsData.indexOf(entry);
                        if (index !== -1) {
                            commentsData.splice(index, 1);
                        }
                    }
                    message.extra.twt_comments = commentsData;
                    await context.updateMessageBlock(mesId, message, { rerenderMessage: false });
                    await context.saveChat();
                    renderCommentsList();
                    renderCommentsForMessage(mesId);
                }
            });

            listContainer.append(commentItem);
        });
        
        listContainer.scrollTop(listContainer[0].scrollHeight);
    };

    renderCommentsList();

    // Footer fold/unfold interaction
    const $footer = $drawer.find('.twt-comment-drawer-footer');
    const $toggleBar = $drawer.find('.twt-comment-footer-toggle-bar');
    const $expandedContent = $drawer.find('.twt-comment-footer-expanded-content');
    const $collapseBtn = $drawer.find('.twt-comment-footer-collapse-btn');

    $toggleBar.on('click', () => {
        $toggleBar.hide();
        $expandedContent.css('display', 'flex');
        $footer.removeClass('folded');
        $drawer.find('.twt-comment-textarea').focus();
    });

    $collapseBtn.on('click', () => {
        $expandedContent.hide();
        $toggleBar.show();
        $footer.addClass('folded');
    });

    const sendComment = async () => {
        const text = $drawer.find('.twt-comment-textarea').val().trim();
        if (!text) return;

        if (!message.extra) message.extra = {};
        if (!message.extra.twt_comments) message.extra.twt_comments = [];

        const hash = getParagraphHash(blockText);
        let entry = message.extra.twt_comments.find(c => c.paragraph_index === paragraphIdx || c.hash === hash);
        if (!entry) {
            entry = {
                paragraph_index: paragraphIdx,
                hash: hash,
                comments: []
            };
            message.extra.twt_comments.push(entry);
        }

        entry.comments.push({
            author: '我',
            text: text,
            timestamp: Date.now(),
            type: 'user'
        });

        await context.updateMessageBlock(mesId, message, { rerenderMessage: false });
        await context.saveChat();

        $drawer.find('.twt-comment-textarea').val('');
        
        // Auto fold footer on submit
        $expandedContent.hide();
        $toggleBar.show();
        $footer.addClass('folded');

        renderCommentsList();
        renderCommentsForMessage(mesId);
    };

    $drawer.find('#twt-btn-comment-send').on('click', sendComment);
    $drawer.find('.twt-comment-textarea').on('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            sendComment();
        }
    });

    $drawer.find('#twt-btn-ai-single').on('click', async () => {
        const btn = $drawer.find('#twt-btn-ai-single');
        btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 生成中...');

        try {
            const paragraphs = [{ id: paragraphIdx, text: blockText }];
            const presetName = settings.commentsCurrentPreset || '网络读者弹幕吐槽';
            const aiComments = await requestAICommentsForParagraphs(paragraphs, presetName);

            // Filter out empty comments
            const validComments = aiComments.filter(item => item && item.comment);

            if (validComments.length === 0) {
                toastr.info('AI 没有为此段落生成任何有效的段评，请重试。', '提示');
                return;
            }

            if (!message.extra) message.extra = {};
            if (!message.extra.twt_comments) message.extra.twt_comments = [];

            const hash = getParagraphHash(blockText);
            let entry = message.extra.twt_comments.find(c => c.paragraph_index === paragraphIdx || c.hash === hash);
            if (!entry) {
                entry = {
                    paragraph_index: paragraphIdx,
                    hash: hash,
                    comments: []
                };
                message.extra.twt_comments.push(entry);
            }

            // Loop and add all generated comments
            validComments.forEach(item => {
                entry.comments.push({
                    author: item.author || getRandomNetizenName(),
                    text: item.comment,
                    timestamp: Date.now(),
                    type: 'ai'
                });
            });

            await context.updateMessageBlock(mesId, message, { rerenderMessage: false });
            await context.saveChat();
            renderCommentsList();
            renderCommentsForMessage(mesId);
        } catch (err) {
            console.error('Failed to generate single AI comment:', err);
            toastr.error(`生成失败: ${err.message || err}`);
        } finally {
            btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> AI 吐槽');
        }
    });
}

window.twtRefreshComments = () => {
    renderCommentsForAllVisibleMessages();
};

// 双击段落开启间贴评论
$(document).on('dblclick', '#chat .mes_text .twt-p-line-wrapper, #chat .mes_text p, #chat .mes_text li, #chat .mes_text blockquote, #chat .mes_text pre', function(e) {
    if (!extension_settings.twt || !extension_settings.twt.commentsEnabled) return;
    // 连续快速点按翻页会被浏览器当成双击，刚翻过页的双击不打开段评
    if (Date.now() - (window.__twtLastUserFlipTime || 0) < 800) return;
    if ($(e.target).closest('button, a, input, textarea, select, .twt-comment-badge, .twt-p-toolbar-wrap, .twt-range-modal-overlay').length) return;
    
    const $el = $(this);
    const $mes = $el.closest('.mes');
    const mesId = parseInt($mes.attr('mesid'));
    if (isNaN(mesId)) return;

    const $mesText = $mes.find('.mes_text');
    const $elements = getSelectableElements($mesText);
    
    let foundIdx = -1;
    for (let k = 0; k < $elements.length; k++) {
        if ($elements[k][0] === $el[0]) {
            foundIdx = k;
            break;
        }
    }
    if (foundIdx === -1) return;

    const settings = extension_settings.twt || {};
    const message = getContext().chat[mesId];
    if (!message) return;
    const visibleBlocks = getMessageVisibleBlocks(message, settings);
    const alignment = performDpAlignment(visibleBlocks, $elements);
    const matchedBlockIdx = alignment[foundIdx];

    if (matchedBlockIdx !== undefined && matchedBlockIdx !== -1) {
        openCommentDrawer(mesId, matchedBlockIdx);
    }
});

// 注册消息渲染和聊天变动监听
try {
    const context = getContext();
    if (context && context.eventSource) {
        context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, (mesId) => {
            renderCommentsForMessage(mesId);
        });
        let commentsRenderTimer = null;
        const scheduleRenderComments = () => {
            clearTimeout(commentsRenderTimer);
            commentsRenderTimer = setTimeout(() => {
                renderCommentsForAllVisibleMessages();
            }, 180);
        };
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, scheduleRenderComments);
        context.eventSource.on(context.eventTypes.MORE_MESSAGES_LOADED, scheduleRenderComments);
    }
} catch (e) {
    console.error("TwT: Failed to register event listeners in paragraph.js", e);
}