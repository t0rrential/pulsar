import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { authorized } from '../lib/auth.js';
import { isIdentifier, json } from '../lib/http.js';
import type { Campaign, Creative } from '../lib/types.js';
import { fingerprintReport } from './fingerprintReport.js';
import { handler as analyticsPipeline } from './analyticsPipeline.js';

const s3 = new S3Client({
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});
const imageExtensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};

type CampaignInput = Pick<Campaign, 'name' | 'status' | 'placements' | 'weight'>;
type CreativeInput = Pick<Creative, 'imageUrl' | 'headline' | 'landingUrl' | 'width' | 'height'>;


function bodyOf(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
    if (Buffer.byteLength(raw) > 16384) return undefined;
    const body: unknown = JSON.parse(raw);
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function campaignInput(body: Record<string, unknown> | undefined): CampaignInput | undefined {
  if (!body || !text(body.name, 200) || (body.status !== 'active' && body.status !== 'paused') ||
      !Array.isArray(body.placements) || body.placements.length < 1 || body.placements.length > 100 ||
      !body.placements.every(isIdentifier) || new Set(body.placements).size !== body.placements.length ||
      typeof body.weight !== 'number' || !Number.isFinite(body.weight) || body.weight <= 0) return undefined;
  return { name: body.name.trim(), status: body.status, placements: body.placements, weight: body.weight };
}

function webUrl(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function creativeInput(body: Record<string, unknown> | undefined): CreativeInput | undefined {
  if (!body || !text(body.headline, 500) || !webUrl(body.landingUrl) ||
      !(webUrl(body.imageUrl) || (typeof body.imageUrl === 'string' && /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(body.imageUrl))) ||
      typeof body.width !== 'number' || !Number.isInteger(body.width) || body.width < 1 || body.width > 10000 ||
      typeof body.height !== 'number' || !Number.isInteger(body.height) || body.height < 1 || body.height > 10000) return undefined;
  return { imageUrl: body.imageUrl, headline: body.headline.trim(), landingUrl: body.landingUrl, width: body.width, height: body.height };
}

function campaignView(item: Campaign) {
  return { id: item.PK.slice('CAMPAIGN#'.length), name: item.name, status: item.status, placements: item.placements, weight: item.weight };
}

function creativeView(item: Creative) {
  return { id: item.SK.slice('CREATIVE#'.length), imageUrl: item.imageUrl, headline: item.headline, landingUrl: item.landingUrl, width: item.width, height: item.height };
}

async function listCampaigns() {
  const campaigns: Campaign[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#sk = :meta AND begins_with(PK, :prefix)',
      ExpressionAttributeNames: { '#sk': 'SK' },
      ExpressionAttributeValues: { ':meta': 'META', ':prefix': 'CAMPAIGN#' },
      ExclusiveStartKey: cursor,
    }));
    campaigns.push(...(page.Items ?? []) as Campaign[]);
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return Promise.all(campaigns.map(async (campaign) => {
    const creatives: Creative[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await db.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': campaign.PK, ':prefix': 'CREATIVE#' },
        ExclusiveStartKey: key,
      }));
      creatives.push(...(page.Items ?? []) as Creative[]);
      key = page.LastEvaluatedKey;
    } while (key);
    return { ...campaignView(campaign), creatives: creatives.map(creativeView) };
  }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  if (!await authorized(event)) return json(401, { error: 'Unauthorized' });
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (path === '/analytics/pipeline' || path === '/analytics/queries' || /^\/analytics\/queries\/[a-zA-Z0-9-]+$/.test(path)) {
    return analyticsPipeline(event);
  }
  if (path === '/campaigns' && method === 'GET') return json(200, { campaigns: await listCampaigns() });
  const fingerprintMatch = /^\/campaigns\/([^/]+)\/fingerprints$/.exec(path);
  if (fingerprintMatch && method === 'GET' && isIdentifier(fingerprintMatch[1])) {
    return fingerprintReport(fingerprintMatch[1], event.queryStringParameters?.days);
  }

  if (path === '/campaigns' && method === 'POST') {
    const input = campaignInput(bodyOf(event));
    if (!input) return json(400, { error: 'Invalid campaign' });
    const item: Campaign = { PK: `CAMPAIGN#${randomUUID()}`, SK: 'META', ...input };
    await db.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }));
    return json(201, { campaign: { ...campaignView(item), creatives: [] } });
  }

  const match = /^\/campaigns\/([^/]+)(\/creatives)?$/.exec(path);
  if (match && isIdentifier(match[1])) {
    const pk = `CAMPAIGN#${match[1]}`;
    if (!match[2] && method === 'PUT') {
      const input = campaignInput(bodyOf(event));
      if (!input) return json(400, { error: 'Invalid campaign' });
      try {
        await db.send(new UpdateCommand({
          TableName: tableName, Key: { PK: pk, SK: 'META' },
          UpdateExpression: 'SET #name = :name, #status = :status, placements = :placements, weight = :weight',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
          ExpressionAttributeValues: { ':name': input.name, ':status': input.status, ':placements': input.placements, ':weight': input.weight },
        }));
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return json(404, { error: 'Campaign not found' });
        throw error;
      }
      return json(200, { campaign: campaignView({ PK: pk, SK: 'META', ...input }) });
    }
    if (match[2] && method === 'POST') {
      const input = creativeInput(bodyOf(event));
      if (!input) return json(400, { error: 'Invalid creative' });
      const campaign = await db.send(new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'META' }, ConsistentRead: true }));
      if (!campaign.Item) return json(404, { error: 'Campaign not found' });
      const item: Creative = { PK: pk, SK: `CREATIVE#${randomUUID()}`, ...input };
      await db.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }));
      return json(201, { creative: creativeView(item) });
    }
  }

  if (path === '/uploads' && method === 'POST') {
    const contentType = bodyOf(event)?.contentType;
    const extension = typeof contentType === 'string' && Object.hasOwn(imageExtensions, contentType) ? imageExtensions[contentType] : undefined;
    if (!extension || typeof contentType !== 'string') return json(400, { error: 'Unsupported image content type' });
    const bucket = process.env.SITE_BUCKET;
    if (!bucket) throw new Error('SITE_BUCKET environment variable is required');
    const domain = event.requestContext.domainName;
    if (!domain) throw new Error('API Gateway domain name is required');
    const siteUrl = `${domain.startsWith('localhost:') ? 'http' : 'https'}://${domain}`;
    const key = `uploads/${randomUUID()}.${extension}`;
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, CacheControl: 'public,max-age=3600' }), {
      expiresIn: 300,
      signableHeaders: new Set(['content-type']),
    });
    return json(200, { uploadUrl, imageUrl: `${siteUrl}/${key}`, headers: { 'content-type': contentType } });
  }
  return json(404, { error: 'Not found' });
}
