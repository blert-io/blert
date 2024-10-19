import { forwardRef, useCallback, useRef, useState } from 'react';

import Input, { InputProps } from '@/components/input';

import styles from './style.module.scss';

type PlayerSearchProps = Omit<InputProps, 'inputRef' | 'type'> & {
  onSelection?: (value: string) => void;
};

const PlayerSearch = forwardRef<HTMLInputElement, PlayerSearchProps>(
  (props, ref) => {
    const inputRef = useRef<HTMLInputElement | null>(null);

    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestionIndex, setSuggestionIndex] = useState<number>(-1);

    const { onBlur, onChange, onFocus, onKeyDown, onSelection, ...inputProps } =
      props;

    const setIfCurrent = useCallback((value: string) => {
      return (suggestions: string[]) => {
        if (inputRef.current?.value === value) {
          setSuggestions(suggestions);
        }
      };
    }, []);

    return (
      <div className={styles.wrapper}>
        <Input
          {...inputProps}
          onBlur={() => {
            setSuggestions([]);
            setSuggestionIndex(-1);
          }}
          onChange={(e) => {
            if (e.target.value !== '') {
              const suggestions = cache.getAndUpdate(
                e.target.value,
                setIfCurrent(e.target.value),
              );
              if (suggestions !== undefined) {
                setSuggestions(suggestions);
              }
            } else {
              setSuggestions([]);
            }
            setSuggestionIndex(-1);
            onChange?.(e);
          }}
          ref={(element) => {
            inputRef.current = element;
            if (typeof ref === 'function') {
              ref(element);
            } else if (ref) {
              ref.current = element;
            }
          }}
          onFocus={() => {
            if (inputRef.current!.value !== '') {
              setSuggestions(
                cache.getAndUpdate(
                  inputRef.current!.value,
                  setIfCurrent(inputRef.current!.value),
                ) ?? [],
              );
            }
            setSuggestionIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSuggestionIndex((i) => (i + 1) % suggestions.length);
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSuggestionIndex((i) =>
                i <= 0 ? suggestions.length - 1 : i - 1,
              );
            }
            if (e.key === 'Enter') {
              if (suggestionIndex >= 0) {
                onSelection?.(suggestions[suggestionIndex]);
              } else {
                onSelection?.(inputRef.current!.value);
              }
              if (props.value === undefined) {
                // If the component is uncontrolled, clear the input once a
                // suggestion is selected.
                inputRef.current!.value = '';
                setSuggestions([]);
                setSuggestionIndex(-1);
              }
            }
            onKeyDown?.(e);
          }}
          type="text"
        />
        {suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((suggestion, i) => (
              <div
                key={suggestion}
                className={`${styles.suggestion} ${
                  i === suggestionIndex ? styles.selected : ''
                }`}
                onClick={() => {
                  setSuggestions([]);
                  inputRef.current!.value = suggestion;
                  inputRef.current!.focus();
                }}
                onMouseEnter={() => setSuggestionIndex(i)}
              >
                {suggestion}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);

export default PlayerSearch;

type CachedSuggestion = {
  results: string[];
  expiry: number;
};

class SuggestionCache {
  private static readonly EXPIRY_PERIOD = 1000 * 15;

  private cache: Map<string, CachedSuggestion> = new Map();

  public getAndUpdate(
    query: string,
    callback: (suggestions: string[]) => void,
  ): string[] | undefined {
    const cached = this.cache.get(query);

    if (!cached || cached.expiry < Date.now()) {
      this.fetch(query).then(() => {
        const suggestions = this.cache.get(query)!.results ?? [];
        callback(suggestions);
      });
    }

    return cached?.results;
  }

  private async fetch(query: string): Promise<void> {
    const res = await fetch(`/api/suggest?type=players&q=${query}`);
    const data = await res.json();
    this.cache.set(query, {
      results: data.results.map((s: any) => s.value),
      expiry: Date.now() + SuggestionCache.EXPIRY_PERIOD,
    });
  }
}

const cache = new SuggestionCache();
