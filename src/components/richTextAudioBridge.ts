import { BridgeExtension } from '@10play/tentap-editor';
import { mergeAttributes, Node } from '@tiptap/core';
import {
    AUDIO_EMBED_ATTR,
    AUDIO_EMBED_DURATION_ATTR,
    AUDIO_EMBED_NODE_NAME,
    AUDIO_EMBED_PATH_ATTR,
    AUDIO_EMBED_SRC_ATTR,
} from '../utils/audioEmbeds';

export type AudioEmbedSelection = {
    start: number;
    end: number;
};

export type InsertAudioEmbedPayload = {
    path: string;
    duration?: number;
    src?: string | null;
    selection?: AudioEmbedSelection | null;
};

export enum AudioEmbedActionType {
    InsertAudioEmbed = 'vaulto-insert-audio-embed',
}

type AudioEmbedMessage = {
    type: AudioEmbedActionType.InsertAudioEmbed;
    payload: InsertAudioEmbedPayload;
};

const formatDuration = (duration?: number | null): string => {
    const safeDuration = typeof duration === 'number' && Number.isFinite(duration)
        ? Math.max(0, Math.round(duration))
        : 0;
    const minutes = Math.floor(safeDuration / 60);
    const seconds = safeDuration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const AudioEmbedNode = Node.create({
    name: AUDIO_EMBED_NODE_NAME,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    isolating: true,

    addAttributes() {
        return {
            path: {
                default: '',
                parseHTML: (element: HTMLElement) => element.getAttribute(AUDIO_EMBED_PATH_ATTR) || '',
                renderHTML: (attributes: Record<string, unknown>) => (
                    attributes.path
                        ? { [AUDIO_EMBED_PATH_ATTR]: String(attributes.path) }
                        : {}
                ),
            },
            duration: {
                default: 0,
                parseHTML: (element: HTMLElement) => {
                    const value = Number(element.getAttribute(AUDIO_EMBED_DURATION_ATTR) || 0);
                    return Number.isFinite(value) ? value : 0;
                },
                renderHTML: (attributes: Record<string, unknown>) => {
                    const value = Number(attributes.duration || 0);
                    return value > 0 ? { [AUDIO_EMBED_DURATION_ATTR]: String(Math.round(value)) } : {};
                },
            },
            src: {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute(AUDIO_EMBED_SRC_ATTR),
                renderHTML: (attributes: Record<string, unknown>) => (
                    typeof attributes.src === 'string' && attributes.src.trim().length > 0
                        ? { [AUDIO_EMBED_SRC_ATTR]: attributes.src.trim() }
                        : {}
                ),
            },
        };
    },

    parseHTML() {
        return [{ tag: `div[${AUDIO_EMBED_ATTR}="true"]` }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { [AUDIO_EMBED_ATTR]: 'true' })];
    },

    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement('div');
            dom.className = 'vaulto-audio-embed';
            dom.setAttribute('data-audio-embed', 'true');
            dom.setAttribute('contenteditable', 'false');
            dom.draggable = true;

            const header = document.createElement('div');
            header.className = 'vaulto-audio-embed__header';

            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'vaulto-audio-embed__handle';
            handle.setAttribute('data-drag-handle', 'true');
            handle.setAttribute('aria-label', 'Move audio block');
            handle.textContent = '::';

            const title = document.createElement('div');
            title.className = 'vaulto-audio-embed__title';

            const label = document.createElement('span');
            label.className = 'vaulto-audio-embed__label';
            label.textContent = 'Voice recording';

            const meta = document.createElement('span');
            meta.className = 'vaulto-audio-embed__meta';

            title.append(label, meta);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'vaulto-audio-embed__remove';
            removeButton.setAttribute('aria-label', 'Remove audio block');
            removeButton.textContent = '×';

            const audio = document.createElement('audio');
            audio.className = 'vaulto-audio-embed__player';
            audio.controls = true;
            audio.preload = 'metadata';

            const updateDom = (attrs: Record<string, unknown>) => {
                const path = typeof attrs.path === 'string' ? attrs.path.trim() : '';
                const duration = typeof attrs.duration === 'number' ? attrs.duration : 0;
                const src = typeof attrs.src === 'string' ? attrs.src.trim() : '';

                if (path) {
                    dom.setAttribute(AUDIO_EMBED_PATH_ATTR, path);
                } else {
                    dom.removeAttribute(AUDIO_EMBED_PATH_ATTR);
                }

                if (duration > 0) {
                    dom.setAttribute(AUDIO_EMBED_DURATION_ATTR, String(Math.round(duration)));
                    meta.textContent = formatDuration(duration);
                } else {
                    dom.removeAttribute(AUDIO_EMBED_DURATION_ATTR);
                    meta.textContent = '';
                }

                if (src) {
                    dom.setAttribute(AUDIO_EMBED_SRC_ATTR, src);
                } else {
                    dom.removeAttribute(AUDIO_EMBED_SRC_ATTR);
                }

                if (audio.src !== src) {
                    audio.src = src;
                }
            };

            removeButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const position = typeof getPos === 'function' ? getPos() : null;
                if (typeof position !== 'number') {
                    return;
                }

                editor
                    .chain()
                    .focus()
                    .deleteRange({ from: position, to: position + node.nodeSize })
                    .run();
            });

            header.append(handle, title, removeButton);
            dom.append(header, audio);
            updateDom(node.attrs);

            return {
                dom,
                update: (updatedNode: typeof node) => {
                    if (updatedNode.type.name !== AUDIO_EMBED_NODE_NAME) {
                        return false;
                    }

                    updateDom(updatedNode.attrs);
                    return true;
                },
                selectNode: () => {
                    dom.classList.add('ProseMirror-selectednode');
                },
                deselectNode: () => {
                    dom.classList.remove('ProseMirror-selectednode');
                },
                stopEvent: (event: Event) => {
                    const target = event.target as HTMLElement | null;
                    if (!target) {
                        return false;
                    }

                    if (target.closest('[data-drag-handle="true"]')) {
                        return false;
                    }

                    return !!target.closest('audio, .vaulto-audio-embed__remove');
                },
                ignoreMutation: () => true,
            };
        };
    },
});

export const AudioEmbedBridge = new BridgeExtension({
    tiptapExtension: AudioEmbedNode,
    onBridgeMessage: (editor, message: AudioEmbedMessage) => {
        if (message.type !== AudioEmbedActionType.InsertAudioEmbed) {
            return false;
        }

        const { selection, ...payload } = message.payload || {};
        const chain = editor.chain().focus();

        if (selection && Number.isFinite(selection.start) && Number.isFinite(selection.end)) {
            chain.setTextSelection({
                from: Number(selection.start),
                to: Number(selection.end),
            });
        }

        chain.insertContent({
            type: AUDIO_EMBED_NODE_NAME,
            attrs: {
                path: payload.path,
                duration: payload.duration || 0,
                src: payload.src || null,
            },
        });

        return chain.run();
    },
    extendEditorInstance: (sendBridgeMessage) => ({
        insertAudioEmbed: (payload: InsertAudioEmbedPayload) => sendBridgeMessage({
            type: AudioEmbedActionType.InsertAudioEmbed,
            payload,
        }),
    }),
    extendEditorState: () => ({}),
    extendCSS: `
  .vaulto-audio-embed {
    display: block;
    margin: 10px 0;
    padding: 12px;
    border: 1px solid #D9E0EA;
    border-radius: 18px;
    background: #F8FAFC;
  }

  .vaulto-audio-embed__header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .vaulto-audio-embed__handle,
  .vaulto-audio-embed__remove {
    border: none;
    background: transparent;
    color: #64748B;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }

  .vaulto-audio-embed__handle {
    padding: 4px 2px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: grab;
  }

  .vaulto-audio-embed__remove {
    margin-left: auto;
    padding: 4px;
    font-size: 18px;
  }

  .vaulto-audio-embed__title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vaulto-audio-embed__label {
    color: #0F172A;
    font-size: 14px;
    font-weight: 600;
  }

  .vaulto-audio-embed__meta {
    color: #64748B;
    font-size: 12px;
  }

  .vaulto-audio-embed__player {
    display: block;
    width: 100%;
  }

  .vaulto-audio-embed.ProseMirror-selectednode {
    border-color: #4A6FA5;
    box-shadow: 0 0 0 2px rgba(74, 111, 165, 0.14);
  }
`,
});
