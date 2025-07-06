'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useReplayContext } from './replay-context';

import styles from './dev-console.module.scss';

type LogEntry = {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
};

type DevConsoleProps = {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
};

const COMMANDS = {
  '/debug': ['on', 'off'],
  '/clear': [],
  '/help': [],
} as const;

export default function DevConsole({
  isOpen,
  onToggle,
  onClose,
}: DevConsoleProps) {
  const { updateConfig } = useReplayContext();
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completionState, setCompletionState] = useState<{
    matches: string[];
    index: number;
    originalInput: string;
  } | null>(null);
  const isTabCompletingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Pre-populate the input with `/` as the user has already typed it.
      setInput('/');
      setCompletionState(null);
      inputRef.current.focus();
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            inputRef.current.value.length,
            inputRef.current.value.length,
          );
        }
      }, 0);
    } else if (!isOpen) {
      setInput('');
      setCompletionState(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = useCallback(
    (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
      setLogs((prev) => [...prev, { timestamp: new Date(), message, level }]);
    },
    [],
  );

  const handleTabCompletion = useCallback(() => {
    if (!input.trim()) {
      return;
    }

    isTabCompletingRef.current = true;

    const parts = input.trim().split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    // Check if we're cycling through existing completions.
    if (completionState && completionState.matches.length > 0) {
      const currentMatch = completionState.matches[completionState.index];
      let expectedInput = '';

      if (parts.length === 1) {
        expectedInput = currentMatch + ' ';
      } else if (parts.length === 2) {
        expectedInput = `${command} ${currentMatch}`;
      }

      if (input === expectedInput.trim() || input === expectedInput) {
        const nextIndex =
          (completionState.index + 1) % completionState.matches.length;
        const nextMatch = completionState.matches[nextIndex];

        let newInput = '';
        if (parts.length === 1) {
          newInput = nextMatch + ' ';
        } else if (parts.length === 2) {
          newInput = `${command} ${nextMatch}`;
        }

        setInput(newInput);
        setCompletionState({
          ...completionState,
          index: nextIndex,
        });

        setTimeout(() => {
          isTabCompletingRef.current = false;
        }, 0);
        return;
      }
    }

    // Start a new completion.
    let matches: string[] = [];
    let originalInput = input;

    if (parts.length === 1) {
      const availableCommands = Object.keys(COMMANDS);
      matches = availableCommands.filter((cmd) =>
        cmd.startsWith(command.toLowerCase()),
      );

      if (matches.length === 1) {
        setInput(matches[0] + ' ');
        setCompletionState(null);
      } else if (matches.length > 1) {
        const firstMatch = matches[0];
        setInput(firstMatch + ' ');
        setCompletionState({
          matches,
          index: 0,
          originalInput,
        });
      }
    } else if (parts.length === 2) {
      // Completing arguments.
      const cmdKey = command.toLowerCase() as keyof typeof COMMANDS;
      const availableArgs = COMMANDS[cmdKey];

      if (availableArgs && availableArgs.length > 0) {
        const currentArg = args[0];
        matches = availableArgs.filter((arg) =>
          arg.startsWith(currentArg.toLowerCase()),
        );

        if (matches.length === 1) {
          setInput(`${command} ${matches[0]}`);
          setCompletionState(null);
        } else if (matches.length > 1) {
          const firstMatch = matches[0];
          setInput(`${command} ${firstMatch}`);
          setCompletionState({
            matches,
            index: 0,
            originalInput,
          });
        }
      }
    }

    setTimeout(() => {
      isTabCompletingRef.current = false;
    }, 0);
  }, [input, completionState]);

  const executeCommand = useCallback(
    (command: string) => {
      if (!command.trim()) {
        return;
      }

      const trimmed = command.trim();
      addLog(`> ${trimmed}`, 'info');

      setCompletionState(null);

      setCommandHistory((prev) => [...prev, trimmed]);
      setHistoryIndex(-1);

      const parts = trimmed.split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      switch (cmd) {
        case '/debug': {
          const action = args[0]?.toLowerCase();
          if (action === 'on') {
            updateConfig((prev) => ({ ...prev, debug: true }));
            addLog('Debug mode enabled', 'info');
          } else if (action === 'off') {
            updateConfig((prev) => ({ ...prev, debug: false }));
            addLog('Debug mode disabled', 'info');
          } else {
            addLog('Usage: /debug on|off', 'warn');
          }
          break;
        }

        case '/clear': {
          setLogs([]);
          break;
        }

        case '/help': {
          addLog('Available commands:', 'info');
          addLog('  /debug on|off - Toggle debug mode', 'info');
          addLog('  /clear - Clear console output', 'info');
          addLog('  /help - Show this help message', 'info');
          break;
        }

        default: {
          addLog(`Unknown command: ${cmd}`, 'error');
          addLog('Type /help for available commands', 'info');
        }
      }
    },
    [addLog, updateConfig],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        executeCommand(input);
        setInput('');
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleTabCompletion();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCompletionState(null);
        if (commandHistory.length > 0) {
          const newIndex =
            historyIndex === -1
              ? commandHistory.length - 1
              : Math.max(0, historyIndex - 1);
          setHistoryIndex(newIndex);
          setInput(commandHistory[newIndex]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCompletionState(null);
        if (historyIndex !== -1) {
          const newIndex = historyIndex + 1;
          if (newIndex >= commandHistory.length) {
            setHistoryIndex(-1);
            setInput('');
          } else {
            setHistoryIndex(newIndex);
            setInput(commandHistory[newIndex]);
          }
        }
      }
    },
    [
      input,
      executeCommand,
      onClose,
      commandHistory,
      historyIndex,
      handleTabCompletion,
    ],
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isOpen && e.key === '/') {
        e.preventDefault();
        onToggle();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onToggle]);

  useEffect(() => {
    if (logs.length === 0) {
      addLog('Type /help for commands', 'info');
    }
  }, [logs.length, addLog]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.devConsole}>
      <div className={styles.logs} ref={logsRef}>
        {logs.map((log, index) => (
          <div
            key={index}
            className={`${styles.logEntry} ${styles[log.level]}`}
          >
            <span className={styles.message}>{log.message}</span>
          </div>
        ))}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (!isTabCompletingRef.current) {
            setCompletionState(null);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a command..."
        className={styles.input}
      />
    </div>
  );
}
