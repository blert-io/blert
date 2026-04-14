import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Input, { InputProps } from '@/components/input';
import Menu, { MenuItem } from '@/components/menu';

import styles from './style.module.scss';

type PlayerSearchProps = Omit<InputProps, 'inputRef' | 'onChange' | 'type'> & {
  onChange?: (value: string) => void;
  onSelection?: (value: string) => void;
};

const DEBOUNCE_MS = 200;

function toMenuItem(value: string): MenuItem {
  return { label: value, value };
}

const PlayerSearch = forwardRef<HTMLInputElement, PlayerSearchProps>(
  function PlayerSearch(props, ref) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [suggestions, setSuggestions] = useState<MenuItem[]>([]);

    const {
      className,
      onBlur: _onBlur,
      onChange,
      onFocus: _onFocus,
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

    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;

        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          if (value !== '') {
            const suggestions = cache.getAndUpdate(value, setIfCurrent(value));
            if (suggestions !== undefined) {
              setSuggestions(suggestions.map(toMenuItem));
            }
          } else {
            setSuggestions([]);
          }
        }, DEBOUNCE_MS);

        onChange?.(value);
      },
      [onChange, setIfCurrent],
    );

    const closeMenu = useCallback(() => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      if (suggestions.length > 0) {
        setSuggestions([]);
      }
    }, [suggestions]);

    useEffect(() => {
      return () => {
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

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
            closeMenu();
            onSelection?.(value as string);
            if (!isControlled) {
              inputRef.current!.value = '';
            }
          }}
          open={suggestions.length > 0}
          targetId={props.id}
        />
      );
    }, [suggestions, props.id, isControlled, onBrowse, onSelection, closeMenu]);

    let inputClassName = styles.input;
    if (className) {
      inputClassName += ` ${className}`;
    }
    if (suggestions.length > 0) {
      inputClassName += ` ${styles.open}`;
    }

    return (
      <div
        className={styles.wrapper}
        style={{ width: inputProps.fluid ? '100%' : inputProps.width }}
      >
        <Input
          {...inputProps}
          inputClassName={inputClassName}
          onBlur={() => {
            closeMenu();
          }}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              closeMenu();
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

  private cache = new Map<string, CachedSuggestion>();

  public getAndUpdate(
    query: string,
    callback: (suggestions: string[]) => void,
  ): string[] | undefined {
    const cached = this.cache.get(query);

    if (!cached || cached.expiry < Date.now()) {
      void this.fetch(query).then(() => {
        const suggestions = this.cache.get(query)!.results ?? [];
        callback(suggestions);
      });
    }

    return cached?.results;
  }

  private async fetch(query: string): Promise<void> {
    const res = await fetch(`/api/suggest?type=players&q=${query}`);
    const data = (await res.json()) as { results: { value: string }[] };
    this.cache.set(query, {
      results: data.results.map((s) => s.value),
      expiry: Date.now() + SuggestionCache.EXPIRY_PERIOD,
    });
  }
}

const cache = new SuggestionCache();
