import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJavaRuntimeVersion, probeJavaRuntime } from '../../services/source-engine/dist/java-runtime.js';

test('missing Java runtime produces stable SRC_JAVA_NOT_FOUND error',async()=>{
  await assert.rejects(()=>probeJavaRuntime('free-new-desk-java-that-does-not-exist',500),/SRC_JAVA_NOT_FOUND/);
});

test('Java security baseline rejects obsolete CPU patches across supported LTS runtimes',()=>{
  for (const version of ['17.0.19', '17.0.20', '21.0.11', '21.0.12', '25.0.3', '25.0.4']) {
    assert.throws(()=>parseJavaRuntimeVersion(`openjdk version "${version}" 2026-07-21\nOpenJDK Runtime Environment`), /SRC_JAVA_NOT_FOUND.*安全基线/);
  }
});

test('Java security baseline accepts the current CPU and subsequent LTS patches',()=>{
  for (const version of ['17.0.20.1', '17.0.21', '21.0.12.1', '21.0.13', '25.0.4.1', '25.0.5', '17.0.20.1+1-LTS']) {
    assert.deepEqual(parseJavaRuntimeVersion(`java version "${version}" 2026-08-18 LTS\nJava Runtime Environment`), {major:Number(version.split('.')[0]),version});
  }
});

test('Java security baseline rejects unknown, non-LTS and prerelease runtimes',()=>{
  for (const version of ['1.8.0_512', '11.0.32.1', '18.0.2', '20.0.2', '24.0.2', '26-ea', '17.0.21-ea', '17.0.20.1-internal']) {
    assert.throws(()=>parseJavaRuntimeVersion(`openjdk version "${version}"`), /SRC_JAVA_NOT_FOUND/);
  }
  assert.throws(()=>parseJavaRuntimeVersion('not a Java version'),/无法识别/);
});
