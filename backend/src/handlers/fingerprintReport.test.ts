import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

process.env.TABLE_NAME = 'fingerprint-report-test';
process.env.ADMIN_KEY = 'secret';
// The modules capture TABLE_NAME at load time, so initialize the environment first.
const { db } = await import('../lib/db.js');
const { handler } = await import('./admin.js');

function request(key = 'secret', days = '7'): APIGatewayProxyEventV2 {
  return {
    rawPath: '/campaigns/c1/fingerprints',
    headers: { 'x-admin-key': key },
    queryStringParameters: { days },
    requestContext: { http: { method: 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

test('fingerprint reporting requires admin authentication and a valid reporting period', async () => {
  assert.equal((await handler(request('wrong'))).statusCode, 401);
  assert.equal((await handler(request('secret', '31'))).statusCode, 400);
});

test('reports retained campaign fingerprints by day without counting expired or future records', async () => {
  const originalSend = db.send;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-11-15T12:00:00Z');
  const expiresAt = Math.floor(Date.now() / 1000) + 100;
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  let page = 0;
  db.send = (async (command: ScanCommand) => {
    assert.ok(command instanceof ScanCommand);
    if (page++ === 0) return { Items: [
      { PK: `FINGERPRINT#${first}`, campaignId: 'c1', ts: Date.parse('2026-11-06T12:00:00Z'), expiresAt, browser: 'Chrome', device: 'Desktop' },
      { PK: `FINGERPRINT#${first}`, campaignId: 'c1', ts: Date.parse('2026-11-14T12:00:00Z'), expiresAt, browser: 'Chrome', device: 'Desktop' },
      { PK: `FINGERPRINT#${second}`, campaignId: 'c1', ts: Date.parse('2026-11-15T09:00:00Z'), expiresAt, browser: 'Safari', device: 'Mobile' },
    ], ScannedCount: 3, LastEvaluatedKey: { PK: 'page', SK: 'page' } };
    return { Items: [
      { PK: `FINGERPRINT#${'c'.repeat(64)}`, campaignId: 'c1', ts: Date.parse('2026-11-15T10:00:00Z'), expiresAt: expiresAt - 200 },
      { PK: `FINGERPRINT#${'d'.repeat(64)}`, campaignId: 'c1', ts: Date.parse('2026-11-16T10:00:00Z'), expiresAt },
      { PK: `FINGERPRINT#${'e'.repeat(64)}`, campaignId: 'c2', ts: Date.parse('2026-11-15T10:00:00Z'), expiresAt },
    ], ScannedCount: 3 };
  }) as typeof db.send;
  try {
    const result = await handler(request());
    assert.equal(result.statusCode, 200);
    const report = JSON.parse(result.body!);
    assert.deepEqual(report.totals, { fingerprints: 2, newFingerprints: 1, returningFingerprints: 1, events: 2 });
    assert.deepEqual(report.daily.filter((day: { events: number }) => day.events).map((day: { date: string; fingerprints: number; events: number }) => [day.date, day.fingerprints, day.events]), [
      ['2026-11-14', 1, 1], ['2026-11-15', 1, 1],
    ]);
    assert.deepEqual(report.fingerprints.map((row: { fingerprint: string; browser: string; device: string }) => [row.fingerprint, row.browser, row.device]), [[second, 'Safari', 'Mobile'], [first, 'Chrome', 'Desktop']]);
  } finally {
    Date.now = originalNow;
    db.send = originalSend;
  }
});

test('does not present an incomplete scan as a complete fingerprint report', async () => {
  const originalSend = db.send;
  db.send = (async () => ({ Items: [], ScannedCount: 500, LastEvaluatedKey: { PK: 'more', SK: 'more' } })) as typeof db.send;
  try {
    assert.equal((await handler(request())).statusCode, 503);
  } finally { db.send = originalSend; }
});
