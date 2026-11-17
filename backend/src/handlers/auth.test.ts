import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import nodemailer from 'nodemailer';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';


process.env.TABLE_NAME = 'auth-test';
// These modules capture TABLE_NAME at initialization.
const { handler } = await import('./auth.js');
const { handler: admin } = await import('./admin.js');
const { db } = await import('../lib/db.js');

function request(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): APIGatewayProxyEventV2 {
  return { rawPath: path, headers, requestContext: { http: { method, sourceIp: '127.0.0.1' } }, body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2;
}

test('shared administrator key is not an authorization credential', async () => {
  process.env.ADMIN_KEY = 'secret';
  assert.equal((await admin(request('GET', '/campaigns', { 'x-admin-key': 'secret' }))).statusCode, 401);
});

test('account and join endpoints require a bearer token', async () => {
  assert.equal((await handler(request('GET', '/auth/me'))).statusCode, 401);
  assert.equal((await handler(request('POST', '/auth/join', {}, { key: 'secret' }))).statusCode, 401);
});

test('local registration fails closed without an email sender', async () => {
  process.env.LOCAL_AUTH = '1';
  delete process.env.SMTP_URL;
  delete process.env.SMTP_FROM;
  assert.equal((await handler(request('POST', '/auth/register', {}, { email: 'person@example.com', password: 'long-password-123' }))).statusCode, 503);
});

test('local registration, email MFA, membership and replay protection', async () => {
  process.env.LOCAL_AUTH = '1';
  process.env.SMTP_URL = 'smtp://localhost:2525';
  process.env.SMTP_FROM = 'sender@example.com';
  process.env.ADMIN_KEY = 'join-key';
  const records = new Map<string, Record<string, any>>();
  const messages: string[] = [];
  const originalSend = db.send;
  const originalTransport = nodemailer.createTransport;
  nodemailer.createTransport = (() => ({
    sendMail: async (message: { text: string }) => { messages.push(message.text); },
    close() {},
  })) as typeof nodemailer.createTransport;
  db.send = (async (command: GetCommand | PutCommand | UpdateCommand | DeleteCommand) => {
    const input = command.input as { Key?: Record<string, any>; Item?: Record<string, any>; ConditionExpression?: string; ExpressionAttributeValues?: Record<string, any> };
    const pk = input.Key?.PK ?? input.Item?.PK;
    const id = String(pk);
    const current = records.get(id);
    const fail = () => { const error = new Error('condition failed'); error.name = 'ConditionalCheckFailedException'; throw error; };
    if (command instanceof GetCommand) return { Item: current };
    if (command instanceof PutCommand) {
      if (input.ConditionExpression && current) fail();
      records.set(id, { ...command.input.Item });
      return {};
    }
    if (command instanceof DeleteCommand) {
      if (input.ConditionExpression && (!current || (input.ExpressionAttributeValues?.[':email'] && (current.email !== input.ExpressionAttributeValues[':email'] || current.expiresAt <= input.ExpressionAttributeValues[':now'])))) fail();
      records.delete(id);
      return { Attributes: current };
    }
    if (command instanceof UpdateCommand) {
      const values = command.input.ExpressionAttributeValues!;
      if (id.startsWith('AUTH#RATE#')) {
        if ((current?.count ?? 0) >= values[':limit']) fail();
        records.set(id, { count: (current?.count ?? 0) + 1 });
      } else {
        if (!current || current.confirmed || current.codeHash !== values[':hash'] || current.codeExpiresAt <= values[':now']) fail();
        records.set(id, { ...current, confirmed: true });
      }
      return {};
    }
    throw new Error('Unexpected command');
  }) as typeof db.send;
  try {
    const email = 'person@example.com', password = 'long-password-123';
    const post = (path: string, body: unknown, token?: string) => handler(request('POST', path, token ? { authorization: `Bearer ${token}` } : {}, body));
    assert.equal((await post('/auth/register', { email, password })).statusCode, 200);
    const confirmation = /\b\d{6}\b/.exec(messages[0])![0];
    assert.equal((await post('/auth/confirm', { email, code: confirmation })).statusCode, 200);
    assert.equal((await post('/auth/confirm', { email, code: confirmation })).statusCode, 400);
    const login = await post('/auth/login', { email, password });
    assert.equal(login.statusCode, 200);
    const challenge = JSON.parse(login.body!).challenge;
    const code = /\b\d{6}\b/.exec(messages[1])![0];
    const verified = await post('/auth/verify', { email, challenge, code });
    assert.equal(verified.statusCode, 200);
    const token = JSON.parse(verified.body!).token;
    assert.equal((await post('/auth/verify', { email, challenge, code })).statusCode, 400);
    const headers = { authorization: `Bearer ${token}` };
    assert.equal(JSON.parse((await handler(request('GET', '/auth/me', headers))).body!).member, false);
    assert.equal((await post('/auth/join', { key: 'wrong' }, token)).statusCode, 403);
    assert.equal((await post('/auth/join', { key: 'join-key' }, token)).statusCode, 200);
    const memberId = [...records.keys()].find((id) => id.startsWith('AUTH#MEMBER#'))!;
    const member = records.get(memberId)!;
    records.delete(memberId);
    assert.equal((await admin(request('GET', '/campaigns', headers))).statusCode, 401);
    records.set(memberId, member);
    assert.equal(JSON.parse((await handler(request('GET', '/auth/me', headers))).body!).member, true);
    assert.equal((await post('/auth/logout', {}, token)).statusCode, 200);
    assert.equal((await handler(request('GET', '/auth/me', headers))).statusCode, 401);
    const secondLogin = await post('/auth/login', { email, password });
    const secondChallenge = JSON.parse(secondLogin.body!).challenge;
    const secondCode = /\b\d{6}\b/.exec(messages[2])![0];
    const secondVerified = await post('/auth/verify', { email, challenge: secondChallenge, code: secondCode });
    const secondToken = JSON.parse(secondVerified.body!).token;
    const session = [...records.entries()].find(([id]) => id.startsWith('AUTH#SESSION#'))!;
    session[1].expiresAt = 0;
    assert.equal((await handler(request('GET', '/auth/me', { authorization: `Bearer ${secondToken}` }))).statusCode, 401);
  } finally {
    db.send = originalSend;
    nodemailer.createTransport = originalTransport;
  }
});

test('Cognito first-login tokens are discarded until a fresh email challenge', async () => {
  delete process.env.LOCAL_AUTH;
  process.env.USER_POOL_ID = 'us-east-1_test';
  process.env.USER_POOL_CLIENT_ID = 'client';
  const originalSend = db.send;
  const originalCognito = CognitoIdentityProviderClient.prototype.send;
  let attempts = 0;
  db.send = (async () => ({})) as typeof db.send;
  CognitoIdentityProviderClient.prototype.send = (async () => {
    attempts++;
    return attempts === 1
      ? { AuthenticationResult: { IdToken: 'unverified-direct-token' } }
      : { ChallengeName: 'EMAIL_OTP', Session: 'cognito-session' };
  }) as typeof CognitoIdentityProviderClient.prototype.send;
  try {
    const response = await handler(request('POST', '/auth/login', {}, { email: 'person@example.com', password: 'long-password-123' }));
    assert.equal(response.statusCode, 200);
    assert.equal(attempts, 2);
    assert.equal(typeof JSON.parse(response.body!).challenge, 'string');
    assert.equal(JSON.parse(response.body!).token, undefined);
  } finally {
    db.send = originalSend;
    CognitoIdentityProviderClient.prototype.send = originalCognito;
  }
});
