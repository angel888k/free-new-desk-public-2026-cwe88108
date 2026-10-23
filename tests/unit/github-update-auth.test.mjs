import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

test('public distribution exposes no update authorization UI or IPC and excludes legacy credentials',async()=>{
  const read=file=>readFile(new URL('../../'+file,import.meta.url),'utf8');
  const code=await read('apps/desktop/src/main/github-update-auth.ts'),module={exports:{}};
  vm.runInNewContext('(function(module,exports){'+ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+'})',{})(module,module.exports);
  const settings=module.exports.publicUpdateSettings({listSettings:()=>({'update.credential.github':'SYNTHETIC_LEGACY_SECRET',theme:'light'})});
  assert.equal(settings.theme,'light');assert.equal(settings['update.credential.github'],undefined);
  for(const file of ['apps/desktop/src/main/index.ts','apps/desktop/src/preload/index.cts','apps/desktop/src/renderer/views/SettingsView.vue']){
    const value=await read(file);assert.doesNotMatch(value,/update:(?:authorize|authorization|forgetAuthorization|openAuthorization)|githubToken|readGitHubUpdateToken/);
  }
});
