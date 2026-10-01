import { BridgeExtension } from '@10play/tentap-editor';
import {
    AUDIO_PREVIEW_ACCENT,
    AUDIO_PREVIEW_ACCENT_SOFT,
    AUDIO_PREVIEW_CARD_BACKGROUND,
    AUDIO_PREVIEW_CARD_BORDER,
    AUDIO_PREVIEW_MARKER,
    AUDIO_PREVIEW_PLAY_END,
    AUDIO_PREVIEW_PROGRESS_BOTTOM,
    AUDIO_PREVIEW_PROGRESS_END,
    AUDIO_PREVIEW_PROGRESS_START,
    AUDIO_PREVIEW_PROGRESS_TOP,
    AUDIO_PREVIEW_SPEED_BACKGROUND,
    AUDIO_PREVIEW_SPEED_BORDER,
    AUDIO_PREVIEW_SPEED_BOTTOM,
    AUDIO_PREVIEW_SPEED_END,
    AUDIO_PREVIEW_SPEED_START,
    AUDIO_PREVIEW_SPEED_TOP,
    AUDIO_PREVIEW_SUBTEXT,
    AUDIO_PREVIEW_TEXT,
    AUDIO_PREVIEW_TRACK,
    AUDIO_PREVIEW_VIEWBOX_HEIGHT,
    AUDIO_PREVIEW_VIEWBOX_WIDTH,
    AUDIO_PREVIEW_WAVE_HEIGHTS,
    AUDIO_PREVIEW_WAVE_IDLE,
    AUDIO_PREVIEW_WAVE_LOADING,
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

export type AudioEmbedControlAction = 'toggle' | 'seek' | 'speed';

export type AudioEmbedControlPayload = {
    path: string;
    action: AudioEmbedControlAction;
    seekRatio?: number;
    duration?: number;
};

export type AudioEmbedRuntimeState = {
    path: string;
    duration?: number;
    position?: number;
    isPlaying?: boolean;
    playbackSpeed?: number;
    isLoading?: boolean;
};

export enum AudioEmbedActionType {
    ControlAudio = 'vaulto-control-audio',
}

const AUDIO_EMBED_CSS = `
  img[src*="${AUDIO_PREVIEW_MARKER}"] {
    display: block;
    box-sizing: border-box;
    width: calc(100% - 4px);
    max-width: calc(100% - 4px);
    height: auto;
    margin: 12px 2px 10px;
    border-radius: 24px;
  }

  img[src*="${AUDIO_PREVIEW_MARKER}"].ProseMirror-selectednode {
    outline: 2px solid #4A6FA5;
    outline-offset: 1px;
  }
`;

const buildAudioEmbedRuntimeJs = () => `
(() => {
  if (window.__vaultoAudioPreviewInstalled) {
    return true;
  }

  const MARKER = ${JSON.stringify(AUDIO_PREVIEW_MARKER)};
  const WIDTH = ${JSON.stringify(AUDIO_PREVIEW_VIEWBOX_WIDTH)};
  const HEIGHT = ${JSON.stringify(AUDIO_PREVIEW_VIEWBOX_HEIGHT)};
  const PLAY_END = ${JSON.stringify(AUDIO_PREVIEW_PLAY_END)};
  const PROGRESS_START = ${JSON.stringify(AUDIO_PREVIEW_PROGRESS_START)};
  const PROGRESS_END = ${JSON.stringify(AUDIO_PREVIEW_PROGRESS_END)};
  const PROGRESS_TOP = ${JSON.stringify(AUDIO_PREVIEW_PROGRESS_TOP)};
  const PROGRESS_BOTTOM = ${JSON.stringify(AUDIO_PREVIEW_PROGRESS_BOTTOM)};
  const SPEED_START = ${JSON.stringify(AUDIO_PREVIEW_SPEED_START)};
  const SPEED_END = ${JSON.stringify(AUDIO_PREVIEW_SPEED_END)};
  const SPEED_TOP = ${JSON.stringify(AUDIO_PREVIEW_SPEED_TOP)};
  const SPEED_BOTTOM = ${JSON.stringify(AUDIO_PREVIEW_SPEED_BOTTOM)};

  const escapeXml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatDuration = (value) => {
    const safeValue = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    const minutes = Math.floor(safeValue / 60);
    const seconds = Math.floor(safeValue % 60);
    return minutes + ':' + String(seconds).padStart(2, '0');
  };

  const parsePayload = (src) => {
    if (typeof src !== 'string') {
      return null;
    }

    const markerIndex = src.indexOf(MARKER);
    if (markerIndex === -1) {
      return null;
    }

    try {
      const decoded = decodeURIComponent(src.slice(markerIndex + MARKER.length));
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed.path !== 'string' || !parsed.path.trim()) {
        return null;
      }

      return {
        kind: 'vaulto-audio',
        path: parsed.path.trim(),
        duration: typeof parsed.duration === 'number' && Number.isFinite(parsed.duration) ? Math.max(0, parsed.duration) : 0,
        position: typeof parsed.position === 'number' && Number.isFinite(parsed.position) ? Math.max(0, parsed.position) : 0,
        isPlaying: !!parsed.isPlaying,
        playbackSpeed: typeof parsed.playbackSpeed === 'number' && Number.isFinite(parsed.playbackSpeed) ? parsed.playbackSpeed : 1,
        isLoading: !!parsed.isLoading,
      };
    } catch {
      return null;
    }
  };

  const buildSource = (payload) => {
    const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration) ? Math.max(0, payload.duration) : 0;
    const position = typeof payload.position === 'number' && Number.isFinite(payload.position)
      ? Math.max(0, Math.min(duration || 0, payload.position))
      : 0;
    const progressRatio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
    const progressWidth = Math.round((PROGRESS_END - PROGRESS_START) * progressRatio);
    const playbackSpeed = typeof payload.playbackSpeed === 'number' && Number.isFinite(payload.playbackSpeed) ? payload.playbackSpeed : 1;
    const isPlaying = !!payload.isPlaying;
    const isLoading = !!payload.isLoading;
    // Drawn shapes, not text: a ">" glyph looked like a typo, not a play button.
    const iconSvg = isLoading
      ? '<circle cx="78" cy="88" r="6" fill="#FFFFFF"/><circle cx="94" cy="88" r="6" fill="#FFFFFF"/><circle cx="110" cy="88" r="6" fill="#FFFFFF"/>'
      : (isPlaying
        ? '<rect x="79" y="70" width="11" height="36" rx="3" fill="#FFFFFF"/><rect x="98" y="70" width="11" height="36" rx="3" fill="#FFFFFF"/>'
        : '<path d="M84 68 L84 108 Q84 113 89 110 L116 92 Q120 88 116 84 L89 66 Q84 63 84 68 Z" fill="#FFFFFF"/>');
    const speedText = String(playbackSpeed).replace(/\\.0$/, '') + 'x';
    const remaining = Math.max(0, duration - position);
    const progressKnobX = PROGRESS_START + progressWidth;
    const waveStartX = 198;
    const waveBaseY = 58;
    const waveBarWidth = 10;
    const waveGap = 9;
    const playedWaveCount = Math.max(0, Math.min(
      ${JSON.stringify(AUDIO_PREVIEW_WAVE_HEIGHTS)}.length,
      Math.round(${JSON.stringify(AUDIO_PREVIEW_WAVE_HEIGHTS)}.length * progressRatio)
    ));
    const waveBars = ${JSON.stringify(AUDIO_PREVIEW_WAVE_HEIGHTS)}.map((height, index) => {
      const x = waveStartX + index * (waveBarWidth + waveGap);
      const y = waveBaseY - Math.round(height / 2);
      const fill = isLoading
        ? '${AUDIO_PREVIEW_WAVE_LOADING}'
        : (index < playedWaveCount ? '${AUDIO_PREVIEW_ACCENT}' : '${AUDIO_PREVIEW_WAVE_IDLE}');
      return '<rect x="' + x + '" y="' + y + '" width="' + waveBarWidth + '" height="' + height + '" rx="5" fill="' + fill + '"/>';
    }).join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT + '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '">' +
      '<rect x="8" y="10" width="664" height="156" rx="32" fill="${AUDIO_PREVIEW_CARD_BACKGROUND}" stroke="${AUDIO_PREVIEW_CARD_BORDER}" stroke-width="2"/>' +
      '<circle cx="94" cy="88" r="52" fill="${AUDIO_PREVIEW_ACCENT_SOFT}"/>' +
      '<circle cx="94" cy="88" r="45" fill="${AUDIO_PREVIEW_ACCENT}"/>' +
      iconSvg +
      waveBars +
      '<rect x="' + SPEED_START + '" y="' + SPEED_TOP + '" width="' + (SPEED_END - SPEED_START) + '" height="' + (SPEED_BOTTOM - SPEED_TOP) + '" rx="19" fill="${AUDIO_PREVIEW_SPEED_BACKGROUND}" stroke="${AUDIO_PREVIEW_SPEED_BORDER}" stroke-width="2"/>' +
      '<text x="' + Math.round((SPEED_START + SPEED_END) / 2) + '" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="${AUDIO_PREVIEW_TEXT}">' + escapeXml(speedText) + '</text>' +
      '<rect x="' + PROGRESS_START + '" y="106" width="' + (PROGRESS_END - PROGRESS_START) + '" height="8" rx="4" fill="${AUDIO_PREVIEW_TRACK}"/>' +
      '<rect x="' + PROGRESS_START + '" y="106" width="' + progressWidth + '" height="8" rx="4" fill="${AUDIO_PREVIEW_ACCENT}"/>' +
      '<circle cx="' + progressKnobX + '" cy="110" r="8" fill="#FFFFFF" stroke="${AUDIO_PREVIEW_ACCENT}" stroke-width="4"/>' +
      '<text x="' + PROGRESS_START + '" y="144" text-anchor="start" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="${AUDIO_PREVIEW_SUBTEXT}">' + escapeXml(formatDuration(position)) + '</text>' +
      '<text x="' + SPEED_END + '" y="144" text-anchor="end" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="${AUDIO_PREVIEW_SUBTEXT}">' + escapeXml(formatDuration(remaining)) + '</text>' +
      '</svg>';

    const nextPayload = {
      kind: 'vaulto-audio',
      path: payload.path,
      duration,
      position,
      isPlaying,
      playbackSpeed,
      isLoading,
    };

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + MARKER + encodeURIComponent(JSON.stringify(nextPayload));
  };

  const getAudioImage = (target) => {
    if (!target || typeof target.closest !== 'function') {
      return null;
    }

    const image = target.closest('img');
    if (!image) {
      return null;
    }

    return parsePayload(image.getAttribute('src') || '') ? image : null;
  };

  window.__vaultoAudioPreviewInstalled = true;
  window.__vaultoAudioPreviewApi = {
    setState(payload) {
      if (!payload || typeof payload.path !== 'string' || !payload.path.trim()) {
        return;
      }

      const images = Array.from(document.querySelectorAll('img[src*="' + MARKER + '"]'));
      images.forEach((image) => {
        const currentPayload = parsePayload(image.getAttribute('src') || '');
        if (!currentPayload || currentPayload.path !== payload.path.trim()) {
          return;
        }

        image.setAttribute('src', buildSource({
          ...currentPayload,
          ...payload,
        }));
      });
    },
  };

  document.addEventListener('click', (event) => {
    const image = getAudioImage(event.target);
    if (!image) {
      return;
    }

    const payload = parsePayload(image.getAttribute('src') || '');
    if (!payload) {
      return;
    }

    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    let action = 'toggle';
    let seekRatio;

    if (x >= SPEED_START && x <= SPEED_END && y >= SPEED_TOP && y <= SPEED_BOTTOM) {
      action = 'speed';
    } else if (x >= PROGRESS_START && x <= PROGRESS_END && y >= PROGRESS_TOP && y <= PROGRESS_BOTTOM) {
      action = 'seek';
      seekRatio = Math.max(0, Math.min(1, (x - PROGRESS_START) / (PROGRESS_END - PROGRESS_START)));
    } else if (x <= PLAY_END) {
      action = 'toggle';
    } else {
      action = 'toggle';
    }

    event.preventDefault();
    event.stopPropagation();

    window.ReactNativeWebView?.postMessage(JSON.stringify({
      type: ${JSON.stringify(AudioEmbedActionType.ControlAudio)},
      payload: {
        path: payload.path,
        duration: payload.duration || 0,
        action,
        seekRatio,
      },
    }));
  }, true);

  return true;
})(); true;
`;

export const getAudioEmbedBridge = (
    onAudioAction?: (payload: AudioEmbedControlPayload) => void
) => new BridgeExtension({
    forceName: 'vaultoAudioPreviewBridge',
    onEditorMessage: (message: { type?: string; payload?: AudioEmbedControlPayload }) => {
        if (message?.type !== AudioEmbedActionType.ControlAudio) {
            return false;
        }

        if (onAudioAction && message.payload?.path) {
            onAudioAction(message.payload);
        }

        return true;
    },
    extendEditorState: () => ({}),
    extendCSS: AUDIO_EMBED_CSS,
});

export const getAudioEmbedRuntimeJs = (): string => buildAudioEmbedRuntimeJs();
