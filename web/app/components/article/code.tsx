'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';

type CodeProps = {
  children: string;
  language?: string;
};

export function Code({ children, language }: CodeProps) {
  const [copied, setCopied] = useState(false);
  const showToast = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('Copied to clipboard');
  };

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        {language && <span className={styles.language}>{language}</span>}
        <button
          className={styles.copyButton}
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          <i className={`fas fa-${copied ? 'check' : 'copy'}`} />
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}
