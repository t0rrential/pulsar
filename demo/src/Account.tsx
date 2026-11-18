import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

type Step = 'login' | 'register' | 'confirm' | 'verify' | 'join';
const passwordRequirements = 'Use 12–256 characters with uppercase and lowercase letters, a number, and a symbol. No spaces.';
const newPasswordPattern = '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^a-zA-Z0-9\\s])\\S{12,256}';

export default function Account({ apiUrl, onConnect }: { apiUrl: string; onConnect: (token: string) => void }) {
  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const [challenge, setChallenge] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailVerificationRequired, setEmailVerificationRequired] = useState<boolean | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  async function request<T>(path: string, body?: object, bearer?: string): Promise<T> {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Request failed (${response.status}).`);
    return result as T;
  }

  useEffect(() => {
    let active = true;
    setLoadingConfig(true);
    setEmailVerificationRequired(null);
    void request<{ emailVerificationRequired: boolean }>('/auth/config').then((config) => {
      if (typeof config.emailVerificationRequired !== 'boolean') throw new Error('Sign-in configuration is unavailable.');
      if (active) setEmailVerificationRequired(config.emailVerificationRequired);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Sign-in configuration is unavailable.');
    }).finally(() => { if (active) setLoadingConfig(false); });
    return () => { active = false; };
  }, [apiUrl]);

  async function completeSignIn(sessionToken: string) {
    setCode(''); setChallenge(''); setToken(sessionToken);
    const account = await request<{ member: boolean; deploymentKey?: string }>('/auth/me', undefined, sessionToken);
    if (account.member) onConnect(sessionToken);
    else {
      setKey(account.deploymentKey ?? '');
      setStep('join');
      setNotice(account.deploymentKey ? 'The demo deployment key is filled in. Joining grants administrator access.' : 'Enter the deployment key to join its administrator group.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (step === 'register') {
        const result = await request<{ emailVerificationRequired: boolean }>('/auth/register', { email, password });
        setPassword(''); setCode(''); setStep(result.emailVerificationRequired ? 'confirm' : 'login');
        setNotice(result.emailVerificationRequired ? 'Enter the confirmation code sent to your email.' : 'Account created. Sign in to continue.');
      } else if (step === 'confirm') {
        await request('/auth/confirm', { email, code });
        setCode(''); setStep('login'); setNotice('Email confirmed. Sign in to continue.');
      } else if (step === 'login') {
        const result = await request<{ challenge: string } | { token: string }>('/auth/login', { email, password });
        setPassword('');
        if ('token' in result) await completeSignIn(result.token);
        else {
          setChallenge(result.challenge); setCode(''); setStep('verify');
          setNotice('Enter the sign-in code sent to your email.');
        }
      } else if (step === 'verify') {
        const result = await request<{ token: string }>('/auth/verify', { email, challenge, code });
        await completeSignIn(result.token);
      } else {
        await request('/auth/join', { key }, token);
        setKey(''); onConnect(token);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  const title = { login: 'Sign in', register: 'Create an account', confirm: 'Confirm your email', verify: 'Verify sign-in', join: 'Join the administrator group' }[step];
  return <Card className="max-w-xl"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{emailVerificationRequired === false ? 'Password-only demo. Email ownership and two-factor verification are disabled.' : emailVerificationRequired === true ? 'Accounts use a password and a verification code sent by email.' : 'Loading sign-in options…'}</CardDescription></CardHeader><CardContent className="space-y-4">
    {loadingConfig && <p role="status">Loading sign-in options…</p>}
    {!loadingConfig && emailVerificationRequired !== null && <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      {(step === 'login' || step === 'register') && <>
        <div className="grid gap-2"><Label htmlFor="account-email">Email</Label><Input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <div className="grid gap-2">
          <Label htmlFor="account-password">Password</Label>
          <Input id="account-password" type="password" autoComplete={step === 'login' ? 'current-password' : 'new-password'} required minLength={step === 'register' ? 12 : undefined} maxLength={256} pattern={step === 'register' ? newPasswordPattern : undefined} title={step === 'register' ? passwordRequirements : undefined} aria-describedby={step === 'register' ? 'password-requirements' : undefined} value={password} onChange={(event) => setPassword(event.target.value)} />
          {step === 'register' && <p id="password-requirements" className="text-sm text-muted-foreground">{passwordRequirements}</p>}
        </div>
      </>}
      {step === 'confirm' && <div className="grid gap-2"><Label htmlFor="confirmation-email">Email</Label><Input id="confirmation-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>}
      {(step === 'confirm' || step === 'verify') && <div className="grid gap-2"><Label htmlFor="account-code">Email code</Label><Input id="account-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} /></div>}
      {step === 'join' && <div className="grid gap-2"><Label htmlFor="group-key">Deployment key</Label><Input id="group-key" type="password" autoComplete="off" required value={key} onChange={(event) => setKey(event.target.value)} /></div>}
      <div><Button type="submit" disabled={busy}>{busy ? 'Working…' : title}</Button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!loadingConfig && emailVerificationRequired !== null && (step === 'login' || step === 'register') && <Button type="button" variant="outline" onClick={() => { setStep(step === 'login' ? 'register' : 'login'); setError(''); setNotice(''); setPassword(''); }}>{step === 'login' ? 'Create account' : 'Already have an account? Sign in'}</Button>}
    {emailVerificationRequired === true && step === 'login' && <Button type="button" variant="outline" onClick={() => { setStep('confirm'); setError(''); setNotice(''); }}>Confirm an existing account</Button>}
    {(step === 'confirm' || step === 'verify') && <Button type="button" variant="outline" onClick={() => { setStep('login'); setCode(''); setError(''); setNotice(''); }}>Back to sign in</Button>}
  </CardContent></Card>;
}
