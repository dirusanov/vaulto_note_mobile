import { BridgeExtension } from '@10play/tentap-editor';
import { isDarkScheme } from '../theme/colors';
import { DRAWING_MARKER, DRAWING_OPEN_MESSAGE_TYPE, DrawingDocument, parseDrawingSrc } from './drawingFormat';

export { DRAWING_MARKER, buildDrawingSrc, parseDrawingSrc } from './drawingFormat';
export type { DrawingDocument } from './drawingFormat';

const buildDrawingCss = () => `
  img[src*="${DRAWING_MARKER}"] {
    display: block;
    box-sizing: border-box;
    /* Natural size (the SVG's own width), shrunk only on a narrower screen:
       a drawing made on a phone must not be blown up on a tablet. */
    width: auto;
    max-width: 100%;
    height: auto;
    margin: 8px 0;
    border-radius: 12px;
    ${isDarkScheme() ? 'filter: invert(1) hue-rotate(180deg);' : ''}
  }
  /* A sheet with its own colour keeps its colours in dark mode. */
  img[src*="${DRAWING_MARKER}"][src*="class='vp'"] {
    filter: none;
  }
  img[src*="${DRAWING_MARKER}"].ProseMirror-selectednode {
    outline: 2px solid #4A6FA5;
    outline-offset: 2px;
  }
  .ProseMirror:not(:focus) img[src*="${DRAWING_MARKER}"].ProseMirror-selectednode {
    outline: none;
  }
`;

const DRAWING_RUNTIME_JS = `
(() => {
  if (window.__vaultoDrawingInstalled) return true;
  window.__vaultoDrawingInstalled = true;
  const MARKER = ${JSON.stringify(DRAWING_MARKER)};
  const drawingImage = (target) => {
    const image = target && typeof target.closest === 'function' ? target.closest('img') : null;
    return image && (image.getAttribute('src') || '').indexOf(MARKER) !== -1 ? image : null;
  };
  const positionOf = (image) => {
    try {
      const view = document.querySelector('.ProseMirror')?.editor?.view;
      return view ? view.posAtDOM(image, 0) : null;
    } catch (error) {
      return null;
    }
  };
  // A drawing opens the canvas on tap; it must not focus the editor (keyboard).
  document.addEventListener('mousedown', (event) => {
    if (drawingImage(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener('click', (event) => {
    const image = drawingImage(event.target);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    window.ReactNativeWebView?.postMessage(JSON.stringify({
      type: ${JSON.stringify(DRAWING_OPEN_MESSAGE_TYPE)},
      payload: { src: image.getAttribute('src') || '', pos: positionOf(image) },
    }));
  }, true);
  return true;
})(); true;
`;

export const getDrawingRuntimeJs = (): string => DRAWING_RUNTIME_JS;

export const getDrawingBridge = (onOpen?: (doc: DrawingDocument) => void) => new BridgeExtension({
    forceName: 'vaultoDrawingBridge',
    onEditorMessage: (message: { type?: string; payload?: { src?: string; pos?: number | null } }) => {
        if (message?.type !== DRAWING_OPEN_MESSAGE_TYPE) {
            return false;
        }
        const doc = parseDrawingSrc(message.payload?.src);
        if (doc && onOpen) {
            const pos = message.payload?.pos;
            onOpen(typeof pos === 'number' ? { ...doc, pos } : doc);
        }
        return true;
    },
    extendEditorState: () => ({}),
    extendCSS: buildDrawingCss(),
});

/**
 * JS for the editor WebView that inserts, replaces or removes a drawing through
 * the tiptap instance (tiptap keeps it on the ProseMirror DOM node), so the change
 * is a real document transaction and reaches the note through the usual update.
 */
export const buildDrawingCommandJs = (command: { id: string; src: string | null; pos?: number }): string => `
(() => {
  try {
    const editor = document.querySelector('.ProseMirror')?.editor;
    if (!editor) return;
    const command = ${JSON.stringify(command)};
    const marker = ${JSON.stringify(DRAWING_MARKER)};
    let found = null;
    const idAt = (node) => {
      if (!node || node.type.name !== 'image') return null;
      const src = node.attrs.src || '';
      const index = src.indexOf(marker);
      if (index === -1) return null;
      try {
        return JSON.parse(decodeURIComponent(src.slice(index + marker.length))).id;
      } catch (e) {
        return null;
      }
    };
    // The node that was tapped, if the document has not moved it since.
    if (typeof command.pos === 'number') {
      for (const pos of [command.pos, command.pos - 1]) {
        if (pos < 0 || pos >= editor.state.doc.content.size) continue;
        const node = editor.state.doc.nodeAt(pos);
        if (idAt(node) === command.id) {
          found = { node, pos };
          break;
        }
      }
    }
    if (!found) editor.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'image') return !found;
      const src = node.attrs.src || '';
      const index = src.indexOf(marker);
      if (index === -1) return false;
      try {
        if (JSON.parse(decodeURIComponent(src.slice(index + marker.length))).id === command.id) {
          found = { node, pos };
        }
      } catch (e) {}
      return false;
    });
    if (found) {
      const tr = editor.state.tr;
      if (command.src) {
        tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, src: command.src });
      } else {
        tr.delete(found.pos, found.pos + found.node.nodeSize);
      }
      editor.view.dispatch(tr);
      return;
    }
    if (!command.src) return;
    const { selection, doc } = editor.state;
    const at = editor.isFocused ? selection.to : doc.content.size;
    editor.chain().insertContentAt(at, [
      { type: 'image', attrs: { src: command.src } },
      { type: 'paragraph' },
    ]).run();
  } catch (error) {
    console.warn('Drawing command failed', error);
  }
})();
true;
`;
