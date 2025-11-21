'use client';

import { useState, useCallback } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';

type CodeProps = {
  children: string;
  language?: string;
  filename?: string;
};

export function Code({ children, language, filename }: CodeProps) {
  const [copied, setCopied] = useState(false);
  const showToast = useToast();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      showToast('Code copied to clipboard!', 'success');

      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
      showToast('Failed to copy code', 'error');
    }
  }, [children, showToast]);

  const getLanguageDisplayName = (lang?: string): string => {
    if (!lang) {
      return '';
    }

    const languageMap: Record<string, string> = {
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      tsx: 'TSX',
      jsx: 'JSX',
      scss: 'SCSS',
      css: 'CSS',
      html: 'HTML',
      bash: 'Bash',
      shell: 'Shell',
      json: 'JSON',
      yaml: 'YAML',
      yml: 'YAML',
      toml: 'TOML',
      python: 'Python',
      rust: 'Rust',
      go: 'Go',
      java: 'Java',
      c: 'C',
      cpp: 'C++',
      csharp: 'C#',
      php: 'PHP',
      ruby: 'Ruby',
      swift: 'Swift',
      kotlin: 'Kotlin',
      sql: 'SQL',
      graphql: 'GraphQL',
      markdown: 'Markdown',
      md: 'Markdown',
      dockerfile: 'Dockerfile',
      nginx: 'Nginx',
      apache: 'Apache',
      vim: 'Vim',
      git: 'Git',
      diff: 'Diff',
      patch: 'Patch',
    };

    return languageMap[lang.toLowerCase()] || lang.toUpperCase();
  };

  const displayLanguage = getLanguageDisplayName(language);
  const lineCount = children.split('\n').length;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <div className={styles.codeInfo}>
          {filename && (
            <span className={styles.filename} title={filename}>
              <i className="fas fa-file-code" />
              {filename}
            </span>
          )}
          {displayLanguage && (
            <span
              className={styles.language}
              title={`Language: ${displayLanguage}`}
            >
              {displayLanguage}
            </span>
          )}
          <span className={styles.lineCount} title={`${lineCount} lines`}>
            <i className="fas fa-list-ol" />
            {lineCount}
          </span>
        </div>
        <button
          className={styles.copyButton}
          onClick={() => void handleCopy()}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
          disabled={copied}
        >
          <i className={`fas fa-${copied ? 'check' : 'copy'}`} />
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}
