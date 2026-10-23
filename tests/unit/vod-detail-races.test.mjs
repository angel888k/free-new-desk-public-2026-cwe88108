import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {parse} from '@vue/compiler-sfc';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const detail=id=>({id,name:id,episodes:[{id:'episode',flag:'route',name:'Episode'}]});
async function view(name,requests={},favorites=async()=>false){
  const code=parse(await readFile(new URL('../../apps/desktop/src/renderer/views/'+name+'.vue',import.meta.url),'utf8')).descriptor.scriptSetup.content;
  const source=ts.createSourceFile('view.ts',code,ts.ScriptTarget.Latest,true);
  const wanted=new Set(name==='VodView'?['currentBrowse','clearDetail','resetCategory','openVideo','loadHome','loadCategory','loadSource']:['open']);
  const nodes=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&wanted.has(node.name?.text));
  assert.equal(nodes.length,wanted.size);
  const saved=[],routes=[],calls=[],state={};
  for(const [key,value]of Object.entries({sourceId:'A',detail:null,favorite:false,error:'',detailSource:'',detailSourceName:'',groups:[{sourceId:'A',sourceName:'A'},{sourceId:'B',sourceName:'B'}],selectedFlag:'',episodePage:1,categoryId:'',manualCategoryId:'',categoryPage:1,pageInput:1,categoryHasMore:false,totalPages:1,totalItems:null,filterValues:{},mode:'home',loading:false,homeMeta:null,items:[],showFilters:false,sortMode:'default'}))state[key]={value};
  const context={...state,console,isVodFavorite:favorites,saveSession:value=>saved.push(value),readSession:()=>({}),localStorage:{setItem:()=>{}},router:{replace:value=>{routes.push(value);return Promise.resolve();}},window:{desktop:{source:{
    detail:(source,ids)=>{calls.push({kind:'detail',source,ids});return requests.detail(source,ids[0]);},
    home:source=>{calls.push({kind:'home',source});return requests.home(source);},
    category:(source,category,page,filters)=>{calls.push({kind:'category',source,category,page,filters});return requests.category(source,category,page,filters);},
  }}}};
  const script='let detailGeneration=0,browseGeneration=0;\n'+nodes.map(node=>node.getText(source)).join('\n')+'\nglobalThis.api={'+[...wanted].join(',')+'};';
  vm.runInNewContext(ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  return{...context.api,state,saved,routes,calls};
}
function open(v,name,source,id){if(name==='VodView'){v.state.sourceId.value=source;return v.openVideo({id,name:id});}if(name==='FavoritesView')return v.open({sourceId:source,videoId:id});return v.open(source,{id,name:id});}

for(const name of ['VodView','SearchView','FavoritesView']){
  test(name+' ignores old details and errors after another title/source is selected',async()=>{
    for(const rejectOld of [false,true]){
      const old=deferred(),next=deferred(),v=await view(name,{detail:(_source,id)=>id==='old'?old.promise:next.promise});
      const first=open(v,name,'A','old'),second=open(v,name,'B','new');
      assert.equal(v.state.detail.value,null,'old playback buttons must disappear while the new detail loads');
      next.resolve(detail('new'));await second;
      if(rejectOld)old.reject(new Error('late failure'));else old.resolve(detail('old'));
      await first;
      assert.equal(v.state.detail.value.id,'new');assert.equal(v.state.error.value,'');
      assert.equal((name==='VodView'?v.state.sourceId:v.state.detailSource).value,'B');
    }
  });
}

for(const name of ['VodView','SearchView']){
  test(name+' discards a late favorite lookup for the previous detail',async()=>{
    const selected=deferred(),v=await view(name,{detail:async(_source,id)=>detail(id)},async(_source,id)=>id==='old'?selected.promise:false);
    const first=open(v,name,'A','old');await Promise.resolve();
    const second=open(v,name,'A','new');await second;
    selected.resolve(true);await first;
    assert.equal(v.state.detail.value.id,'new');assert.equal(v.state.favorite.value,false);
    assert.equal(v.saved.some(value=>value.detailId==='old'),false);
  });
}

test('closing VOD detail invalidates its in-flight request',async()=>{
  const pending=deferred(),v=await view('VodView',{detail:()=>pending.promise});
  const first=v.openVideo({id:'old'});v.clearDetail(false);pending.resolve(detail('old'));await first;
  assert.equal(v.state.detail.value,null);assert.equal(v.saved.length,0);
});

test('changing a VOD source cannot commit an old home result or its error',async()=>{
  for(const rejectOld of [false,true]){
    const old=deferred(),next=deferred(),v=await view('VodView',{home:source=>source==='A'?old.promise:next.promise});
    const first=v.loadSource();v.state.sourceId.value='B';const second=v.loadSource();
    next.resolve({items:[{id:'new'}]});await second;
    if(rejectOld)old.reject(new Error('late source failure'));else old.resolve({items:[{id:'old'}]});await first;
    assert.equal(v.state.items.value[0].id,'new');assert.equal(v.state.error.value,'');assert.equal(v.state.loading.value,false);
  }
});

test('old category completion cannot clear the current loading flag or overwrite new filters',async()=>{
  const old=deferred(),next=deferred(),v=await view('VodView',{category:(_source,_category,_page,filters)=>filters.area==='old'?old.promise:next.promise});
  v.state.categoryId.value='movies';v.state.filterValues.value={area:'old'};const first=v.loadCategory();
  v.state.filterValues.value={area:'new'};const second=v.loadCategory();
  old.resolve({items:[{id:'old'}],page:1,hasMore:false});await first;assert.equal(v.state.loading.value,true);
  next.resolve({items:[{id:'new'}],page:1,hasMore:false});await second;
  assert.equal(v.state.items.value[0].id,'new');assert.equal(v.state.loading.value,false);
  assert.equal(v.calls[1].filters.area,'new');assert.equal(v.routes.length,1);
});
