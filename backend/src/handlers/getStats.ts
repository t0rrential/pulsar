import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { isIdentifier, json } from '../lib/http.js';
import type { DailyStats, StatsResponse } from '../lib/types.js';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const campaignId = event.queryStringParameters?.campaignId;
  const rawDays = event.queryStringParameters?.days ?? '7';
  if (!isIdentifier(campaignId)) return json(400, { error: 'campaignId must be a 1–128 character identifier' });
  if (!/^\d{1,3}$/.test(rawDays) || Number(rawDays) < 1 || Number(rawDays) > 365) {
    return json(400, { error: 'days must be an integer between 1 and 365' });
  }
  const count = Number(rawDays);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: DailyStats[] = [];
  const byDate = new Map<string, DailyStats>();
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    const row: DailyStats = { date, requests: 0, impressions: 0, clicks: 0 };
    days.push(row);
    byDate.set(date, row);
  }

  let queryKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `CAMPAIGN#${campaignId}`,
        ':start': `STATS#${days[0]!.date}`,
        ':end': `STATS#${days[days.length - 1]!.date}`,
      },
      ExclusiveStartKey: queryKey,
      ConsistentRead: true,
    }));
    for (const item of page.Items ?? []) {
      if (typeof item.SK !== 'string') continue;
      const row = byDate.get(item.SK.slice('STATS#'.length));
      if (!row) continue;
      row.requests = typeof item.requests === 'number' ? item.requests : 0;
      row.impressions = typeof item.impressions === 'number' ? item.impressions : 0;
      row.clicks = typeof item.clicks === 'number' ? item.clicks : 0;
    }
    queryKey = page.LastEvaluatedKey;
  } while (queryKey);

  const response: StatsResponse = { days };
  return json(200, response);
}
