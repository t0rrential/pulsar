import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CognitoIdentityProviderClient, ConfirmSignUpCommand, InitiateAuthCommand, RespondToAuthChallengeCommand, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import nodemailer from 'nodemailer';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { db, tableName } from '../lib/db.js';
import { digest, identity, isMember, memberKey } from '../lib/auth.js';
import { json } from '../lib/http.js';

const cognito = new CognitoIdentityProviderClient({});
const scrypt = promisify(scryptCallback);
const now = () => Math.floor(Date.now() / 1000);
const random = () => randomBytes(32).toString('base64url');
const key = (kind: string, value: string) => ({ PK: `AUTH#${kind}#${value}`, SK: 'META' });
const emailValue = (value: unknown) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : undefined;
const equal = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const codeValue = (value: unknown) => typeof value === 'string' && /^\d{6}$/.test(value) ? value : undefined;
async function secretHash(value: string, salt: string) { return (await scrypt(value, salt, 32) as Buffer).toString('hex'); }

async function rateLimit(scope: string, limit: number) {
  const window = Math.floor(now() / 600);
  try {
    await db.send(new UpdateCommand({ TableName: tableName, Key: key('RATE', `${digest(scope)}#${window}`),
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expiry',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':expiry': (window + 2) * 600, ':limit': limit } }));
    return true;
  } catch (error) {
    if ((error as Error).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}
async function sendCode(email: string, code: string) {
  if (!process.env.SMTP_URL || !process.env.SMTP_FROM) throw new Error('SMTP is not configured');
  const url = new URL(process.env.SMTP_URL);
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid SMTP URL');
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'smtps:' ? 465 : 587,
    secure: url.protocol === 'smtps:',
    requireTLS: true,
    ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
  });
  try { await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Your Pulsar verification code', text: `Your Pulsar verification code is ${code}. It expires in 10 minutes.` }); }
  finally { transport.close(); }
}
async function putSession(userId: string, email: string) {
  const token = random();
  await db.send(new PutCommand({ TableName: tableName, Item: { ...key('SESSION', digest(token)), userId, email, expiresAt: now() + 3600 }, ConditionExpression: 'attribute_not_exists(PK)' }));
  return token;
}
async function takeChallenge(challenge: string, email: string) {
  const challengeKey = key('CHALLENGE', digest(challenge));
  const result = await db.send(new DeleteCommand({ TableName: tableName, Key: challengeKey,
    ConditionExpression: 'attribute_exists(PK) AND email = :email AND expiresAt > :now',
    ExpressionAttributeValues: { ':email': email, ':now': now() }, ReturnValues: 'ALL_OLD' }));
  return result.Attributes;
}
function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
    if (Buffer.byteLength(raw) > 16384) return undefined;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export async function handler(event: APIGatewayProxyEventV2) {
  const path = event.rawPath.replace(/\/+$/, '');
  const method = event.requestContext.http.method;
  try {
    if (path === '/auth/me' || path === '/auth/join' || path === '/auth/logout') {
      if ((path === '/auth/me' && method !== 'GET') || (path !== '/auth/me' && method !== 'POST')) return json(404, { error: 'Not found' });
      const user = await identity(event);
      if (!user) return json(401, { error: 'Unauthorized' });
      if (path === '/auth/logout') {
        const header = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1] ?? '';
        const token = /^Bearer ([^\s]+)$/i.exec(header)![1];
        await db.send(new DeleteCommand({ TableName: tableName, Key: key('SESSION', digest(token)) }));
        return json(200, { ok: true });
      }
      if (path === '/auth/me') return json(200, { email: user.email, member: await isMember(user) });
      if (!await rateLimit(`join:${user.id}`, 10) || !await rateLimit(`ip:${event.requestContext.http.sourceIp}`, 100)) return json(429, { error: 'Too many attempts' });
      const supplied = parseBody(event)?.key;
      const expected = process.env.ADMIN_KEY;
      if (!expected || typeof supplied !== 'string' || supplied.length > 4096 || !equal(expected, supplied)) return json(403, { error: 'Invalid key' });
      await db.send(new PutCommand({ TableName: tableName, Item: { ...memberKey(user.id), email: user.email } }));
      return json(200, { member: true });
    }
    if (method !== 'POST' || !['/auth/register', '/auth/confirm', '/auth/login', '/auth/verify'].includes(path)) return json(404, { error: 'Not found' });
    const body = parseBody(event);
    const email = emailValue(body?.email);
    if (!body || !email) return json(400, { error: 'Invalid request' });
    const local = process.env.LOCAL_AUTH === '1';
    if (local && (!process.env.SMTP_URL || !process.env.SMTP_FROM)) return json(503, { error: 'Email delivery is not configured' });
    const clientId = process.env.USER_POOL_CLIENT_ID;
    if (!local && (!clientId || !process.env.USER_POOL_ID)) return json(503, { error: 'Authentication is not configured' });
    if (!await rateLimit(`ip:${event.requestContext.http.sourceIp}`, 100) || !await rateLimit(`${path}:${email}`, 10)) return json(429, { error: 'Too many attempts' });
    const userKey = key('USER', digest(email));
    if (path === '/auth/register') {
      const password = body.password;
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) return json(400, { error: 'Password must be between 12 and 256 characters' });
      if (!local) {
        await cognito.send(new SignUpCommand({ ClientId: clientId!, Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] }));
      } else {
        const salt = random();
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const codeSalt = random();
        await db.send(new PutCommand({ TableName: tableName, Item: { ...userKey, email, salt, passwordHash: await secretHash(password, salt), codeSalt, codeHash: await secretHash(code, codeSalt), codeExpiresAt: now() + 600, confirmed: false }, ConditionExpression: 'attribute_not_exists(PK)' }));
        try { await sendCode(email, code); } catch (error) {
          await db.send(new DeleteCommand({ TableName: tableName, Key: userKey, ConditionExpression: 'codeSalt = :salt AND confirmed = :false', ExpressionAttributeValues: { ':salt': codeSalt, ':false': false } }));
          throw error;
        }
      }
      return json(200, { ok: true });
    }
    if (path === '/auth/confirm') {
      const code = codeValue(body.code);
      if (!code) return json(400, { error: 'Invalid code' });
      if (!local) await cognito.send(new ConfirmSignUpCommand({ ClientId: clientId!, Username: email, ConfirmationCode: code }));
      else {
        const user = (await db.send(new GetCommand({ TableName: tableName, Key: userKey, ConsistentRead: true }))).Item;
        if (!user || user.confirmed || user.codeExpiresAt <= now() || !equal(await secretHash(code, user.codeSalt), user.codeHash)) return json(400, { error: 'Invalid or expired code' });
        await db.send(new UpdateCommand({ TableName: tableName, Key: userKey, UpdateExpression: 'SET confirmed = :true REMOVE codeHash, codeSalt, codeExpiresAt', ConditionExpression: 'confirmed = :false AND codeHash = :hash AND codeExpiresAt > :now', ExpressionAttributeValues: { ':true': true, ':false': false, ':hash': user.codeHash, ':now': now() } }));
      }
      return json(200, { ok: true });
    }
    if (path === '/auth/login') {
      const password = body.password;
      if (typeof password !== 'string' || password.length > 256) return json(400, { error: 'Invalid credentials' });
      const challenge = random();
      if (local) {
        const user = (await db.send(new GetCommand({ TableName: tableName, Key: userKey, ConsistentRead: true }))).Item;
        const hash = await secretHash(password, user?.salt ?? 'missing-user-salt');
        if (!user?.confirmed || !equal(hash, user.passwordHash)) return json(401, { error: 'Invalid credentials' });
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const salt = random();
        await db.send(new PutCommand({ TableName: tableName, Item: { ...key('CHALLENGE', digest(challenge)), email, salt, codeHash: await secretHash(code, salt), expiresAt: now() + 600 }, ConditionExpression: 'attribute_not_exists(PK)' }));
        try { await sendCode(email, code); } catch (error) { await db.send(new DeleteCommand({ TableName: tableName, Key: key('CHALLENGE', digest(challenge)) })); throw error; }
      } else {
        const input = { AuthFlow: 'USER_PASSWORD_AUTH' as const, ClientId: clientId!, AuthParameters: { USERNAME: email, PASSWORD: password } };
        let result = await cognito.send(new InitiateAuthCommand(input));
        if (result.AuthenticationResult) result = await cognito.send(new InitiateAuthCommand(input));
        if (result.ChallengeName !== 'EMAIL_OTP' || !result.Session) return json(401, { error: 'Email verification is required' });
        await db.send(new PutCommand({ TableName: tableName, Item: { ...key('CHALLENGE', digest(challenge)), email, cognitoSession: result.Session, expiresAt: now() + 180 }, ConditionExpression: 'attribute_not_exists(PK)' }));
      }
      return json(200, { challenge });
    }
    const code = codeValue(body.code);
    const challenge = body.challenge;
    if (!code || typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return json(400, { error: 'Invalid challenge' });
    const pending = await takeChallenge(challenge, email);
    if (!pending) return json(400, { error: 'Invalid or expired challenge' });
    let userId: string;
    if (local) {
      if (!equal(await secretHash(code, pending.salt), pending.codeHash)) return json(400, { error: 'Invalid or expired code' });
      userId = `local#${digest(email)}`;
    } else {
      if (typeof pending.cognitoSession !== 'string') return json(400, { error: 'Invalid challenge' });
      const result = await cognito.send(new RespondToAuthChallengeCommand({ ClientId: clientId!, ChallengeName: 'EMAIL_OTP', Session: pending.cognitoSession, ChallengeResponses: { USERNAME: email, EMAIL_OTP_CODE: code } }));
      if (!result.AuthenticationResult?.IdToken) return json(401, { error: 'Email verification is required' });
      const verifier = CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID!, clientId: clientId!, tokenUse: 'id' });
      const claims = await verifier.verify(result.AuthenticationResult.IdToken);
      if (claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.toLowerCase() !== email) return json(401, { error: 'Unauthorized' });
      userId = `cognito#${claims.sub}`;
    }
    return json(200, { token: await putSession(userId, email) });
  } catch (error) {
    const name = (error as Error).name;
    if (['ConditionalCheckFailedException', 'CodeMismatchException', 'ExpiredCodeException', 'NotAuthorizedException', 'UserNotFoundException', 'UsernameExistsException', 'UserNotConfirmedException', 'InvalidPasswordException', 'InvalidParameterException'].includes(name)) return json(400, { error: 'Invalid request or credentials' });
    if (['TooManyRequestsException', 'LimitExceededException'].includes(name)) return json(429, { error: 'Too many attempts' });
    console.error('Authentication request failed', name);
    return json(503, { error: 'Authentication is unavailable' });
  }
}
