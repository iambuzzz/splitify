import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { ApiError, requestSignInEmail } from '../data/api';
import { config } from '../data/config';
import { googleConfigured, startGoogleSignIn, takeGoogleReturn } from '../data/google';
import { rememberInviteFromUrl, rememberReturnPath } from '../data/invite';
import { useStore } from '../data/StoreProvider';
import { supabase } from '../data/supabase';
import { useTheme } from '../theme/ThemeProvider';
import { Logo } from '../ui/Logo';
import { Button, Field, Label, Screen, T } from '../ui/kit';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6,10}$/;

/**
 * The email's "Sign in" button lands on /auth/callback#token_hash=…&type=… (the token after `#` never
 * reaches a server). Read once, then cleared from the address bar and history.
 */
function takeCallbackToken(): { tokenHash: string; type: string } | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || window.location.pathname !== '/auth/callback') return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, '', '/');
  const tokenHash = p.get('token_hash');
  return tokenHash ? { tokenHash, type: p.get('type') ?? 'magiclink' } : null;
}

/** Shown instead of the app until someone is signed in and has a name. */
export function SignIn() {
  const { theme } = useTheme();
  const { account } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  /** Digits in the emailed code: a Supabase project setting (6–10). */
  const [codeLength, setCodeLength] = useState(6);
  /**
   * 'code': our own email (a code + a button that works in any browser).
   * 'link': the server has no email set up, so Supabase's built-in email (a link) was sent instead.
   */
  const [mode, setMode] = useState<'code' | 'link'>('code');
  const [busy, setBusy] = useState(false);
  const [checkingLink, setCheckingLink] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const googleOn = useGoogleEnabled();
  useEffect(() => {
    rememberInviteFromUrl();
    rememberReturnPath();
  }, []);

  // Back from Google: sign in to Supabase with the ID token it gave us, or say why not.
  useEffect(() => {
    const g = takeGoogleReturn();
    if (!g) return;
    if ('error' in g) {
      setProblem(g.error === 'cancelled' ? 'Google sign-in was cancelled. Try again, or use your email.' : 'Google sign-in did not work. Try again, or use your email.');
      return;
    }
    setCheckingLink(true);
    supabase!.auth
      .signInWithIdToken({ provider: 'google', token: g.idToken, nonce: g.nonce })
      .then(({ error }) => {
        if (error) setProblem('Google sign-in did not work. Try again, or use your email.');
      })
      .finally(() => setCheckingLink(false));
  }, []);

  // Opened from the email's button: sign in with the token it carries.
  useEffect(() => {
    const t = takeCallbackToken();
    if (!t) return;
    setCheckingLink(true);
    supabase!.auth
      .verifyOtp({ token_hash: t.tokenHash, type: t.type as 'magiclink' | 'signup' | 'email' })
      .then(({ error }) => {
        if (error) setProblem('That sign-in link has expired or was already used. Ask for a new code below.');
      })
      .finally(() => setCheckingLink(false));
  }, []);

  if (!account || account.status === 'loading' || checkingLink) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: theme.c.bg }}>
        <ActivityIndicator color={theme.c.primary} />
        {checkingLink ? (
          <T size={15} color={theme.c.muted}>
            Signing you in…
          </T>
        ) : null}
      </View>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Something went wrong. Try again');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const to = email.trim().toLowerCase();
      try {
        setCodeLength(await requestSignInEmail(to));
        setMode('code');
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'email_not_configured')) throw err;
        // No email service on this server yet: Supabase's own email, which has a link only.
        const emailRedirectTo = Platform.OS === 'web' ? window.location.origin : undefined;
        const { error } = await supabase!.auth.signInWithOtp({ email: to, options: { shouldCreateUser: true, emailRedirectTo } });
        if (error) throw new Error(error.status === 429 ? 'Too many emails asked for. Wait a minute and try again' : error.message);
        setMode('link');
      }
      setSentTo(to);
      setCode('');
    });

  const verify = (token = code.trim()) =>
    run(async () => {
      const { error } = await supabase!.auth.verifyOtp({ email: sentTo!, token, type: 'email' });
      if (error) throw new Error('That code is wrong or has expired. Check the latest email, or ask for a new code');
    });

  const google = () => run(startGoogleSignIn);

  const saveName = () => run(() => account.saveName(name.trim()));

  if (account.status === 'needs_name') {
    const valid = name.trim().length > 0 && name.trim().length <= 60;
    return (
      <Screen maxWidth={440} footer={<Button title={busy ? 'Saving…' : 'Continue'} disabled={!valid || busy} onPress={saveName} />}>
        <Intro title="What should friends call you?" text="This name shows in your groups. You can change it per group later." />
        <View style={{ gap: 8 }}>
          <Label>Your name</Label>
          <Field accessibilityLabel="Your name" placeholder="e.g. Asha" value={name} onChangeText={setName} autoFocus onSubmitEditing={() => valid && saveName()} returnKeyType="done" />
        </View>
        <Problem text={problem} />
      </Screen>
    );
  }

  if (sentTo) {
    const valid = CODE.test(code.trim());
    const inbox = webmailFor(sentTo, mode === 'code' ? 'Splitify' : 'from:supabase');
    const codeField = (
      <Field
        accessibilityLabel="Sign-in code"
        placeholder={'123456789'.padEnd(codeLength, '0').slice(0, codeLength)}
        value={code}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '');
          setCode(digits);
          // Whole code typed or pasted: sign in straight away.
          if (mode === 'code' && digits.length === codeLength && !busy) verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={10}
        autoFocus={mode === 'code'}
        onSubmitEditing={() => valid && verify()}
        style={mode === 'code' ? { fontSize: codeLength > 6 ? 24 : 28, letterSpacing: codeLength > 6 ? 5 : 8, textAlign: 'center', height: 64 } : undefined}
      />
    );
    const again = (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Send a new code" size="md" variant="secondary" flex={1} disabled={busy} onPress={sendCode} />
        <Button title="Use another email" size="md" variant="secondary" flex={1} disabled={busy} onPress={() => setSentTo(null)} />
      </View>
    );

    if (mode === 'code') {
      return (
        <Screen maxWidth={440} footer={<Button title={busy ? 'Checking…' : 'Sign in'} disabled={!valid || busy} onPress={() => verify()} />}>
          <Intro title="Enter your code" text={`We emailed a ${codeLength}-digit code to ${sentTo}.`} />
          <View style={{ gap: 8 }}>
            <Label>Code</Label>
            {codeField}
          </View>
          <Problem text={problem} />
          <T size={14} color={theme.c.muted}>
            Or tap “Sign in” in the email. The button works in any browser.
          </T>
          {inbox ? <Button title={`Open ${inbox.name}`} icon="mail" size="md" variant="secondary" onPress={() => window.open(inbox.url, '_blank', 'noopener')} /> : null}
          {again}
        </Screen>
      );
    }

    return (
      <Screen maxWidth={440}>
        <Intro title="Check your email" text={`We sent a sign-in link to ${sentTo}.`} />
        {/* Supabase's built-in email has a link only, so the steps lead with it. */}
        <View style={{ gap: 12, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: theme.c.border, backgroundColor: theme.c.surface }}>
          {[
            'Open the email from Supabase Auth (check Spam too).',
            'Tap “Confirm email address” or “Log In” in it.',
            Platform.OS === 'web' ? 'Open it in this same browser. This page then continues by itself.' : 'You come back to Splitify signed in.',
          ].map((step, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.c.tint, alignItems: 'center', justifyContent: 'center' }}>
                <T size={13} weight="bold">
                  {String(i + 1)}
                </T>
              </View>
              <T size={15} style={{ flex: 1 }}>
                {step}
              </T>
            </View>
          ))}
          {inbox ? <Button title={`Open ${inbox.name}`} icon="mail" size="md" onPress={() => window.open(inbox.url, '_blank', 'noopener')} /> : null}
        </View>
        {Platform.OS === 'web' ? (
          <T size={13} color={theme.c.muted}>
            If the link opens in a different browser, copy it instead (right-click or long-press → Copy Link) and paste it into this browser’s address bar.
          </T>
        ) : null}
        <Problem text={problem} />
        {again}
        <View style={{ gap: 10, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: theme.c.border, backgroundColor: theme.c.surface }}>
          <Label>Or type the code from the email</Label>
          {codeField}
          <Button title={busy ? 'Checking…' : 'Sign in with code'} size="md" disabled={!valid || busy} onPress={() => verify()} />
        </View>
      </Screen>
    );
  }

  const valid = EMAIL.test(email.trim());
  return (
    <Screen maxWidth={440} footer={<Button title={busy ? 'Sending…' : 'Email me a code'} disabled={!valid || busy} onPress={sendCode} />}>
      <Intro title="Sign in to Splitify" text="Keep chatting on WhatsApp. Keep the money here. No password: we email you a code." />
      {googleOn ? (
        <>
          <GoogleButton disabled={busy} onPress={google} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.c.border }} />
            <T size={13} color={theme.c.muted}>
              or use your email
            </T>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.c.border }} />
          </View>
        </>
      ) : null}
      <View style={{ gap: 8 }}>
        <Label>Email</Label>
        <Field
          accessibilityLabel="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoFocus
          onSubmitEditing={() => valid && sendCode()}
          returnKeyType="send"
        />
      </View>
      <Problem text={problem} />
      <T size={13} color={theme.c.muted}>
        New here? The same code creates your account.
      </T>
    </Screen>
  );
}

/** Whether Google sign-in is set up here and switched on in Supabase (the button stays hidden until it is). Web only for now. */
function useGoogleEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!googleConfigured() || !config.supabaseUrl || !config.supabaseKey) return;
    let live = true;
    fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: config.supabaseKey } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: { google?: boolean } } | null) => live && setOn(!!s?.external?.google))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return on;
}

// Google's own "G" mark, as their sign-in branding asks.
const GOOGLE_G =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  );

function GoogleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        borderRadius: receipt ? 999 : theme.r.button,
        borderWidth: receipt ? 2 : 1,
        borderColor: receipt ? theme.c.text : theme.c.borderStrong,
        backgroundColor: receipt ? 'transparent' : theme.c.surface,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        {/* A plain <img>: react-native-web's Image does not draw this inline SVG. The button is web-only. */}
        {createElement('img', { src: GOOGLE_G, width: 16, height: 16, alt: '' })}
      </View>
      <T size={16} weight="bold">
        Continue with Google
      </T>
    </Pressable>
  );
}

function Intro({ title, text }: { title: string; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 24, marginBottom: 8 }}>
      <Logo />
      <T size={26} weight="heavy">
        {title}
      </T>
      <T size={15} color={theme.c.muted}>
        {text}
      </T>
    </View>
  );
}

function Problem({ text }: { text: string | null }) {
  const { theme } = useTheme();
  if (!text) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite">
      <T size={14} color={theme.c.owe}>
        {text}
      </T>
    </View>
  );
}

/** A one-tap way to the inbox for the big webmail providers (others just open their email app). */
function webmailFor(email: string, search: string): { name: string; url: string } | null {
  if (Platform.OS !== 'web') return null;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { name: 'Gmail', url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(search)}` };
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return { name: 'Outlook', url: 'https://outlook.live.com/mail/0/' };
  if (domain === 'yahoo.com' || domain === 'yahoo.co.in') return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com/' };
  return null;
}
