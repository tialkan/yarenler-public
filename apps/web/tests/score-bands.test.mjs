import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SCORE_BANDS,NETWORK_MIN_SCORE,scoreBand,bandLabel,bandTitle,bandRanges,apiBand} from '../src/server/score-bands.ts';
import {band} from '../src/server/model.ts';

test('thresholds live in one table, highest band first, ending at zero',()=>{
 assert.deepEqual(SCORE_BANDS.map(b=>b.key),['cok_yakin','yakin','ilgili']);
 assert.ok(SCORE_BANDS.every((b,i)=>i===0||b.min<SCORE_BANDS[i-1].min));
 assert.equal(SCORE_BANDS.at(-1).min,0);
});

test('band edges: 85 and 65 belong to the higher band',()=>{
 assert.equal(scoreBand(100).key,'cok_yakin');
 assert.equal(scoreBand(85).key,'cok_yakin');
 assert.equal(scoreBand(84).key,'yakin');
 assert.equal(scoreBand(65).key,'yakin');
 assert.equal(scoreBand(64).key,'ilgili');
 assert.equal(scoreBand(3).key,'ilgili');
});

test('labels in both languages; the raw score only in the title text',()=>{
 assert.equal(bandLabel(97,'tr'),'Çok yakın');assert.equal(bandLabel(97,'en'),'Very close');
 assert.equal(bandLabel(70,'tr'),'Yakın');assert.equal(bandLabel(70,'en'),'Close');
 assert.equal(bandLabel(40,'tr'),'İlgili');assert.equal(bandLabel(40,'en'),'Related');
 assert.equal(bandTitle(97,'tr'),'Alan yakınlığı puanı 97/100');
 assert.ok(!/\d/.test(bandLabel(97,'tr')));
});

test('method text ranges follow the table',()=>{
 assert.deepEqual(bandRanges('tr').map(r=>r.range),['85 ve üstü','65-84','64 ve altı']);
 assert.deepEqual(bandRanges('en').map(r=>r.range),['85 and above','65-84','64 and below']);
});

test('API band codes come from the same thresholds and the network minimum',()=>{
 assert.equal(apiBand(90),'cok_sicak');assert.equal(apiBand(70),'sicak');
 assert.equal(apiBand(NETWORK_MIN_SCORE),'ilik');assert.equal(apiBand(NETWORK_MIN_SCORE-1),'serin');
 assert.equal(band(85),'cok_sicak');
});
