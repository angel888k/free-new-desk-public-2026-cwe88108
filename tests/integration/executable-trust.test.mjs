import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PluginAdapter} from '../../services/source-engine/dist/plugin-adapter.js';
import {SpiderAdapter} from '../../services/source-engine/dist/spider-adapter.js';
import {Drpy2Adapter} from '../../services/source-engine/dist/drpy2-adapter.js';
import {JavaSpiderAdapter} from '../../services/source-engine/dist/java-spider-adapter.js';
import {prepareExecutableReview,writeExecutableApproval,revokeExecutableApproval,readExecutableApproval} from '../../services/source-engine/dist/executable-trust.js';
import {launchTrustedWorker} from '../../services/source-engine/dist/trusted-worker.js';
import {TrustedExecutableReview} from '../../apps/desktop/dist/main/trusted-executable-review.js';

async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'fnd-executable-trust-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const config=(id,kind,endpoint,extra={})=>({id,name:id,kind,endpoint,enabled:true,trust:'A',configRevision:'r1',...extra});
const denied=action=>assert.rejects(action,/SOURCE_EXECUTABLE_NOT_APPROVED/);

test('imported trust A cannot run a local plugin; approval covers manifest, entry, revision, and revocation',async t=>{
  const dir=await fixture(t),manifest=path.join(dir,'plugin.json'),entry=path.join(dir,'index.js'),store=path.join(dir,'approvals');
  await writeFile(manifest,JSON.stringify({id:'fixture.plugin',name:'Fixture',version:'1.0.0',apiVersion:'1',entry:'index.js',permissions:{network:[]}}));
  const code=`module.exports={home(){return{categories:[{id:'1',name:'Trusted'}],items:[]}},category(){return{page:1,hasMore:false,items:[]}},search(){return{page:1,items:[]}},detail(){return{id:'1',name:'Trusted',episodes:[]}},play(){return{url:'https://media.example/1.mp4',parse:false}}}`;
  await writeFile(entry,code);const source=config('trusted-plugin','PLUGIN',manifest),ctx={sourceId:source.id,executableTrustStoreDir:store};
  for(const context of [{sourceId:source.id},ctx]){const adapter=new PluginAdapter(source);await denied(()=>adapter.init(context));await adapter.destroy();}
  await writeExecutableApproval(store,await prepareExecutableReview(source));const approved=new PluginAdapter(source);await approved.init(ctx);assert.equal((await approved.getHome()).categories[0].name,'Trusted');await approved.destroy();
  await writeFile(entry,`${code}\n// updated entry`);const changed=new PluginAdapter(source);await denied(()=>changed.init(ctx));await changed.destroy();
  await writeFile(entry,code);const revised=new PluginAdapter({...source,configRevision:'r2'});await denied(()=>revised.init(ctx));await revised.destroy();
  const data=JSON.parse(await readFile(manifest));data.permissions.network=['example.com'];await writeFile(manifest,JSON.stringify(data));const permissionChange=new PluginAdapter(source);await denied(()=>permissionChange.init(ctx));await permissionChange.destroy();
  await writeExecutableApproval(store,await prepareExecutableReview(source));await revokeExecutableApproval(store,source.id);const revoked=new PluginAdapter(source);await denied(()=>revoked.init(ctx));await revoked.destroy();
});

test('remote JS execution uses the approved bytes and rejects same-URL updates',async t=>{
  const dir=await fixture(t),store=path.join(dir,'approvals'),source=config('trusted-js','T3_JS','https://203.0.113.1/spider.js');
  let code=`module.exports={homeContent(){return{class:[{type_id:'1',type_name:'Approved'}],list:[]}}}`;t.mock.method(globalThis,'fetch',async()=>new Response(code));
  const ctx={sourceId:source.id,executableTrustStoreDir:store},unapproved=new SpiderAdapter(source);await denied(()=>unapproved.init(ctx));await unapproved.destroy();
  await writeExecutableApproval(store,await prepareExecutableReview(source));const approved=new SpiderAdapter(source);await approved.init(ctx);assert.equal((await approved.getHome()).categories[0].name,'Approved');await approved.destroy();
  code+='\n// new remote version';const changed=new SpiderAdapter(source);await denied(()=>changed.init(ctx));await changed.destroy();
});

test('DRPY gate covers the ESM graph, remote rule and $require dependencies before engine execution',async t=>{
  const dir=await fixture(t),store=path.join(dir,'approvals'),base='https://203.0.113.1/',source=config('trusted-drpy','T3_JS',base+'drpy2.js',{ext:base+'rule.js'});
  const [engine,core]=await Promise.all(['engine.js','core.js'].map(name=>readFile(new URL('../fixtures/drpy2/controlled-v1/'+name,import.meta.url),'utf8')));
  const values=new Map([[base+'drpy2.js',engine],[base+'core.js',core],[base+'rule.js',`var rule={title:'Reviewed'}; $require('${base}helper.js');`],[base+'helper.js',`const helper='reviewed';`]]);
  t.mock.method(globalThis,'fetch',async url=>new Response(values.get(String(url))??'missing',{status:values.has(String(url))?200:404}));const ctx={sourceId:source.id,executableTrustStoreDir:store,engineStoreDir:path.join(dir,'engines')};
  const unapproved=new Drpy2Adapter(source);await denied(()=>unapproved.init(ctx));await unapproved.destroy();await writeExecutableApproval(store,await prepareExecutableReview(source));
  const approved=new Drpy2Adapter(source);await approved.init(ctx);assert.equal((await approved.getHome()).items[0].name,'Home One');await approved.destroy();
  for(const location of [base+'rule.js',base+'helper.js',base+'core.js',base+'drpy2.js']){const original=values.get(location);values.set(location,original+'\n// changed bytes');const changed=new Drpy2Adapter(source);await denied(()=>changed.init(ctx));await changed.destroy();values.set(location,original);}
});

test('native approval coordinator requires exported bytes, rechecks changes during confirmation, and honors cancellation',async t=>{
  const dir=await fixture(t),source=config('review-flow','T3_JS','https://203.0.113.1/spider.js'),store=path.join(dir,'approvals');let code='module.exports={home(){return{items:[]}}}',mode='cancel',dialogs=0,resets=0;
  t.mock.method(globalThis,'fetch',async()=>new Response(code));const service=new TrustedExecutableReview({storeDir:store,findSource:()=>source,prepare:prepareExecutableReview,choosePath:async()=>path.join(dir,'review.md'),confirm:async()=>{dialogs++;if(mode==='race')code+='\n// changed in dialog';return mode!=='cancel';},reset:async()=>{resets++;}});
  await assert.rejects(()=>service.approve(source.id),/先导出/);assert.equal(dialogs,0);assert.equal(await readExecutableApproval(store,source.id),undefined);
  const exported=await service.review(source.id);assert.equal(exported.canceled,false);assert.match(await readFile(exported.path,'utf8'),/不是安全沙箱/);assert.equal((await service.statuses([source]))[0].reviewReady,true);
  assert.equal((await service.approve(source.id)).approved,false);assert.equal(await readExecutableApproval(store,source.id),undefined);
  mode='race';await assert.rejects(()=>service.approve(source.id),/确认期间代码或配置已变化/);assert.equal(await readExecutableApproval(store,source.id),undefined);
  await service.review(source.id);mode='approve';assert.equal((await service.approve(source.id)).approved,true);assert.equal((await service.statuses([source]))[0].approved,true);await service.revoke(source.id);assert.equal((await service.statuses([source]))[0].approved,false);assert.ok(resets>=3);
});

test('trusted child launch drops arbitrary inherited application credentials',async t=>{
  const dir=await fixture(t),entry=path.join(dir,'worker.cjs');await writeFile(entry,`process.send({secret:process.env.FND_TRUST_TEST_SECRET,options:process.env.NODE_OPTIONS,path:!!process.env.Path||!!process.env.PATH});`);
  const previous=process.env.FND_TRUST_TEST_SECRET;process.env.FND_TRUST_TEST_SECRET='local-test-marker';t.after(()=>{if(previous===undefined)delete process.env.FND_TRUST_TEST_SECRET;else process.env.FND_TRUST_TEST_SECRET=previous;});
  const child=launchTrustedWorker(entry,[]);t.after(()=>child.kill());const result=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});assert.deepEqual(result,{path:true});child.kill();
});

test('JAR entry and relative Class-Path dependency bytes are reviewed, then execute from an immutable copy',async t=>{
  if(spawnSync('javac',['-version'],{windowsHide:true}).error||spawnSync('jar',['--version'],{windowsHide:true}).error){t.skip('JDK tools unavailable');return;}
  const dir=await fixture(t),classes=path.join(dir,'classes'),lib=path.join(dir,'lib'),store=path.join(dir,'approvals');await mkdir(classes);await mkdir(lib);
  await writeFile(path.join(dir,'Helper.java'),'package fixture; public class Helper { public static String name(){return "Reviewed dependency";} }');
  await writeFile(path.join(dir,'TestFixture.java'),'package com.github.catvod.spider; public class TestFixture {public String homeContent(boolean filter){return "{\\\"class\\\":[{\\\"type_id\\\":\\\"1\\\",\\\"type_name\\\":\\\""+fixture.Helper.name()+"\\\"}],\\\"list\\\":[]}";} public String homeVideoContent(){return "{\\\"list\\\":[]}";}}');
  const run=(command,args)=>{const result=spawnSync(command,args,{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  run('javac',['-d',classes,path.join(dir,'Helper.java'),path.join(dir,'TestFixture.java')]);run('jar',['--create','--file',path.join(lib,'helper.jar'),'-C',classes,'fixture']);
  await writeFile(path.join(dir,'MANIFEST.MF'),'Manifest-Version: 1.0\nClass-Path: lib/helper.jar\n\n');run('jar',['--create','--file',path.join(dir,'main.jar'),'--manifest',path.join(dir,'MANIFEST.MF'),'-C',classes,'com']);
  const source=config('trusted-jar','T3_JAR','csp_TestFixture',{jar:path.join(dir,'main.jar')}),ctx={sourceId:source.id,executableTrustStoreDir:store};const unapproved=new JavaSpiderAdapter(source);await denied(()=>unapproved.init(ctx));await unapproved.destroy();const review=await prepareExecutableReview(source);assert.equal(review.artifacts.length,2);await writeExecutableApproval(store,review);
  const approved=new JavaSpiderAdapter(source);await approved.init(ctx);assert.equal((await approved.getHome()).categories[0].name,'Reviewed dependency');await approved.destroy();
  const helperBytes=await readFile(path.join(lib,'helper.jar'));helperBytes.writeUInt16LE(7,helperBytes.length-2);await writeFile(path.join(lib,'helper.jar'),Buffer.concat([helperBytes,Buffer.from('updated')]));const changed=new JavaSpiderAdapter(source);await denied(()=>changed.init(ctx));await changed.destroy();
});
