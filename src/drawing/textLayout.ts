import { Platform } from 'react-native';
import { matchFont, SkFont } from '@shopify/react-native-skia';
import { INK_TEXT_LINE_HEIGHT, InkText } from './ink';
import { TextBox } from './drawingModel';

// Labels are drawn with the platform's system sans-serif, the same family the
// SVG preview asks for (Roboto on Android, Helvetica on iOS).
const FONT_FAMILY = Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' });

const fonts = new Map<number, SkFont>();

export const fontFor = (size: number): SkFont => {
    const key = Math.round(size * 2) / 2;
    let font = fonts.get(key);
    if (!font) {
        font = matchFont({ fontFamily: FONT_FAMILY, fontSize: key, fontWeight: 'normal' });
        fonts.set(key, font);
    }
    return font;
};

export const textLines = (text: string): string[] => text.split('\n');

/** Baseline of line `index`, relative to the label's top edge (matches the SVG preview). */
export const lineBaseline = (size: number, index: number): number => size * (0.82 + index * INK_TEXT_LINE_HEIGHT);

export const measureText = (item: InkText): TextBox => {
    const font = fontFor(item.size);
    const lines = textLines(item.text);
    const width = lines.reduce((max, line) => Math.max(max, line ? font.measureText(line).width : 0), 0);
    return { width: Math.max(width, item.size * 0.6), height: lines.length * item.size * INK_TEXT_LINE_HEIGHT };
};

/** Index of the topmost label under the point, or -1. */
export const hitText = (texts: InkText[], boxes: TextBox[], x: number, y: number, slop: number): number => {
    for (let index = texts.length - 1; index >= 0; index--) {
        const item = texts[index];
        const box = boxes[index];
        if (box && x >= item.x - slop && x <= item.x + box.width + slop && y >= item.y - slop && y <= item.y + box.height + slop) {
            return index;
        }
    }
    return -1;
};
