import { describe, expect, it } from 'vitest';
import { synthesizeTimeline } from './timeline.ts';
import type { FilingPetition, TimelineEvent } from './types.ts';

/** Minimal filing date fields matching SAT-LOA-19991207-00117 */
const SAT_LOA_FILING = {
  dateFiled: '1999-12-07 15:00:00',
  dateSigned: '1999-12-07 07:00:00',
  dateGrant: '2004-02-19 00:00:00',
  dateBegin: null,
  dateExpire: null,
  lastActionDate: '2004-02-19 00:00:00',
} as const;

/** Pleadings matching SAT-LOA-19991207-00117 */
const SAT_LOA_PETITIONS: FilingPetition[] = [
  {
    filingKey: 1,
    partyName: 'NEW SKIES',
    dateFiled: '2000-01-10 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001180',
  },
  {
    filingKey: 1,
    partyName: 'NEW SKIES SATELLITES NV',
    dateFiled: '2000-01-24 03:00:00',
    description: null,
    pleadingType: 'SUPPLEMENT',
    pleadingNumber: 'PC0001213',
  },
  {
    filingKey: 1,
    partyName: 'GE AMERICAN',
    dateFiled: '2000-01-24 03:00:00',
    description: null,
    pleadingType: 'SUPPLEMENT',
    pleadingNumber: 'PC0001211',
  },
  {
    filingKey: 1,
    partyName: 'LORAL',
    dateFiled: '2000-01-24 03:00:00',
    description: null,
    pleadingType: 'SUPPLEMENT',
    pleadingNumber: 'PC0001212',
  },
  {
    filingKey: 1,
    partyName: 'Loral Space & Communications, Ltd.',
    dateFiled: '2000-01-24 07:00:00',
    description: null,
    pleadingType: 'PETITION',
    pleadingNumber: null,
  },
  {
    filingKey: 1,
    partyName: 'New Skies Satellites N.V.',
    dateFiled: '2000-01-24 07:00:00',
    description: null,
    pleadingType: 'PETITION',
    pleadingNumber: null,
  },
  {
    filingKey: 1,
    partyName: 'GE American Communications, Inc.',
    dateFiled: '2000-01-24 07:00:00',
    description: null,
    pleadingType: 'PETITION',
    pleadingNumber: null,
  },
  {
    filingKey: 1,
    partyName: 'NEW SKIES SATELLITES',
    dateFiled: '2000-02-18 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001207',
  },
  {
    filingKey: 1,
    partyName: 'GE AMERICAN',
    dateFiled: '2000-02-18 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001209',
  },
  {
    filingKey: 1,
    partyName: 'LORAL SPACE & COMMUNICATIONS',
    dateFiled: '2000-02-18 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001208',
  },
  {
    filingKey: 1,
    partyName: 'LOCKHEED MARTIN CORPORATION',
    dateFiled: '2000-02-18 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001210',
  },
  {
    filingKey: 1,
    partyName: 'NEW SKIES SATELLITES',
    dateFiled: '2000-02-18 03:00:00',
    description: null,
    pleadingType: 'Other',
    pleadingNumber: 'PC0001206',
  },
  {
    filingKey: 1,
    partyName: 'FCC,IB',
    dateFiled: '2004-02-19 03:00:00',
    description: null,
    pleadingType: 'DECISION',
    pleadingNumber: 'PC0003127',
  },
  {
    filingKey: 1,
    partyName: 'PanAmSat',
    dateFiled: '2004-04-19 03:00:00',
    description: null,
    pleadingType: 'SUPPLEMENT',
    pleadingNumber: 'PC0003381',
  },
];

describe('synthesizeTimeline', () => {
  it('produces the correct number of events from SAT-LOA-19991207-00117 data', () => {
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      SAT_LOA_PETITIONS,
    );

    // 4 non-null date fields (dateFiled, dateSigned, dateGrant, lastActionDate) + 14 pleadings = 18
    expect(events).toHaveLength(18);
  });

  it('returns events sorted by date ascending', () => {
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      SAT_LOA_PETITIONS,
    );

    for (let i: number = 1; i < events.length; i++) {
      expect(events[i]!.date >= events[i - 1]!.date).toBe(true);
    }
  });

  it('normalizes timestamps to ISO date strings (YYYY-MM-DD)', () => {
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      SAT_LOA_PETITIONS,
    );

    for (const event of events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('correctly maps filing date fields to milestone events', () => {
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      SAT_LOA_PETITIONS,
    );
    const milestones: TimelineEvent[] = events.filter(
      (e) => e.source === 'filing_field',
    );

    expect(milestones).toHaveLength(4);
    expect(milestones.map((m) => m.type)).toEqual(
      expect.arrayContaining(['filed', 'signed', 'granted', 'last_action']),
    );
    // All milestones have no actor
    for (const m of milestones) {
      expect(m.actor).toBeNull();
    }
  });

  it('correctly maps pleadings to events with actor names', () => {
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      SAT_LOA_PETITIONS,
    );
    const pleadings: TimelineEvent[] = events.filter(
      (e) => e.source === 'pleading',
    );

    expect(pleadings).toHaveLength(14);

    const petitionEvents: TimelineEvent[] = pleadings.filter(
      (e) => e.type === 'petition',
    );
    expect(petitionEvents).toHaveLength(3);
    expect(petitionEvents[0]!.actor).toEqual(
      'Loral Space & Communications, Ltd.',
    );

    const decisionEvents: TimelineEvent[] = pleadings.filter(
      (e) => e.type === 'decision',
    );
    expect(decisionEvents).toHaveLength(1);
    expect(decisionEvents[0]!.actor).toEqual('FCC,IB');
  });

  it('returns an empty array when no dates and no pleadings exist', () => {
    const emptyFiling = {
      dateFiled: null,
      dateSigned: null,
      dateGrant: null,
      dateBegin: null,
      dateExpire: null,
      lastActionDate: null,
    };
    const events: TimelineEvent[] = synthesizeTimeline(emptyFiling, []);
    expect(events).toEqual([]);
  });

  it('produces milestones only when there are no pleadings', () => {
    const events: TimelineEvent[] = synthesizeTimeline(SAT_LOA_FILING, []);
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.source === 'filing_field')).toBe(true);
  });

  it('skips pleadings with null dateFiled', () => {
    const petitionsWithNull: FilingPetition[] = [
      {
        filingKey: 1,
        partyName: 'No Date Corp',
        dateFiled: null,
        description: null,
        pleadingType: 'COMMENT',
        pleadingNumber: 'PC9999',
      },
    ];
    const events: TimelineEvent[] = synthesizeTimeline(
      SAT_LOA_FILING,
      petitionsWithNull,
    );
    // Should only have the 4 milestone events, not the dateless pleading
    expect(events).toHaveLength(4);
  });

  it('normalizes JS Date.toString() format dates to YYYY-MM-DD', () => {
    const jsFiling = {
      dateFiled: 'Tue Dec 07 1999 08:00:00 GMT-0700 (Mountain Standard Time)',
      dateSigned: null,
      dateGrant: null,
      dateBegin: null,
      dateExpire: null,
      lastActionDate: null,
    };
    const events: TimelineEvent[] = synthesizeTimeline(jsFiling, []);
    expect(events).toHaveLength(1);
    expect(events[0]!.date).toEqual('1999-12-07');
  });

  it('maps all pleading types correctly', () => {
    const testPetitions: FilingPetition[] = [
      {
        filingKey: 1,
        partyName: 'A',
        dateFiled: '2000-01-01',
        description: null,
        pleadingType: 'PETITION',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'B',
        dateFiled: '2000-01-02',
        description: null,
        pleadingType: 'SUPPLEMENT',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'C',
        dateFiled: '2000-01-03',
        description: null,
        pleadingType: 'DECISION',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'D',
        dateFiled: '2000-01-04',
        description: null,
        pleadingType: 'LETTER',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'E',
        dateFiled: '2000-01-05',
        description: null,
        pleadingType: 'COMMENT',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'F',
        dateFiled: '2000-01-06',
        description: null,
        pleadingType: 'Unknown',
        pleadingNumber: null,
      },
      {
        filingKey: 1,
        partyName: 'G',
        dateFiled: '2000-01-07',
        description: null,
        pleadingType: null,
        pleadingNumber: null,
      },
    ];
    const emptyFiling = {
      dateFiled: null,
      dateSigned: null,
      dateGrant: null,
      dateBegin: null,
      dateExpire: null,
      lastActionDate: null,
    };
    const events: TimelineEvent[] = synthesizeTimeline(
      emptyFiling,
      testPetitions,
    );

    expect(events.map((e) => e.type)).toEqual([
      'petition',
      'supplement',
      'decision',
      'letter',
      'comment',
      'other',
      'other',
    ]);
  });
});
