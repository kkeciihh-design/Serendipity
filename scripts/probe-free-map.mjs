import fs from 'node:fs';
import { Buffer } from 'node:buffer';
/* global AbortSignal */
const urls = [
  'https://operations.osmfoundation.org/policies/tiles/',
  'https://operations.osmfoundation.org/policies/nominatim/',
  'https://www.openstreetmap.org/copyright',
  'https://osmfoundation.org/wiki/Licence/Attribution_Guidelines',
];
const results=[];
for (const url of urls) {
  const start=Date.now();
  try {
    const r=await fetch(url,{headers:{'User-Agent':'Serendipity/0.1 (personal local travel planner; https://github.com/kkeciihh-design/Serendipity)'},signal:AbortSignal.timeout(15000)});
    const bytes=Buffer.from(await r.arrayBuffer());
    const type=r.headers.get('content-type');
    const text=bytes.toString('utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
    results.push({url,status:r.status,type,bytes:bytes.length,elapsedMs:Date.now()-start,
      ...(type?.includes('json')?{data:JSON.parse(text)}:{}),
      ...(type?.includes('html')?{excerpts:[...text.matchAll(/.{0,80}(per second|cach|attribution|offline|download|print|bulk|User-Agent|Referer|autocomplete).{0,170}/gi)].slice(0,25).map(m=>m[0])}:{}),
    });
  } catch(e) {results.push({url,error:e.message,elapsedMs:Date.now()-start});}
  await new Promise(r=>setTimeout(r,1100));
}
fs.mkdirSync('test-data/phase11-evidence',{recursive:true});
fs.writeFileSync('test-data/phase11-evidence/free-provider-probe.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
