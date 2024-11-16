import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';

import Input, { InputProps } from '@/components/input';
import Menu, { MenuItem } from '@/components/menu';

import styles from './style.module.scss';

type PlayerSearchProps = Omit<InputProps, 'inputRef' | 'onChange' | 'type'> & {
  onChange?: (value: string) => void;
  onSelection?: (value: string) => void;
};

function toMenuItem(value: string): MenuItem {
  return { label: value, value };
}

const PlayerSearch = forwardRef<HTMLInputElement, PlayerSearchProps>(
  function PlayerSearch(props, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [suggestions, setSuggestions] = useState<MenuItem[]>([]);

    const {
      className,
      onBlur,
      onChange,
      onFocus,
      onKeyDown,
      onSelection,
      ...inputProps
    } = props;

    const setIfCurrent = useCallback((value: string) => {
      return (suggestions: string[]) => {
        if (inputRef.current?.value === value) {
          setSuggestions(suggestions.map(toMenuItem));
        }
      };
    }, []);

    const onBrowse = useCallback(
      (item: MenuItem | null) => {
        if (item !== null) {
          if (onChange) {
            onChange(item.value! as string);
          }
          inputRef.current!.value = item.value! as string;
        }
      },
      [onChange],
    );

    const isControlled = props.value !== undefined;

    const menu = useMemo(() => {
      return (
        <Menu
          attach="bottom"
          onBrowse={onBrowse}
          itemClass={styles.suggestion}
          items={suggestions}
          menuClass={styles.suggestions}
          onSelection={(value) => {
            setSuggestions([]);
            onSelection?.(value as string);
            if (!isControlled) {
              inputRef.current!.value = '';
            }
          }}
          open={suggestions.length > 0}
          targetId={props.id}
        />
      );
    }, [suggestions, props.id, isControlled, onBrowse, onSelection]);

    let inputClassName = styles.input;
    if (className) {
      inputClassName += ` ${className}`;
    }
    if (suggestions.length > 0) {
      inputClassName += ` ${styles.open}`;
    }

    return (
      <div className={styles.wrapper}>
        <Input
          {...inputProps}
          inputClassName={inputClassName}
          onBlur={() => {
            setSuggestions([]);
          }}
          onChange={(e) => {
            if (e.target.value !== '') {
              const suggestions = cache.getAndUpdate(
                e.target.value,
                setIfCurrent(e.target.value),
              );
              if (suggestions !== undefined) {
                setSuggestions(suggestions.map(toMenuItem));
              }
            } else {
              setSuggestions([]);
            }
            onChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSuggestions([]);
              onSelection?.(props.value ?? inputRef.current!.value);
              if (!isControlled) {
                inputRef.current!.value = '';
              }
            }
            onKeyDown?.(e);
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
                cache
                  .getAndUpdate(
                    inputRef.current!.value,
                    setIfCurrent(inputRef.current!.value),
                  )
                  ?.map(toMenuItem) ?? [],
              );
            }
          }}
          type="text"
        />
        {menu}
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
