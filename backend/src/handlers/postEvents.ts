import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { isIdentifier, json } from '../lib/http.js';
import type { AdEvent } from '../lib/types.js';

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
        !isIdentifier(item.placement) || (item.type !== 'impression' && item.type !== 'click') ||
        typeof item.ts !== 'number' || !Number.isInteger(item.ts) ||
        item.ts < 0 || item.ts > 253_402_300_799_999) {
      return json(400, { error: 'Invalid event: identifiers, impression/click type, and a valid UTC millisecond timestamp are required' });
    }
    events.push(item as AdEvent);
  }

  // Validate the whole batch before writing. Phase 1 intentionally does not deduplicate.
  for (const item of events) {
    const date = new Date(item.ts).toISOString().slice(0, 10);
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `CAMPAIGN#${item.campaignId}`, SK: `STATS#${date}` },
      UpdateExpression: 'ADD #counter :one',
      ExpressionAttributeNames: { '#counter': item.type === 'impression' ? 'impressions' : 'clicks' },
      ExpressionAttributeValues: { ':one': 1 },
    }));
  }
  return json(202, { accepted: events.length });
}
