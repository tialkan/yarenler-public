import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeNetworkLabels} from '../src/components/network-labels.ts';
test('large labels at coincident nodes stay distinct and inside a mobile viewport',()=>{
 const labels=placeNetworkLabels(Array.from({length:6},(_,i)=>({id:String(i),x:i%2?1:389,y:220,width:210,height:20})),390,500);
 for(const a of labels){assert.ok(a.x-a.width/2>=0&&a.x+a.width/2<=390);assert.ok(a.y>=0&&a.y+a.height<=500);for(const b of labels){if(a===b)continue;const overlap=Math.abs(a.x-b.x)<(a.width+b.width)/2&&a.y<b.y+b.height&&a.y+a.height>b.y;assert.equal(overlap,false);}}
});
