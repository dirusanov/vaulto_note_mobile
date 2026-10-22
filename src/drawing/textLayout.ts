import { Platform } from 'react-native';
import { Skia, SkParagraph } from '@shopify/react-native-skia';
import { INK_TEXT_LINE_HEIGHT, InkText } from './ink';
import { TextBox } from './drawingModel';

// Labels are laid out with Skia's paragraph engine over the system fonts, so
// scripts the base font lacks (CJK, Devanagari, Arabic, emoji) fall back to
// another system font and are shaped, as in the text field they were typed in.
// The family matches what the SVG preview asks for (Roboto / Helvetica).
const FONT_FAMILIES = Platform.select({ ios: ['Helvetica Neue'], default: ['sans-serif'] });

/** Wide enough that a label only breaks where its text has a newline. */
const LAYOUT_WIDTH = 100000;

const cache = new Map<string, SkParagraph>();
const CACHE_LIMIT = 300;

export const paragraphFor = (item: InkText): SkParagraph => {
    const key = `${item.size}|${item.color}|${item.text}`;
    let paragraph = cache.get(key);
    if (!paragraph) {
        const builder = Skia.ParagraphBuilder.Make();
        builder.pushStyle({
            color: Skia.Color(item.color),
            fontSize: item.size,
            fontFamilies: FONT_FAMILIES,
            heightMultiplier: INK_TEXT_LINE_HEIGHT,
            halfLeading: true,
        });
        builder.addText(item.text);
        builder.pop();
        paragraph = builder.build();
        paragraph.layout(LAYOUT_WIDTH);
        if (cache.size >= CACHE_LIMIT) {
            cache.delete(cache.keys().next().value as string);
        }
        cache.set(key, paragraph);
    }
    return paragraph;
};

export const LABEL_LAYOUT_WIDTH = LAYOUT_WIDTH;

export const measureText = (item: InkText): TextBox => {
    const paragraph = paragraphFor(item);
    return {
        width: Math.max(paragraph.getLongestLine(), item.size * 0.6),
        height: Math.max(paragraph.getHeight(), item.size * INK_TEXT_LINE_HEIGHT),
    };
};
