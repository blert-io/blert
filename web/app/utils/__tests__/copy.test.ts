import { oxford, withIndefiniteArticle } from '@/utils/copy';

describe('withIndefiniteArticle', () => {
  it('picks the article from a leading word', () => {
    expect(withIndefiniteArticle('Inferno')).toBe('an Inferno');
    expect(withIndefiniteArticle('Colosseum')).toBe('a Colosseum');
    expect(withIndefiniteArticle('Doom of Mokhaiotl')).toBe(
      'a Doom of Mokhaiotl',
    );
    expect(withIndefiniteArticle('trio Theatre of Blood (HM)')).toBe(
      'a trio Theatre of Blood (HM)',
    );
  });

  it('picks the article from the spoken form of a leading number', () => {
    expect(withIndefiniteArticle('5-player Theatre of Blood')).toBe(
      'a 5-player Theatre of Blood',
    );
    expect(withIndefiniteArticle('8-player Tombs of Amascut')).toBe(
      'an 8-player Tombs of Amascut',
    );
    expect(withIndefiniteArticle('11% success rate')).toBe(
      'an 11% success rate',
    );
    expect(withIndefiniteArticle('18% success rate')).toBe(
      'an 18% success rate',
    );
    expect(withIndefiniteArticle('80% success rate')).toBe(
      'an 80% success rate',
    );
    expect(withIndefiniteArticle('100% success rate')).toBe(
      'a 100% success rate',
    );
    expect(withIndefiniteArticle('110% success rate')).toBe(
      'a 110% success rate',
    );
  });
});

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
