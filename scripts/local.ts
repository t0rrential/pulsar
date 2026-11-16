import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const apiPort = Number(process.env.API_PORT || 3001);
const databasePort = Number(process.env.DB_PORT || 8000);
const storagePort = Number(process.env.STORAGE_PORT || 9000);
if (![apiPort, databasePort, storagePort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error('API_PORT, DB_PORT and STORAGE_PORT must be integers between 1 and 65535.');
}
if (new Set([apiPort, databasePort, storagePort]).size !== 3) {
  throw new Error('API_PORT, DB_PORT and STORAGE_PORT must be distinct.');
}
for (const port of [apiPort, databasePort, storagePort]) {
  const server = net.createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  server.close();
  await once(server, 'close');
}

// This runner always uses a local database, never an authenticated AWS table.
process.env.DYNAMODB_ENDPOINT = `http://127.0.0.1:${databasePort}`;
process.env.TABLE_NAME = 'PulsarLocal';
process.env.AWS_REGION ||= 'us-east-1';
process.env.ADMIN_KEY ||= 'local-admin';
process.env.SITE_BUCKET = 'pulsar-local';
process.env.S3_ENDPOINT = `http://localhost:${storagePort}`;
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.AWS_ACCESS_KEY_ID = 'pulsarlocal';
process.env.AWS_SECRET_ACCESS_KEY = 'pulsarlocal-secret';

const containerName = `pulsar-local-${process.pid}`;
const database = spawn('docker', [
  'run', '--rm', '--name', containerName, '-p', `127.0.0.1:${databasePort}:8000`,
  'amazon/dynamodb-local:latest', '-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb',
], { stdio: ['ignore', 'ignore', 'inherit'] });
let databaseError: Error | undefined;
database.on('error', (error) => { databaseError = error; });
database.on('exit', (code) => { databaseError = new Error(`DynamoDB Local exited (${code}).`); });
const storageName = `pulsar-storage-${process.pid}`;
const storage = spawn('docker', [
  'run', '--rm', '--name', storageName, '-p', `127.0.0.1:${storagePort}:9090`,
  'adobe/s3mock:latest',
], { stdio: ['ignore', 'ignore', 'inherit'] });
let storageError: Error | undefined;
storage.on('error', (error) => { storageError = error; });
storage.on('exit', (code) => { storageError = new Error(`Local object storage exited (${code}).`); });

function stopDatabase() {
  spawnSync('docker', ['stop', storageName], { stdio: 'ignore' });
  storage.kill();
  spawnSync('docker', ['stop', containerName], { stdio: 'ignore' });
  database.kill();
}

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT,
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.AWS_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: 'pulsarlocal', secretAccessKey: 'pulsarlocal-secret' },
});

try {
  const deadline = Date.now() + 60_000;
  while (true) {
    if (databaseError) throw databaseError;
    try {
      await client.send(new ListTablesCommand({ Limit: 1 }));
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
  while (true) {
    if (storageError) throw storageError;
    try {
      await s3.send(new CreateBucketCommand({ Bucket: process.env.SITE_BUCKET }));
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
  await client.send(new CreateTableCommand({
    TableName: process.env.TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
  }));

  const [{ handler: getAd }, { handler: postEvents }, { handler: getStats }, { handler: admin }, { seed }] = await Promise.all([
    import('../backend/src/handlers/getAd.ts'),
    import('../backend/src/handlers/postEvents.ts'),
    import('../backend/src/handlers/getStats.ts'),
    import('../backend/src/handlers/admin.ts'),
    import('./seed.ts'),
  ]);
  await seed();

  // Synthetic history is confined to this disposable local database.
  const localDb = DynamoDBDocumentClient.from(client);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const activity = [0.62, 0.76, 0.69, 0.88, 0.81, 1, 0.54];
  for (let campaign = 1; campaign <= 6; campaign++) {
    for (let day = 0; day < activity.length; day++) {
      const date = new Date(today.getTime() - (activity.length - 1 - day) * 86_400_000).toISOString().slice(0, 10);
      const impressions = Math.round((95 + campaign * 31) * activity[day]!);
      const requests = impressions + Math.round(impressions * 0.12);
      const viewable = Math.round(impressions * (0.68 + campaign * 0.02));
      const clicks = Math.round(impressions * (0.025 + campaign * 0.003));
      const conversions = Math.floor(clicks / 4);
      await localDb.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: { PK: `CAMPAIGN#c${campaign}`, SK: `STATS#${date}`, requests, impressions, viewable, clicks, conversions },
      }));
    }
  }
  console.log('Loaded seven days of synthetic sample statistics into the disposable local database.');

  const routes = { 'GET /ad': getAd, 'POST /events': postEvents, 'GET /stats': getStats };
  const api = http.createServer(async (request, response) => {
    if (request.headers.origin === 'http://127.0.0.1:5173') response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-admin-key');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${apiPort}`);
      if (request.method === 'GET' && /^\/uploads\/[a-zA-Z0-9.-]+$/.test(url.pathname)) {
        const object = await s3.send(new GetObjectCommand({ Bucket: process.env.SITE_BUCKET, Key: url.pathname.slice(1) }));
        response.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
        response.end(Buffer.from(await object.Body!.transformToByteArray()));
        return;
      }
      const routeKey = `${request.method} ${url.pathname}`;
      const handler = routes[routeKey as keyof typeof routes] ??
        (/^\/campaigns(?:\/[^/]+(?:\/creatives)?)?$/.test(url.pathname) || url.pathname === '/uploads' ? admin : undefined);
      if (!handler) { response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'Not found' })); return; }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 1_048_576) { response.writeHead(413); response.end(); return; }
        chunks.push(buffer);
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(',') : value;
      }
      const event: APIGatewayProxyEventV2 = {
        version: '2.0', routeKey, rawPath: url.pathname, rawQueryString: url.search.slice(1), headers,
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: length ? Buffer.concat(chunks).toString('utf8') : undefined,
        isBase64Encoded: false,
        requestContext: {
          accountId: 'local', apiId: 'local', domainName: `localhost:${apiPort}`, domainPrefix: 'localhost',
          http: { method: request.method || 'GET', path: url.pathname, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: headers['user-agent'] || '' },
          requestId: crypto.randomUUID(), routeKey, stage: '$default', time: new Date().toISOString(), timeEpoch: Date.now(),
        },
      };
      const result = await handler(event);
      response.statusCode = result.statusCode || 200;
      for (const [key, value] of Object.entries(result.headers || {})) response.setHeader(key, String(value));
      response.end(result.body ? (result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body) : undefined);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Local API request failed' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    api.once('error', reject);
    api.listen(apiPort, '127.0.0.1', () => { api.removeListener('error', reject); resolve(); });
  });
  console.log(`Local API ready: http://localhost:${apiPort}`);
  console.log('DynamoDB-compatible local storage (in memory); data resets when stopped.');
  const stop = () => {
    api.close();
    api.closeAllConnections();
    stopDatabase();
    client.destroy();
    s3.destroy();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  stopDatabase();
  client.destroy();
  s3.destroy();
  throw error;
}
