import assert from 'node:assert/strict';
import test from 'node:test';
import {RequestBroker} from '../../packages/source-sdk/dist/index.js';
import {isNetworkAllowed,parsePluginManifest} from '../../packages/plugin-sdk/dist/index.js';
import {readTextBody} from '../../services/proxy-service/dist/text-body.js';

const manifest=parsePluginManifest({id:'network.test',name:'Network test',version:'1.0.0',apiVersion:'1',entry:'index.js',permissions:{network:['api.example.test','*.media.example.test','127.0.0.1','192.168.1.10']}});
const validateUrl=url=>{if(!isNetworkAllowed(manifest,url))throw new Error('Plugin network permission denied');};

test('plugin policy only permits HTTP(S), preserves explicit LAN permission, and rejects deceptive hosts',()=>{
  for(const url of ['https://api.example.test/x','http://192.168.1.10/a','http://127.0.0.1/a','https://cdn.media.example.test/a'])assert.equal(isNetworkAllowed(manifest,url),true,url);
  for(const url of ['ftp://api.example.test/x','file://api.example.test/x','https://api.example.test.evil.test/x','https://api.example.test@evil.test/x','http://192.168.1.11/a'])assert.equal(isNetworkAllowed(manifest,url),false,url);
});

test('Broker checks denied entry and every redirect before transport, cancelling the previous body',async t=>{
  const requests=[];let cancelled=false;
  t.mock.method(globalThis,'fetch',async url=>{requests.push(String(url));return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'https://denied.example.test/secret'}});});
  const broker=new RequestBroker();
  await assert.rejects(broker.request({sourceId:'plugin',url:'https://denied.example.test/entry',validateUrl}),/permission denied/);
  assert.deepEqual(requests,[]);
  await assert.rejects(broker.request({sourceId:'plugin',url:'https://api.example.test/entry',validateUrl}),/permission denied/);
  assert.deepEqual(requests,['https://api.example.test/entry']);assert.equal(cancelled,true);
});

test('Broker permits relative, multi-hop, and HTTP to HTTPS redirects only when every host is allowed',async t=>{
  const requests=[],checks=[];
  t.mock.method(globalThis,'fetch',async url=>{
    requests.push(String(url));
    if(requests.length===1)return new Response('',{status:302,headers:{location:'/relative'}});
    if(requests.length===2)return new Response('',{status:307,headers:{location:'https://cdn.media.example.test/final'}});
    return new Response('allowed');
  });
  const broker=new RequestBroker();
  const response=await broker.request({sourceId:'plugin',url:'http://api.example.test/entry',validateUrl:url=>{checks.push(url);validateUrl(url);}});
  assert.equal(await response.text(),'allowed');assert.equal(response.redirected,true);assert.equal(response.url,'https://cdn.media.example.test/final');
  assert.deepEqual(requests,['http://api.example.test/entry','http://api.example.test/relative','https://cdn.media.example.test/final']);assert.deepEqual(checks,requests);
});

test('Broker rejects non-HTTP protocols before initial or redirected transport, even with a permissive callback',async t=>{
  const requests=[];let cancelled=false;
  t.mock.method(globalThis,'fetch',async url=>{requests.push(String(url));return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'file://api.example.test/local'}});});
  const broker=new RequestBroker();
  await assert.rejects(broker.request({sourceId:'protocol',url:'data:text/plain,no',validateUrl:()=>{}}),/SOURCE_PROTOCOL_DENIED/);
  assert.deepEqual(requests,[]);
  await assert.rejects(broker.request({sourceId:'protocol',url:'https://api.example.test/entry',validateUrl:()=>{}}),/SOURCE_PROTOCOL_DENIED/);
  assert.deepEqual(requests,['https://api.example.test/entry']);assert.equal(cancelled,true);
});

test('Broker redirect cycles remain bounded and cancel every intermediate body',async t=>{
  let requests=0,cancelled=0,checked=0;
  t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:302,headers:{location:'/loop'}});});
  await assert.rejects(new RequestBroker().request({sourceId:'cycle',url:'https://api.example.test/loop',validateUrl:url=>{checked++;validateUrl(url);}}),/SOURCE_REDIRECT_LIMIT/);
  assert.equal(requests,9);assert.equal(checked,requests);assert.equal(cancelled,requests);
});

test('bounded text accepts exact-byte UTF-8 budgets across chunk boundaries',async()=>{
  const encoded=new TextEncoder().encode('字幕\n#EXTM3U');
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(encoded.slice(0,1));controller.enqueue(encoded.slice(1,4));controller.enqueue(encoded.slice(4));controller.close();}}));
  assert.equal(await readTextBody(response,new AbortController().signal,encoded.length),'字幕\n#EXTM3U');
});

test('bounded text cancels declared over-limit bodies before buffering them',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':'5'}});
  await assert.rejects(readTextBody(response,new AbortController().signal,4),/byte safety limit/);assert.equal(cancelled,true);
});

test('bounded text counts actual chunked bytes without trusting missing or misleading lengths',async()=>{
  for(const headers of [{},{'content-length':'1'}]){
    let cancelled=false;
    const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(3));controller.enqueue(new Uint8Array(3));},cancel(){cancelled=true;}}),{headers});
    await assert.rejects(readTextBody(response,new AbortController().signal,4),/byte safety limit/);assert.equal(cancelled,true);
  }
});

test('bounded text releases header-only stalled bodies when the total deadline expires',async()=>{
  let cancelled=false;const controller=new AbortController();
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  const pending=readTextBody(response,controller.signal,1024);
  controller.abort(new DOMException('Proxy upstream request timeout','TimeoutError'));
  await assert.rejects(pending,/request timeout/);assert.equal(cancelled,true);
});

test('bounded text cancels ongoing and already-aborted client requests without returning partial text',async()=>{
  for(const alreadyAborted of [false,true]){
    let cancelled=false;const controller=new AbortController();
    const response=new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('partial'));},cancel(){cancelled=true;}}));
    if(alreadyAborted)controller.abort(new DOMException('Proxy client disconnected','AbortError'));
    const pending=readTextBody(response,controller.signal,1024);
    if(!alreadyAborted)controller.abort(new DOMException('Proxy client disconnected','AbortError'));
    await assert.rejects(pending,/client disconnected/);assert.equal(cancelled,true);
  }
});
