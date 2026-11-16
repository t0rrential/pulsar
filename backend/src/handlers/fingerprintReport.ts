import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { json } from '../lib/http.js';

const dayMs = 86_400_000;
const scanPageSize = 500;
const scanLimit = 10_000;

/** Called only after the admin handler has authenticated the request. */
export async function fingerprintReport(campaignId: string, requestedDays: string | undefined): Promise<APIGatewayProxyStructuredResultV2> {
  if (requestedDays !== undefined && (!/^[0-9]+$/.test(requestedDays) || Number(requestedDays) < 1 || Number(requestedDays) > 30)) {
    return json(400, { error: 'days must be an integer between 1 and 30' });
  }
  const days = requestedDays === undefined ? 7 : Number(requestedDays);
  const now = Date.now();
  const today = Math.floor(now / dayMs) * dayMs;
  const windowStart = today - (days - 1) * dayMs;
  const historyStart = today - 29 * dayMs;
  type Row = { fingerprint: string; firstSeen: number; lastSeen: number; events: number; browser: string; device: string };
  const people = new Map<string, Row>();
  const daily = Array.from({ length: days }, (_, index) => ({
    date: new Date(windowStart + index * dayMs).toISOString().slice(0, 10),
    events: 0,
    fingerprints: new Set<string>(),
  }));
  let cursor: Record<string, unknown> | undefined;
  let scanned = 0;
  do {
    const page = await db.send(new ScanCommand({
      TableName: tableName,
      Limit: Math.min(scanPageSize, scanLimit - scanned),
      ExclusiveStartKey: cursor,
      FilterExpression: 'begins_with(PK, :prefix) AND campaignId = :campaign AND #ts >= :start AND expiresAt > :now',
      ExpressionAttributeNames: { '#ts': 'ts' },
      ExpressionAttributeValues: { ':prefix': 'FINGERPRINT#', ':campaign': campaignId, ':start': historyStart, ':now': Math.floor(now / 1000) },
      ProjectionExpression: 'PK, campaignId, #ts, expiresAt, browser, device',
    }));
    scanned += page.ScannedCount ?? 0;
    cursor = page.LastEvaluatedKey;
    for (const item of page.Items ?? []) {
      if (item.campaignId !== campaignId || typeof item.PK !== 'string' || !/^FINGERPRINT#[0-9a-f]{64}$/.test(item.PK) ||
          typeof item.ts !== 'number' || item.ts < historyStart || item.ts > now ||
          typeof item.expiresAt !== 'number' || item.expiresAt <= Math.floor(now / 1000)) continue;
      const fingerprint = item.PK.slice('FINGERPRINT#'.length);
      let row = people.get(fingerprint);
      if (!row) {
        row = { fingerprint, firstSeen: item.ts, lastSeen: 0, events: 0, browser: 'Unknown', device: 'Unknown' };
        people.set(fingerprint, row);
      }
      row.firstSeen = Math.min(row.firstSeen, item.ts);
      if (item.ts >= windowStart) {
        row.events++;
        const day = daily[Math.floor((item.ts - windowStart) / dayMs)];
        if (day) { day.events++; day.fingerprints.add(fingerprint); }
        if (item.ts >= row.lastSeen) {
          row.lastSeen = item.ts;
          row.browser = typeof item.browser === 'string' ? item.browser : 'Unknown';
          row.device = typeof item.device === 'string' ? item.device : 'Unknown';
        }
      }
    }
    if (cursor && scanned >= scanLimit) return json(503, { error: 'Fingerprint report is too large to calculate safely; no partial results returned.' });
  } while (cursor);

  const rows = [...people.values()].filter((row) => row.events > 0).sort((a, b) => b.lastSeen - a.lastSeen || a.fingerprint.localeCompare(b.fingerprint));
  const returning = rows.filter((row) => row.firstSeen < windowStart).length;
  return json(200, {
    campaignId, days,
    totals: { fingerprints: rows.length, newFingerprints: rows.length - returning, returningFingerprints: returning, events: rows.reduce((sum, row) => sum + row.events, 0) },
    daily: daily.map((day) => ({ date: day.date, events: day.events, fingerprints: day.fingerprints.size })),
    fingerprints: rows.slice(0, 200),
    fingerprintsTruncated: rows.length > 200,
  });
}
