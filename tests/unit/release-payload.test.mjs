import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {crc32} from 'node:zlib';
import {verifyExecutablePayload,validateUpdateManifest} from '../../scripts/release-manifest.mjs';
import {prepareBuilderTools} from '../../scripts/prepare-builder-tools.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const current={'app.exe':'current executable bytes','resources/app.asar':'current application bytes'};
const expected=Object.entries(current).map(([file,value])=>({path:file,sha256:hash(value)})).sort((a,b)=>a.path.localeCompare(b.path));
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'fnd-payload-check-'));
  t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^fnd-payload-check-/);await rm(dir,{recursive:true,force:true});});
  const tool=(await prepareBuilderTools(undefined,{nsis:false})).sevenZipPath;
  const archive=async(files,name=`${randomUUID()}.exe`)=>{
    const source=path.join(dir,randomUUID());await mkdir(source);
    for(const[file,value]of Object.entries(files)){const target=path.join(source,...file.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,value);}
    const target=path.join(dir,name);execFileSync(tool,['a','-t7z','-mhc=off','-bso0','-bsp0','--',target,'.'],{cwd:source,windowsHide:true});return target;
  };
  return{dir,tool,archive};
}

async function unsafeFixturePath(archive,replacement){
  // Modern 7-Zip refuses unsafe rename requests. Construct a controlled, valid
  // plain 7z header instead, without using a vulnerable archiver for the test.
  const bytes=await readFile(archive),start=32+Number(bytes.readBigUInt64LE(12)),size=Number(bytes.readBigUInt64LE(20));
  const header=bytes.subarray(start,start+size),name=Buffer.from('safe.txt','utf16le'),changed=Buffer.from(replacement,'utf16le');
  assert.equal(changed.length,name.length);const offset=header.indexOf(name);assert(offset>=0);changed.copy(header,offset);
  bytes.writeUInt32LE(crc32(header),28);bytes.writeUInt32LE(crc32(bytes.subarray(12,32)),8);
  await writeFile(archive,bytes);
}

test('release payload complete inventory accepts byte-identical current application files',async t=>{
  const f=await fixture(t),archive=await f.archive(current);
  const result=await verifyExecutablePayload(archive,expected,f.dir);
  assert.equal(result.fileCount,2);assert.equal(result.treeSha256,hash(Buffer.from(JSON.stringify(expected))));
});

test('release payload complete inventory rejects missing, changed, and additional old application files',async t=>{
  const f=await fixture(t);
  for(const files of [{'app.exe':current['app.exe']},{...current,'app.exe':'old executable bytes'},{...current,'legacy/old-app.exe':'old unexpected application'}]){
    await assert.rejects(verifyExecutablePayload(await f.archive(files),expected,f.dir),/payload does not match/);
  }
});

test('release payload rejects nested x64 wrappers instead of ignoring their extra old files',async t=>{
  const f=await fixture(t),inner=await f.archive(current,'current-inner.7z');
  const archive=await f.archive({'app-64.7z':await readFile(inner),'legacy/old-app.exe':'unverified old payload'});
  await assert.rejects(verifyExecutablePayload(archive,expected,f.dir),/wrapper layout is not supported/);
});

test('release payload rejects multiple nested x64 application archives',async t=>{
  const f=await fixture(t),inner=await f.archive(current,'inner.7z'),bytes=await readFile(inner);
  const archive=await f.archive({'app-64.7z':bytes,'old/app-64.7z':bytes});
  await assert.rejects(verifyExecutablePayload(archive,expected,f.dir),/wrapper layout is not supported/);
});

test('release payload rejects parent-directory archive paths before extraction',async t=>{
  const f=await fixture(t),archive=await f.archive({'safe.txt':'controlled harmless text'});
  await unsafeFixturePath(archive,'../a.txt');
  const listing=execFileSync(f.tool,['l','-slt','--',archive],{encoding:'utf8',windowsHide:true});
  assert.match(listing,/Path = \.\.[\\/]a\.txt/);
  await assert.rejects(verifyExecutablePayload(archive,[],f.dir),/Unsafe path/);
  await assert.rejects(readFile(path.join(f.dir,'a.txt')),/ENOENT/);
});

test('release payload rejects absolute Windows archive paths before extraction',async t=>{
  const f=await fixture(t),archive=await f.archive({'safe.txt':'controlled harmless text'});
  await unsafeFixturePath(archive,'C:/a.txt');
  const listing=execFileSync(f.tool,['l','-slt','--',archive],{encoding:'utf8',windowsHide:true});
  assert.match(listing,/Path = C:[\\/]a\.txt/);
  await assert.rejects(verifyExecutablePayload(archive,[],f.dir),/Unsafe path/);
});

test('release updater gate rejects object-shaped files collections that mimic an array',()=>{
  const setup={name:'Setup.exe',sha512:'verified',size:100};
  const update={version:'1.0.0',path:setup.name,sha512:setup.sha512,files:{length:1,0:{url:setup.name,sha512:setup.sha512,size:setup.size}}};
  assert.throws(()=>validateUpdateManifest(JSON.stringify(update),setup,'1.0.0'),/does not match/);
});
