import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServiceCredential, AuthenticationError } from '../src/runtime.js';
import { bearerToken, matchesMcpToken, assertMcpRequest } from '../mcp/server.mjs';

test('MCP bearer authentication is stable and separate from Supabase credentials',()=>{
  assert.equal(bearerToken('Bearer porter-secret'),'porter-secret');
  assert.equal(matchesMcpToken('porter-secret','porter-secret'),true);
  assert.equal(matchesMcpToken('wrong','porter-secret'),false);
  assert.throws(()=>bearerToken('Basic nope'),AuthenticationError);
});

test('MCP request accepts only loopback, non-browser traffic with the configured token',()=>{
  assert.doesNotThrow(()=>assertMcpRequest({headers:{host:'127.0.0.1:8791',authorization:'Bearer porter-secret'}},'porter-secret'));
  assert.doesNotThrow(()=>assertMcpRequest({headers:{host:'localhost:8791',authorization:'Bearer porter-secret'}},'porter-secret'));
  assert.throws(()=>assertMcpRequest({headers:{host:'example.com',authorization:'Bearer porter-secret'}},'porter-secret'),AuthenticationError);
  assert.throws(()=>assertMcpRequest({headers:{host:'127.0.0.1:8791',origin:'https://example.com',authorization:'Bearer porter-secret'}},'porter-secret'),AuthenticationError);
  assert.throws(()=>assertMcpRequest({headers:{host:'127.0.0.1:8791',authorization:'Bearer wrong'}},'porter-secret'),AuthenticationError);
});

test('MCP runtime rejects publishable credentials as server identity',()=>{
  assert.equal(assertServiceCredential('sb_secret_example'),'sb_secret_example');
  const payload=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  const legacy=`x.${payload}.y`;
  assert.equal(assertServiceCredential(legacy),legacy);
  assert.throws(()=>assertServiceCredential('sb_publishable_example'),AuthenticationError);
});
