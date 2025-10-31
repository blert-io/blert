type SelectionRange = [number, number];

type Line = {
  start: number;
  end: number;
  text: string;
};

/**
 * Returns the line of text at the given position.
 * @param input The input text.
 * @param cursorPos The position of the cursor.
 * @returns The line of text at the given position.
 */
function getLine(input: string, cursorPos: number): Line {
  const start = input.lastIndexOf('\n', cursorPos - 1) + 1;
  let end = input.indexOf('\n', cursorPos);
  if (end === -1) {
    end = input.length;
  }
  const text = input.substring(start, end);
  return { start, end, text };
}

/**
 * Wraps selected text (or inserts placeholder) with before/after strings.
 * If text is already wrapped, unwraps it.
 */
export function wrapInlineText(
  input: string,
  selection: SelectionRange,
  before: string,
  after: string = before,
  placeholder: string = '',
): [string, SelectionRange] {
  const [start, end] = selection;
  const selectedText = input.substring(start, end);
  const isWrapped =
    input.substring(start - before.length, start) === before &&
    input.substring(end, end + after.length) === after;

  let newValue: string;
  let newStart: number;
  let newEnd: number;

  if (selectedText && isWrapped) {
    newValue =
      input.substring(0, start - before.length) +
      selectedText +
      input.substring(end + after.length);
    newStart = start - before.length;
    newEnd = end - before.length;
  } else {
    const insert = selectedText || placeholder;
    newValue =
      input.substring(0, start) +
      before +
      insert +
      after +
      input.substring(end);
    newStart = start + before.length;
    newEnd = selectedText
      ? end + before.length
      : start + before.length + insert.length;
  }

  return [newValue, [newStart, newEnd]];
}

/**
 * Toggles a prefix on all lines in the selection.
 * If all lines have the prefix, removes it. Otherwise, adds it.
 */
export function toggleLinePrefixText(
  input: string,
  selection: SelectionRange,
  prefix: string,
  includeEmpty: boolean = false,
): [string, SelectionRange] {
  const [start, end] = selection;
  const blockStart = input.lastIndexOf('\n', start - 1) + 1;
  let blockEnd = input.indexOf('\n', end);
  if (blockEnd === -1) {
    blockEnd = input.length;
  }

  const isEmptyLine = (line: string) => !includeEmpty && line.trim() === '';

  const lines = input.substring(blockStart, blockEnd).split('\n');
  const nonEmptyLines = lines.filter((line) => !isEmptyLine(line));
  const allPrefixed = nonEmptyLines.every((line) => line.startsWith(prefix));
  const delta =
    (allPrefixed ? -prefix.length : prefix.length) * nonEmptyLines.length;

  const newLines = lines.map((line) => {
    if (isEmptyLine(line)) {
      return line;
    }
    return allPrefixed ? line.substring(prefix.length) : prefix + line;
  });

  const newValue =
    input.substring(0, blockStart) +
    newLines.join('\n') +
    input.substring(blockEnd);

  return [newValue, [start, end + delta]];
}

/**
 * Cycles through heading levels (## -> ### -> #### -> ##### -> ###### -> no heading -> ##).
 */
export function cycleHeadingLevel(
  input: string,
  cursorPos: number,
): [string, number] {
  const line = getLine(input, cursorPos);

  let newLine: string;

  const match = line.text.match(/^(#{1,6})\s+/);
  if (match === null) {
    newLine = `## ${line.text}`;
  } else if (match[1].length < 6) {
    newLine =
      '#'.repeat(match[1].length + 1) +
      ' ' +
      line.text.substring(match[0].length);
  } else {
    newLine = line.text.replace(/^#{1,6}\s+/, '');
  }

  const newValue =
    input.substring(0, line.start) + newLine + input.substring(line.end);
  const newPos = Math.min(line.start + newLine.length, newValue.length);

  return [newValue, newPos];
}

/**
 * Inserts a markdown table at the cursor position.
 * Ensures the table is on its own lines with proper spacing.
 */
export function insertTableText(
  input: string,
  cursorPos: number,
  rows: number,
  cols: number,
): [string, number] {
  const headers = Array(cols)
    .fill(null)
    .map((_, i) => `Header ${i + 1}`)
    .join(' | ');
  const separator = Array(cols).fill('---').join(' | ');

  const tableRows = [`| ${headers} |`, `| ${separator} |`];
  if (rows > 1) {
    const rowTemplate = '| ' + Array(cols).fill('Cell').join(' | ') + ' |';
    for (let i = 0; i < rows - 1; i++) {
      tableRows.push(rowTemplate);
    }
  }

  const before = input.substring(0, cursorPos);
  const after = input.substring(cursorPos);
  const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
  const needsNewlineAfter = after.length > 0 && !after.startsWith('\n');

  const prefix = needsNewlineBefore ? '\n' : '';
  const suffix = needsNewlineAfter ? '\n' : '';
  const table = prefix + tableRows.join('\n') + '\n' + suffix;

  const newValue = before + table + after;
  const newPos = before.length + table.length;

  return [newValue, newPos];
}

/**
 * Handles Tab key in a list item (indents or outdents).
 * Returns null if not in a list.
 */
function handleTabInList(
  input: string,
  selection: SelectionRange,
  line: Line,
  isShift: boolean,
): [string, SelectionRange] | null {
  const [cursorPos, cursorEnd] = selection;

  // Check if we're in a list (bullet or numbered).
  const listMatch = line.text.match(/^(\s*)(-|\d+\.)\s+(.*)$/);
  if (!listMatch) {
    return null;
  }

  const currentIndent = listMatch[1];
  const listMarker = listMatch[2];
  const content = listMatch[3];

  const isNumbered = listMarker !== '-';
  const indentSize = 4;

  if (isShift) {
    // Shift+Tab: Remove one level of indentation
    if (currentIndent.length < indentSize) {
      return null; // Can't outdent further
    }

    const newIndent = currentIndent.substring(indentSize);
    const newLine = `${newIndent}${listMarker} ${content}`;
    const newValue =
      input.substring(0, line.start) + newLine + input.substring(line.end);

    const offsetInLine = cursorPos - line.start;
    const newOffset = Math.max(
      newIndent.length + listMarker.length + 1,
      offsetInLine - indentSize,
    );
    const newPos = line.start + newOffset;
    const newEnd =
      cursorEnd === cursorPos
        ? newPos
        : line.start + Math.max(newOffset, cursorEnd - line.start - indentSize);

    return [newValue, [newPos, newEnd]];
  } else {
    // Tab: Add one level of indentation.
    const newIndent = currentIndent + ' '.repeat(indentSize);
    // Reset numbered lists to 1 when nesting
    const newMarker = isNumbered ? '1.' : listMarker;
    const newLine = `${newIndent}${newMarker} ${content}`;
    const newValue =
      input.substring(0, line.start) + newLine + input.substring(line.end);

    const offsetInLine = cursorPos - line.start;
    // Account for marker length change if numbered list.
    const markerDiff = isNumbered ? newMarker.length - listMarker.length : 0;
    const newPos = line.start + offsetInLine + indentSize + markerDiff;
    const newEnd =
      cursorEnd === cursorPos ? newPos : cursorEnd + indentSize + markerDiff;

    return [newValue, [newPos, newEnd]];
  }
}

/**
 * Handles Tab key in a quote (adds or removes quote level).
 * Returns null if not in a quote.
 */
function handleTabInQuote(
  input: string,
  selection: SelectionRange,
  line: Line,
  isShift: boolean,
): [string, SelectionRange] | null {
  const [cursorPos, cursorEnd] = selection;

  const quoteMatch = line.text.match(/^(>\s*)(.*)$/);
  if (!quoteMatch) {
    return null;
  }

  const prefix = quoteMatch[1];
  const content = quoteMatch[2];

  if (isShift) {
    // Shift+Tab: Remove one level of quoting.
    if (prefix.length <= 2) {
      return null; // Can't remove further
    }

    const newPrefix = prefix.substring(2);
    const newLine = `${newPrefix}${content}`;
    const newValue =
      input.substring(0, line.start) + newLine + input.substring(line.end);

    const offsetInLine = cursorPos - line.start;
    const newOffset = Math.max(newPrefix.length, offsetInLine - 2);
    const newPos = line.start + newOffset;
    const newEnd =
      cursorEnd === cursorPos
        ? newPos
        : line.start + Math.max(newOffset, cursorEnd - line.start - 2);

    return [newValue, [newPos, newEnd]];
  } else {
    // Tab: Add one level of quoting.
    const newLine = `> ${prefix}${content}`;
    const newValue =
      input.substring(0, line.start) + newLine + input.substring(line.end);

    const offsetInLine = cursorPos - line.start;
    const newPos = line.start + offsetInLine + 2;
    const newEnd = cursorEnd === cursorPos ? newPos : cursorEnd + 2;

    return [newValue, [newPos, newEnd]];
  }
}

/**
 * Handles Enter key in a bullet list (continues list or exits if empty).
 * Returns null if not in a bullet list.
 */
function handleEnterInBulletList(
  input: string,
  cursorPos: number,
  line: Line,
): [string, number] | null {
  const bulletMatch = line.text.match(/^(\s*)-\s+(.*)$/);
  if (!bulletMatch) {
    return null;
  }

  const indent = bulletMatch[1];
  const content = bulletMatch[2];

  if (content === '') {
    // If the list item is empty, remove it and exit the list.
    const newValue =
      input.substring(0, line.start) + indent + input.substring(cursorPos);
    return [newValue, line.start + indent.length];
  } else {
    // Add a new bullet point.
    const newValue =
      input.substring(0, cursorPos) +
      `\n${indent}- ` +
      input.substring(cursorPos);
    const newPos = cursorPos + indent.length + 3;
    return [newValue, newPos];
  }
}

/**
 * Handles Enter key in a numbered list (continues list or exits if empty).
 * Returns null if not in a numbered list.
 */
function handleEnterInNumberedList(
  input: string,
  cursorPos: number,
  line: Line,
): [string, number] | null {
  const numberedMatch = line.text.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (!numberedMatch) {
    return null;
  }

  const indent = numberedMatch[1];
  const currentNum = parseInt(numberedMatch[2]);
  const content = numberedMatch[3];

  if (content === '') {
    // If the list item is empty, remove it and exit the list.
    const newValue =
      input.substring(0, line.start) + indent + input.substring(cursorPos);
    return [newValue, line.start + indent.length];
  } else {
    // Add a new numbered item with an incremented number.
    const nextNum = currentNum + 1;
    const newValue =
      input.substring(0, cursorPos) +
      `\n${indent}${nextNum}. ` +
      input.substring(cursorPos);
    const newPos = cursorPos + indent.length + nextNum.toString().length + 3;
    return [newValue, newPos];
  }
}

/**
 * Handles Enter key in a quote (continues quote or exits if empty).
 * Returns null if not in a quote.
 */
function handleEnterInQuote(
  input: string,
  cursorPos: number,
  line: Line,
): [string, number] | null {
  const quoteMatch = line.text.match(/^(>\s*)(.*)$/);
  if (!quoteMatch) {
    return null;
  }

  const prefix = quoteMatch[1];
  const content = quoteMatch[2];

  if (content === '') {
    // If the quote line is empty, remove it and exit the quote.
    const newValue =
      input.substring(0, line.start) + input.substring(cursorPos);
    return [newValue, line.start];
  } else {
    // Continue the quote on the next line.
    const newValue =
      input.substring(0, cursorPos) +
      `\n${prefix}` +
      input.substring(cursorPos);
    const newPos = cursorPos + prefix.length + 1;
    return [newValue, newPos];
  }
}

export function handleTab(
  input: string,
  selection: SelectionRange,
  isShift: boolean,
): [string, SelectionRange] | null {
  const line = getLine(input, selection[0]);

  const listResult = handleTabInList(input, selection, line, isShift);
  if (listResult) {
    return listResult;
  }

  const quoteResult = handleTabInQuote(input, selection, line, isShift);
  if (quoteResult) {
    return quoteResult;
  }

  return null;
}

export function handleEnter(
  input: string,
  cursorPos: number,
): [string, number] | null {
  const line = getLine(input, cursorPos);

  const bulletResult = handleEnterInBulletList(input, cursorPos, line);
  if (bulletResult) {
    return bulletResult;
  }

  const numberedResult = handleEnterInNumberedList(input, cursorPos, line);
  if (numberedResult) {
    return numberedResult;
  }

  const quoteResult = handleEnterInQuote(input, cursorPos, line);
  if (quoteResult) {
    return quoteResult;
  }

  return null;
}

/**
 * Inserts a block element (like code blocks or display math) with proper
 * line spacing. Ensures the block is on its own lines.
 */
export function insertBlockText(
  input: string,
  selection: SelectionRange,
  delimiter: string,
  placeholder: string = '',
): [string, SelectionRange] {
  const [start, end] = selection;
  const selectedText = input.substring(start, end);
  const insert = selectedText || placeholder;

  // Ensure block is on its own lines.
  const before = input.substring(0, start);
  const after = input.substring(end);
  const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
  const needsNewlineAfter = after.length > 0 && !after.startsWith('\n');

  const prefix = needsNewlineBefore ? `\n${delimiter}\n` : `${delimiter}\n`;
  const suffix = needsNewlineAfter ? `\n${delimiter}\n` : `\n${delimiter}`;

  const newValue = before + prefix + insert + suffix + after;
  const newStart = before.length + prefix.length;
  const newEnd = selectedText
    ? newStart + selectedText.length
    : newStart + insert.length;

  return [newValue, [newStart, newEnd]];
}
