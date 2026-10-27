import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeRequest} from '../src/server/routing.ts';
const r=(path,query='')=>routeRequest(path,new URLSearchParams(query));
test('search queries go to the per-request search route; the explore listing stays static',()=>{
 assert.deepEqual(r('/tr/kesfet','q=yapay+zeka'),{kind:'rewrite',pathname:'/tr/arama',dropPage:false});
 assert.deepEqual(r('/en/explore','kurum=disi'),{kind:'rewrite',pathname:'/en/arama',dropPage:false});
 assert.deepEqual(r('/tr/kesfet','q=+'),{kind:'next'});
 assert.deepEqual(r('/tr/kesfet'),{kind:'next'});
});
test('"?page=n" becomes a path part on listings, page 1 is the plain page, junk is page 0 (404)',()=>{
 assert.deepEqual(r('/tr/kesfet','page=3'),{kind:'rewrite',pathname:'/tr/kesfet/3',dropPage:true});
 assert.deepEqual(r('/tr/alan/sosyal-bilimler','page=2'),{kind:'rewrite',pathname:'/tr/alan/sosyal-bilimler/2',dropPage:true});
 assert.deepEqual(r('/en/unit/tip-fakultesi/','page=02'),{kind:'rewrite',pathname:'/en/unit/tip-fakultesi/2',dropPage:true});
 assert.deepEqual(r('/tr/birim/tip-fakultesi','page=1'),{kind:'rewrite',pathname:'/tr/birim/tip-fakultesi',dropPage:true});
 assert.deepEqual(r('/tr/birim/tip-fakultesi','page=abc'),{kind:'rewrite',pathname:'/tr/birim/tip-fakultesi/0',dropPage:true});
 assert.deepEqual(r('/tr/a/abc123-ad','page=2'),{kind:'next'});
});
test('announcement addresses are checked for expiry in both languages',()=>{
 assert.deepEqual(r('/tr/duyuru/99ef0cd324-tubitak-1001'),{kind:'announcement',id:'99ef0cd324',lang:'tr'});
 assert.deepEqual(r('/en/announcement/99ef0cd324'),{kind:'announcement',id:'99ef0cd324',lang:'en'});
 assert.deepEqual(r('/tr/duyurular'),{kind:'next'});
 assert.deepEqual(r('/tr/duyuru/ABC'),{kind:'next'});
});
test('ADR 0003 announcement detail form redirects to the new address; the RSS feed is untouched',()=>{
 assert.deepEqual(r('/tr/duyurular/99ef0cd324-tubitak'),{kind:'redirect',pathname:'/tr/duyuru/99ef0cd324-tubitak'});
 assert.deepEqual(r('/en/announcements/99ef0cd324'),{kind:'redirect',pathname:'/en/announcement/99ef0cd324'});
 assert.deepEqual(r('/tr/duyurular/rss.xml'),{kind:'next'});
});
