import { BridgeExtension } from '@10play/tentap-editor';
import { isDarkScheme } from '../theme/colors';
import { INK_TOOLS, INK_TOOL_ORDER, InkStroke, InkTool, outlineToSvgPath, strokeBounds, strokeOutlineFor } from './ink';

// A drawing lives in the note like the audio card does: an <img> whose src is
// an SVG preview followed by a marker and the editable strokes. Every client
// that renders the note HTML shows the picture; only the canvas reads the strokes.
export const DRAWING_MARKER = '#vaulto-drawing=';
export const DRAWING_OPEN_MESSAGE_TYPE = 'vaulto-open-drawing';

export type DrawingDocument = {
    id: string;
    /** Width of the document coordinate space (the canvas width it was started on). */
    width: number;
    strokes: InkStroke[];
};

const PADDING = 16;
const MIN_HEIGHT = 120;

// Points are stored as deltas in tenths of a pixel and pressure in hundredths:
// about a third of the size of plain JSON numbers.
const encodeStroke = (stroke: InkStroke): (string | number)[] => {
    const out: (string | number)[] = [INK_TOOL_ORDER.indexOf(stroke.tool), stroke.color, Math.round(stroke.size * 10)];
    let px = 0;
    let py = 0;
    for (let i = 0; i + 2 < stroke.points.length; i += 3) {
        const x = Math.round(stroke.points[i] * 10);
        const y = Math.round(stroke.points[i + 1] * 10);
        out.push(x - px, y - py, Math.round(stroke.points[i + 2] * 100));
        px = x;
        py = y;
    }
    return out;
};

const decodeStroke = (raw: unknown): InkStroke | null => {
    if (!Array.isArray(raw) || raw.length < 3) {
        return null;
    }
    const tool: InkTool = INK_TOOL_ORDER[Number(raw[0])] || 'fountain';
    const points: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 3; i + 2 < raw.length; i += 3) {
        x += Number(raw[i]) || 0;
        y += Number(raw[i + 1]) || 0;
        points.push(x / 10, y / 10, (Number(raw[i + 2]) || 50) / 100);
    }
    return {
        tool,
        color: typeof raw[1] === 'string' ? raw[1] : '#1D1D1F',
        size: (Number(raw[2]) || 20) / 10,
        points,
    };
};

export const parseDrawingSrc = (src: string | null | undefined): DrawingDocument | null => {
    const index = (src || '').indexOf(DRAWING_MARKER);
    if (index === -1) {
        return null;
    }
    try {
        const parsed = JSON.parse(decodeURIComponent((src as string).slice(index + DRAWING_MARKER.length)));
        if (!parsed || typeof parsed.id !== 'string') {
            return null;
        }
        return {
            id: parsed.id,
            width: Number(parsed.w) || 800,
            strokes: (Array.isArray(parsed.s) ? parsed.s : []).map(decodeStroke).filter(Boolean) as InkStroke[],
        };
    } catch {
        return null;
    }
};

export const buildDrawingSvg = (doc: DrawingDocument): string => {
    const bounds = strokeBounds(doc.strokes);
    const top = bounds ? Math.max(0, Math.floor(bounds.minY - PADDING)) : 0;
    const height = Math.max(MIN_HEIGHT, bounds ? Math.ceil(bounds.maxY + PADDING) - top : MIN_HEIGHT);
    const width = Math.round(doc.width);
    const paths = doc.strokes.map((stroke) => {
        const d = outlineToSvgPath(strokeOutlineFor(stroke));
        if (!d) {
            return '';
        }
        const spec = INK_TOOLS[stroke.tool];
        const opacity = spec?.opacity ?? 1;
        return `<path d="${d}" fill="${stroke.color}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}${spec?.grain ? ' filter="url(#g)"' : ''}/>`;
    }).join('');
    // Same graphite grain as the canvas: noise as an alpha mask over the ink.
    const defs = doc.strokes.some((stroke) => INK_TOOLS[stroke.tool]?.grain)
        ? '<defs><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>'
            + '<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -0.55"/>'
            + '<feComposite in="SourceGraphic" operator="in"/></filter></defs>'
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 ${top} ${width} ${height}">${defs}${paths}</svg>`;
};

export const buildDrawingSrc = (doc: DrawingDocument): string => {
    const payload = {
        v: 1,
        id: doc.id,
        w: Math.round(doc.width),
        s: doc.strokes.map(encodeStroke),
    };
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildDrawingSvg(doc))}${DRAWING_MARKER}${encodeURIComponent(JSON.stringify(payload))}`;
};

const buildDrawingCss = () => `
  img[src*="${DRAWING_MARKER}"] {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 8px 0;
    border-radius: 12px;
    ${isDarkScheme() ? 'filter: invert(1) hue-rotate(180deg);' : ''}
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
      payload: { src: image.getAttribute('src') || '' },
    }));
  }, true);
  return true;
})(); true;
`;

export const getDrawingRuntimeJs = (): string => DRAWING_RUNTIME_JS;

export const getDrawingBridge = (onOpen?: (doc: DrawingDocument) => void) => new BridgeExtension({
    forceName: 'vaultoDrawingBridge',
    onEditorMessage: (message: { type?: string; payload?: { src?: string } }) => {
        if (message?.type !== DRAWING_OPEN_MESSAGE_TYPE) {
            return false;
        }
        const doc = parseDrawingSrc(message.payload?.src);
        if (doc && onOpen) {
            onOpen(doc);
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
export const buildDrawingCommandJs = (command: { id: string; src: string | null }): string => `
(() => {
  try {
    const editor = document.querySelector('.ProseMirror')?.editor;
    if (!editor) return;
    const command = ${JSON.stringify(command)};
    const marker = ${JSON.stringify(DRAWING_MARKER)};
    let found = null;
    editor.state.doc.descendants((node, pos) => {
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
