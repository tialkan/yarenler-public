import {Worker} from 'node:worker_threads';
import 'pdf-lib'; // Keep this external dependency in the standalone production trace.
export const MAX_PROTOCOL_BYTES=8*1024*1024;
/** Parse in a memory-limited worker. Never render PDFs or execute document actions on the web process. */
export async function checkProtocolPdf(bytes:Uint8Array){
 if(bytes.length<100||bytes.length>MAX_PROTOCOL_BYTES||Buffer.from(bytes.subarray(0,8)).toString('ascii').slice(0,5)!=='%PDF-')return false;
 return new Promise<boolean>(resolve=>{
  let done=false;const finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();resolve(ok);};
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
const {PDFDocument}=require('pdf-lib');
(async()=>{try{
const d=await PDFDocument.load(workerData.bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true});
if(d.isEncrypted||d.getPageCount()<1||d.getPageCount()>30)throw Error('pages');
const objects=d.context.enumerateIndirectObjects();if(objects.length>10000)throw Error('objects');
const unsafe=/\\/(?:JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|XFA|RichMedia|SubmitForm|ImportData|GoToR|AA|OpenAction)(?![A-Za-z])/;
for(const [,o] of objects)if(unsafe.test(o.toString()))throw Error('active');
parentPort.postMessage(true);
}catch{parentPort.postMessage(false);}})();`,{eval:true,workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16},execArgv:[]});
  const timer=setTimeout(()=>finish(false),5000);worker.on('message',v=>finish(v===true));worker.on('error',()=>finish(false));worker.on('exit',()=>finish(false));
 });
}
