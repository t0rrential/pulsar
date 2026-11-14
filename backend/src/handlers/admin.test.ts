import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

process.env.TABLE_NAME = 'admin-test';
// The database module reads TABLE_NAME during module initialization.
const { handler } = await import('./admin.js');

function request(method: string, path: string, key?: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    headers: key === undefined ? {} : { 'x-admin-key': key },
    requestContext: { http: { method } },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as APIGatewayProxyEventV2;
}

test('admin access fails closed when the configured key is missing', async () => {
  delete process.env.ADMIN_KEY;
  assert.equal((await handler(request('GET', '/campaigns', 'anything'))).statusCode, 401);
});

test('admin access rejects absent and incorrect keys', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await handler(request('GET', '/campaigns'))).statusCode, 401);
  assert.equal((await handler(request('GET', '/campaigns', 'wrong'))).statusCode, 401);
});

test('admin rejects invalid campaign data and unsafe upload types', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await handler(request('POST', '/campaigns', 'secret', {
    name: 'Bad', status: 'active', placements: ['sidebar'], weight: 0,
  }))).statusCode, 400);
  assert.equal((await handler(request('POST', '/uploads', 'secret', {
    contentType: 'image/svg+xml',
  }))).statusCode, 400);
});
