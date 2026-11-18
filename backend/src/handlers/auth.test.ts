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

for (const emailVerificationRequired of [true, false]) {
test(emailVerificationRequired ? 'local email MFA, membership and replay protection' : 'password-only local registration and membership without email', async () => {
  const envNames = ['LOCAL_AUTH', 'REQUIRE_EMAIL_VERIFICATION', 'AUTO_FILL_DEPLOYMENT_KEY', 'SMTP_URL', 'SMTP_FROM', 'ADMIN_KEY'] as const;
  const previousEnv = envNames.map((name) => process.env[name]);
  process.env.LOCAL_AUTH = '1';
  process.env.REQUIRE_EMAIL_VERIFICATION = String(emailVerificationRequired);
  delete process.env.AUTO_FILL_DEPLOYMENT_KEY;
  if (emailVerificationRequired) {
    process.env.SMTP_URL = 'smtp://localhost:2525';
    process.env.SMTP_FROM = 'sender@example.com';
  } else {
    delete process.env.SMTP_URL;
    delete process.env.SMTP_FROM;
  }
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
    const signIn = async () => {
      const login = await post('/auth/login', { email, password });
      assert.equal(login.statusCode, 200);
      if (!emailVerificationRequired) return JSON.parse(login.body!).token as string;
      const challenge = JSON.parse(login.body!).challenge;
      const code = /\b\d{6}\b/.exec(messages.at(-1)!)![0];
      const verified = await post('/auth/verify', { email, challenge, code });
      assert.equal(verified.statusCode, 200);
      assert.equal((await post('/auth/verify', { email, challenge, code })).statusCode, 400);
      return JSON.parse(verified.body!).token as string;
    };
    assert.equal((await post('/auth/register', { email, password })).statusCode, 200);
    if (emailVerificationRequired) {
      const confirmation = /\b\d{6}\b/.exec(messages[0])![0];
      assert.equal((await post('/auth/confirm', { email, code: confirmation })).statusCode, 200);
      assert.equal((await post('/auth/confirm', { email, code: confirmation })).statusCode, 400);
    }
    assert.equal((await post('/auth/login', { email, password: 'wrong-password' })).statusCode, 401);
    const token = await signIn();
    const headers = { authorization: `Bearer ${token}` };
    const privateAccount = JSON.parse((await handler(request('GET', '/auth/me', headers))).body!);
    assert.equal(privateAccount.member, false);
    assert.equal(privateAccount.deploymentKey, undefined);
    process.env.AUTO_FILL_DEPLOYMENT_KEY = 'true';
    assert.equal((await handler(request('GET', '/auth/me'))).statusCode, 401);
    assert.equal(JSON.parse((await handler(request('GET', '/auth/config'))).body!).deploymentKey, undefined);
    const demoAccount = JSON.parse((await handler(request('GET', '/auth/me', headers))).body!);
    assert.equal(demoAccount.deploymentKey, 'join-key');
    assert.equal((await admin(request('GET', '/campaigns', headers))).statusCode, 401);
    assert.equal((await post('/auth/join', { key: 'wrong' }, token)).statusCode, 403);
    assert.equal((await post('/auth/join', { key: demoAccount.deploymentKey }, token)).statusCode, 200);
    const memberId = [...records.keys()].find((id) => id.startsWith('AUTH#MEMBER#'))!;
    const member = records.get(memberId)!;
    records.delete(memberId);
    assert.equal((await admin(request('GET', '/campaigns', headers))).statusCode, 401);
    records.set(memberId, member);
    const memberAccount = JSON.parse((await handler(request('GET', '/auth/me', headers))).body!);
    assert.equal(memberAccount.member, true);
    assert.equal(memberAccount.deploymentKey, undefined);
    assert.equal((await post('/auth/logout', {}, token)).statusCode, 200);
    assert.equal((await handler(request('GET', '/auth/me', headers))).statusCode, 401);
    const secondToken = await signIn();
    const session = [...records.entries()].find(([id]) => id.startsWith('AUTH#SESSION#'))!;
    session[1].expiresAt = 0;
    assert.equal((await handler(request('GET', '/auth/me', { authorization: `Bearer ${secondToken}` }))).statusCode, 401);
  } finally {
    db.send = originalSend;
    nodemailer.createTransport = originalTransport;
    envNames.forEach((name, index) => {
      const value = previousEnv[index];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    });
  }
});
}

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
