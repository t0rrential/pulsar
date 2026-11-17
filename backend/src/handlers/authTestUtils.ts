import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';

export function authenticatedGet(command: unknown) {
  if (!(command instanceof GetCommand)) return undefined;
  const pk = command.input.Key?.PK;
  if (pk === `AUTH#SESSION#${createHash('sha256').update('test-session').digest('hex')}`) return { Item: { email: 'admin@example.com', userId: 'test-user', expiresAt: Math.floor(Date.now() / 1000) + 3600 } };
  if (pk === 'AUTH#MEMBER#test-user') return { Item: { PK: pk } };
  return {};
}
