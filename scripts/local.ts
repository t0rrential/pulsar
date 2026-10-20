import http from 'node:http';
import dynalite from 'dynalite';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const apiPort = Number(process.env.API_PORT || 3001);
const databasePort = Number(process.env.DB_PORT || 8000);
if (![apiPort, databasePort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error('API_PORT and DB_PORT must be integers between 1 and 65535.');
}

// This runner always uses a local database, never an authenticated AWS table.
process.env.DYNAMODB_ENDPOINT = `http://127.0.0.1:${databasePort}`;
process.env.TABLE_NAME = 'PulsarLocal';
process.env.AWS_REGION ||= 'us-east-1';

const database = dynalite({ createTableMs: 0 });
await new Promise<void>((resolve, reject) => {
  database.once('error', reject);
  database.listen(databasePort, '127.0.0.1', () => {
    database.removeListener('error', reject);
    resolve();
  });
});

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT,
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

try {
  await client.send(new CreateTableCommand({
    TableName: process.env.TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
  }));

  const [{ handler: getAd }, { handler: postEvents }, { handler: getStats }, { seed }] = await Promise.all([
    import('../backend/src/handlers/getAd.ts'),
    import('../backend/src/handlers/postEvents.ts'),
    import('../backend/src/handlers/getStats.ts'),
    import('./seed.ts'),
  ]);
  await seed();

  const routes = { 'GET /ad': getAd, 'POST /events': postEvents, 'GET /stats': getStats };
  const api = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${apiPort}`);
      const routeKey = `${request.method} ${url.pathname}`;
      const handler = routes[routeKey as keyof typeof routes];
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
          accountId: 'local', apiId: 'local', domainName: 'localhost', domainPrefix: 'localhost',
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
    database.close();
    client.destroy();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  database.close();
  client.destroy();
  throw error;
}
