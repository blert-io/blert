import { oxford } from '@/utils/copy';

describe('oxford', () => {
  it('emits an empty string for an empty list', () => {
    expect(oxford([])).toBe('');
  });

  it('emits a single item unchanged', () => {
    expect(oxford(['Maiden'])).toBe('Maiden');
  });

  it('formats two items without a comma', () => {
    expect(oxford(['Maiden', 'Bloat'])).toBe('Maiden and Bloat');
  });

  it('comma-separates three or more items', () => {
    expect(oxford(['Maiden', 'Bloat', 'Nylocas'])).toBe(
      'Maiden, Bloat, and Nylocas',
    );
    expect(oxford(['Maiden', 'Bloat', 'Nylocas', 'Sotetseg'])).toBe(
      'Maiden, Bloat, Nylocas, and Sotetseg',
    );
  });
});
