import * as asar from '@electron/asar';
import {copyFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base=path.resolve('../审核报告/来源模块验收-2026-10-21');
const installed='D:/Program Files/freedesk/Free New Desk/resources/app.asar';
const backup=path.join(base,'original-app.asar');
await mkdir(base,{recursive:true});
await copyFile(installed,backup,1).catch(error=>{if(error.code!=='EEXIST')throw error;}); // Never replace the rollback copy.
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
for(const entry of ['apps/desktop/dist/main/index.js','apps/desktop/dist/main/player-client.js','apps/desktop/dist/main/playback-session-ipc.js','apps/desktop/dist/preload/index.cjs','packages/contracts/dist/index.js']){
  if(hash(await readFile(entry))!==hash(asar.extractFile(backup,entry.replaceAll('/','\\'))))throw new Error('Backend/preload/contracts changed; build a complete candidate instead of a renderer-only patch: '+entry);
}
for(const entry of asar.listPackage(backup)){
  if(asar.statFile(backup,entry.slice(1)).files||entry.replaceAll('\\','/').startsWith('/apps/desktop/dist/renderer/'))continue;
  if(hash(asar.extractFile(installed,entry.slice(1)))!==hash(asar.extractFile(backup,entry.slice(1))))throw new Error('Installed backend changed since backup: '+entry);
}
const extracted=path.join(base,'candidate-input');asar.extractAll(backup,extracted);
await cp(path.resolve('apps/desktop/dist/renderer'),path.join(extracted,'apps/desktop/dist/renderer'),{recursive:true});
const candidate=path.join(base,'source-fix-app.asar');await asar.createPackage(extracted,candidate);
const files=asar.listPackage(backup),changed=[];
for(const entry of files){
  if(asar.statFile(backup,entry.slice(1)).files)continue;
  const before=hash(asar.extractFile(backup,entry.slice(1))),after=hash(asar.extractFile(candidate,entry.slice(1)));
  if(before!==after){if(!entry.replaceAll('\\','/').startsWith('/apps/desktop/dist/renderer/'))throw new Error('Unexpected non-renderer change: '+entry);changed.push(entry);}
}
const evidence={candidate,backup,originalEntries:files.length,changedExistingFiles:changed,unchangedOutsideRenderer:true};
await writeFile(path.join(base,'candidate-package-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
