import test from 'node:test';
import assert from 'node:assert/strict';
import {redactDiagnosticArtifact,redactDiagnosticText} from '../../apps/desktop/dist/main/diagnostic-redaction.js';

test('diagnostic ZIP payload redacts nested secrets, URLs, local files, UNC paths, and headers',()=>{
  const secret='FND_SECRET_CANARY_DO_NOT_EXPORT';
  const payload={
    player:{path:'C:\\Users\\'+secret+'\\movie.mkv',duration:120,position:20},
    live:{epg:'https://epg.test/program.xml?token='+secret,headers:{Authorization:'Bearer '+secret}},
    music:{root:'\\\\server\\'+secret+'\\audio',credentialRef:secret},
    nested:[{details:'https://cdn.test/movie.m3u8?signature='+secret},{description:'password='+secret}],
  };
  const sanitized=JSON.stringify(redactDiagnosticArtifact(payload));
  assert.ok(!sanitized.includes(secret),sanitized);
  assert.match(sanitized,/REDACTED/);
  assert.match(sanitized,/"duration":120/);
  const log=JSON.stringify({message:'status',path:'C:\\Users\\'+secret+'\\file.mp4',endpoint:'https://nas.test/?key='+secret});
  const cleaned=JSON.stringify(redactDiagnosticArtifact(JSON.parse(log)));
  assert.ok(!cleaned.includes(secret));
  assert.ok(!redactDiagnosticText('Authorization: '+secret+';').includes(secret));
});
test('diagnostic export uses sanitization for all JSON reports and log lines',async()=>{
  const fs=await import('node:fs/promises');
  const main=await fs.readFile(new URL('../../apps/desktop/src/main/index.ts',import.meta.url),'utf8');
  const start=main.indexOf('async function exportDiagnostics('),end=main.indexOf('\nfunction newer(',start);
  const section=main.slice(start,end);
  assert.equal((section.match(/JSON\.stringify\(/g)||[]).length,(section.match(/JSON\.stringify\(redactDiagnosticArtifact\(/g)||[]).length);
  assert.match(section,/redactDiagnosticText\(line\)/);
});
