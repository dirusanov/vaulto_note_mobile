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
    buildAudioEmbedPreviewSrc,
    getAudioEmbedAttributesFromImageSrc,
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

// The checkbox body is optional (`- []` is what models keep emitting) and the
// trailing space is optional too, so an item that is still empty stays a
// checklist item instead of degrading into a bullet that reads "[x]".
const TODO_REGEX = /^(\s*[-*]\s*\[([ xX])?\](?:\s+|\s*$))(.*)$/;
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
            const audioAttrs = getAudioEmbedAttributesFromImageSrc(
                typeof node.attrs?.src === 'string' ? node.attrs.src : ''
            );
            if (audioAttrs?.path) {
                return `![audio](${audioAttrs.path})`;
            }

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

type ListKind = 'bullet' | 'ordered' | 'task';

type ListLineInfo = {
    indent: number;
    kind: ListKind;
    text: string;
    checked: boolean;
    start: number;
};

const getIndentWidth = (raw: string): number => raw.replace(/\t/g, '  ').length;

const matchListLine = (line: string): ListLineInfo | null => {
    const todo = line.match(TODO_REGEX);
    if (todo) {
        const leading = todo[1].match(/^\s*/);
        return {
            indent: getIndentWidth(leading ? leading[0] : ''),
            kind: 'task',
            text: todo[3],
            checked: (todo[2] || '').toLowerCase() === 'x',
            start: 1,
        };
    }

    const ordered = line.match(ORDERED_REGEX);
    if (ordered) {
        return {
            indent: getIndentWidth(ordered[1]),
            kind: 'ordered',
            text: ordered[3],
            checked: false,
            start: parseInt(ordered[2], 10) || 1,
        };
    }

    const bullet = line.match(BULLET_REGEX);
    if (bullet) {
        return {
            indent: getIndentWidth(bullet[1]),
            kind: 'bullet',
            text: bullet[2],
            checked: false,
            start: 1,
        };
    }

    return null;
};

const createListNodeForKind = (kind: ListKind, start: number, items: TiptapNode[]): TiptapNode => {
    if (kind === 'task') {
        return { type: 'taskList', content: items };
    }

    if (kind === 'ordered') {
        return { type: 'orderedList', attrs: { start }, content: items };
    }

    return { type: 'bulletList', content: items };
};

/**
 * Builds one list (and everything nested under it) starting at `index`.
 * Indented lines become child lists of the item above them instead of being
 * flattened into siblings, which is how AI answers and imported notes keep the
 * structure they were written with.
 */
const buildListNode = (lines: ListLineInfo[], index: number): [TiptapNode, number] => {
    const first = lines[index];
    const { indent, kind } = first;
    const items: TiptapNode[] = [];
    let cursor = index;

    while (cursor < lines.length) {
        const line = lines[cursor];

        if (line.indent < indent || (line.indent === indent && line.kind !== kind)) {
            break;
        }

        if (line.indent > indent) {
            const [childList, nextIndex] = buildListNode(lines, cursor);
            const parent = items[items.length - 1];

            if (parent) {
                parent.content = [...(parent.content || []), childList];
            } else {
                // A list that starts indented: keep it, wrapped in an empty item.
                items.push({
                    type: kind === 'task' ? 'taskItem' : 'listItem',
                    ...(kind === 'task' ? { attrs: { checked: false } } : {}),
                    content: [{ type: 'paragraph' }, childList],
                });
            }

            cursor = nextIndex;
            continue;
        }

        items.push(
            kind === 'task'
                ? createTaskItemNode(line.text, line.checked)
                : createListItemNode(line.text)
        );
        cursor += 1;
    }

    return [createListNodeForKind(kind, first.start, items), cursor];
};

const createAudioEmbedNode = (path: string): TiptapNode => ({
    type: 'image',
    attrs: {
        src: buildAudioEmbedPreviewSrc({ path }),
    },
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

const LIST_NODE_TYPES = ['bulletList', 'orderedList', 'taskList'];

/** Mirrors buildListNode: two spaces of indentation per nesting level. */
const serializeListNode = (node: TiptapNode, depth: number = 0): string[] => {
    const indent = '  '.repeat(depth);
    const start = node.type === 'orderedList' ? Number(node.attrs?.start || 1) : 1;
    const lines: string[] = [];

    (node.content || []).forEach((item, position) => {
        const marker = node.type === 'orderedList'
            ? `${start + position}. `
            : node.type === 'taskList'
                ? `- [${item.attrs?.checked ? 'x' : ' '}] `
                : '- ';

        lines.push(`${indent}${marker}${listItemParagraph(item)}`);

        (item.content || []).forEach((child) => {
            if (LIST_NODE_TYPES.includes(child.type)) {
                lines.push(...serializeListNode(child, depth + 1));
            }
        });
    });

    return lines;
};

const serializeBlockNode = (node: TiptapNode): string[] => {
    switch (node.type) {
        case 'paragraph':
            return [inlineNodesToMarkdown(node.content)];
        case 'heading': {
            const level = Number(node.attrs?.level || 1);
            const prefix = '#'.repeat(Math.max(1, Math.min(level, 6)));
            return [`${prefix} ${inlineNodesToMarkdown(node.content)}`.trimEnd()];
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
            return serializeListNode(node);
        case 'blockquote':
            return (node.content || []).flatMap((child) => serializeBlockNode(child)).map((line) => `> ${line}`);
        case AUDIO_EMBED_NODE_NAME: {
            const path = typeof node.attrs?.path === 'string' ? node.attrs.path : '';
            return path ? [`![audio](${path})`] : [];
        }
        case 'image': {
            const audioAttrs = getAudioEmbedAttributesFromImageSrc(
                typeof node.attrs?.src === 'string' ? node.attrs.src : ''
            );
            if (audioAttrs?.path) {
                return [`![audio](${audioAttrs.path})`];
            }

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

        if (todoMatch || orderedMatch || bulletMatch) {
            const listLines: ListLineInfo[] = [];
            while (index < lines.length) {
                const info = matchListLine(lines[index]);
                if (!info) {
                    break;
                }
                listLines.push(info);
                index += 1;
            }

            let cursor = 0;
            while (cursor < listLines.length) {
                const [node, nextCursor] = buildListNode(listLines, cursor);
                content.push(node);
                cursor = nextCursor > cursor ? nextCursor : cursor + 1;
            }

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
            const imageAudioAttrs = getAudioEmbedAttributesFromImageSrc(
                typeof candidate.attrs?.src === 'string' ? candidate.attrs.src : ''
            );
            const resolvedCandidatePath = imageAudioAttrs?.path || candidatePath;
            if (!resolvedCandidatePath) {
                return false;
            }
            if (resolvedCandidatePath === audioPath) {
                return true;
            }
            return !!filename && resolvedCandidatePath.includes(filename);
        }))
        .filter((node): node is TiptapNode => !!node);

    return {
        type: 'doc',
        content: nextContent.length > 0 ? nextContent : [{ type: 'paragraph' }],
    };
};
