import { ChallengeType } from '@blert/common';

import { EditableGearSetup, EditingContext } from '../editing-context';
import { GearSetup } from '../setup';

const BASE_SETUP: GearSetup = {
  title: '',
  description: '',
  challenge: ChallengeType.TOB,
  players: [],
};

function harness() {
  let state = EditingContext.newEditableGearSetup(BASE_SETUP);

  const context = () =>
    new EditingContext('local-test', state, (action) => {
      state = typeof action === 'function' ? action(state) : action;
    });

  return {
    type: (title: string) =>
      context().update((prev) => ({ ...prev, title }), { coalesce: 'title' }),
    undo: () => context().undo(),
    redo: () => context().redo(),
    save: () => context().clearModified(),
    titles: (): string[] => state.history.map((setup) => setup.title),
    state: (): EditableGearSetup => state,
  };
}

describe('EditingContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('coalescing', () => {
    it('collapses consecutive updates sharing a key into one entry', () => {
      const h = harness();

      h.type('a');
      h.type('ab');
      h.type('abc');

      expect(h.titles()).toEqual(['', 'abc']);
      expect(h.state().position).toBe(1);

      h.undo();
      expect(h.state().position).toBe(0);
    });

    it('ends the run at a long pause', () => {
      const h = harness();

      h.type('a');
      jest.setSystemTime(Date.now() + 60_000);
      h.type('ab');

      expect(h.titles()).toEqual(['', 'a', 'ab']);
    });

    it('ends the run on undo, truncating the redo tail', () => {
      const h = harness();

      h.type('a');
      h.type('ab');
      expect(h.state().coalesce).not.toBeNull();

      h.undo();
      expect(h.state().coalesce).toBeNull();

      h.type('x');
      expect(h.titles()).toEqual(['', 'x']);
    });

    it('ends the run across undo and redo, keeping the redone value', () => {
      const h = harness();

      h.type('a');
      h.undo();
      h.redo();
      h.type('ab');

      expect(h.titles()).toEqual(['', 'a', 'ab']);
      expect(h.state().position).toBe(2);

      h.undo();
      expect(h.titles()[h.state().position]).toBe('a');
    });

    it('ends the run once a saved state is established', () => {
      const h = harness();

      h.type('a');
      h.save();
      h.type('ab');

      expect(h.titles()).toEqual(['', 'a', 'ab']);

      h.undo();
      expect(h.titles()[h.state().position]).toBe('a');
      expect(h.state().modified).toBe(true);
    });
  });
});
