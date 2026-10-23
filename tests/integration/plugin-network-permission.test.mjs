import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PluginAdapter} from '../../services/source-engine/dist/plugin-adapter.js';
import {prepareExecutableReview,writeExecutableApproval} from '../../services/source-engine/dist/executable-trust.js';

test('reviewed plugin IPC requests enforce each redirect permission and keep allowed redirects working',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'fnd-plugin-network-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifestPath=path.join(dir,'plugin.json'),store=path.join(dir,'approvals');
  await writeFile(manifestPath,JSON.stringify({id:'network.plugin',name:'Network test',version:'1.0.0',apiVersion:'1',entry:'index.js',permissions:{network:['api.example.test','cdn.example.test','127.0.0.1']}}));
  await writeFile(path.join(dir,'index.js'),`module.exports={category:async url=>{const result=await host.request(url);return{page:1,hasMore:false,items:[{id:result.url,name:result.text}]};}};`);
  const config={id:'plugin-network',name:'Plugin network',kind:'PLUGIN',endpoint:manifestPath,enabled:true,trust:'B',configRevision:'test-revision'};
  await writeExecutableApproval(store,await prepareExecutableReview(config));
  const requests=[];
  t.mock.method(globalThis,'fetch',async url=>{
    requests.push(String(url));
    if(String(url).endsWith('/denied'))return new Response('',{status:302,headers:{location:'https://forbidden.example.test/final'}});
    if(String(url).endsWith('/allowed'))return new Response('',{status:302,headers:{location:'/relative'}});
    if(String(url).endsWith('/relative'))return new Response('',{status:307,headers:{location:'https://cdn.example.test/final'}});
    if(String(url).endsWith('/protocol'))return new Response('',{status:302,headers:{location:'file://api.example.test/local'}});
    return new Response('ok');
  });
  const adapter=new PluginAdapter(config);t.after(()=>adapter.destroy());
  await adapter.init({sourceId:config.id,executableTrustStoreDir:store});
  await assert.rejects(adapter.getCategory('https://api.example.test/denied',1),/permission denied/);
  assert.deepEqual(requests,['https://api.example.test/denied']);requests.length=0;
  const allowed=await adapter.getCategory('http://api.example.test/allowed',1);
  assert.equal(allowed.items[0].name,'ok');assert.equal(allowed.items[0].id,'https://cdn.example.test/final');
  assert.deepEqual(requests,['http://api.example.test/allowed','http://api.example.test/relative','https://cdn.example.test/final']);requests.length=0;
  await assert.rejects(adapter.getCategory('https://api.example.test/protocol',1),/SOURCE_PROTOCOL_DENIED/);
  assert.deepEqual(requests,['https://api.example.test/protocol']);requests.length=0;
  assert.equal((await adapter.getCategory('http://127.0.0.1/local',1)).items[0].name,'ok');
  assert.deepEqual(requests,['http://127.0.0.1/local']);
});
