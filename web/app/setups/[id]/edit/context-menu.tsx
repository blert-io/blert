import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import Menu, { MENU_DIVIDER, MenuItem } from '@/components/menu';
import { useIsApple } from '@/display';
import {
  indexToCoords,
  SlotIdentifier,
  slotIdFromString,
  slotIdToString,
} from '@/setups/container-grid';
import { EditingContext, SetupEditingContext } from '@/setups/editing-context';
import { getContainerKey } from '@/setups/setup';
import { extendedItemCache } from '@/utils/item-cache/extended';

function isInSelection(
  context: EditingContext,
  targetId: SlotIdentifier,
): boolean {
  if (context.selection === null) {
    return false;
  }

  const { playerIndex, container, index } = targetId;
  if (
    context.selection.bounds.playerIndex !== playerIndex ||
    context.selection.bounds.container !== container
  ) {
    return false;
  }

  const coords = indexToCoords(index, container);
  if (coords === null) {
    return false;
  }

  return context.selection.slots.has(`${coords[0]},${coords[1]}`);
}

export function ContextMenuWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = useContext(SetupEditingContext);
  const [menuTargetId, setMenuTargetId] = useState<SlotIdentifier | null>(null);

  const isApple = useIsApple();

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (context === null) {
        return;
      }

      const slot =
        e.target instanceof Element
          ? e.target.closest('[data-slot="true"]')
          : null;

      if (slot === null || !slot.id) {
        setMenuTargetId(null);
        return;
      }

      const slotId = slotIdFromString(slot.id);
      if (slotId === null) {
        setMenuTargetId(null);
        return;
      }

      e.preventDefault();
      setMenuTargetId(slotId);
      context.setActiveSearchSlot(null);
    },
    [context],
  );

  const activeSearchSlot = context?.activeSearchSlot ?? null;
  useEffect(() => {
    if (activeSearchSlot !== null) {
      setMenuTargetId(null);
    }
  }, [activeSearchSlot]);

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (menuTargetId === null || context === null) {
      return items;
    }

    const ctrl = isApple ? '⌘' : 'Ctrl';

    const { playerIndex, container, index } = menuTargetId;

    if (isInSelection(context, menuTargetId)) {
      items.push({
        label: 'Copy',
        customAction: () => {
          context?.copySelection();
        },
        secondary: `${ctrl}+C`,
      });

      items.push({
        label: 'Cut',
        customAction: () => {
          context?.cutSelection();
        },
        secondary: `${ctrl}+X`,
      });

      items.push({
        label: 'Delete',
        customAction: () => {
          context?.deleteSelection();
        },
        secondary: `Del`,
      });

      items.push({
        label: 'Clear selection',
        customAction: () => {
          context?.clearSelection();
        },
        secondary: `Esc`,
      });
    } else {
      items.push({
        label: 'Choose item…',
        customAction: () => {
          context?.setActiveSearchSlot(slotIdToString(menuTargetId));
        },
      });

      const key = getContainerKey(container);

      const slot = context.setup.players[playerIndex][key].slots.find(
        (slot) => slot.index === index,
      );

      if (slot?.item) {
        const id = slot.item.id;
        const name = extendedItemCache.getItemName(id);

        items.push(MENU_DIVIDER);

        items.push({
          label: `Select ${name}`,
          customAction: () => {
            context?.setSelectedItem(id);
          },
        });

        items.push({
          label: `Remove ${name}`,
          customAction: () => {
            context?.updatePlayer(playerIndex, (prev) => {
              return {
                ...prev,
                [key]: {
                  ...prev[key],
                  slots: prev[key].slots.filter((slot) => slot.index !== index),
                },
              };
            });
          },
        });

        items.push({
          label: `Remove all ${name}`,
          customAction: () => {
            context?.updatePlayer(playerIndex, (prev) => {
              return {
                ...prev,
                [key]: {
                  ...prev[key],
                  slots: prev[key].slots.filter((slot) => slot.item?.id !== id),
                },
              };
            });
          },
        });
      }
    }

    return items;
  }, [context, menuTargetId, isApple]);

  return (
    <div onContextMenu={handleContextMenu}>
      {children}
      {menuTargetId && (
        <Menu
          items={menuItems}
          open
          onClose={() => setMenuTargetId(null)}
          width="auto"
          targetId={slotIdToString(menuTargetId)}
        />
      )}
    </div>
  );
}
