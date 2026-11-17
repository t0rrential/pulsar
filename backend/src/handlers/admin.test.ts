import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { authenticatedGet } from './authTestUtils.js';

process.env.TABLE_NAME = 'admin-test';
// The database module reads TABLE_NAME during module initialization.
const { handler } = await import('./admin.js');
const { db } = await import('../lib/db.js');
db.send = (async (command: unknown) => authenticatedGet(command)) as typeof db.send;

function request(method: string, path: string, key?: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
    requestContext: { http: { method } },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as APIGatewayProxyEventV2;
}

test('admin access rejects a shared key even when configured', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await handler({ ...request('GET', '/campaigns'), headers: { 'x-admin-key': 'secret' } })).statusCode, 401);
});

test('admin access rejects absent and incorrect tokens', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await handler(request('GET', '/campaigns'))).statusCode, 401);
  assert.equal((await handler(request('GET', '/campaigns', 'wrong'))).statusCode, 401);
});

test('admin rejects invalid campaign data and unsafe upload types', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await handler(request('POST', '/campaigns', 'test-session', {
    name: 'Bad', status: 'active', placements: ['sidebar'], weight: 0,
  }))).statusCode, 400);
  assert.equal((await handler(request('POST', '/uploads', 'test-session', {
    contentType: 'image/svg+xml',
  }))).statusCode, 400);
});
