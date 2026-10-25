import * as assert from 'node:assert/strict';
import { formatToolResultDateTimes } from '../ai-tool-result-date-times.util';

async function run() {
  const paris = 'Europe/Paris';

  assert.equal(
    formatToolResultDateTimes('2026-06-02T05:50:00.000Z', paris),
    '2026-06-02T07:50:00+02:00',
    'a UTC instant is written in the user zone with its offset',
  );
  assert.equal(
    formatToolResultDateTimes('2026-12-02T05:50:00Z', paris),
    '2026-12-02T06:50:00+01:00',
    'the offset follows the zone at that instant (winter time)',
  );
  assert.equal(
    formatToolResultDateTimes('2026-06-02T05:50:00.000Z', 'America/New_York'),
    '2026-06-02T01:50:00-04:00',
    'a western zone keeps its negative offset',
  );
  assert.equal(
    formatToolResultDateTimes('2026-06-02T05:50:00.123Z', 'Asia/Kolkata'),
    '2026-06-02T11:20:00.123+05:30',
    'a half-hour zone keeps the milliseconds and its offset',
  );
  assert.equal(
    formatToolResultDateTimes('2026-06-02T07:50:00+02:00', paris),
    '2026-06-02T07:50:00+02:00',
    'an instant that already carries the user offset is not shifted twice',
  );

  assert.equal(formatToolResultDateTimes('2026-06-02', paris), '2026-06-02', 'a date-only field keeps its day');
  assert.equal(formatToolResultDateTimes('2 June 2026 05:50', paris), '2 June 2026 05:50', 'free text is untouched');
  assert.equal(formatToolResultDateTimes('2026-06-02T05:50:00', paris), '2026-06-02T05:50:00', 'a value without a zone is left as written');

  assert.deepEqual(
    formatToolResultDateTimes({
      items: [{
        detected_at: '2026-06-02T05:50:00.000Z',
        created_at: new Date('2026-06-02T05:50:00.000Z'),
        starts_on: '2026-06-02',
        title: 'B2B portal down',
        count: 1,
        missing: null,
      }],
      total: 1,
    }, paris),
    {
      items: [{
        detected_at: '2026-06-02T07:50:00+02:00',
        created_at: '2026-06-02T07:50:00+02:00',
        starts_on: '2026-06-02',
        title: 'B2B portal down',
        count: 1,
        missing: null,
      }],
      total: 1,
    },
    'nested values are formatted and the rest of the result stays as it is',
  );
}

void run();
