import { randomUUID } from 'node:crypto';
import { QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { isIdentifier, json } from '../lib/http.js';
import { weightedPick } from '../lib/select.js';
import type { Ad, Campaign, Creative } from '../lib/types.js';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const placement = event.queryStringParameters?.placement;
  if (!isIdentifier(placement)) return json(400, { error: 'placement must be a 1–128 character identifier' });

  const campaigns: Campaign[] = [];
  let scanKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#sk = :meta AND #status = :active AND contains(placements, :placement)',
      ExpressionAttributeNames: { '#sk': 'SK', '#status': 'status' },
      ExpressionAttributeValues: { ':meta': 'META', ':active': 'active', ':placement': placement },
      ExclusiveStartKey: scanKey,
    }));
    for (const item of page.Items ?? []) {
      if (typeof item.PK === 'string' && item.PK.startsWith('CAMPAIGN#') &&
          typeof item.weight === 'number' && Number.isFinite(item.weight) && item.weight > 0) {
        campaigns.push(item as Campaign);
      }
    }
    scanKey = page.LastEvaluatedKey;
  } while (scanKey);

  const campaign = weightedPick(campaigns);
  if (!campaign) return { statusCode: 204, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } };

  const creatives: Creative[] = [];
  let queryKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :creative)',
      ExpressionAttributeValues: { ':pk': campaign.PK, ':creative': 'CREATIVE#' },
      ExclusiveStartKey: queryKey,
    }));
    for (const item of page.Items ?? []) {
      if (typeof item.SK === 'string' && item.SK.length > 'CREATIVE#'.length &&
          typeof item.imageUrl === 'string' && typeof item.headline === 'string' &&
          typeof item.landingUrl === 'string' && typeof item.width === 'number' &&
          Number.isFinite(item.width) && item.width > 0 && typeof item.height === 'number' &&
          Number.isFinite(item.height) && item.height > 0) {
        creatives.push(item as Creative);
      }
    }
    queryKey = page.LastEvaluatedKey;
  } while (queryKey);

  const creative = creatives[Math.floor(Math.random() * creatives.length)];
  if (!creative) return { statusCode: 204, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } };

  const date = new Date().toISOString().slice(0, 10);
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: campaign.PK, SK: `STATS#${date}` },
    UpdateExpression: 'ADD #requests :one',
    ExpressionAttributeNames: { '#requests': 'requests' },
    ExpressionAttributeValues: { ':one': 1 },
  }));

  const ad: Ad = {
    impressionId: randomUUID(),
    campaignId: campaign.PK.slice('CAMPAIGN#'.length),
    creativeId: creative.SK.slice('CREATIVE#'.length),
    imageUrl: creative.imageUrl,
    headline: creative.headline,
    landingUrl: creative.landingUrl,
    width: creative.width,
    height: creative.height,
  };
  return json(200, ad);
}
