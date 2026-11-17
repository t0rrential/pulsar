import { createHash } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { db, tableName } from './db.js';

export type Identity = { id: string; email: string };
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const memberKey = (id: string) => ({ PK: `AUTH#MEMBER#${id}`, SK: 'META' });

export async function identity(event: APIGatewayProxyEventV2): Promise<Identity | undefined> {
  const header = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');
  if (!match || match[1].length > 8192) return undefined;
  const result = await db.send(new GetCommand({ TableName: tableName, Key: { PK: `AUTH#SESSION#${digest(match[1])}`, SK: 'META' }, ConsistentRead: true }));
  const item = result.Item;
  if (!item || item.expiresAt <= Math.floor(Date.now() / 1000) || typeof item.email !== 'string' || typeof item.userId !== 'string') return undefined;
  return { id: item.userId, email: item.email };
}

export async function isMember(user: Identity): Promise<boolean> {
  const result = await db.send(new GetCommand({ TableName: tableName, Key: memberKey(user.id), ConsistentRead: true }));
  return !!result.Item;
}

export async function authorized(event: APIGatewayProxyEventV2): Promise<boolean> {
  const user = await identity(event);
  return !!user && await isMember(user);
}
