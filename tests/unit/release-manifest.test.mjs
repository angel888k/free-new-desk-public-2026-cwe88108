import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeReleaseManifest,validateUpdateManifest,executableImageHash} from '../../scripts/release-manifest.mjs';

test('release gate rejects unsigned artifacts and a mismatched updater manifest',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'fnd-release-gate-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'dist','releases');await mkdir(output,{recursive:true});
  await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0',build:{directories:{output:'dist/releases'}}}));
  for(const kind of ['Setup','Portable'])await writeFile(path.join(output,`Free-New-Desk-${kind}-1.0.0-x64.exe`),'unsigned controlled artifact');
  await writeFile(path.join(output,'latest.yml'),'version: 1.0.0\npath: wrong.exe\nsha512: bad\n');
  const previous=process.env.FND_SIGNER_THUMBPRINT;
  t.after(()=>{if(previous===undefined)delete process.env.FND_SIGNER_THUMBPRINT;else process.env.FND_SIGNER_THUMBPRINT=previous;});
  delete process.env.FND_SIGNER_THUMBPRINT;
  await assert.rejects(()=>writeReleaseManifest(root,true),/expected publisher certificate/);
  process.env.FND_SIGNER_THUMBPRINT='A'.repeat(40);
  await assert.rejects(()=>writeReleaseManifest(root,true),/valid timestamped publisher signature/);
  await assert.rejects(()=>writeReleaseManifest(root),/installer path, URL, size or SHA512/);
  await assert.rejects(()=>readFile(path.join(output,'release-manifest.json')),/ENOENT/);
});

test('updater manifest cannot redirect to another file or lie about signed artifact size',()=>{
  const setup={name:'Setup.exe',sha512:'verified-hash',size:100};
  const update={version:'1.0.0',path:setup.name,sha512:setup.sha512,files:[{url:setup.name,sha512:setup.sha512,size:setup.size}]};
  const text=value=>JSON.stringify(value);
  validateUpdateManifest(text(update),setup,'1.0.0');
  for(const field of ['url','sha512','size']){
    const changed=structuredClone(update);changed.files[0][field]=field==='size'?101:'replaced';
    assert.throws(()=>validateUpdateManifest(text(changed),setup,'1.0.0'),/does not match/);
  }
});

test('native image comparison accepts only signing fields and rejects changed executable bytes',()=>{
  const unsigned=Buffer.alloc(512);unsigned.write('MZ');unsigned.writeUInt32LE(0x80,0x3c);unsigned.write('PE\0\0',0x80);unsigned.writeUInt16LE(0x20b,0x98);unsigned[0x180]=42;
  const signed=Buffer.concat([unsigned,Buffer.alloc(16,7)]);signed.writeUInt32LE(123456,0xd8);signed.writeUInt32LE(512,0x128);signed.writeUInt32LE(16,0x12c);
  assert.equal(executableImageHash(signed),executableImageHash(unsigned));
  const changed=Buffer.from(signed);changed[0x180]=43;
  assert.notEqual(executableImageHash(changed),executableImageHash(unsigned));
  assert.throws(()=>executableImageHash(Buffer.concat([signed,Buffer.from('extra overlay')])),/unsupported layout/);
  assert.throws(()=>executableImageHash(Buffer.from('not a PE executable')),/Invalid native PE/);
});

test('clean Windows packaging embeds provenance before building and verifies it afterwards',async()=>{
  const [script,manifest,pkg]=await Promise.all([
    readFile(new URL('../../scripts/package-windows.mjs',import.meta.url),'utf8'),
    readFile(new URL('../../scripts/release-manifest.mjs',import.meta.url),'utf8'),
    readFile(new URL('../../package.json',import.meta.url),'utf8')
  ]);
  assert.ok(script.indexOf("'--prepare'")<script.indexOf("require.resolve('electron-builder/out/cli/cli.js')"));
  assert.match(manifest,/export async function prepareReleaseProvenance\(root\)/);
  assert.match(manifest,/asar\.extractFile\([\s\S]*?'build-provenance\.json'/);
  assert.ok(JSON.parse(pkg).build.files.some(item=>typeof item==='object'&&item.from==='dist'&&item.to==='.'&&item.filter.includes('build-provenance.json')));
});
