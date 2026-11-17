import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';
import { FirehoseClient } from '@aws-sdk/client-firehose';
import { S3Client } from '@aws-sdk/client-s3';
import { authenticatedGet } from './authTestUtils.js';

process.env.TABLE_NAME = 'analytics-test';
// The database module reads its table name at import time.
const { db } = await import('../lib/db.js');
const { handler } = await import('./analyticsPipeline.js');
db.send = (async (command: unknown) => authenticatedGet(command)) as typeof db.send;

function request(method: string, path: string, body?: unknown, key = 'test-session'): APIGatewayProxyEventV2 {
  return { rawPath: path, headers: { authorization: `Bearer ${key}` }, requestContext: { http: { method } }, body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2;
}
function configure() {
  Object.assign(process.env, { ADMIN_KEY: 'secret', FIREHOSE_STREAM_NAME: 'stream', RAW_EVENTS_BUCKET: 'bucket', ATHENA_WORKGROUP: 'group', ATHENA_DATABASE: 'database' });
}

test('rejects unauthorized requests and reports missing configuration', async () => {
  configure();
  assert.equal((await handler(request('GET', '/analytics/pipeline', undefined, 'bad'))).statusCode, 401);
  delete process.env.ATHENA_DATABASE;
  assert.equal((await handler(request('GET', '/analytics/pipeline'))).statusCode, 503);
});

test('validates template and inclusive UTC partition range before starting Athena', async () => {
  configure();
  const send = mock.method(AthenaClient.prototype, 'send', (async (command: unknown) => {
    assert.ok(command instanceof StartQueryExecutionCommand);
    assert.match(command.input.QueryString ?? '', /dt BETWEEN '2024-02-01' AND '2024-03-02'/);
    assert.equal(command.input.WorkGroup, 'group');
    assert.equal(command.input.QueryExecutionContext?.Database, 'database');
    return { QueryExecutionId: 'query-id' };
  }) as unknown as typeof AthenaClient.prototype.send);
  try {
    for (const body of [
      { templateId: 'arbitrary', startDate: '2024-02-01', endDate: '2024-02-02' },
      { templateId: 'daily-events', startDate: '2024-02-30', endDate: '2024-03-02' },
      { templateId: 'daily-events', startDate: '2024-02-01', endDate: '2024-03-03' },
      { templateId: 'daily-events', startDate: '2024-03-02', endDate: '2024-02-01' },
    ]) assert.equal((await handler(request('POST', '/analytics/queries', body))).statusCode, 400);
    const result = await handler(request('POST', '/analytics/queries', { templateId: 'daily-events', startDate: '2024-02-01', endDate: '2024-03-02' }));
    assert.equal(result.statusCode, 202);
    assert.equal(JSON.parse(result.body!).id, 'query-id');
    assert.equal(send.mock.callCount(), 1);
  } finally { send.mock.restore(); }
});

test('does not retrieve results from another workgroup', async () => {
  configure();
  const send = mock.method(AthenaClient.prototype, 'send', (async (command: unknown) => {
    assert.ok(command instanceof GetQueryExecutionCommand);
    return { QueryExecution: { WorkGroup: 'other', Status: { State: 'SUCCEEDED' } } };
  }) as unknown as typeof AthenaClient.prototype.send);
  try {
    assert.equal((await handler(request('GET', '/analytics/queries/abc'))).statusCode, 404);
    assert.equal(send.mock.callCount(), 1);
  } finally { send.mock.restore(); }
});

test('returns bounded result rows and scanned bytes for successful queries', async () => {
  configure();
  const send = mock.method(AthenaClient.prototype, 'send', (async (command: unknown) => {
    if (command instanceof GetQueryExecutionCommand) return { QueryExecution: { WorkGroup: 'group', Status: { State: 'SUCCEEDED' }, Statistics: { DataScannedInBytes: 123 } } };
    assert.ok(command instanceof GetQueryResultsCommand);
    assert.equal(command.input.MaxResults, 101);
    return { ResultSet: { ResultSetMetadata: { ColumnInfo: [{ Name: 'dt' }, { Name: 'events' }] }, Rows: [{ Data: [{ VarCharValue: 'dt' }, { VarCharValue: 'events' }] }, { Data: [{ VarCharValue: '2024-02-01' }, { VarCharValue: '5' }] }] }, NextToken: 'more' };
  }) as unknown as typeof AthenaClient.prototype.send);
  try {
    const result = await handler(request('GET', '/analytics/queries/abc'));
    assert.deepEqual(JSON.parse(result.body!), { id: 'abc', state: 'SUCCEEDED', scannedBytes: 123, columns: ['dt', 'events'], rows: [['2024-02-01', '5']], truncated: true });
  } finally { send.mock.restore(); }
});

test('returns failure state without requesting results', async () => {
  configure();
  const send = mock.method(AthenaClient.prototype, 'send', (async (command: unknown) => {
    assert.ok(command instanceof GetQueryExecutionCommand);
    return { QueryExecution: { WorkGroup: 'group', Status: { State: 'FAILED', StateChangeReason: 'Query failed' }, Statistics: { DataScannedInBytes: 42 } } };
  }) as unknown as typeof AthenaClient.prototype.send);
  try {
    const result = await handler(request('GET', '/analytics/queries/abc'));
    assert.deepEqual(JSON.parse(result.body!), { id: 'abc', state: 'FAILED', scannedBytes: 42, reason: 'Query failed' });
    assert.equal(send.mock.callCount(), 1);
  } finally { send.mock.restore(); }
});

test('reports AWS failures without leaking service details', async () => {
  configure();
  const firehose = mock.method(FirehoseClient.prototype, 'send', (async () => { throw new Error('private detail'); }) as unknown as typeof FirehoseClient.prototype.send);
  const s3 = mock.method(S3Client.prototype, 'send', (async () => ({ Contents: [] })) as unknown as typeof S3Client.prototype.send);
  try {
    const result = await handler(request('GET', '/analytics/pipeline'));
    assert.equal(result.statusCode, 502);
    assert.doesNotMatch(result.body!, /private detail/);
  } finally { firehose.mock.restore(); s3.mock.restore(); }
});

test('bounds S3 listing and marks the displayed objects as an incomplete sample', async () => {
  configure();
  let calls = 0;
  const firehose = mock.method(FirehoseClient.prototype, 'send', (async () => ({ DeliveryStreamDescription: { DeliveryStreamStatus: 'ACTIVE' } })) as unknown as typeof FirehoseClient.prototype.send);
  const s3 = mock.method(S3Client.prototype, 'send', (async () => {
    calls++;
    if (calls > 4) throw new Error('listing exceeded its limit');
    return { Contents: [{ Key: `events/${calls}`, LastModified: new Date('2026-11-15T00:00:00Z'), Size: 10 }], IsTruncated: true, NextContinuationToken: 'next' };
  }) as unknown as typeof S3Client.prototype.send);
  try {
    const result = await handler(request('GET', '/analytics/pipeline'));
    assert.equal(result.statusCode, 200);
    const data = JSON.parse(result.body!);
    assert.equal(data.objectsIncomplete, true);
    assert.equal(data.objects.length, 4);
  } finally { firehose.mock.restore(); s3.mock.restore(); }
});
