import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeSourceProxyResult} from '../../services/source-engine/dist/source-proxy-result.js';

test('proxy credentials are attached only in the trusted parent to the exact proxy endpoint',()=>{
  const context={sourceId:'source',proxyBaseUrl:'http://127.0.0.1:12345',proxyToken:'private-proxy-token'};
  const allowed={url:'http://127.0.0.1:12345/proxy?u=https%3A%2F%2Ffixture.test',headers:{Referer:'https://fixture.test'}};
  const result=authorizeSourceProxyResult(allowed,context);assert.deepEqual(result.headers,{Referer:'https://fixture.test',Authorization:'Bearer private-proxy-token'});
  assert.equal(allowed.headers.Authorization,undefined,'the worker-originated object must never receive the credential');
  for(const url of ['http://127.0.0.1:123456/proxy','http://127.0.0.1:12345.evil.test/proxy','http://127.0.0.1:12345@evil.test/proxy','http://127.0.0.1:12345/proxy-other','https://127.0.0.1:12345/proxy','https://fixture.test/proxy']){
    const input={url};assert.equal(authorizeSourceProxyResult(input,context),input);
  }
});
