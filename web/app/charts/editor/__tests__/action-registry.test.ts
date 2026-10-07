import { ActionEntry, filterEntries } from '../action-registry';

describe('filterEntries', () => {
  it('puts entries with an exact alias match first', () => {
    const vengeanceOther: ActionEntry = {
      key: 'spell:VENGEANCE_OTHER',
      tab: 'spell',
      name: 'Vengeance Other',
      aliases: [],
      action: { type: 'spell', spellType: 'VENGEANCE_OTHER' },
      style: null,
      cooldown: 1,
    };
    const vengeance: ActionEntry = {
      key: 'spell:VENGEANCE',
      tab: 'spell',
      name: 'Vengeance',
      aliases: ['veng'],
      action: { type: 'spell', spellType: 'VENGEANCE' },
      style: null,
      cooldown: 1,
    };

    expect(filterEntries([vengeanceOther, vengeance], 'veng')).toEqual([
      vengeance,
      vengeanceOther,
    ]);
  });

  it('matches entries by part of an alias', () => {
    const humidify: ActionEntry = {
      key: 'spell:HUMIDIFY',
      tab: 'spell',
      name: 'Humidify',
      aliases: [],
      action: { type: 'spell', spellType: 'HUMIDIFY' },
      style: null,
      cooldown: 1,
    };
    const thrall: ActionEntry = {
      key: 'spell:RESURRECT_GREATER_GHOST',
      tab: 'spell',
      name: 'Resurrect Greater Ghost',
      aliases: ['thrall'],
      action: { type: 'spell', spellType: 'RESURRECT_GREATER_GHOST' },
      style: null,
      cooldown: 1,
    };

    expect(filterEntries([humidify, thrall], 'THR')).toEqual([thrall]);
  });

  it('matches entries by part of their name', () => {
    const humidify: ActionEntry = {
      key: 'spell:HUMIDIFY',
      tab: 'spell',
      name: 'Humidify',
      aliases: [],
      action: { type: 'spell', spellType: 'HUMIDIFY' },
      style: null,
      cooldown: 1,
    };
    const thrall: ActionEntry = {
      key: 'spell:RESURRECT_GREATER_GHOST',
      tab: 'spell',
      name: 'Resurrect Greater Ghost',
      aliases: ['thrall'],
      action: { type: 'spell', spellType: 'RESURRECT_GREATER_GHOST' },
      style: null,
      cooldown: 1,
    };

    expect(filterEntries([humidify, thrall], ' ghost ')).toEqual([thrall]);
  });

  it('returns nothing if no name or alias matches', () => {
    const humidify: ActionEntry = {
      key: 'spell:HUMIDIFY',
      tab: 'spell',
      name: 'Humidify',
      aliases: [],
      action: { type: 'spell', spellType: 'HUMIDIFY' },
      style: null,
      cooldown: 1,
    };
    const thrall: ActionEntry = {
      key: 'spell:RESURRECT_GREATER_GHOST',
      tab: 'spell',
      name: 'Resurrect Greater Ghost',
      aliases: ['thrall'],
      action: { type: 'spell', spellType: 'RESURRECT_GREATER_GHOST' },
      style: null,
      cooldown: 1,
    };

    expect(filterEntries([humidify, thrall], 'surge')).toEqual([]);
  });
});
