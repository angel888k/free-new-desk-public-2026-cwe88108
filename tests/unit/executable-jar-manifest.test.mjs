import test from 'node:test';
import assert from 'node:assert/strict';
import {jarClassPath} from '../../services/source-engine/dist/jar-inspector.js';

function zip(entries){let offset=0;const locals=[],central=[];for(const [name,text] of entries){const n=Buffer.from(name),data=Buffer.from(text),head=Buffer.alloc(30),record=Buffer.alloc(46);head.writeUInt32LE(0x04034b50);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);record.writeUInt32LE(0x02014b50);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(n.length,28);record.writeUInt32LE(offset,42);const local=Buffer.concat([head,n,data]);locals.push(local);central.push(record,n);offset+=local.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
const manifest=text=>zip([['META-INF/MANIFEST.MF',text]]);
test('JAR dependency approval follows folded main-section manifest attributes',()=>{
  assert.deepEqual(jarClassPath(manifest('Manifest-Version: 1.0\r\nClass-Path: lib/a.jar\r\n  lib/b.jar\r\n\r\nName: x\r\nClass-Path: untrusted.jar\r\n\r\n')),['lib/a.jar','lib/b.jar']);
  assert.throws(()=>jarClassPath(manifest('Manifest-Version: 1.0\nClass-Path: reviewed.jar\ncLaSs-PaTh: https://unreviewed.example/evil.jar\n\n')),/duplicate Class-Path/);
  assert.throws(()=>jarClassPath(zip([['META-INF/MANIFEST.MF','Class-Path: a.jar\n\n'],['meta-inf/manifest.mf','Class-Path: b.jar\n\n']])),/ambiguous/);
});
test('JAR approval ignores fake central signatures inside payload and rejects missing directory bounds',()=>{
  const bytes=zip([['payload.class',Buffer.alloc(60).fill(0x50)],['META-INF/MANIFEST.MF','Class-Path: reviewed.jar\n\n']]);assert.deepEqual(jarClassPath(bytes),['reviewed.jar']);
  assert.throws(()=>jarClassPath(bytes.subarray(0,bytes.length-22)),/central directory/);const invalid=Buffer.from(bytes);invalid.writeUInt32LE(0,invalid.length-6);assert.throws(()=>jarClassPath(invalid),/bounds/);
});
