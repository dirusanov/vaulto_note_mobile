const TASK_ITEM_HTML_REGEX = /<li\b[^>]*data-type=(['"])taskItem\1/gi;
const TASK_ITEM_MARKDOWN_REGEX = /^\s*[-*]\s*\[(?:[ xX])?\]\s+/gm;

export const countChecklistItems = (content: string): number => {
    if (!content) {
        return 0;
    }

    const htmlMatches = content.match(TASK_ITEM_HTML_REGEX);
    if (htmlMatches && htmlMatches.length > 0) {
        return htmlMatches.length;
    }

    return content.match(TASK_ITEM_MARKDOWN_REGEX)?.length ?? 0;
};

export const resolveChecklistScaleFactor = (count: number, enabled: boolean): number => {
    if (!enabled || count === 0) {
        return 1;
    }

    if (count <= 8) {
        return 1.25;
    }

    if (count <= 15) {
        return 1.15;
    }

    return 1;
};

export const resolveChecklistScaleForContent = (content: string, enabled: boolean): number | null => {
    const checklistCount = countChecklistItems(content);
    if (checklistCount === 0) {
        return null;
    }

    return resolveChecklistScaleFactor(checklistCount, enabled);
};
