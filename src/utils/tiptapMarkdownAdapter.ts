import { BlockFormat, parseMarkdownToData } from './markdownUtils';
import {
    isDefaultHighlightColor,
    normalizeHighlightColorForCss,
} from './highlightColors';
import {
    VOICE_PROCESSING_LABEL,
    getVoiceProcessingText,
    isVoiceProcessingMarkerLine,
} from './voiceDraft';
import {
    AUDIO_EMBED_NODE_NAME,
    buildAudioEmbedHtml,
} from './audioEmbeds';

type TiptapMark = {
    type: string;
    attrs?: Record<string, unknown>;
};

export type TiptapNode = {
    type: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: TiptapMark[];
    content?: TiptapNode[];
};

type TiptapDocument = {
    type: 'doc';
    content: TiptapNode[];
};

const AUDIO_TITLE_PREFIX = 'vaulto-audio:';
const PROCESSING_TITLE_PREFIX = 'vaulto-processing:';
const PROCESSING_PREVIEW_SVG = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="124" viewBox="0 0 680 124">
<rect x="2" y="2" width="676" height="120" rx="24" fill="#FFF7E8" stroke="#E8D5A8" stroke-width="4"/>
<circle cx="74" cy="62" r="22" fill="#C58B2A"/>
<circle cx="74" cy="62" r="8" fill="#ffffff"/>
<text x="126" y="54" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#4F3B15">Processing voice note</text>
<text x="126" y="84" font-family="Arial, sans-serif" font-size="18" fill="#7A6336">The transcript placeholder will be replaced automatically</text>
</svg>`
);
const PROCESSING_PREVIEW_DATA_URI = `data:image/svg+xml;charset=utf-8,${PROCESSING_PREVIEW_SVG}`;

const TODO_REGEX = /^(\s*-\s\[(?:([ xX])?)\]\s)(.*)$/;
const ORDERED_REGEX = /^(\s*)(\d+)\.\s+(.*)$/;
const BULLET_REGEX = /^(\s*)[-*]\s+(.*)$/;
const BLOCKQUOTE_REGEX = /^\s*>\s?(.*)$/;

const MARK_ORDER = ['code', 'highlight', 'bold', 'italic', 'underline', 'strikethrough'] as const;

const buildPreviewImageNode = (
    src: string,
    titlePrefix: string,
    value: string,
    alt: string
): TiptapNode => ({
    type: 'image',
    attrs: {
        src,
        alt,
        title: `${titlePrefix}${encodeURIComponent(value)}`,
    },
});

const getImageTitleValue = (node: TiptapNode, prefix: string) => {
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
    if (!title.startsWith(prefix)) {
        return null;
    }

    try {
        return decodeURIComponent(title.slice(prefix.length));
    } catch {
        return title.slice(prefix.length);
    }
};

const getMarkPriority = (type: string) => {
    const priority = MARK_ORDER.indexOf(type as (typeof MARK_ORDER)[number]);
    return priority === -1 ? MARK_ORDER.length : priority;
};

const escapeHtml = (text: string): string =>
    text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const escapeHtmlAttribute = (value: string): string =>
    escapeHtml(value).replace(/`/g, '&#96;');

const getMarksForRange = (formats: BlockFormat[], start: number, end: number): TiptapMark[] | undefined => {
    const activeFormats = formats
        .filter((format) => format.start <= start && format.end >= end)
        .sort((left, right) => getMarkPriority(left.type) - getMarkPriority(right.type))
        .map<TiptapMark>((format) => {
            if (format.type === 'highlight') {
                return {
                    type: 'highlight',
                    attrs: { color: normalizeHighlightColorForCss(format.data || 'yellow') },
                };
            }

            if (format.type === 'strikethrough') {
                return { type: 'strike' };
            }

            return { type: format.type };
        });

    return activeFormats.length > 0 ? activeFormats : undefined;
};

const inlineMarkdownToNodes = (markdown: string): TiptapNode[] | undefined => {
    const { content, formats } = parseMarkdownToData(markdown);
    if (!content) {
        return undefined;
    }

    const boundaries = new Set<number>([0, content.length]);
    formats.forEach((format) => {
        boundaries.add(Math.max(0, Math.min(format.start, content.length)));
        boundaries.add(Math.max(0, Math.min(format.end, content.length)));
    });

    const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
    const nodes: TiptapNode[] = [];

    for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
        const start = sortedBoundaries[index];
        const end = sortedBoundaries[index + 1];
        if (start === end) {
            continue;
        }

        const text = content.slice(start, end);
        if (!text) {
            continue;
        }

        nodes.push({
            type: 'text',
            text,
            marks: getMarksForRange(formats, start, end),
        });
    }

    return nodes.length > 0 ? nodes : undefined;
};

const wrapTextWithMarks = (text: string, marks?: TiptapMark[]): string => {
    if (!marks || marks.length === 0) {
        return text;
    }

    return [...marks].sort((left, right) => getMarkPriority(left.type) - getMarkPriority(right.type)).reduce((current, mark) => {
        switch (mark.type) {
            case 'bold':
                return `**${current}**`;
            case 'italic':
                return `_${current}_`;
            case 'strike':
                return `~~${current}~~`;
            case 'underline':
                return `<u>${current}</u>`;
            case 'code':
                return `\`${current}\``;
            case 'highlight': {
                const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : 'yellow';
                return isDefaultHighlightColor(color)
                    ? `==${current}==`
                    : `==${normalizeHighlightColorForCss(color)}:${current}==`;
            }
            case 'link': {
                const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
                return href ? `[${current}](${href})` : current;
            }
            default:
                return current;
        }
    }, text);
};

const inlineNodesToMarkdown = (nodes?: TiptapNode[]): string => {
    if (!nodes || nodes.length === 0) {
        return '';
    }

    return nodes.map((node) => {
        if (node.type === 'text') {
            return wrapTextWithMarks(node.text || '', node.marks);
        }

        if (node.type === 'hardBreak') {
            return '\n';
        }

        if (node.type === 'image') {
            const audioPath = getImageTitleValue(node, AUDIO_TITLE_PREFIX);
            if (audioPath) {
                return `![audio](${audioPath})`;
            }

            const processingText = getImageTitleValue(node, PROCESSING_TITLE_PREFIX);
            if (processingText !== null) {
                return `![processing](${encodeURIComponent(processingText)})`;
            }

            return '';
        }

        return inlineNodesToMarkdown(node.content);
    }).join('');
};

const wrapTextWithHtmlMarks = (text: string, marks?: TiptapMark[]): string => {
    if (!marks || marks.length === 0) {
        return escapeHtml(text);
    }

    return [...marks]
        .sort((left, right) => getMarkPriority(left.type) - getMarkPriority(right.type))
        .reduce((current, mark) => {
            switch (mark.type) {
                case 'bold':
                    return `<strong>${current}</strong>`;
                case 'italic':
                    return `<em>${current}</em>`;
                case 'strike':
                    return `<s>${current}</s>`;
                case 'underline':
                    return `<u>${current}</u>`;
                case 'code':
                    return `<code>${current}</code>`;
                case 'highlight': {
                    const color = normalizeHighlightColorForCss(
                        typeof mark.attrs?.color === 'string' ? mark.attrs.color : 'yellow'
                    );
                    return `<mark data-color="${escapeHtmlAttribute(color)}" style="background-color: ${escapeHtmlAttribute(color)};">${current}</mark>`;
                }
                case 'link': {
                    const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
                    return href
                        ? `<a href="${escapeHtmlAttribute(href)}">${current}</a>`
                        : current;
                }
                default:
                    return current;
            }
        }, escapeHtml(text));
};

const inlineNodesToHtml = (nodes?: TiptapNode[]): string => {
    if (!nodes || nodes.length === 0) {
        return '';
    }

    return nodes.map((node) => {
        if (node.type === 'text') {
            return wrapTextWithHtmlMarks(node.text || '', node.marks);
        }

        if (node.type === 'hardBreak') {
            return '<br>';
        }

        if (node.type === 'image') {
            const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
            const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
            const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
            return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" title="${escapeHtmlAttribute(title)}">`;
        }

        return serializeNodeToHtml(node);
    }).join('');
};

const serializeNodeToHtml = (node: TiptapNode): string => {
    switch (node.type) {
        case 'paragraph': {
            const html = inlineNodesToHtml(node.content);
            return `<p>${html || '<br>'}</p>`;
        }
        case 'heading': {
            const level = Math.max(1, Math.min(Number(node.attrs?.level || 1), 6));
            const html = inlineNodesToHtml(node.content);
            return `<h${level}>${html || '<br>'}</h${level}>`;
        }
        case 'bulletList':
            return `<ul>${(node.content || []).map((child) => serializeNodeToHtml(child)).join('')}</ul>`;
        case 'orderedList': {
            const start = Number(node.attrs?.start || 1);
            const startAttr = start > 1 ? ` start="${start}"` : '';
            return `<ol${startAttr}>${(node.content || []).map((child) => serializeNodeToHtml(child)).join('')}</ol>`;
        }
        case 'taskList':
            return `<ul data-type="taskList">${(node.content || []).map((child) => serializeNodeToHtml(child)).join('')}</ul>`;
        case 'listItem':
            return `<li>${(node.content || []).map((child) => serializeNodeToHtml(child)).join('') || '<p><br></p>'}</li>`;
        case 'taskItem': {
            const checked = !!node.attrs?.checked;
            const checkedAttr = checked ? 'true' : 'false';
            const contentHtml = (node.content || []).map((child) => serializeNodeToHtml(child)).join('') || '<p><br></p>';
            return `<li data-type="taskItem" data-checked="${checkedAttr}">${contentHtml}</li>`;
        }
        case 'blockquote':
            return `<blockquote>${(node.content || []).map((child) => serializeNodeToHtml(child)).join('')}</blockquote>`;
        case 'image':
            return inlineNodesToHtml([node]);
        case AUDIO_EMBED_NODE_NAME:
            return buildAudioEmbedHtml({
                path: typeof node.attrs?.path === 'string' ? node.attrs.path : '',
                duration: typeof node.attrs?.duration === 'number' ? node.attrs.duration : null,
                src: typeof node.attrs?.src === 'string' ? node.attrs.src : null,
            }) || '<p></p>';
        default:
            return node.content ? node.content.map((child) => serializeNodeToHtml(child)).join('') : '';
    }
};

const createParagraphNode = (markdown: string): TiptapNode => {
    const content = inlineMarkdownToNodes(markdown);
    return content ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const createHeadingNode = (level: 1 | 2 | 3, markdown: string): TiptapNode => {
    const content = inlineMarkdownToNodes(markdown);
    return content
        ? { type: 'heading', attrs: { level }, content }
        : { type: 'heading', attrs: { level } };
};

const createListItemNode = (markdown: string): TiptapNode => ({
    type: 'listItem',
    content: [createParagraphNode(markdown)],
});

const createTaskItemNode = (markdown: string, checked: boolean): TiptapNode => ({
    type: 'taskItem',
    attrs: { checked },
    content: [createParagraphNode(markdown)],
});

const createAudioEmbedNode = (path: string): TiptapNode => ({
    type: AUDIO_EMBED_NODE_NAME,
    attrs: { path },
});

const paragraphContentToMarkdown = (node?: TiptapNode) => {
    if (!node) {
        return '';
    }

    if (node.type === 'paragraph' || node.type === 'heading') {
        return inlineNodesToMarkdown(node.content);
    }

    return inlineNodesToMarkdown(node.content);
};

const listItemParagraph = (node?: TiptapNode) => {
    if (!node?.content || node.content.length === 0) {
        return '';
    }

    const paragraphNode = node.content.find((child) => child.type === 'paragraph') || node.content[0];
    return paragraphContentToMarkdown(paragraphNode);
};

const serializeBlockNode = (node: TiptapNode, orderedStart = 1): string[] => {
    switch (node.type) {
        case 'paragraph':
            return [inlineNodesToMarkdown(node.content)];
        case 'heading': {
            const level = Number(node.attrs?.level || 1);
            const prefix = '#'.repeat(Math.max(1, Math.min(level, 6)));
            return [`${prefix} ${inlineNodesToMarkdown(node.content)}`.trimEnd()];
        }
        case 'bulletList':
            return (node.content || []).flatMap((item) => [`- ${listItemParagraph(item)}`]);
        case 'orderedList': {
            const start = Number(node.attrs?.start || orderedStart || 1);
            return (node.content || []).map((item, index) => `${start + index}. ${listItemParagraph(item)}`);
        }
        case 'taskList':
            return (node.content || []).flatMap((item) => {
                const checked = !!item.attrs?.checked;
                return [`- [${checked ? 'x' : ' '}] ${listItemParagraph(item)}`];
            });
        case 'blockquote':
            return (node.content || []).flatMap((child) => serializeBlockNode(child)).map((line) => `> ${line}`);
        case AUDIO_EMBED_NODE_NAME: {
            const path = typeof node.attrs?.path === 'string' ? node.attrs.path : '';
            return path ? [`![audio](${path})`] : [];
        }
        case 'image': {
            const audioPath = getImageTitleValue(node, AUDIO_TITLE_PREFIX);
            if (audioPath) {
                return [`![audio](${audioPath})`];
            }

            const processingText = getImageTitleValue(node, PROCESSING_TITLE_PREFIX);
            if (processingText !== null) {
                return [`![processing](${encodeURIComponent(processingText)})`];
            }

            return [];
        }
        default:
            return node.content ? node.content.flatMap((child) => serializeBlockNode(child)) : [];
    }
};

const removeMatchingNode = (node: TiptapNode, predicate: (candidate: TiptapNode) => boolean): TiptapNode | null => {
    if (predicate(node)) {
        return null;
    }

    if (!node.content) {
        return node;
    }

    const nextContent = node.content
        .map((child) => removeMatchingNode(child, predicate))
        .filter((child): child is TiptapNode => !!child);

    return {
        ...node,
        content: nextContent,
    };
};

export const getEditorPlaceholderCss = (
    baseFontSize: number,
    placeholder?: string
) => `
  html, body {
    margin: 0;
    padding: 0;
    background: ${'#ffffff'};
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: ${'#1f2937'};
    font-size: ${baseFontSize}px;
    line-height: ${Math.round(baseFontSize * 1.55)}px;
  }

  .ProseMirror {
    min-height: 120px;
    padding: 0 0 24px;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ProseMirror p {
    margin: 0;
    min-height: ${Math.round(baseFontSize * 1.55)}px;
  }

  .ProseMirror h1,
  .ProseMirror h2,
  .ProseMirror h3 {
    color: ${'#111827'};
    font-weight: 700;
  }

  .ProseMirror h1 {
    font-size: ${Math.round(baseFontSize * 1.28)}px;
    line-height: ${Math.round(baseFontSize * 1.65)}px;
    margin: 10px 0 6px;
  }

  .ProseMirror h2 {
    font-size: ${Math.round(baseFontSize * 1.16)}px;
    line-height: ${Math.round(baseFontSize * 1.58)}px;
    margin: 8px 0 5px;
  }

  .ProseMirror h3 {
    font-size: ${Math.round(baseFontSize * 1.08)}px;
    line-height: ${Math.round(baseFontSize * 1.52)}px;
    margin: 6px 0 4px;
  }

  .ProseMirror ul,
  .ProseMirror ol {
    padding-left: 1.35rem;
    margin: 0;
  }

  .ProseMirror li > p {
    margin: 0;
  }

  .ProseMirror ul[data-type="taskList"] {
    list-style: none;
    padding-left: 0.25rem;
  }

  .ProseMirror ul[data-type="taskList"] li {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .ProseMirror ul[data-type="taskList"] li label {
    margin-top: 0.2rem;
  }

  .ProseMirror img[alt="processing-preview"] {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 8px 0;
    border-radius: 18px;
  }

  .ProseMirror mark {
    padding: 0.04em 0.12em;
    border-radius: 0.22em;
  }

  ${placeholder ? `.ProseMirror p.is-editor-empty:first-child::before { color: #9CA3AF; content: "${placeholder.replace(/"/g, '\\"')}"; float: left; height: 0; pointer-events: none; }` : ''}
`;

export const markdownToTiptapDocument = (markdown: string): TiptapDocument => {
    const lines = markdown.split('\n');
    const content: TiptapNode[] = [];

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        const todoMatch = line.match(TODO_REGEX);
        const orderedMatch = line.match(ORDERED_REGEX);
        const bulletMatch = !todoMatch ? line.match(BULLET_REGEX) : null;
        const blockquoteMatch = line.match(BLOCKQUOTE_REGEX);
        const audioMatch = line.match(/^\s*!\[audio\]\((.*?)\)\s*$/);
        const header3Match = line.match(/^###\s+(.*)$/);
        const header2Match = line.match(/^##\s+(.*)$/);
        const header1Match = line.match(/^#\s+(.*)$/);

        if (audioMatch) {
            content.push(createAudioEmbedNode(audioMatch[1]));
            index += 1;
            continue;
        }

        if (isVoiceProcessingMarkerLine(line)) {
            content.push(
                buildPreviewImageNode(
                    PROCESSING_PREVIEW_DATA_URI,
                    PROCESSING_TITLE_PREFIX,
                    getVoiceProcessingText(line) || VOICE_PROCESSING_LABEL,
                    'processing-preview'
                )
            );
            index += 1;
            continue;
        }

        if (header3Match) {
            content.push(createHeadingNode(3, header3Match[1]));
            index += 1;
            continue;
        }

        if (header2Match) {
            content.push(createHeadingNode(2, header2Match[1]));
            index += 1;
            continue;
        }

        if (header1Match) {
            content.push(createHeadingNode(1, header1Match[1]));
            index += 1;
            continue;
        }

        if (todoMatch) {
            const items: TiptapNode[] = [];
            while (index < lines.length) {
                const candidate = lines[index].match(TODO_REGEX);
                if (!candidate) {
                    break;
                }
                items.push(createTaskItemNode(candidate[3], candidate[2].toLowerCase() === 'x'));
                index += 1;
            }

            content.push({ type: 'taskList', content: items });
            continue;
        }

        if (orderedMatch) {
            const items: TiptapNode[] = [];
            const start = parseInt(orderedMatch[2], 10) || 1;
            while (index < lines.length) {
                const candidate = lines[index].match(ORDERED_REGEX);
                if (!candidate) {
                    break;
                }
                items.push(createListItemNode(candidate[3]));
                index += 1;
            }

            content.push({ type: 'orderedList', attrs: { start }, content: items });
            continue;
        }

        if (bulletMatch) {
            const items: TiptapNode[] = [];
            while (index < lines.length) {
                const candidate = lines[index].match(BULLET_REGEX);
                if (!candidate || TODO_REGEX.test(lines[index])) {
                    break;
                }
                items.push(createListItemNode(candidate[2]));
                index += 1;
            }

            content.push({ type: 'bulletList', content: items });
            continue;
        }

        if (blockquoteMatch) {
            content.push({
                type: 'blockquote',
                content: [createParagraphNode(blockquoteMatch[1])],
            });
            index += 1;
            continue;
        }

        if (!trimmed) {
            content.push({ type: 'paragraph' });
            index += 1;
            continue;
        }

        content.push(createParagraphNode(line));
        index += 1;
    }

    if (content.length === 0) {
        content.push({ type: 'paragraph' });
    }

    return {
        type: 'doc',
        content,
    };
};

export const tiptapDocumentToMarkdown = (document: unknown): string => {
    const doc = document as TiptapDocument | null;
    if (!doc || !Array.isArray(doc.content)) {
        return '';
    }

    const lines = doc.content.flatMap((node) => serializeBlockNode(node));
    return lines.join('\n');
};

export const tiptapDocumentToHtml = (document: unknown): string => {
    const doc = document as TiptapDocument | null;
    if (!doc || !Array.isArray(doc.content) || doc.content.length === 0) {
        return '<p></p>';
    }

    const html = doc.content.map((node) => serializeNodeToHtml(node)).join('');
    return html || '<p></p>';
};

export const markdownToTiptapHtml = (markdown: string): string =>
    tiptapDocumentToHtml(markdownToTiptapDocument(markdown));

export const removeAudioFromTiptapDocument = (document: unknown, audioPath: string): TiptapDocument => {
    const doc = document as TiptapDocument | null;
    if (!doc || !Array.isArray(doc.content)) {
        return markdownToTiptapDocument('');
    }

    const filename = audioPath.split('/').pop();
    const nextContent = doc.content
        .map((node) => removeMatchingNode(node, (candidate) => {
            if (candidate.type === AUDIO_EMBED_NODE_NAME) {
                const candidatePath = typeof candidate.attrs?.path === 'string' ? candidate.attrs.path : '';
                if (!candidatePath) {
                    return false;
                }
                if (candidatePath === audioPath) {
                    return true;
                }
                return !!filename && candidatePath.includes(filename);
            }

            const candidatePath = getImageTitleValue(candidate, AUDIO_TITLE_PREFIX);
            if (!candidatePath) {
                return false;
            }
            if (candidatePath === audioPath) {
                return true;
            }
            return !!filename && candidatePath.includes(filename);
        }))
        .filter((node): node is TiptapNode => !!node);

    return {
        type: 'doc',
        content: nextContent.length > 0 ? nextContent : [{ type: 'paragraph' }],
    };
};
