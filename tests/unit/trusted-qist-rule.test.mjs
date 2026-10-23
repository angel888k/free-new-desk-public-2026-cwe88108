import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Drpy2Adapter} from '../../services/source-engine/dist/drpy2-adapter.js';
import {prepareExecutableReview,writeExecutableApproval} from '../../services/source-engine/dist/executable-trust.js';

test('approved pinned qist engine loads a reviewed URL rule snapshot, without refetching it inside the VM',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'fnd-qist-trust-'));t.after(()=>rm(dir,{recursive:true,force:true}));const base='https://203.0.113.1/',ruleUrl=base+'rule.js';
  const [engine,core]=await Promise.all(['drpy2.min.js','drpy-core-lite.min.js'].map(name=>readFile(new URL('../fixtures/drpy2/qist-3.9.52beta3/'+name,import.meta.url),'utf8')));
  const rule=`var rule={title:'Reviewed Rule',host:'https://203.0.113.1',homeUrl:'/',url:'/movie/fypage',class_name:'审核分类',class_url:'movie',headers:{},一级:'json:list;name;pic;note;id'};`;let ruleFetches=0;
  t.mock.method(globalThis,'fetch',async url=>{const key=String(url);if(key===base+'drpy2.min.js')return new Response(engine);if(key===base+'drpy-core-lite.min.js')return new Response(core);if(key===ruleUrl){ruleFetches++;return new Response(rule);}return new Response('{"list":[]}');});
  const source={id:'qist-trusted-rule',name:'Qist Trusted Rule',kind:'T3_JS',endpoint:base+'drpy2.min.js',ext:ruleUrl,trust:'A',enabled:true},store=path.join(dir,'approvals');await writeExecutableApproval(store,await prepareExecutableReview(source));ruleFetches=0;
  const adapter=new Drpy2Adapter(source);t.after(()=>adapter.destroy());await adapter.init({sourceId:source.id,executableTrustStoreDir:store,engineStoreDir:path.join(dir,'engines')});assert.equal(ruleFetches,1,'rule fetched once by parent; VM must get the reviewed snapshot');const home=await adapter.getHome();assert.equal(home.categories[0].name,'审核分类');assert.equal(ruleFetches,1);await adapter.destroy();
});
