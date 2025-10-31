import {
  wrapInlineText,
  toggleLinePrefixText,
  cycleHeadingLevel,
  insertTableText,
  insertBlockText,
  handleTab,
  handleEnter,
} from '../markdown-formatting';

describe('wrapInlineText', () => {
  it('wraps selected text with markers', () => {
    const [result, selection] = wrapInlineText(
      'hello world',
      [0, 5],
      '**',
      '**',
      '',
    );
    expect(result).toBe('**hello** world');
    expect(selection).toEqual([2, 7]);
  });

  it('unwraps text that is already wrapped', () => {
    const [result, selection] = wrapInlineText(
      '**hello** world',
      [2, 7],
      '**',
      '**',
      '',
    );
    expect(result).toBe('hello world');
    expect(selection).toEqual([0, 5]);
  });

  it('inserts placeholder when no text is selected', () => {
    const [result, selection] = wrapInlineText(
      'hello world',
      [6, 6],
      '**',
      '**',
      'bold text',
    );
    expect(result).toBe('hello **bold text**world');
    expect(selection).toEqual([8, 17]);
  });

  it('wraps with asymmetric markers', () => {
    const [result, selection] = wrapInlineText(
      'link text',
      [0, 9],
      '[',
      '](url)',
      '',
    );
    expect(result).toBe('[link text](url)');
    expect(selection).toEqual([1, 10]);
  });

  it('wraps text at the start of string', () => {
    const [result, selection] = wrapInlineText('hello', [0, 5], '*', '*', '');
    expect(result).toBe('*hello*');
    expect(selection).toEqual([1, 6]);
  });

  it('wraps text at the end of string', () => {
    const [result, selection] = wrapInlineText('hello', [0, 5], '`', '`', '');
    expect(result).toBe('`hello`');
    expect(selection).toEqual([1, 6]);
  });

  it('handles empty string', () => {
    const [result, selection] = wrapInlineText('', [0, 0], '**', '**', 'text');
    expect(result).toBe('**text**');
    expect(selection).toEqual([2, 6]);
  });
});

describe('toggleLinePrefixText', () => {
  it('adds prefix to lines without it', () => {
    const [result] = toggleLinePrefixText('first\nsecond', [0, 11], '- ');
    expect(result).toBe('- first\n- second');
  });

  it('removes prefix from lines that have it', () => {
    const [result] = toggleLinePrefixText('- first\n- second', [0, 15], '- ');
    expect(result).toBe('first\nsecond');
  });

  it('adds prefix to single line', () => {
    const [result] = toggleLinePrefixText('single line', [0, 11], '> ');
    expect(result).toBe('> single line');
  });

  it('handles partial line selection', () => {
    const [result] = toggleLinePrefixText('first\nsecond\nthird', [3, 9], '- ');
    expect(result).toBe('- first\n- second\nthird');
  });

  it('skips empty lines when includeEmpty is false', () => {
    const [result] = toggleLinePrefixText(
      'first\n\nsecond',
      [0, 13],
      '- ',
      false,
    );
    expect(result).toBe('- first\n\n- second');
  });

  it('includes empty lines when includeEmpty is true', () => {
    const [result] = toggleLinePrefixText(
      'first\n\nsecond',
      [0, 13],
      '> ',
      true,
    );
    expect(result).toBe('> first\n> \n> second');
  });

  it('handles mixed prefixed and unprefixed lines (adds to all)', () => {
    const [result] = toggleLinePrefixText('- first\nsecond', [0, 14], '- ');
    expect(result).toBe('- - first\n- second');
  });

  it('updates selection range correctly when adding', () => {
    const [, selection] = toggleLinePrefixText('first\nsecond', [0, 12], '- ');
    expect(selection).toEqual([0, 16]); // +4 chars (2 prefixes * 2 chars)
  });

  it('updates selection range correctly when removing', () => {
    const [, selection] = toggleLinePrefixText(
      '- first\n- second',
      [0, 16],
      '- ',
    );
    expect(selection).toEqual([0, 12]); // -4 chars
  });
});

describe('cycleHeadingLevel', () => {
  it('adds ## heading to plain text', () => {
    const [result] = cycleHeadingLevel('Hello', 0);
    expect(result).toBe('## Hello');
  });

  it('increments heading level from ## to ###', () => {
    const [result] = cycleHeadingLevel('## Hello', 0);
    expect(result).toBe('### Hello');
  });

  it('increments heading level from ### to ####', () => {
    const [result] = cycleHeadingLevel('### Hello', 0);
    expect(result).toBe('#### Hello');
  });

  it('increments heading level from ##### to ######', () => {
    const [result] = cycleHeadingLevel('##### Hello', 0);
    expect(result).toBe('###### Hello');
  });

  it('removes heading at level 6', () => {
    const [result] = cycleHeadingLevel('###### Hello', 0);
    expect(result).toBe('Hello');
  });

  it('positions cursor at end of line', () => {
    const [result, pos] = cycleHeadingLevel('Hello', 2);
    expect(result).toBe('## Hello');
    expect(pos).toBe(8); // End of "## Hello"
  });

  it('handles multiline text (only affects current line)', () => {
    const [result] = cycleHeadingLevel('## First\nSecond', 5);
    expect(result).toBe('### First\nSecond');
  });
});

describe('insertTableText', () => {
  it('inserts a 2x3 table', () => {
    const [result] = insertTableText('text', 4, 2, 3);
    expect(result).toContain('| Header 1 | Header 2 | Header 3 |');
    expect(result).toContain('| --- | --- | --- |');
    expect(result).toContain('| Cell | Cell | Cell |');
  });

  it('inserts a header-only table when rows=1', () => {
    const [result] = insertTableText('text', 4, 1, 2);
    expect(result).toContain('| Header 1 | Header 2 |');
    expect(result).toContain('| --- | --- |');
    expect(result).not.toContain('Cell');
  });

  it('inserts at the beginning of text with newline after', () => {
    const [result] = insertTableText('existing text', 0, 1, 2);
    expect(result.startsWith('| Header 1 | Header 2 |')).toBe(true);
    expect(result).toContain('\nexisting text');
  });

  it('inserts at end of text with newline before', () => {
    const [result] = insertTableText('text', 4, 1, 2);
    expect(result).toContain('text\n| Header 1 | Header 2 |');
  });

  it('inserts in the middle with newlines before and after', () => {
    const [result] = insertTableText('before\nafter', 7, 1, 2);
    expect(result).toContain('before\n');
    expect(result).toContain('| Header 1 | Header 2 |');
    expect(result).toContain('\nafter');
  });

  it('does not add extra newline when already at line start', () => {
    const [result] = insertTableText('text\n', 5, 1, 2);
    expect(result).toBe('text\n| Header 1 | Header 2 |\n| --- | --- |\n');
  });

  it('creates correct number of rows', () => {
    const [result] = insertTableText('', 0, 5, 2);
    const lines = result.trim().split('\n');
    expect(lines).toHaveLength(6); // header + separator + 4 data rows
  });

  it('creates correct number of columns', () => {
    const [result] = insertTableText('', 0, 2, 5);
    const headerLine = result.split('\n')[0]; // First line is now the header
    const cellCount = (headerLine.match(/\|/g) || []).length - 1;
    expect(cellCount).toBe(5);
  });

  it('positions cursor at end of table', () => {
    const [result, pos] = insertTableText('start', 5, 1, 2);
    expect(pos).toBe(result.length);
  });
});

describe('insertBlockText', () => {
  it('inserts a block with delimiters on separate lines', () => {
    const [result] = insertBlockText('', [0, 0], '$$', 'x = 1');
    expect(result).toBe('$$\nx = 1\n$$');
  });

  it('inserts a block with newline before when not at start', () => {
    const [result] = insertBlockText('text', [4, 4], '$$', 'math');
    expect(result).toBe('text\n$$\nmath\n$$');
  });

  it('inserts a block with newline after when not at end', () => {
    const [result] = insertBlockText('after', [0, 0], '$$', 'math');
    expect(result).toBe('$$\nmath\n$$\nafter');
  });

  it('inserts a block in the middle of text', () => {
    const [result] = insertBlockText('before\nafter', [7, 7], '$$', 'math');
    expect(result).toBe('before\n$$\nmath\n$$\nafter');
  });

  it('does not add extra newlines when already on own line', () => {
    const [result] = insertBlockText('text\n', [5, 5], '$$', 'math');
    expect(result).toBe('text\n$$\nmath\n$$');
  });

  it('wraps selected text', () => {
    const [result] = insertBlockText('some math here', [5, 9], '$$', '');
    expect(result).toBe('some \n$$\nmath\n$$\n here');
  });

  it('positions cursor correctly with no selection', () => {
    const [, selection] = insertBlockText('', [0, 0], '$$', 'placeholder');
    expect(selection).toEqual([3, 14]); // After "$$\n" to end of placeholder
  });

  it('positions cursor correctly with selection', () => {
    const [, selection] = insertBlockText('text selected', [0, 4], '```', '');
    expect(selection).toEqual([4, 8]); // After "```\n" to end of "text"
  });

  it('works with different delimiters', () => {
    const [result] = insertBlockText('code', [0, 4], '```', '');
    expect(result).toBe('```\ncode\n```');
  });

  it('handles empty text correctly', () => {
    const [result] = insertBlockText('', [0, 0], '```', 'code');
    expect(result).toBe('```\ncode\n```');
  });

  it('handles block at end of existing text', () => {
    const [result] = insertBlockText('some text\n', [10, 10], '$$', 'math');
    expect(result).toBe('some text\n$$\nmath\n$$');
  });

  it('preserves text before and after', () => {
    const [result] = insertBlockText('before\n\nafter', [7, 7], '```', 'code');
    expect(result).toBe('before\n```\ncode\n```\nafter');
  });
});

describe('handleTab', () => {
  describe('bullet lists', () => {
    it('indents a bullet list item', () => {
      const result = handleTab('- item', [0, 6], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    - item');
      }
    });

    it('outdents a nested list item', () => {
      const result = handleTab('    - item', [0, 10], true);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('- item');
      }
    });

    it('cannot outdent a top-level list item', () => {
      const result = handleTab('- item', [0, 6], true);
      expect(result).toBeNull();
    });

    it('preserves cursor position when indenting', () => {
      const result = handleTab('- item', [3, 3], false);
      expect(result).not.toBeNull();
      if (result) {
        const [, selection] = result;
        expect(selection).toEqual([7, 7]); // Moved 4 spaces forward
      }
    });

    it('handles deeply nested lists', () => {
      const result = handleTab('        - item', [0, 14], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('            - item');
      }
    });
  });

  describe('numbered lists', () => {
    it('indents and resets to 1', () => {
      const result = handleTab('2. item', [0, 7], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    1. item');
      }
    });

    it('outdents a nested numbered list', () => {
      const result = handleTab('    1. item', [0, 11], true);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('1. item');
      }
    });

    it('handles multi-digit numbers', () => {
      const result = handleTab('10. item', [0, 8], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    1. item');
      }
    });

    it('adjusts cursor for marker length change', () => {
      const result = handleTab('10. item', [5, 5], false);
      expect(result).not.toBeNull();
      if (result) {
        const [, selection] = result;
        // 10. -> 1. is -1 char, +4 indent = +3 total
        expect(selection[0]).toBe(8);
      }
    });
  });

  describe('quotes', () => {
    it('indents a quote', () => {
      const result = handleTab('> some text', [0, 11], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> > some text');
      }
    });

    it('cannot outdent a single-level quote', () => {
      const result = handleTab('> some text', [0, 11], true);
      expect(result).toBeNull();
    });

    it('cannot outdent a double-nested quote (single > prefix)', () => {
      // The regex only matches the first "> " prefix
      const result = handleTab('> > > text', [0, 10], true);
      expect(result).toBeNull(); // prefix is only "> " (2 chars), can't outdent
    });

    it('handles quote with multiple spaces', () => {
      const result = handleTab('>  text', [0, 7], false);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> >  text');
      }
    });
  });

  it('returns null for non-list/non-quote text', () => {
    const result = handleTab('regular text', [0, 12], false);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = handleTab('', [0, 0], false);
    expect(result).toBeNull();
  });
});

describe('handleEnter', () => {
  describe('bullet lists', () => {
    it('continues a bullet list', () => {
      const result = handleEnter('- item one', 10);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('- item one\n- ');
      }
    });

    it('exits bullet list when item is empty', () => {
      const result = handleEnter('- ', 2);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('');
      }
    });

    it('continues nested bullet list', () => {
      const result = handleEnter('    - nested item', 17);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    - nested item\n    - ');
      }
    });

    it('exits nested list when empty', () => {
      const result = handleEnter('    - ', 6);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    ');
      }
    });

    it('continues list in middle of item', () => {
      const result = handleEnter('- some text here', 7);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('- some \n- text here');
      }
    });
  });

  describe('numbered lists', () => {
    it('continues a numbered list with incremented number', () => {
      const result = handleEnter('1. item one', 11);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('1. item one\n2. ');
      }
    });

    it('exits numbered list when item is empty', () => {
      const result = handleEnter('1. ', 3);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('');
      }
    });

    it('increments from multi-digit number', () => {
      const result = handleEnter('9. item', 7);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('9. item\n10. ');
      }
    });

    it('continues nested numbered list', () => {
      const result = handleEnter('    3. nested', 13);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('    3. nested\n    4. ');
      }
    });

    it('handles number in middle of sequence', () => {
      const result = handleEnter('5. middle item', 14);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('5. middle item\n6. ');
      }
    });
  });

  describe('quotes', () => {
    it('continues a quote', () => {
      const result = handleEnter('> some text', 11);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> some text\n> ');
      }
    });

    it('exits quote when line is empty', () => {
      const result = handleEnter('> ', 2);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('');
      }
    });

    it('continues nested quote (one level at a time)', () => {
      // The regex only matches the first "> " prefix
      const result = handleEnter('> > nested', 10);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> > nested\n> '); // Only first level continues
      }
    });

    it('continues quote when nested quote is empty', () => {
      // For "> > ", regex matches prefix="> " and content="> "
      // Since content is not empty, it continues the quote
      const result = handleEnter('> > ', 4);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> > \n> ');
      }
    });

    it('continues quote in middle of line', () => {
      const result = handleEnter('> text here', 6);
      expect(result).not.toBeNull();
      if (result) {
        const [newValue] = result;
        expect(newValue).toBe('> text\n>  here');
      }
    });
  });

  describe('non-matching cases', () => {
    it('returns null for regular text', () => {
      const result = handleEnter('regular text', 5);
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = handleEnter('', 0);
      expect(result).toBeNull();
    });

    it('returns null for partial list syntax', () => {
      const result = handleEnter('-item', 5);
      expect(result).toBeNull();
    });

    it('returns null for heading', () => {
      const result = handleEnter('## Heading', 10);
      expect(result).toBeNull();
    });
  });
});
