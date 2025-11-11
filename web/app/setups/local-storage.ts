import { SetupListItem, SetupMetadata } from '@/actions/setup';

import { GearSetup } from './setup';

class SetupLocalStorage {
  private static readonly PREFIX = 'blert:setup';

  /**
   * Loads a setup from local storage.
   * @param id ID of the setup to load.
   * @returns Setup metadata or null if the setup does not exist.
   */
  public loadSetup(id: string): SetupMetadata | null {
    const key = this.setupKey(id);
    const data = localStorage.getItem(key);
    if (data === null) {
      return null;
    }
    const meta = JSON.parse(data) as SetupMetadata;
    if (meta.latestRevision !== null) {
      meta.latestRevision.createdAt = new Date(meta.latestRevision.createdAt);
    }

    return meta;
  }

  /**
   * Saves a setup to local storage.
   * Unlike the server-side save, this does not create a new revision. Only the
   * latest draft is kept.
   *
   * @param id ID of the setup to save.
   * @param setup Setup to save.
   */
  public saveSetup(id: string, setup: GearSetup): void {
    const meta: SetupMetadata = {
      publicId: id,
      name: setup.title,
      challengeType: setup.challenge,
      scale: setup.players.length,
      authorId: 0,
      author: '',
      state: 'draft',
      views: 0,
      likes: 0,
      dislikes: 0,
      latestRevision: {
        version: 1,
        message: null,
        createdAt: new Date(),
        createdBy: 0,
        createdByUsername: '',
      },
      draft: setup,
    };

    localStorage.setItem(this.setupKey(id), JSON.stringify(meta));
  }

  /**
   * Deletes a setup from local storage.
   *
   * @param id ID of the setup to delete.
   */
  public deleteSetup(id: string): void {
    const key = this.setupKey(id);
    localStorage.removeItem(key);
  }

  public listSetups(): SetupListItem[] {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith(SetupLocalStorage.PREFIX),
    );

    const setups: SetupListItem[] = [];

    for (const key of keys) {
      const setup = this.loadSetup(key.split(':')[2]);
      if (setup === null) {
        continue;
      }
      setups.push({
        publicId: setup.publicId,
        name: setup.name,
        challengeType: setup.challengeType,
        authorId: setup.authorId,
        author: setup.author,
        state: setup.state,
        views: setup.views,
        likes: setup.likes,
        dislikes: setup.dislikes,
        score: 0,
        // For local setups, we don't care about creation time, only when it
        // was last modified.
        createdAt: setup.latestRevision!.createdAt,
        updatedAt: setup.latestRevision!.createdAt,
      });
    }

    setups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return setups;
  }

  private setupKey(id: string): string {
    return `${SetupLocalStorage.PREFIX}:${id}`;
  }
}

export const setupLocalStorage = new SetupLocalStorage();
