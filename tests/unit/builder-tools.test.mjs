import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {prepareBuilderTools} from '../../scripts/prepare-builder-tools.mjs';
import {windowsPackageArguments} from '../../scripts/package-windows.mjs';

const repo=path.resolve(import.meta.dirname,'../..');
async function isolated(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'fnd-builder-tool-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^fnd-builder-tool-test-/);await rm(root,{recursive:true,force:true});});
  const directory=path.join(root,'third_party/build-tools');await mkdir(path.join(directory,'cache'),{recursive:true});
  await copyFile(path.join(repo,'third_party/build-tools/SOURCE.json'),path.join(directory,'SOURCE.json'));
  const source=JSON.parse(await readFile(path.join(directory,'SOURCE.json'),'utf8'));
  return{root,cache:path.join(directory,'cache'),source};
}
test('pinned archiver runs and payload tests use the fixed security version',async()=>{
  const tools=await prepareBuilderTools(undefined,{nsis:false});
  assert.equal(tools.versions.sevenZip,'26.04');
  assert.match(execFileSync(tools.sevenZipPath,['i'],{encoding:'utf8',windowsHide:true}),/26\.04/);
});
test('corrupt downloaded build tool archive is rejected before extraction',async t=>{
  const f=await isolated(t),source=f.source.sevenZip.platforms[`${process.platform}-${process.arch}`];
  const extension=new URL(source.url).pathname.endsWith('.7z')?'.7z':'.tar.xz';
  await writeFile(path.join(f.cache,source.archiveSha256+extension),'controlled invalid archive');
  await assert.rejects(()=>prepareBuilderTools(f.root,{nsis:false}),/archive SHA256 mismatch/);
});
test('cached executable replacement is rejected rather than reused',async t=>{
  const f=await isolated(t),source=f.source.sevenZip.platforms[`${process.platform}-${process.arch}`];
  const target=path.join(f.cache,`7zip-${f.source.sevenZip.version}-${process.platform}-${process.arch}`,source.executable);
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,'controlled replaced executable');
  await assert.rejects(()=>prepareBuilderTools(f.root,{nsis:false}),/executable SHA256 mismatch/);
});
test('packaging wrapper consumes signed flag and preserves output and Electron distribution arguments',()=>{
  const args=['--signed','--config.directories.output=dist/isolated','--config.electronDist=D:/controlled local/electron.zip'];
  const configured=windowsPackageArguments(args);
  assert.equal(configured.signed,true);assert(!configured.args.includes('--signed'));
  assert(configured.args.includes('--config.forceCodeSigning=true'));
  assert.deepEqual(configured.args.slice(-2),args.slice(-2));
});

test('unsigned packaging keeps application icon editing and rejects disabling it',()=>{
  const configured=windowsPackageArguments([]);
  assert.equal(configured.signed,false);
  assert(configured.args.includes('--config.win.signExecutable=false'));
  assert(!configured.args.includes('--config.win.signAndEditExecutable=false'));
  assert.throws(()=>windowsPackageArguments(['--config.win.signAndEditExecutable=false']),/icon resource editing/);
});
test('builder proxy dependency override initializes the unchanged bootstrap API without network access',()=>{
  const script=`const path=require('node:path');const builder=path.dirname(require.resolve('app-builder-lib/package.json'));const get=path.dirname(require.resolve('@electron/get/package.json',{paths:[builder]}));const agent=require(require.resolve('global-agent/package.json',{paths:[get]}));if(agent.version!=='4.1.3')throw Error('Unexpected proxy version');require(path.join(get,'dist/cjs/proxy.js')).initializeProxy();if(!global.GLOBAL_AGENT)throw Error('Proxy bootstrap failed');console.log(agent.version);`;
  assert.equal(execFileSync(process.execPath,['-e',script],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),'4.1.3');
});
if(process.platform==='win32')test('builder resolves the verified native NSIS entrypoint and compiles a controlled installer',async t=>{
  const f=await isolated(t),tools=await prepareBuilderTools(),require=createRequire(import.meta.url);
  const previous=process.env.ELECTRON_BUILDER_NSIS_DIR;
  process.env.ELECTRON_BUILDER_NSIS_DIR=tools.nsisDir;
  t.after(()=>{if(previous===undefined)delete process.env.ELECTRON_BUILDER_NSIS_DIR;else process.env.ELECTRON_BUILDER_NSIS_DIR=previous;});
  const entry=await require('app-builder-lib/out/toolsets/windows').getMakeNsisPath('1.2.1');
  assert.equal(entry.path,path.join(tools.nsisDir,'Bin/makensis.exe'));
  const output=path.join(f.root,'controlled-installer.exe').replaceAll('\\','/');
  const script=`Name "Controlled tool test"\nOutFile "${output}"\nRequestExecutionLevel user\nSection\nDetailPrint "Controlled fixture"\nSectionEnd\n`;
  await require('builder-util').spawnAndWriteWithOutput(entry.path,['/NOCD','/V2','-INPUTCHARSET','UTF8','-'],script,{env:{...process.env,...entry.env}});
  assert.equal((await readFile(output)).subarray(0,2).toString(),'MZ');
});
