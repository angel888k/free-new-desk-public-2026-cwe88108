import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';

// Load the actual compiled client, replacing only Electron's process transport.
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='electron')return{url:'fnd-test:electron',shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url==='fnd-test:electron')return{format:'module',source:`export const app={getAppPath:()=>process.cwd()};export const utilityProcess={fork:()=>globalThis.__fndRecoveryTestFork()};`,shortCircuit:true};return next(url,context);}});
const {SourceEngineClient}=await import('../../apps/desktop/dist/main/source-engine-client.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class FakeUtilityProcess extends EventEmitter{
  requests=[];killed=false;
  postMessage(request){this.requests.push(structuredClone(request));}
  kill(){this.killed=true;/* Exit is intentionally delayed, as it can be on Windows. */}
  respond(method,result={ok:true}){const request=this.requests.find(item=>item.method===method&&!item.responded);assert.ok(request,`Missing ${method} request`);request.responded=true;this.emit('message',{id:request.id,result});return request;}
  fail(method){const request=this.requests.find(item=>item.method===method&&!item.responded);assert.ok(request);request.responded=true;this.emit('message',{id:request.id,error:{code:'RESTORE_REJECTED',message:'configuration rejected',recoverable:false}});}
  methods(){return this.requests.map(item=>item.method);}
}
function setup(t){const children=[];globalThis.__fndRecoveryTestFork=()=>{const child=new FakeUtilityProcess();children.push(child);return child;};const client=new SourceEngineClient();t.after(()=>client.stop());return{client,children};}
const source={id:'reviewed',name:'Reviewed',kind:'T3_JS',endpoint:'https://example.com/source.js',enabled:true,trust:'A'};
async function configured(t){const state=setup(t),config={executableTrustStoreDir:'private/approvals'},sources=[{...source}];const first=state.client.configure(config);await turn();state.children[0].respond('source.configure');await first;const second=state.client.replaceAll(sources);await turn();state.children[0].respond('source.replaceAll');await second;return{...state,config,sources};}

test('cold-start configuration and source replacement each send one request and resolve only after acknowledgement',async t=>{
  const {client,children}=setup(t);let configured=false,replaced=false;const config=client.configure({executableTrustStoreDir:'private/approvals'}).then(()=>configured=true);await turn();assert.deepEqual(children[0].methods(),['source.configure']);assert.equal(configured,false);children[0].respond('source.configure');await config;
  const replacement=client.replaceAll([{...source}]).then(()=>replaced=true);await turn();assert.deepEqual(children[0].methods(),['source.configure','source.replaceAll']);assert.equal(replaced,false);children[0].respond('source.replaceAll');await replacement;assert.equal(replaced,true);
});
test('restarted concurrent browse requests wait for configuration then source acknowledgements, with one shared restore',async t=>{
  const {client,children}=await configured(t);client.stop();const first=client.home(source.id),second=client.search(source.id,'test');await turn();const restarted=children[1];assert.deepEqual(restarted.methods(),['source.configure']);restarted.respond('source.configure');await turn();assert.deepEqual(restarted.methods(),['source.configure','source.replaceAll']);restarted.respond('source.replaceAll');await turn();assert.deepEqual(restarted.methods(),['source.configure','source.replaceAll','source.home','source.search']);restarted.respond('source.home',{items:[]});restarted.respond('source.search',{page:1,items:[]});assert.deepEqual(await first,{items:[]});assert.deepEqual(await second,{page:1,items:[]});
});
test('a late exit and forged response from the stopped child cannot clear the new child or resolve its calls',async t=>{
  const {client,children}=await configured(t);client.stop();const home=client.home(source.id);await turn();const restarted=children[1];children[0].emit('exit',0);restarted.respond('source.configure');await turn();restarted.respond('source.replaceAll');await turn();const pending=restarted.requests.find(item=>item.method==='source.home');let resolved=false;void home.then(()=>resolved=true);children[0].emit('message',{id:pending.id,result:{items:[{id:'forged'}]}});await turn();assert.equal(resolved,false);restarted.respond('source.home',{items:[]});assert.deepEqual(await home,{items:[]});const ping=client.ping();await turn();assert.equal(children.length,2);restarted.respond('source.ping',{ok:true});assert.equal(await ping,true);
});
test('a rejected restore does not dispatch source operations',async t=>{
  const {client,children}=await configured(t);client.stop();const pending=client.home(source.id);const rejected=assert.rejects(pending,/restore failed.*RESTORE_REJECTED/);await turn();children[1].fail('source.configure');await rejected;assert.deepEqual(children[1].methods(),['source.configure']);assert.equal(children[1].killed,true);
  const retry=client.home(source.id);await turn();assert.equal(children.length,3);children[2].respond('source.configure');await turn();children[2].respond('source.replaceAll');await turn();children[2].respond('source.home',{items:[]});await retry;
});
test('cancelling a browse call while restoring returns promptly and never sends that call',async t=>{
  const {client,children}=await configured(t);client.stop();const controller=new AbortController(),pending=client.home(source.id,controller.signal),rejected=assert.rejects(pending,{name:'AbortError'});await turn();controller.abort();await rejected;children[1].respond('source.configure');await turn();children[1].respond('source.replaceAll');await turn();assert.deepEqual(children[1].methods(),['source.configure','source.replaceAll']);
});
test('recovery replays the exact acknowledged snapshot even if the caller later mutates its objects',async t=>{
  const {client,children,config,sources}=await configured(t);config.executableTrustStoreDir='changed/unapproved';sources[0].endpoint='https://example.com/changed.js';client.stop();const pending=client.home(source.id);await turn();assert.equal(children[1].requests[0].params.executableTrustStoreDir,'private/approvals');children[1].respond('source.configure');await turn();assert.equal(children[1].requests[1].params.sources[0].endpoint,source.endpoint);children[1].respond('source.replaceAll');await turn();children[1].respond('source.home',{items:[]});await pending;
});
test('a late acknowledgement from an older replacement cannot roll the recovery snapshot back',async t=>{
  const {client,children}=await configured(t),first=client.replaceAll([{...source,endpoint:'https://example.com/old.js'}]),second=client.replaceAll([{...source,endpoint:'https://example.com/latest.js'}]);await turn();const updates=children[0].requests.filter(item=>item.method==='source.replaceAll'&&!item.responded);updates[1].responded=true;children[0].emit('message',{id:updates[1].id,result:{ok:true}});await second;updates[0].responded=true;children[0].emit('message',{id:updates[0].id,result:{ok:true}});await first;
  client.stop();const home=client.home(source.id);await turn();children[1].respond('source.configure');await turn();assert.equal(children[1].requests[1].params.sources[0].endpoint,'https://example.com/latest.js');children[1].respond('source.replaceAll');await turn();children[1].respond('source.home',{items:[]});await home;
});
test('a crash retries concurrent operations on one restored replacement without killing it for another stale failure',async t=>{
  const {client,children}=await configured(t),first=client.home(source.id),second=client.search(source.id,'test');await turn();children[0].emit('exit',1);await turn();assert.equal(children.length,2);const child=children[1];assert.equal(child.killed,false);assert.deepEqual(child.methods(),['source.configure']);child.respond('source.configure');await turn();child.respond('source.replaceAll');await turn();assert.equal(child.killed,false);child.respond('source.home',{items:[]});child.respond('source.search',{page:1,items:[]});await Promise.all([first,second]);
});
test.after(()=>{hooks.deregister();delete globalThis.__fndRecoveryTestFork;});
