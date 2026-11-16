import { createHash, timingSafeEqual } from 'node:crypto';
import { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';
import { DescribeDeliveryStreamCommand, FirehoseClient } from '@aws-sdk/client-firehose';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { json } from '../lib/http.js';

const athena = new AthenaClient({});
const firehose = new FirehoseClient({});
const s3 = new S3Client({});

const templates: Record<string, (where: string) => string> = {
  'daily-events': (where) => `SELECT dt, type, count(*) AS events FROM events WHERE ${where} GROUP BY dt, type ORDER BY dt, type LIMIT 100`,
  'placement-counts': (where) => `SELECT placement, count(*) AS impressions FROM events WHERE ${where} AND type = 'impression' GROUP BY placement ORDER BY impressions DESC LIMIT 100`,
  'creative-performance': (where) => `SELECT creativeid, count_if(type = 'impression') AS impressions, count_if(type = 'click') AS clicks, CAST(count_if(type = 'click') AS double) / NULLIF(count_if(type = 'impression'), 0) AS ctr FROM events WHERE ${where} GROUP BY creativeid ORDER BY impressions DESC LIMIT 100`,
};

function dateValue(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : undefined;
}

function authorized(event: APIGatewayProxyEventV2): boolean {
  const expected = process.env.ADMIN_KEY;
  const supplied = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === 'x-admin-key')?.[1];
  if (!expected || !supplied) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(expected), hash(supplied));
}

function bodyOf(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
    if (Buffer.byteLength(raw) > 16384) return undefined;
    const body: unknown = JSON.parse(raw);
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function recentObjects(bucket: string) {
  const objects: { key: string; size: number; lastModified: string }[] = [];
  let objectsIncomplete = false;
  for (const prefix of ['events/', 'errors/']) {
    let token: string | undefined;
    let pages = 0;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
      pages++;
      for (const object of page.Contents ?? []) {
        if (!object.Key || !object.LastModified) continue;
        objects.push({ key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified.toISOString() });
      }
      objects.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
      objects.length = Math.min(objects.length, 20);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) throw new Error('S3 listing is incomplete');
      if (token && pages === 2) { objectsIncomplete = true; break; }
    } while (token);
  }
  return { objects, objectsIncomplete };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  if (!authorized(event)) return json(401, { error: 'Unauthorized' });
  const stream = process.env.FIREHOSE_STREAM_NAME;
  const bucket = process.env.RAW_EVENTS_BUCKET;
  const workgroup = process.env.ATHENA_WORKGROUP;
  const database = process.env.ATHENA_DATABASE;
  if (!stream || !bucket || !workgroup || !database) return json(503, { error: 'Analytics pipeline is not configured.' });
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, '');
  try {
    if (method === 'GET' && path === '/analytics/pipeline') {
      const [description, listing] = await Promise.all([
        firehose.send(new DescribeDeliveryStreamCommand({ DeliveryStreamName: stream })),
        recentObjects(bucket),
      ]);
      return json(200, { stream: { name: stream, status: description.DeliveryStreamDescription?.DeliveryStreamStatus ?? 'UNKNOWN' }, ...listing });
    }
    if (method === 'POST' && path === '/analytics/queries') {
      const body = bodyOf(event);
      const templateId = body?.templateId;
      const start = dateValue(body?.startDate);
      const end = dateValue(body?.endDate);
      if (typeof templateId !== 'string' || !Object.hasOwn(templates, templateId) || start === undefined || end === undefined || end < start || end - start >= 31 * 86400000) {
        return json(400, { error: 'Choose a query and a valid UTC date range of at most 31 days.' });
      }
      const where = `dt BETWEEN '${body!.startDate}' AND '${body!.endDate}'`;
      const result = await athena.send(new StartQueryExecutionCommand({ QueryString: templates[templateId](where), QueryExecutionContext: { Database: database }, WorkGroup: workgroup }));
      if (!result.QueryExecutionId) throw new Error('Athena did not return an execution ID');
      return json(202, { id: result.QueryExecutionId });
    }
    const match = path.match(/^\/analytics\/queries\/([a-zA-Z0-9-]{1,128})$/);
    if (method === 'GET' && match) {
      const id = match[1];
      const execution = (await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: id }))).QueryExecution;
      if (!execution || execution.WorkGroup !== workgroup) return json(404, { error: 'Query not found.' });
      const state = execution.Status?.State ?? 'UNKNOWN';
      const scannedBytes = execution.Statistics?.DataScannedInBytes ?? 0;
      if (state !== 'SUCCEEDED') return json(200, { id, state, scannedBytes, ...(state === 'FAILED' || state === 'CANCELLED' ? { reason: execution.Status?.StateChangeReason ?? 'Query did not complete.' } : {}) });
      const results = await athena.send(new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: 101 }));
      const columns = (results.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map((column) => column.Name ?? '');
      const rows = (results.ResultSet?.Rows ?? []).slice(1).map((row) => (row.Data ?? []).map((cell) => cell.VarCharValue ?? null));
      return json(200, { id, state, scannedBytes, columns, rows, truncated: Boolean(results.NextToken) });
    }
    return json(404, { error: 'Not found.' });
  } catch (error) {
    console.error('Analytics pipeline request failed', error);
    return json(502, { error: 'Analytics service request failed.' });
  }
}
