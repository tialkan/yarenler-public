import {test} from 'node:test';
import assert from 'node:assert/strict';
import {facultyPalette,facultyTone,degrees,linkWidth,nodeAlpha} from '../src/components/network-style.ts';
test('faculty tones derive from the brand colour and stay in one blue family',()=>{
 assert.equal(facultyPalette[0],'#1683a8');
 for(const tone of facultyPalette){const [r,g,b]=[1,3,5].map(i=>parseInt(tone.slice(i,i+2),16));assert.ok(b>=g&&g>r,tone);}
 assert.equal(facultyTone('Tıp Fakültesi'),facultyTone('Tıp Fakültesi'));
});
test('isolated people recede by default and reappear when selected',()=>{
 const d=degrees(['a','b','c'],[{source:'a',target:'b',score:40}]);assert.equal(d.get('c'),0);assert.equal(d.get('a'),1);
 assert.equal(nodeAlpha({selected:false,isSelected:false,isNeighbour:false,degree:0}),'88');
 assert.equal(nodeAlpha({selected:true,isSelected:true,isNeighbour:false,degree:0}),'ee');
 assert.equal(nodeAlpha({selected:true,isSelected:false,isNeighbour:false,degree:5}),'16');
});
test('selected match lines are proportional to score and others fade',()=>{
 assert.ok(linkWidth(90,true,true)>linkWidth(30,true,true));assert.ok(linkWidth(30,true,true)>linkWidth(90,false,true));
});
