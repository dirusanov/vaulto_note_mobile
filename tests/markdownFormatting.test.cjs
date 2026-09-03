/**
 * Round-trip guards for the note formatting pipeline.
 * Build first:
 *   npx tsc src/utils/markdownUtils.tsx src/utils/tiptapMarkdownAdapter.ts \
 *     --target ES2020 --module commonjs --jsx react --outDir .test-build/md \
 *     --skipLibCheck --esModuleInterop --moduleResolution node
 */
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'react-native') {
        return {
            Text: () => null,
            StyleSheet: { flatten: (style) => style, create: (styles) => styles },
        };
    }
    if (request === 'react') {
        return { createElement: (...args) => ({ args }) };
    }
    return originalLoad.apply(this, arguments);
};

const { parseMarkdownToData, stripMarkdownSyntax } = require('../.test-build/md/utils/markdownUtils');
const { markdownToTiptapHtml } = require('../.test-build/md/utils/tiptapMarkdownAdapter');

let failures = 0;
const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures += 1;
        console.error(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    } else {
        console.log(`ok   ${name}`);
    }
};

// --- emphasis must not eat ordinary underscores / asterisks ------------------
const plain = (text) => parseMarkdownToData(text).content;
const types = (text) => parseMarkdownToData(text).formats.map((f) => f.type);

check('snake_case survives', plain('use user_id and order_id'), 'use user_id and order_id');
check('snake_case has no italics', types('use user_id and order_id'), []);
check('file name survives', plain('open my_file_name.txt'), 'open my_file_name.txt');
check('url survives', plain('https://x.com/a_b_c_d'), 'https://x.com/a_b_c_d');
check('multiplication survives', plain('2 * 3 * 4 = 24'), '2 * 3 * 4 = 24');
check('real underscore italic still parses', plain('a _word_ here'), 'a word here');
check('real underscore italic marks', types('a _word_ here'), ['italic']);
check('real star italic still parses', plain('a *word* here'), 'a word here');
check('italic after a snake_case word', plain('user_id and _real_ italic'), 'user_id and real italic');
check('italic after snake_case marks', types('user_id and _real_ italic'), ['italic']);
check('bold untouched', types('**bold**'), ['bold']);
check('highlight untouched', types('==note=='), ['highlight']);
check('strip keeps identifiers', stripMarkdownSyntax('- fix user_id in my_file.py'), 'fix user_id in my_file.py');

check('bare ** is kept as typed', plain('**'), '**');
check('bare ** produces no format', types('**'), []);
check('bare == is kept as typed', plain('=='), '==');
check('spaced stars are kept', plain('a ** b'), 'a ** b');
check('cyrillic underscores survive', plain('файл_с_именем.txt'), 'файл_с_именем.txt');
check('quoted italic still parses', types('«_курсив_»'), ['italic']);

// --- checklist parsing ------------------------------------------------------
check(
    'empty brackets checklist does not crash',
    markdownToTiptapHtml('- [] buy milk'),
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>buy milk</p></li></ul>'
);
check(
    'checked checklist',
    markdownToTiptapHtml('- [x] done'),
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>'
);
check(
    'empty checklist item stays a checklist',
    markdownToTiptapHtml('- [ ]'),
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><br></p></li></ul>'
);
check(
    'identifier inside a bullet is preserved',
    markdownToTiptapHtml('- rename user_id to account_id'),
    '<ul><li><p>rename user_id to account_id</p></li></ul>'
);

// --- nested lists -----------------------------------------------------------
const { tiptapDocumentToMarkdown, markdownToTiptapDocument } = require('../.test-build/md/utils/tiptapMarkdownAdapter');
const roundTrip = (markdown) => tiptapDocumentToMarkdown(markdownToTiptapDocument(markdown));

check(
    'nested bullets keep their nesting',
    markdownToTiptapHtml('- Top\n  - Child\n- Second'),
    '<ul><li><p>Top</p><ul><li><p>Child</p></li></ul></li><li><p>Second</p></li></ul>'
);
check(
    'nested bullet round-trips back to markdown',
    roundTrip('- Top\n  - Child\n- Second'),
    '- Top\n  - Child\n- Second'
);
check(
    'ordered list nested under a bullet',
    roundTrip('- Top\n  1. First\n  2. Second'),
    '- Top\n  1. First\n  2. Second'
);
check(
    'nested checklist round-trips',
    roundTrip('- [ ] Task\n  - [x] Subtask'),
    '- [ ] Task\n  - [x] Subtask'
);
check(
    'three levels deep',
    roundTrip('- A\n  - B\n    - C'),
    '- A\n  - B\n    - C'
);
check(
    'flat list is unchanged',
    roundTrip('- One\n- Two\n- Three'),
    '- One\n- Two\n- Three'
);
check(
    'ordered list keeps its start number',
    roundTrip('3. Three\n4. Four'),
    '3. Three\n4. Four'
);
check(
    'a bullet list following a checklist stays separate',
    markdownToTiptapHtml('- [ ] Task\n- Bullet'),
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul><ul><li><p>Bullet</p></li></ul>'
);
check(
    'paragraph after a list is not swallowed',
    roundTrip('- One\nPlain line'),
    '- One\nPlain line'
);

// --- HTML -> markdown handed to the AI --------------------------------------
const { richContentToAgentMarkdown } = require('../.test-build/md/utils/richContent');

check(
    'nested bullets keep indentation for the AI',
    richContentToAgentMarkdown('<ul><li><p>Top</p><ul><li><p>Child</p></li><li><p>Child2</p></li></ul></li><li><p>Second</p></li></ul>'),
    '- Top\n  - Child\n  - Child2\n- Second'
);
check(
    'three list levels keep indentation',
    richContentToAgentMarkdown('<ul><li><p>A</p><ul><li><p>B</p><ul><li><p>C</p></li></ul></li></ul></li></ul>'),
    '- A\n  - B\n    - C'
);
check(
    'nested checklist keeps its state',
    richContentToAgentMarkdown('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Kid</p></li></ul></li></ul>'),
    '- [ ] Parent\n  - [x] Kid'
);
check(
    'flat list has no blank lines between items',
    richContentToAgentMarkdown('<ul><li><p>One</p></li><li><p>Two</p></li></ul>'),
    '- One\n- Two'
);
check(
    'wrapped item line is indented under its bullet',
    richContentToAgentMarkdown('<ul><li><p>Line one<br>Line two</p></li></ul>'),
    '- Line one\n  Line two'
);
check(
    'empty item is dropped',
    richContentToAgentMarkdown('<ul><li><p></p></li><li><p>Real</p></li></ul>'),
    '- Real'
);
check(
    'paragraphs around a list are kept',
    richContentToAgentMarkdown('<p>Intro</p><ul><li><p>One</p></li></ul><p>Outro</p>'),
    'Intro\n\n- One\nOutro'
);

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nAll formatting tests passed');
