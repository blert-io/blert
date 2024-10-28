import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './style.module.scss';

export type MenuItem = {
  label: string;
  customAction?: () => void;
  icon?: string;
  subMenu?: MenuItem[];
  value?: string | number;
  wrap?: boolean;
};

export const MENU_DIVIDER: MenuItem = { label: '' };

type MenuProps = {
  attach?: 'top' | 'bottom';
  itemClass?: string;
  items: MenuItem[];
  menuClass?: string;
  onBrowse?: (item: MenuItem | null) => void;
  onClose?: () => void;
  onSelection?: (value: string | number) => void;
  open: boolean;
  position?: { x: number; y: number };
  targetId?: string;
  width?: number | string;
};

type MenuImplProps = MenuProps & {
  parent: HTMLElement | null;
  depth: number;
  activeElements: Array<number | null>;
  setActiveElements: Dispatch<SetStateAction<Array<number | null>>>;
};

function MenuImpl(props: MenuImplProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const style: React.CSSProperties = {
    width: props.width,
  };

  if (props.parent) {
    const rect = props.parent.getBoundingClientRect();
    style.top = rect.top - 1;
    style.left = rect.right;
    style.borderRadius = '5px';
  } else {
    if (props.attach === 'top') {
      style.borderRadius = '5px 5px 0 0';
      style.borderBottom = 'none';
    } else if (props.attach === 'bottom') {
      style.borderRadius = '0 0 5px 5px';
      style.borderTop = 'none';
    } else {
      style.borderRadius = '5px';
    }
  }

  let className = styles.menu;
  if (props.menuClass) {
    className += ` ${props.menuClass}`;
  }

  return (
    <div className={className} ref={menuRef} style={style}>
      {props.items.map((item, i) => {
        let ElementType: keyof JSX.IntrinsicElements;
        let onMouseDown;

        let itemClass;
        if (item === MENU_DIVIDER) {
          itemClass = styles.divider;
        } else {
          itemClass = styles.entry;
          if (props.itemClass) {
            itemClass += ` ${props.itemClass}`;
          }
          if (props.activeElements[props.depth] === i) {
            itemClass += ` ${styles.active}`;
          }
          if (item.wrap) {
            itemClass += ` ${styles.wrap}`;
          }
        }

        const interactive = isInteractive(item);

        if (item.customAction) {
          ElementType = 'button';
          onMouseDown = () => {
            item.customAction!();
            props.onClose?.();
          };
        } else if (item.value !== undefined) {
          ElementType = 'button';
          onMouseDown = () => {
            props.onSelection?.(item.value!);
            props.onClose?.();
          };
        } else {
          ElementType = 'div';
        }

        if (!interactive) {
          itemClass += ` ${styles.inactive}`;
        }

        let icon;
        if (item.subMenu) {
          icon = (
            <i
              className={`fas fa-chevron-right ${styles.icon} ${styles.subMenuIcon}`}
            />
          );
        } else if (item.icon) {
          icon = <i className={`${item.icon} ${styles.icon}`} />;
        }

        return (
          <ElementType
            className={itemClass}
            key={i}
            onMouseDown={onMouseDown}
            onMouseEnter={() => {
              if (interactive) {
                props.setActiveElements((prev) => {
                  const next = [...prev];
                  next[props.depth] = i;
                  return next;
                });
              }
            }}
            onMouseLeave={() => {
              if (interactive) {
                props.setActiveElements((prev) => {
                  const next = [...prev];
                  next[props.depth] = null;
                  return next;
                });
              }
            }}
          >
            <span>{item.label}</span>
            {icon}
            {item.subMenu && props.activeElements[props.depth] === i && (
              <MenuImpl
                {...props}
                depth={props.depth + 1}
                items={item.subMenu}
                parent={menuRef.current?.children[i] as HTMLElement}
              />
            )}
          </ElementType>
        );
      })}
    </div>
  );
}

function maxMenuDepth(items: MenuItem[]): number {
  let max = items.length === 0 ? 0 : 1;
  for (const item of items) {
    if (item.subMenu) {
      max = Math.max(max, 1 + maxMenuDepth(item.subMenu));
    }
  }
  return max;
}

function currentDepth(active: Array<number | null>): number {
  return active.findLastIndex((el) => el !== null);
}

function currentMenu(
  items: MenuItem[],
  active: Array<number | null>,
): MenuItem[] {
  const depth = currentDepth(active);
  if (depth === -1) {
    return items;
  }

  let menu = items;
  for (let i = 0; i < depth; i++) {
    menu = menu[active[i]!].subMenu!;
  }

  return menu;
}

function createActiveElementsList(items: MenuItem[]): Array<number | null> {
  const depth = maxMenuDepth(items);
  return new Array(depth).fill(null);
}

function isInteractive(item: MenuItem): boolean {
  return (
    item.customAction !== undefined ||
    item.value !== undefined ||
    item.subMenu !== undefined
  );
}

export default function Menu(props: MenuProps) {
  const [ready, setReady] = useState(false);
  const portalNode = useRef<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const { items, open, onBrowse, onSelection, onClose } = props;

  const [activeElements, setActiveElements] = useState<Array<number | null>>(
    () => createActiveElementsList(items),
  );

  useEffect(() => {
    setActiveElements(createActiveElementsList(items));
  }, [items, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const maxDepth = maxMenuDepth(items);
    const depth = currentDepth(activeElements);

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();

          const next = [...activeElements];
          if (depth === -1) {
            const firstItem = items.findIndex(isInteractive);
            if (firstItem !== -1) {
              next[0] = firstItem;
              onBrowse?.(items[firstItem]);
            } else {
              next[0] = null;
              onBrowse?.(null);
            }
          } else {
            const menu = currentMenu(items, next);
            for (let i = 1; i < menu.length; i++) {
              const index = (next[depth]! + i) % menu.length;
              if (isInteractive(menu[index])) {
                next[depth] = index;
                onBrowse?.(menu[index]);
                break;
              }
            }
          }
          setActiveElements(next);
          break;
        }

        case 'ArrowUp': {
          e.preventDefault();
          const next = [...activeElements];

          if (depth === -1) {
            const lastItem = items.findLastIndex(isInteractive);
            next[0] = lastItem === -1 ? null : lastItem;
            if (lastItem !== -1) {
              next[0] = lastItem;
              onBrowse?.(items[lastItem]);
            } else {
              next[0] = null;
              onBrowse?.(null);
            }
          } else {
            const menu = currentMenu(items, next);
            for (let i = 1; i < menu.length; i++) {
              const index = (next[depth]! - i + menu.length) % menu.length;
              if (isInteractive(menu[index])) {
                next[depth] = index;
                onBrowse?.(menu[index]);
                break;
              }
            }
          }
          setActiveElements(next);
          break;
        }

        case 'ArrowRight': {
          if (maxDepth < 2) {
            return;
          }

          e.preventDefault();

          if (depth !== -1) {
            const next = [...activeElements];
            const menu = currentMenu(items, next);
            if (menu[next[depth]!].subMenu) {
              next[depth + 1] = 0;
              onBrowse?.(menu[next[depth]!].subMenu![0]);
            }
            setActiveElements(next);
          }
          break;
        }

        case 'ArrowLeft': {
          if (maxDepth < 2) {
            return;
          }

          e.preventDefault();
          if (depth < 1) {
            return;
          }

          const next = [...activeElements];
          next[depth] = null;
          onBrowse?.(null);
          setActiveElements(next);
          break;
        }

        case 'Enter': {
          if (currentDepth(activeElements) === -1) {
            return;
          }

          e.preventDefault();

          const menu = currentMenu(items, activeElements);
          const item = menu[activeElements[currentDepth(activeElements)]!];
          if (item.customAction) {
            item.customAction();
          } else if (item.value !== undefined) {
            onSelection?.(item.value);
          }
          setActiveElements(createActiveElementsList(items));
          onClose?.();
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeElements, items, open, onBrowse, onSelection, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const root = document.getElementById('portal-root');

    const menuPortal = document.createElement('div');
    menuPortal.classList.add('menu-portal');
    root?.appendChild(menuPortal);
    portalNode.current = menuPortal as HTMLElement;

    setReady(true);

    return () => {
      if (portalNode.current !== null) {
        document
          .getElementById('portal-root')
          ?.removeChild(portalNode.current!);
      }
    };
  }, [open]);

  useEffect(() => {
    if (onClose) {
      const closeMenu = (e: MouseEvent) => {
        if (
          wrapperRef.current !== null &&
          !wrapperRef.current.contains(e.target as Node)
        ) {
          onClose();
        }
      };

      window.addEventListener('click', closeMenu);
      return () => {
        window.removeEventListener('click', closeMenu);
      };
    }
  }, [onClose]);

  if (
    portalNode.current === null ||
    !ready ||
    !props.open ||
    props.items.length === 0
  ) {
    return null;
  }

  const style: React.CSSProperties = {};

  if (props.position) {
    style.top = props.position.y;
    style.left = props.position.x;
  } else if (props.targetId) {
    const target = document.getElementById(props.targetId);
    if (!target) {
      console.error(`Menu target ${props.targetId} not found`);
      return null;
    }

    const rect = target.getBoundingClientRect();
    style.left = rect.left;

    if (!props.width) {
      style.width = rect.width;
    }

    if (props.attach === 'top') {
      style.top = rect.top;
    } else if (props.attach === 'bottom') {
      style.top = rect.top + rect.height;
    } else {
      style.top = rect.top + rect.height + 5;
    }
  } else {
    console.error('Menu requires either a position or a targetId');
    return null;
  }

  return createPortal(
    <div className={styles.menuWrapper} ref={wrapperRef} style={style}>
      <MenuImpl
        {...props}
        activeElements={activeElements}
        setActiveElements={setActiveElements}
        depth={0}
        parent={null}
        width={props.width ?? style.width}
      />
    </div>,
    portalNode.current,
  );
}
