'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import MarkdownRenderer from '@/components/markdown-renderer';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useIsApple } from '@/display';

import * as fmt from './markdown-formatting';

import styles from './style.module.scss';

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  maxLength: number;
};

type FormatAction = {
  icon: string;
  tooltip: string;
  action: () => void;
  key?: string;
};

function selectRange(el: HTMLTextAreaElement, from: number, to: number) {
  const scrollTop = el.scrollTop;
  el.focus();
  el.setSelectionRange(from, to);
  el.scrollTop = scrollTop;
}

function FormatButton({
  action,
  disabled,
  isApple,
}: {
  action: FormatAction;
  disabled: boolean;
  isApple: boolean;
}) {
  let tooltip = action.tooltip;
  if (action.key) {
    const modifier = isApple ? '⌘' : 'Ctrl';
    tooltip += ` (${modifier}+${action.key.toUpperCase()})`;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className={styles.formatButton}
      onClick={action.action}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content={tooltip}
      data-tooltip-delay-show={250}
      aria-label={action.tooltip}
    >
      <i className={`fas ${action.icon}`} />
    </button>
  );
}

export default function MarkdownEditor({
  value,
  onChange,
  className,
  placeholder,
  maxLength,
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isApple = useIsApple();
  const [savedCursorPosition, setSavedCursorPosition] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [hoveredTableCell, setHoveredTableCell] = useState<{
    rows: number;
    cols: number;
  } | null>(null);
  const tablePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Restore cursor position when returning from preview mode.
    if (!showPreview && savedCursorPosition !== null) {
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea !== null) {
          textarea.focus();
          textarea.setSelectionRange(
            savedCursorPosition.start,
            savedCursorPosition.end,
          );
        }
      });
    }
  }, [showPreview, savedCursorPosition]);

  const handleChange = useCallback(
    (newValue: string) => {
      if (newValue.length > maxLength) {
        onChange(newValue.substring(0, maxLength));
      } else {
        onChange(newValue);
      }
    },
    [onChange, maxLength],
  );

  const wrapInline = useCallback(
    (before: string, after: string = before, placeholder: string = '') => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }

      const [newValue, newSelection] = fmt.wrapInlineText(
        textarea.value,
        [textarea.selectionStart, textarea.selectionEnd],
        before,
        after,
        placeholder,
      );

      handleChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          selectRange(textareaRef.current, newSelection[0], newSelection[1]);
        }
      });
    },
    [handleChange],
  );

  const wrapBlock = useCallback(
    (delimiter: string, placeholder: string = '') => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }

      const [newValue, newSelection] = fmt.insertBlockText(
        textarea.value,
        [textarea.selectionStart, textarea.selectionEnd],
        delimiter,
        placeholder,
      );

      handleChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          selectRange(textareaRef.current, newSelection[0], newSelection[1]);
        }
      });
    },
    [handleChange],
  );

  const toggleLinePrefix = useCallback(
    (prefix: string, includeEmpty: boolean = false) => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }

      const [newValue, newSelection] = fmt.toggleLinePrefixText(
        textarea.value,
        [textarea.selectionStart, textarea.selectionEnd],
        prefix,
        includeEmpty,
      );

      handleChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          selectRange(textareaRef.current, newSelection[0], newSelection[1]);
        }
      });
    },
    [handleChange],
  );

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      const textarea = textareaRef.current;
      if (textarea === null) {
        return;
      }

      const [newValue, newPos] = fmt.insertTableText(
        textarea.value,
        textarea.selectionStart,
        rows,
        cols,
      );

      handleChange(newValue);
      setShowTablePicker(false);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          selectRange(textareaRef.current, newPos, newPos);
        }
      });
    },
    [handleChange],
  );

  useEffect(() => {
    if (!showTablePicker) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (
        tablePickerRef.current &&
        !tablePickerRef.current.contains(e.target as Node)
      ) {
        setShowTablePicker(false);
        setHoveredTableCell(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTablePicker]);

  const formatActions = useMemo(() => {
    const bold: FormatAction = {
      icon: 'fa-bold',
      tooltip: 'Bold',
      action: () => wrapInline('**', '**', 'bold text'),
      key: 'b',
    };

    const italic: FormatAction = {
      icon: 'fa-italic',
      tooltip: 'Italic',
      action: () => wrapInline('*', '*', 'italic text'),
      key: 'i',
    };

    const strikethrough: FormatAction = {
      icon: 'fa-strikethrough',
      tooltip: 'Strikethrough',
      action: () => wrapInline('~~', '~~', 'strikethrough'),
    };

    const heading: FormatAction = {
      icon: 'fa-heading',
      tooltip: 'Heading',
      action: () => {
        const textarea = textareaRef.current;
        if (textarea === null) {
          return;
        }

        const [newValue, newPos] = fmt.cycleHeadingLevel(
          textarea.value,
          textarea.selectionStart,
        );

        handleChange(newValue);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            selectRange(textareaRef.current, newPos, newPos);
          }
        });
      },
    };

    const link: FormatAction = {
      icon: 'fa-link',
      tooltip: 'Link',
      action: () => wrapInline('[', '](url)', 'link text'),
      key: 'k',
    };

    const image: FormatAction = {
      icon: 'fa-image',
      tooltip: 'Image',
      action: () =>
        wrapInline('![', '](https://i.imgur.com/image.png)', 'alt text'),
    };

    const bulletList: FormatAction = {
      icon: 'fa-list-ul',
      tooltip: 'Bullet List',
      action: () => toggleLinePrefix('- '),
    };

    const numberedList: FormatAction = {
      icon: 'fa-list-ol',
      tooltip: 'Numbered List',
      action: () => toggleLinePrefix('1. '),
    };

    const inlineCode: FormatAction = {
      icon: 'fa-code',
      tooltip: 'Inline Code',
      action: () => wrapInline('`', '`', 'code'),
    };

    const codeBlock: FormatAction = {
      icon: 'fa-file-code',
      tooltip: 'Code Block',
      action: () => wrapBlock('```', "print('Hello, Blert!')"),
    };

    const quote: FormatAction = {
      icon: 'fa-quote-right',
      tooltip: 'Quote',
      action: () => toggleLinePrefix('> ', /*includeEmpty=*/ true),
    };

    const inlineMath: FormatAction = {
      icon: 'fa-square-root-alt',
      tooltip: 'Inline Math',
      action: () => wrapInline('$', '$', 'E = mc^2'),
    };

    const displayMath: FormatAction = {
      icon: 'fa-superscript',
      tooltip: 'Display Math',
      action: () =>
        wrapBlock(
          '$$',
          '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}',
        ),
    };

    const inlineActions = [
      bold,
      italic,
      strikethrough,
      link,
      inlineCode,
      inlineMath,
    ];

    const blockActions = [
      heading,
      image,
      bulletList,
      numberedList,
      quote,
      codeBlock,
      displayMath,
    ];

    return { inlineActions, blockActions };
  }, [wrapInline, wrapBlock, toggleLinePrefix, handleChange]);

  const handleShortcutKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!e.ctrlKey && !e.metaKey) {
        return false;
      }

      const allActions = [
        ...formatActions.inlineActions,
        ...formatActions.blockActions,
      ];
      const action = allActions.find((action) => action.key === e.key);
      if (action) {
        e.preventDefault();
        action.action();
        return true;
      }

      return false;
    },
    [formatActions],
  );

  const handleTabKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current;
      if (e.key !== 'Tab' || textarea === null) {
        return false;
      }

      const result = fmt.handleTab(
        textarea.value,
        [textarea.selectionStart, textarea.selectionEnd],
        e.shiftKey,
      );

      if (result !== null) {
        e.preventDefault();
        const [newValue, newSelection] = result;
        handleChange(newValue);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            selectRange(textareaRef.current, newSelection[0], newSelection[1]);
          }
        });
        return true;
      }

      return false;
    },
    [handleChange],
  );

  const handleEnterKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) {
        return false;
      }
      const textarea = textareaRef.current;
      if (textarea === null) {
        return false;
      }

      const cursorPos = textarea.selectionStart;

      const result = fmt.handleEnter(textarea.value, cursorPos);
      if (result !== null) {
        e.preventDefault();
        const [newValue, newPos] = result;
        handleChange(newValue);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            selectRange(textareaRef.current, newPos, newPos);
          }
        });
        return true;
      }

      return false;
    },
    [handleChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleShortcutKey(e)) {
        return;
      }
      if (handleTabKey(e)) {
        return;
      }
      if (handleEnterKey(e)) {
        return;
      }
    },
    [handleShortcutKey, handleTabKey, handleEnterKey],
  );

  const handleTogglePreview = useCallback(() => {
    if (!showPreview) {
      // Save cursor position before switching to preview mode.
      const textarea = textareaRef.current;
      if (textarea !== null) {
        setSavedCursorPosition({
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
        });
      }
    }
    setShowPreview(!showPreview);
  }, [showPreview]);

  const characterCount = value.length;
  const isNearLimit = characterCount > maxLength * 0.9;
  const isOverLimit = characterCount > maxLength;

  return (
    <div className={`${styles.editor} ${className || ''}`}>
      <div className={styles.toolbar}>
        <div className={styles.formatButtons}>
          {formatActions.inlineActions.map((action, index) => (
            <FormatButton
              key={index}
              action={action}
              disabled={showPreview}
              isApple={isApple}
            />
          ))}
          <div className={styles.toolbarDivider} />
          {formatActions.blockActions.map((action, index) => (
            <FormatButton
              key={index}
              action={action}
              disabled={showPreview}
              isApple={isApple}
            />
          ))}
          <div className={styles.tableButtonWrapper} ref={tablePickerRef}>
            <button
              type="button"
              disabled={showPreview}
              className={`${styles.formatButton} ${showTablePicker ? styles.active : ''}`}
              onClick={() => {
                setShowTablePicker(!showTablePicker);
                setHoveredTableCell(null);
              }}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Table"
              data-tooltip-delay-show={250}
            >
              <i className="fas fa-table" />
            </button>
            {showTablePicker && (
              <div className={styles.tablePicker}>
                <div
                  className={styles.tableGrid}
                  onMouseLeave={() => setHoveredTableCell(null)}
                >
                  {Array.from({ length: 6 }, (_, row) =>
                    Array.from({ length: 8 }, (_, col) => (
                      <div
                        key={`${row}-${col}`}
                        className={`${styles.tableCell} ${
                          row === 0 ? styles.headerRow : ''
                        } ${
                          hoveredTableCell &&
                          row <= hoveredTableCell.rows - 1 &&
                          col <= hoveredTableCell.cols - 1
                            ? styles.selected
                            : ''
                        }`}
                        onMouseEnter={() =>
                          setHoveredTableCell({ rows: row + 1, cols: col + 1 })
                        }
                        onClick={() => insertTable(row + 1, col + 1)}
                      />
                    )),
                  )}
                </div>
                <div className={styles.tableLabel}>
                  {hoveredTableCell
                    ? `${hoveredTableCell.rows} × ${hoveredTableCell.cols}`
                    : 'Select table size'}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={`${styles.toolbarButton} ${showHelp ? styles.active : ''}`}
            onClick={() => setShowHelp(!showHelp)}
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content="Markdown help"
            data-tooltip-delay-show={250}
          >
            <i className="fas fa-question-circle" />
          </button>
          <button
            type="button"
            className={`${styles.toolbarButton} ${showPreview ? styles.active : ''} ${styles.previewButton}`}
            onClick={handleTogglePreview}
            data-tooltip-id={GLOBAL_TOOLTIP_ID}
            data-tooltip-content="Toggle preview"
            data-tooltip-delay-show={250}
          >
            <i className={`fas ${showPreview ? 'fa-edit' : 'fa-eye'}`} />
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className={styles.helpPanel}>
          <div className={styles.helpContent}>
            <h4>Markdown Quick Reference</h4>
            <div className={styles.helpGrid}>
              <div className={styles.helpItem}>
                <code>**bold**</code>
                <span>Bold text</span>
              </div>
              <div className={styles.helpItem}>
                <code>*italic*</code>
                <span>Italic text</span>
              </div>
              <div className={styles.helpItem}>
                <code>~~strike~~</code>
                <span>Strikethrough</span>
              </div>
              <div className={styles.helpItem}>
                <code>[text](url)</code>
                <span>Link</span>
              </div>
              <div className={styles.helpItem}>
                <code>![alt](url)</code>
                <span>Image</span>
              </div>
              <div className={styles.helpItem}>
                <code>`code`</code>
                <span>Inline code</span>
              </div>
              <div className={styles.helpItem}>
                <code>```...```</code>
                <span>Code block</span>
              </div>
              <div className={styles.helpItem}>
                <code>## Heading</code>
                <span>Heading</span>
              </div>
              <div className={styles.helpItem}>
                <code>- item</code>
                <span>Bullet list</span>
              </div>
              <div className={styles.helpItem}>
                <code>1. item</code>
                <span>Numbered list</span>
              </div>
              <div className={styles.helpItem}>
                <code>&gt; quote</code>
                <span>Quote</span>
              </div>
              <div className={styles.helpItem}>
                <code>$x^2$</code>
                <span>Inline math</span>
              </div>
              <div className={styles.helpItem}>
                <code>$$...$$</code>
                <span>Display math</span>
              </div>
            </div>
            <p className={styles.helpNote}>
              <i className="fas fa-info-circle" />
              Images must be hosted on trusted sites (imgur, discord, reddit).
              Only HTTPS URLs are allowed.
            </p>
          </div>
        </div>
      )}

      <div className={styles.editorContent}>
        {showPreview ? (
          <div className={styles.preview}>
            {value ? (
              <MarkdownRenderer content={value} />
            ) : (
              <div className={styles.emptyPreview}>
                Nothing to preview. Start typing to see your markdown rendered.
              </div>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={styles.textarea}
            maxLength={maxLength}
          />
        )}
      </div>

      <div className={styles.footer}>
        <span
          className={`${styles.characterCount} ${
            isOverLimit ? styles.error : isNearLimit ? styles.warning : ''
          }`}
        >
          {characterCount} / {maxLength}
        </span>
      </div>
    </div>
  );
}
