import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';

test('completed action continues through the front server after its client disconnects',async()=>{
 let finish;const finished=new Promise(resolve=>{finish=resolve;});let closedBeforeCompletion=false;
 const source=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.on('close',()=>{if(!res.writableFinished)closedBeforeCompletion=true;});setTimeout(()=>{res.end('{"accounted":true}');finish();},100);});});source.listen(0,'127.0.0.1');await once(source,'listening');
 const previous=process.env.INTERNAL_PORT;process.env.INTERNAL_PORT=String(source.address().port);
 const {handler}=await import('../scripts/front-server.mjs?disconnect-accounting');if(previous===undefined)delete process.env.INTERNAL_PORT;else process.env.INTERNAL_PORT=previous;
 const front=http.createServer(handler);front.listen(0,'127.0.0.1');await once(front,'listening');
 try{const req=http.request({host:'127.0.0.1',port:front.address().port,method:'POST',path:'/tr/profilim',headers:{'next-action':'test-action','content-type':'text/plain','content-length':2}});req.on('error',()=>{});req.end('{}');setTimeout(()=>req.destroy(),40);await finished;assert.equal(closedBeforeCompletion,false);}
 finally{front.closeAllConnections();source.closeAllConnections();await new Promise(r=>front.close(r));await new Promise(r=>source.close(r));}
});
