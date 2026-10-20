import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  let path: string;
  try {
    path = decodeURIComponent(event.rawPath);
  } catch {
    return { statusCode: 400, body: 'Invalid asset path' };
  }
  const key = path === '/' ? 'index.html' : path.slice(1);
  if (!path.startsWith('/') || !key || key.split('/').some((part) => part === '..') || /[\\\x00-\x1f]/.test(key)) {
    return { statusCode: 400, body: 'Invalid asset path' };
  }
  const bucket = process.env.SITE_BUCKET;
  if (!bucket) throw new Error('SITE_BUCKET is required.');
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body) throw new Error('Static asset has no response body.');
    return {
      statusCode: 200,
      headers: {
        'content-type': object.ContentType || 'application/octet-stream',
        'cache-control': object.CacheControl || 'public,max-age=60',
        'x-content-type-options': 'nosniff',
      },
      isBase64Encoded: true,
      body: Buffer.from(await object.Body.transformToByteArray()).toString('base64'),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return { statusCode: 404, headers: { 'cache-control': 'no-store' }, body: 'Asset not found' };
    }
    throw error;
  }
}
