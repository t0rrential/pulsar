import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db } from '../lib/db.js';
import { handler as postEvents } from './postEvents.js';
import { handler as getStats } from './getStats.js';

const sample = { eventId: 'event-1', type: 'viewable', impressionId: 'imp-1', campaignId: 'campaign-1', creativeId: 'creative-1', placement: 'sidebar', ts: 1760678400000 };
const request = (events: unknown[]) => ({ body: JSON.stringify({ events }) }) as APIGatewayProxyEventV2;

test('rejects invalid events before writing any part of the batch', async () => {
  const original = db.send;
  let writes = 0;
  db.send = (async () => { writes++; return {}; }) as typeof db.send;
  try {
    const result = await postEvents(request([sample, { ...sample, type: 'unknown' }]));
    assert.equal(result.statusCode, 400);
    assert.equal(writes, 0);
  } finally { db.send = original; }
});

test('rejects oversized batches and missing identifiers', async () => {
  assert.equal((await postEvents(request(Array.from({ length: 101 }, () => sample)))).statusCode, 400);
  assert.equal((await postEvents(request([{ ...sample, eventId: '' }]))).statusCode, 400);
});

test('conversion events increment the conversions counter', async () => {
  const original = db.send;
  db.send = (async (command: TransactWriteCommand) => {
    assert.ok(command instanceof TransactWriteCommand);
    assert.equal(command.input.TransactItems![1]?.Update?.ExpressionAttributeNames?.['#counter'], 'conversions');
    return {};
  }) as typeof db.send;
  try {
    assert.equal((await postEvents(request([{ ...sample, type: 'conversion' }]))).statusCode, 202);
  } finally { db.send = original; }
});

test('deduplicates an event and increments its viewable counter in one transaction', async () => {
  const original = db.send;
  let stored: Record<string, unknown> | undefined;
  let counter = 0;
  db.send = (async (command: TransactWriteCommand | GetCommand) => {
    if (command instanceof TransactWriteCommand) {
      if (stored) throw Object.assign(new Error('duplicate'), { name: 'TransactionCanceledException' });
      const operations = command.input.TransactItems!;
      assert.equal(operations[0]?.Put?.ConditionExpression, 'attribute_not_exists(PK)');
      assert.equal(operations[1]?.Update?.ExpressionAttributeNames?.['#counter'], 'viewable');
      stored = operations[0]?.Put?.Item;
      counter++;
      return {};
    }
    if (command instanceof GetCommand) return { Item: stored };
    throw new Error('unexpected command');
  }) as typeof db.send;
  try {
    assert.equal((await postEvents(request([sample, sample]))).statusCode, 202);
    assert.equal(counter, 1);
  } finally { db.send = original; }
});

test('stats return viewable and conversion counts and default missing counters to zero', async () => {
  const original = db.send;
  db.send = (async (command: QueryCommand) => {
    assert.ok(command instanceof QueryCommand);
    const date = new Date().toISOString().slice(0, 10);
    return { Items: [{ SK: `STATS#${date}`, viewable: 3, conversions: 2 }] };
  }) as typeof db.send;
  try {
    const result = await getStats({ queryStringParameters: { campaignId: 'campaign-1', days: '1' } } as unknown as APIGatewayProxyEventV2);
    assert.deepEqual(JSON.parse(result.body!).days[0], { date: new Date().toISOString().slice(0, 10), requests: 0, impressions: 0, clicks: 0, viewable: 3, conversions: 2 });
  } finally { db.send = original; }
});

test('retries pending Firehose delivery without incrementing the counter again', async () => {
  const originalDb = db.send;
  const originalFirehose = FirehoseClient.prototype.send;
  const originalStream = process.env.FIREHOSE_STREAM_NAME;
  process.env.FIREHOSE_STREAM_NAME = 'events';
  let stored: Record<string, unknown> | undefined;
  let count = 0;
  let attempts = 0;
  db.send = (async (command: TransactWriteCommand | GetCommand | UpdateCommand) => {
    if (command instanceof TransactWriteCommand) {
      if (stored) throw Object.assign(new Error('duplicate'), { name: 'TransactionCanceledException' });
      stored = { ...command.input.TransactItems![0]!.Put!.Item };
      count++;
      return {};
    }
    if (command instanceof GetCommand) return { Item: stored };
    if (command instanceof UpdateCommand) {
      delete stored!.firehosePending;
      delete stored!.event;
      return {};
    }
    throw new Error('unexpected command');
  }) as typeof db.send;
  FirehoseClient.prototype.send = (async (command: PutRecordBatchCommand) => {
    assert.ok(command instanceof PutRecordBatchCommand);
    assert.deepEqual(JSON.parse(Buffer.from(command.input.Records![0]!.Data!).toString()), sample);
    attempts++;
    return attempts === 1
      ? { FailedPutCount: 1, RequestResponses: [{ ErrorCode: 'ServiceUnavailableException' }] }
      : { FailedPutCount: 0, RequestResponses: [{ RecordId: 'record-1' }] };
  }) as typeof FirehoseClient.prototype.send;
  try {
    assert.equal((await postEvents(request([sample]))).statusCode, 503);
    assert.equal((await postEvents(request([sample]))).statusCode, 202);
    assert.equal(count, 1);
    assert.equal(attempts, 2);
  } finally {
    db.send = originalDb;
    FirehoseClient.prototype.send = originalFirehose;
    if (originalStream === undefined) delete process.env.FIREHOSE_STREAM_NAME;
    else process.env.FIREHOSE_STREAM_NAME = originalStream;
  }
});
