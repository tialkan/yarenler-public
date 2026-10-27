import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatDataDate,isoDate} from '../src/server/data-date.ts';

test('dates in Turkish and English, Istanbul time',()=>{
 assert.equal(formatDataDate('2026-10-22T16:45:19.696979+00:00','tr'),'22 Ekim 2026');
 assert.equal(formatDataDate('2026-10-22T16:45:19Z','en'),'22 October 2026');
 // 22:30 UTC is already 23 October in Istanbul.
 assert.equal(formatDataDate('2026-10-22T22:30:00Z','tr'),'23 Ekim 2026');
 assert.equal(formatDataDate(new Date('2026-02-01T09:00:00Z'),'tr'),'1 Şubat 2026');
 assert.equal(isoDate('2026-10-22T22:30:00Z'),'2026-10-23');
});

test('unknown or invalid dates give null, never a made-up date',()=>{
 assert.equal(formatDataDate(null,'tr'),null);
 assert.equal(formatDataDate('',"en"),null);
 assert.equal(formatDataDate('not a date','tr'),null);
 assert.equal(isoDate(undefined),null);
});

test('PostgreSQL timestamptz text is understood',()=>{
 assert.equal(formatDataDate('2026-10-23 18:41:55.614001+00','tr'),'23 Ekim 2026');
});
