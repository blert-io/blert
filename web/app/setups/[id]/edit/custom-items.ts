'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CustomItems,
  getCustomItems,
  ItemCategory,
  addCustomItem as addCustomItemAction,
  removeCustomItem as removeCustomItemAction,
  hideDefaultItem as hideDefaultItemAction,
  showDefaultItem as showDefaultItemAction,
} from '@/actions/setup';

export function useCustomItems(onError?: (message: string) => void) {
  const session = useSession();
  const status = session.status;

  const itemStorage = useMemo(() => {
    if (status === 'loading') {
      return null;
    }
    const useLocalStorage = status !== 'authenticated';
    return new CustomItemStorage(useLocalStorage);
  }, [status]);

  const [customItems, setCustomItems] = useState<CustomItems>({
    melee: { added: [], hidden: [] },
    ranged: { added: [], hidden: [] },
    magic: { added: [], hidden: [] },
    supplies: { added: [], hidden: [] },
    utility: { added: [], hidden: [] },
    runes: { added: [], hidden: [] },
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (itemStorage === null) {
      return;
    }

    const storage = itemStorage;
    let cancelled = false;

    async function loadConfig() {
      setIsLoading(true);

      try {
        const config = await storage.loadConfig();
        if (!cancelled) {
          setCustomItems(config);
        }
      } catch {
        if (!cancelled) {
          onError?.('Failed to load custom items');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [itemStorage, onError]);

  const addCustomItem = useCallback(
    async (category: ItemCategory, id: number) => {
      if (itemStorage === null) {
        return;
      }

      try {
        await itemStorage.addCustom(category, id);
        setCustomItems((prev) => ({
          ...prev,
          [category]: {
            ...prev[category],
            added: [...prev[category].added, id],
          },
        }));
      } catch {
        onError?.('Failed to add custom item');
      }
    },
    [setCustomItems, itemStorage, onError],
  );

  const removeCustomItem = useCallback(
    async (category: ItemCategory, id: number) => {
      if (itemStorage === null) {
        return;
      }

      try {
        await itemStorage.removeCustom(category, id);
        setCustomItems((prev) => ({
          ...prev,
          [category]: {
            ...prev[category],
            added: prev[category].added.filter((item) => item !== id),
          },
        }));
      } catch {
        onError?.('Failed to remove custom item');
      }
    },
    [setCustomItems, itemStorage, onError],
  );

  const hideDefaultItem = useCallback(
    async (category: ItemCategory, id: number) => {
      if (itemStorage === null) {
        return;
      }

      try {
        await itemStorage.hideDefault(category, id);
        setCustomItems((prev) => ({
          ...prev,
          [category]: {
            ...prev[category],
            hidden: [...prev[category].hidden, id],
          },
        }));
      } catch {
        onError?.('Failed to hide default item');
      }
    },
    [setCustomItems, itemStorage, onError],
  );

  const showDefaultItem = useCallback(
    async (category: ItemCategory, id: number) => {
      if (itemStorage === null) {
        return;
      }

      try {
        await itemStorage.showDefault(category, id);
        setCustomItems((prev) => ({
          ...prev,
          [category]: {
            ...prev[category],
            hidden: prev[category].hidden.filter((item) => item !== id),
          },
        }));
      } catch {
        onError?.('Failed to show default item');
      }
    },
    [setCustomItems, itemStorage, onError],
  );

  return {
    customItems,
    isLoading,
    addCustomItem,
    removeCustomItem,
    hideDefaultItem,
    showDefaultItem,
  };
}

class CustomItemStorage {
  private static readonly GLOBAL_KEY = 'blert:custom-items:global';

  public constructor(private readonly isLocal: boolean) {}

  async addCustom(category: ItemCategory, id: number): Promise<void> {
    if (this.isLocal) {
      const config = this.loadLocalConfig();
      if (!config[category].added.includes(id)) {
        config[category].added.push(id);
      }
      localStorage.setItem(
        CustomItemStorage.GLOBAL_KEY,
        JSON.stringify(config),
      );
    } else {
      await addCustomItemAction(category, id);
    }
  }

  async removeCustom(category: ItemCategory, id: number): Promise<void> {
    if (this.isLocal) {
      const config = this.loadLocalConfig();
      if (config[category].added.includes(id)) {
        config[category].added = config[category].added.filter(
          (item) => item !== id,
        );
        localStorage.setItem(
          CustomItemStorage.GLOBAL_KEY,
          JSON.stringify(config),
        );
      }
    } else {
      await removeCustomItemAction(category, id);
    }
  }

  async hideDefault(category: ItemCategory, id: number): Promise<void> {
    if (this.isLocal) {
      const config = this.loadLocalConfig();
      if (!config[category].hidden.includes(id)) {
        config[category].hidden.push(id);
        localStorage.setItem(
          CustomItemStorage.GLOBAL_KEY,
          JSON.stringify(config),
        );
      }
    } else {
      await hideDefaultItemAction(category, id);
    }
  }

  async showDefault(category: ItemCategory, id: number): Promise<void> {
    if (this.isLocal) {
      const config = this.loadLocalConfig();
      if (config[category].hidden.includes(id)) {
        config[category].hidden = config[category].hidden.filter(
          (item) => item !== id,
        );
        localStorage.setItem(
          CustomItemStorage.GLOBAL_KEY,
          JSON.stringify(config),
        );
      }
    } else {
      await showDefaultItemAction(category, id);
    }
  }

  async loadConfig(): Promise<CustomItems> {
    if (this.isLocal) {
      return this.loadLocalConfig();
    }
    return await getCustomItems();
  }

  private loadLocalConfig(): CustomItems {
    const emptyConfig: CustomItems = {
      melee: { added: [], hidden: [] },
      ranged: { added: [], hidden: [] },
      magic: { added: [], hidden: [] },
      supplies: { added: [], hidden: [] },
      utility: { added: [], hidden: [] },
      runes: { added: [], hidden: [] },
    };

    const data = localStorage.getItem(CustomItemStorage.GLOBAL_KEY);
    if (data === null) {
      return emptyConfig;
    }
    const parsed = JSON.parse(data) as Partial<CustomItems>;
    return { ...emptyConfig, ...parsed };
  }
}
