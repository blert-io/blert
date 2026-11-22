import { Column, parseSavedColumn, parseSavedColumns } from '../types';

describe('parseSavedColumn', () => {
  it('maps numbers saved before columns had names', () => {
    expect([0, 23, 60, 66, 96, 102].map(parseSavedColumn)).toEqual([
      Column.UUID,
      Column.TOB_VERZIK_P1,
      Column.TOB_NYLOCAS_CLEANUP,
      Column.TOB_NYLOCAS_ENTRY,
      Column.TFA_OCELLUS_ENTRY,
      Column.TFA_BORK_CANNONBALLS_MISSED,
    ]);
  });

  it('accepts column names', () => {
    expect(
      ['DATE', 'TOB_SOTETSEG_66', 'MOKHAIOTL_AVG_DEEP_DELVE_TICKS'].map(
        parseSavedColumn,
      ),
    ).toEqual([
      Column.DATE,
      Column.TOB_SOTETSEG_66,
      Column.MOKHAIOTL_AVG_DEEP_DELVE_TICKS,
    ]);
  });

  it('rejects unknown values', () => {
    expect(
      [103, -1, 1.5, 'VERZIK_P1', 'tob_verzik_p1', null, undefined, {}].map(
        parseSavedColumn,
      ),
    ).toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe('parseSavedColumns', () => {
  it('parses saved columns and drops unknown ones', () => {
    expect(
      parseSavedColumns([
        { column: 1 },
        { column: 'TOB_MAIDEN_70S' },
        { column: 500 },
        { column: 'UNKNOWN' },
        { column: 49 },
      ]),
    ).toEqual([
      { column: Column.DATE },
      { column: Column.TOB_MAIDEN_70S },
      { column: Column.COLOSSEUM_WAVE_12 },
    ]);
  });
});
