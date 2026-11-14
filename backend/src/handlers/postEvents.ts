import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { isIdentifier, json } from '../lib/http.js';
import type { AdEvent } from '../lib/types.js';

const firehose = new FirehoseClient({});
const counters: Record<AdEvent['type'], string> = {
  impression: 'impressions',
  click: 'clicks',
  viewable: 'viewable',
  conversion: 'conversions',
};
const eventKey = (eventId: string) => ({ PK: `EVENT#${eventId}`, SK: 'EVENT' });

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  if (!event.body || event.body.length > 90_000) {
    return json(400, { error: 'A JSON body of at most 64 KiB is required' });
  }
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  if (Buffer.byteLength(body, 'utf8') > 65_536) {
    return json(413, { error: 'Body exceeds 64 KiB' });
  }

  let parsed: unknown;
  try {
    // Deliberately independent of Content-Type: sendBeacon sends text/plain.
    parsed = JSON.parse(body);
  } catch {
    return json(400, { error: 'Body must contain valid JSON' });
  }
  if (typeof parsed !== 'object' || parsed === null || !('events' in parsed) ||
      !Array.isArray(parsed.events) || parsed.events.length === 0 || parsed.events.length > 100) {
    return json(400, { error: 'events must be an array containing 1–100 events' });
  }

  const events: AdEvent[] = [];
  for (const value of parsed.events) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return json(400, { error: 'Each event must be an object' });
    }
    const item = value as Partial<AdEvent>;
    if (!isIdentifier(item.eventId) || !isIdentifier(item.impressionId) ||
        !isIdentifier(item.campaignId) || !isIdentifier(item.creativeId) ||
        !isIdentifier(item.placement) || !['impression', 'click', 'viewable', 'conversion'].includes(item.type ?? '') ||
        typeof item.ts !== 'number' || !Number.isInteger(item.ts) ||
        item.ts < 0 || item.ts > 253_402_300_799_999) {
      return json(400, { error: 'Invalid event: identifiers, known type, and a valid UTC millisecond timestamp are required' });
    }
    events.push({
      eventId: item.eventId, impressionId: item.impressionId, campaignId: item.campaignId,
      creativeId: item.creativeId, placement: item.placement, type: item.type!, ts: item.ts,
    });
  }

  const stream = process.env.FIREHOSE_STREAM_NAME;
  const pending = new Map<string, AdEvent>();
  for (const item of events) {
    const key = eventKey(item.eventId);
    const date = new Date(item.ts).toISOString().slice(0, 10);
    try {
      await db.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: { ...key, expiresAt: Math.floor(Date.now() / 1000) + 172_800, ...(stream ? { firehosePending: true, event: item } : {}) },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: `CAMPAIGN#${item.campaignId}`, SK: `STATS#${date}` },
              UpdateExpression: 'ADD #counter :one',
              ExpressionAttributeNames: { '#counter': counters[item.type] },
              ExpressionAttributeValues: { ':one': 1 },
            },
          },
        ],
      }));
      if (stream) pending.set(item.eventId, item);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') throw error;
      const existing = await db.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      if (!existing.Item) throw error;
      if (stream && existing.Item.firehosePending && existing.Item.event) {
        pending.set(item.eventId, existing.Item.event as AdEvent);
      }
    }
  }

  if (stream && pending.size) {
    const batch = [...pending.values()];
    let result;
    try {
      result = await firehose.send(new PutRecordBatchCommand({
        DeliveryStreamName: stream,
        Records: batch.map(item => ({ Data: Buffer.from(`${JSON.stringify(item)}\n`) })),
      }));
    } catch (error) {
      console.error('Firehose delivery failed', error);
      return json(503, { error: 'Firehose delivery failed; retry these events', failedEventIds: batch.map(item => item.eventId) });
    }
    const failedEventIds: string[] = [];
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index]!;
      const record = result.RequestResponses?.[index];
      if (!record || record.ErrorCode || !record.RecordId) {
        failedEventIds.push(item.eventId);
        continue;
      }
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: eventKey(item.eventId),
        UpdateExpression: 'REMOVE firehosePending, #event',
        ExpressionAttributeNames: { '#event': 'event' },
        ConditionExpression: 'attribute_exists(PK)',
      }));
    }
    if (failedEventIds.length) return json(503, { error: 'Firehose delivery failed; retry these events', failedEventIds });
  }
  return json(202, { accepted: events.length });
}
