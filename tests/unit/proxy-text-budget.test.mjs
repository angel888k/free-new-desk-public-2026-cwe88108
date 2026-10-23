import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import test from 'node:test';
import {ProxyService} from '../../services/proxy-service/dist/index.js';

// Exercise the real handler with native Response streams while TCP is tested separately.
async function proxyHarness(t,transport){
  let handler;
  t.mock.method(http,'createServer',callback=>{
    handler=callback;
    return{once(){return this;},listen(_port,_host,ready){ready();},address(){return{port:43210};},close(done){done();}};
  });
  t.mock.method(globalThis,'fetch',transport);
  const proxy=new ProxyService(),descriptor=await proxy.start();t.after(()=>proxy.stop());
  return(target,subtitle=false,headers={},proxied=false)=>{
    const url=new URL(proxied?target:subtitle?proxy.subtitleUrl(target,headers):proxy.url(target,headers));
    const request=Object.assign(new EventEmitter(),{method:'GET',headers:{authorization:`Bearer ${descriptor.token}`},url:url.pathname+url.search,destroyed:false});
    let resolve;const done=new Promise(value=>{resolve=value;});
    const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,headersSent:false,status:0,headers:{},body:'',writeHead(status,headers){this.headersSent=true;this.status=status;this.headers=headers;return this;},write(){return true;},end(body=''){this.body=String(body);this.writableEnded=true;resolve(this);},destroy(){this.destroyed=true;this.emit('close');resolve(this);}});
    handler(request,response);return{request,response,done};
  };
}

test('HLS segment, key and variant requests scope credentials to the manifest origin',async t=>{
  const seen=[];
  const invoke=await proxyHarness(t,async(url,init)=>{
    seen.push({url:String(url),headers:new Headers(init.headers)});
    return String(url).endsWith('/master.m3u8')?new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.test/key"\n#EXT-X-MAP:URI="init.mp4"\nhttps://cdn.test/variant.m3u8\nsegment.ts',{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response('bytes');
  });
  const result=await invoke('https://origin.test/master.m3u8',false,{Authorization:'Bearer synthetic',COOKIE:'synthetic','X-Source-Token':'secret',Referer:'https://origin.test/', 'User-Agent':'test-player'}).done;
  assert.equal(result.status,200);
  const children=[...result.body.matchAll(/URI="([^"]+)"/g)].map(match=>match[1]);
  children.push(...result.body.split('\n').filter(line=>line&&!line.startsWith('#')));
  for(const child of children)assert.equal((await invoke(child,false,{},true).done).status,200);
  assert.equal(seen.length,5);
  for(const request of seen.slice(1)){
    assert.equal(request.headers.get('user-agent'),'test-player');
    if(new URL(request.url).origin==='https://origin.test'){
      assert.equal(request.headers.get('authorization'),'Bearer synthetic');assert.equal(request.headers.get('cookie'),'synthetic');
    }else for(const name of ['authorization','cookie','referer','x-source-token'])assert.equal(request.headers.has(name),false,name+' must not cross origins');
  }
});

test('redirects retain same-origin credentials but never resurrect them after crossing origins',async t=>{
  const seen=[];
  const routes=new Map([
    ['https://origin.test/entry',{status:302,headers:{location:'/same'}}],
    ['https://origin.test/same',{status:307,headers:{location:'https://cdn.test/redirect'}}],
    ['https://cdn.test/redirect',{status:308,headers:{location:'https://origin.test/final.m3u8'}}],
  ]);
  const invoke=await proxyHarness(t,async(url,init)=>{
    assert.equal(init.redirect,'manual');seen.push({url:String(url),headers:new Headers(init.headers)});
    const redirect=routes.get(String(url));if(redirect)return new Response(null,redirect);
    return String(url).endsWith('final.m3u8')?new Response('#EXTM3U\nsegment.ts',{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response('bytes');
  });
  const result=await invoke('https://origin.test/entry',false,{Authorization:'Bearer synthetic',Cookie:'synthetic','X-Api-Key':'secret',Referer:'https://origin.test/'}).done;
  assert.equal(result.status,200);
  assert.equal(seen[0].headers.get('authorization'),'Bearer synthetic');assert.equal(seen[1].headers.get('authorization'),'Bearer synthetic');
  const child=result.body.split('\n').find(line=>line&&!line.startsWith('#'));
  assert.equal(new URL(child).searchParams.get('u'),'https://origin.test/segment.ts');
  assert.equal((await invoke(child,false,{},true).done).status,200);
  for(const request of seen.slice(2))for(const name of ['authorization','cookie','referer','x-api-key'])assert.equal(request.headers.has(name),false);
});

test('proxy bounds redirect chains and refuses non-HTTP redirect targets',async t=>{
  let calls=0;
  const invoke=await proxyHarness(t,async url=>{calls++;return new Response(null,{status:302,headers:{location:String(url).endsWith('/invalid')?'file:///private.txt':'/loop'}});});
  const loop=await invoke('https://origin.test/loop').done;assert.equal(loop.status,502);assert.match(loop.body,/redirect limit/);assert.equal(calls,9);
  calls=0;const invalid=await invoke('https://origin.test/invalid').done;assert.equal(invalid.status,502);assert.match(invalid.body,/protocol is not supported/);assert.equal(calls,1);
});

test('proxy enforces distinct HLS and subtitle byte budgets through its actual request handler',async t=>{
  const cancelled=[];
  const invoke=await proxyHarness(t,async url=>new Response(new ReadableStream({cancel(){cancelled.push(String(url));}}),{headers:{'content-type':String(url).endsWith('.m3u8')?'application/vnd.apple.mpegurl':'text/vtt','content-length':String(String(url).endsWith('.m3u8')?8*1024*1024+1:16*1024*1024+1)}}));
  for(const [target,subtitle,limit] of [['https://media.test/master.m3u8',false,8*1024*1024],['https://media.test/sub.vtt',true,16*1024*1024]]){
    const result=await invoke(target,subtitle).done;assert.equal(result.status,502);assert.match(result.body,new RegExp(`exceeds ${limit} byte safety limit`));
  }
  assert.equal(cancelled.length,2);
});

test('proxy rejects HLS chunked overflows even without Content-Length and cancels transport',async t=>{
  let cancelled=false;
  const invoke=await proxyHarness(t,async()=>new Response(new ReadableStream({start(stream){stream.enqueue(new Uint8Array(8*1024*1024+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/vnd.apple.mpegurl'}}));
  const result=await invoke('https://media.test/master.m3u8').done;assert.equal(result.status,502);assert.match(result.body,/byte safety limit/);assert.equal(cancelled,true);
});

test('proxy bounds rewritten HLS output when many URIs amplify forwarded headers',async t=>{
  const invoke=await proxyHarness(t,async()=>new Response('#EXTM3U\n'+Array(2000).fill('segment.ts').join('\n'),{headers:{'content-type':'application/vnd.apple.mpegurl'}}));
  const result=await invoke('https://media.test/master.m3u8',false,{'x-source-token':'a'.repeat(16*1024)}).done;
  assert.equal(result.status,502);assert.match(result.body,/rewritten HLS exceeds byte safety limit/);
});

test('proxy total text deadline stays active after headers arrive and releases stalled bodies',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
  const invoke=await proxyHarness(t,async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/vnd.apple.mpegurl'}}));
  const request=invoke('https://media.test/master.m3u8');
  await Promise.resolve();t.mock.timers.tick(20_000);
  const result=await request.done;assert.equal(result.status,502);assert.match(result.body,/upstream request timeout/);assert.equal(cancelled,true);
});

test('proxy cancels an in-flight subtitle transform when its client disconnects',async t=>{
  let cancelled=false,signal;
  const invoke=await proxyHarness(t,async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/vtt'}});});
  const request=invoke('https://media.test/sub.vtt',true);await Promise.resolve();request.response.destroy();await request.done;await Promise.resolve();
  assert.equal(signal.aborted,true);assert.equal(cancelled,true);assert.equal(request.response.status,0);
});

test('proxy preserves normal HLS rewriting and SRT conversion inside its budgets',async t=>{
  const invoke=await proxyHarness(t,async url=>String(url).endsWith('.srt')?new Response('1\n00:00:01,000 --> 00:00:02,000\n字幕',{headers:{'content-type':'application/x-subrip'}}):new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts',{headers:{'content-type':'application/vnd.apple.mpegurl'}}));
  const hls=await invoke('https://media.test/folder/master.m3u8').done;assert.equal(hls.status,200);assert.match(hls.body,/\/proxy\?u=/);assert.match(hls.body,/folder%2Fsegment.ts/);
  const subtitle=await invoke('https://media.test/sub.srt',true).done;assert.equal(subtitle.status,200);assert.equal(subtitle.headers['content-type'],'text/vtt; charset=utf-8');assert.match(subtitle.body,/^WEBVTT[\s\S]*00:00:01\.000[\s\S]*字幕/);
});

test('proxy keeps progressing live media open beyond the text total deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let stream,signal;
  const invoke=await proxyHarness(t,async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'video/mp4'}});});
  const request=invoke('https://media.test/live.mp4');await new Promise(setImmediate);
  for(let tick=0;tick<2;tick++){
    t.mock.timers.tick(20_000);assert.equal(signal.aborted,false);stream.enqueue(new Uint8Array(1));await new Promise(setImmediate);
  }
  stream.close();const result=await request.done;assert.equal(result.status,200);assert.equal(signal.aborted,false);
});

test('proxy cancels upstream and releases a blocked drain waiter when its client disconnects',async t=>{
  let cancelled=false,signal;
  const invoke=await proxyHarness(t,async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({start(stream){stream.enqueue(new Uint8Array(64*1024));},cancel(){cancelled=true;}}),{headers:{'content-type':'video/mp4'}});});
  const request=invoke('https://media.test/live.mp4');request.response.write=()=>false;
  await new Promise(setImmediate);assert.equal(request.response.listenerCount('drain'),1);
  request.response.destroy();await new Promise(setImmediate);
  assert.equal(signal.aborted,true);assert.equal(cancelled,true);assert.equal(request.response.listenerCount('drain'),0);assert.equal(request.response.status,200);
});
