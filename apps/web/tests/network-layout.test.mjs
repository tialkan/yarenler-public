import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutNetwork} from '../src/workers/network-layout.mjs';
test('worker layout preserves graph input and gives every connected or isolated node finite coordinates',()=>{
 const graph={nodes:[{id:'a'},{id:'b'},{id:'isolated'}],links:[{source:'a',target:'b'}]};const before=structuredClone(graph),layout=layoutNetwork(graph);
 assert.deepEqual(graph,before);assert.deepEqual(layout.map(n=>n.id),['a','b','isolated']);assert.ok(layout.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));assert.deepEqual(layoutNetwork(graph),layout);
});
