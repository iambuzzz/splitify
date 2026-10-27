import type { Session } from '@supabase/supabase-js';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError, api, configureApi, fetchReceipt, uploadReceipt } from './api';
import { uuidv7 } from './ids';
import { config, remoteEnabled } from './config';
import { forgetThisDevice } from '../ui/useNotifications';
import { type Action, ME, type Receipt, type SeenMark, type State, actionGroup, reducer, seed } from './model';
import { type Pending, type Snap, buildRemote, fetchGroupIds, fetchPulse, fetchSnapshot, perform, sendSeen, settled, withPending } from './remote';
import { supabase } from './supabase';

export interface InvitePreview {
  groupId: string;
  name: string;
  memberCount: number;
  placeholders: { id: string; displayName: string }[];
}

/** Signed-in mode only: who is signed in, and what needs the API directly. */
export interface Account {
  status: 'loading' | 'signed_out' | 'needs_name' | 'ready';
  email?: string;
  name?: string;
  saveName(name: string): Promise<void>;
  signOut(): Promise<void>;
  /** A fresh invite link for a group (the token is in the #fragment, which never reaches a server). */
  inviteLink(groupId: string): Promise<string>;
  /** Turns off every invite link already sent for a group; says how many. */
  revokeInvites(groupId: string): Promise<number>;
  preview(token: string): Promise<InvitePreview>;
  /** Joins as a placeholder I claim, or as a new member (with my profile name unless `displayName` is given). */
  join(token: string, claimMemberId?: string, displayName?: string): Promise<string>;
}

/** `upTo` (e.g. the newest message id) only decides whether this is news; it isn't sent. */
export type SeenItem = { type: 'expense' | 'settlement' | 'pair'; id: string; version?: number; upTo?: string };

interface Store {
  state: State;
  dispatch: (a: Action) => void;
  /** Sends one action and waits: throws if the server refuses it. For step-by-step work like an import. */
  run(a: Action): Promise<void>;
  /** Fetches the latest state for these groups (after a batch of `run`s). */
  refresh(groupIds?: string[]): Promise<void>;
  /** What this server supports (demo: everything). */
  features: { receipts: boolean };
  /** Attaches a prepared photo or PDF to an expense; says if the same file is already on an expense. */
  addReceipt(expenseId: string, file: ReceiptFile): Promise<{ duplicateOf: DuplicateOf | null }>;
  /** A URL that shows a receipt in this browser (loaded once, then kept). */
  receiptUrl(r: Receipt): Promise<string>;
  /** Tell the others I've seen these money items (signed in only; repeated calls are cheap). */
  markSeen(groupId: string, items: SeenItem[]): void;
  /** Null in demo mode. */
  account: Account | null;
  /** Whether the groups have arrived: 'offline' while the server can't be reached (it keeps retrying). */
  sync: 'loading' | 'ready' | 'offline';
  /** The last change the API refused, in words for the user. */
  error: string | null;
  clearError(): void;
}

export interface ReceiptFile {
  blob: Blob;
  type: string;
  width?: number;
  height?: number;
}
export interface DuplicateOf {
  expenseId: string;
  title: string;
  sameExpense: boolean;
}

const StoreContext = createContext<Store | null>(null);

// Receipts are fetched with the sign-in token, then shown from a local blob: URL (kept while the app is open).
// File storage sometimes stalls for a few seconds, so a failed load is tried twice more before giving up;
// a file that isn't there (404) or a sign-in problem (401/403) isn't worth repeating.
const RECEIPT_RETRY_MS = [1000, 3000];
async function fetchReceiptPatiently(id: string): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchReceipt(id);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const wait = RECEIPT_RETRY_MS[attempt];
      if (wait === undefined || status === 401 || status === 403 || status === 404) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
const receiptUrls = new Map<string, Promise<string>>();
const remoteReceiptUrl = (r: Receipt) => {
  let url = receiptUrls.get(r.id);
  if (!url) {
    url = fetchReceiptPatiently(r.id).then((b) => URL.createObjectURL(b));
    url.catch(() => receiptUrls.delete(r.id));
    receiptUrls.set(r.id, url);
  }
  return url;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  return remoteEnabled ? <RemoteStore>{children}</RemoteStore> : <DemoStore>{children}</DemoStore>;
}

function DemoStore({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer((s: State, a: Action) => reducer(s, a), undefined, seed);
  return (
    <StoreContext.Provider
      value={{
        state,
        dispatch,
        run: async (a) => dispatch(a),
        refresh: async () => {},
        features: { receipts: true },
        // Demo: the file stays in this browser.
        async addReceipt(expenseId, file) {
          const receipt: Receipt = { id: uuidv7(), by: ME, contentType: file.type, size: file.blob.size, at: new Date().toISOString(), localUrl: URL.createObjectURL(file.blob) };
          dispatch({ type: 'add_receipt', id: expenseId, receipt });
          return { duplicateOf: null };
        },
        receiptUrl: async (r) => r.localUrl ?? '',
        markSeen: () => {},
        account: null,
        sync: 'ready',
        error: null,
        clearError: () => {},
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}


const words = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again');

/** The app's public address, for links people send to each other. */
export function appUrl(): string {
  if (config.appUrl) return config.appUrl.replace(/\/$/, '');
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'splitify:/';
}

if (remoteEnabled) configureApi(config.apiUrl!, async () => (await supabase!.auth.getSession()).data.session?.access_token);

function RemoteStore({ children }: { children: ReactNode }) {
  const auth = supabase!.auth;
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** undefined = not loaded yet; null = signed in but no name yet. */
  const [name, setName] = useState<string | null | undefined>(undefined);
  /**
   * The latest snapshot per group, numbered by when its request started: a slow, older response never
   * replaces a newer one. The app's state is built from these.
   */
  const [snaps, setSnaps] = useState<Record<string, Snap>>({});
  /**
   * My changes shown before the server has them. Each stays on top of any snapshot fetched before it
   * was saved, so the screen doesn't jump back while a reload that started earlier comes in.
   */
  const [pending, setPending] = useState<Pending[]>([]);
  const seq = useRef(0);
  /** What I've opened on this device, so its dot clears at once. */
  const [seenLocally, setSeenLocally] = useState<SeenMark[]>([]);
  const remote = useMemo(() => withPending(snaps, pending, seenLocally), [snaps, pending, seenLocally]);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<Store['sync']>('loading');
  const loadedRef = useRef(snaps);
  loadedRef.current = snaps;
  const latest = useRef(remote);
  latest.current = remote;
  const pendingKey = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pulse = useRef<Record<string, string>>({});
  const seenSent = useRef(new Set<string>());

  useEffect(() => {
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [auth]);

  const userId = session?.user.id;
  useEffect(() => {
    setName(undefined);
    setSnaps({});
    setSeenLocally([]);
    setSync('loading');
    pulse.current = {};
    seenSent.current.clear();
    if (!userId) return;
    api
      .get('/me')
      .then((me) => setName(me.displayName))
      .catch((err) => setError(words(err)));
  }, [userId]);

  const snapshot = async (g: string): Promise<Snap | null> => {
    const started = ++seq.current;
    try {
      return { data: await fetchSnapshot(g), seq: started };
    } catch (err) {
      // A group I can no longer see (deleted, or I was removed).
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  };
  const newer = (old: Snap | undefined, s: Snap) => (old && old.seq > s.seq ? old : s);

  /** Reloads the given groups (all of mine when omitted), dropping groups I can no longer see. */
  const reload = useCallback(async (only?: string[]) => {
    try {
      if (only) {
        // Straight to the groups that changed: one round of requests, no group list first.
        const fresh = await Promise.all(only.map(async (g) => [g, await snapshot(g)] as const));
        setSnaps((prev) => {
          const next = { ...prev };
          for (const [g, s] of fresh) {
            if (s) next[g] = newer(prev[g], s);
            else delete next[g];
          }
          return next;
        });
      } else {
        const ids = await fetchGroupIds();
        const fresh = await Promise.all(ids.map(async (g) => [g, await snapshot(g)] as const));
        setSnaps((prev) => {
          const next: Record<string, Snap> = {};
          for (const [g, s] of fresh) if (s) next[g] = newer(prev[g], s);
          return next;
        });
      }
      setSync('ready');
    } catch {
      // Shown as "reconnecting"; the live check below loads whatever is still missing.
      setSync('offline');
    }
  }, []);

  useEffect(() => {
    if (name) reload();
  }, [name, reload]);

  // Live updates. Supabase Realtime tells this person "group X changed" on their own private channel
  // (the database sends it after a change commits; it carries no data), and the app reloads that
  // group through the API. /pulse is the safety net: every 30 s while the channel is up, every 3 s
  // while it is down, and at once when the app comes back to the front.
  const live = useRef(false);
  const kick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!name) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => (Platform.OS === 'web' ? typeof document === 'undefined' || document.visibilityState === 'visible' : AppState.currentState === 'active');
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      clearTimeout(timer);
      if (visible()) {
        try {
          const now = await fetchPulse();
          const before = pulse.current;
          const first = Object.keys(before).length === 0;
          // Changed since the last check, or never loaded (say, the first load failed). The very first
          // check only records where things stand: the first load is already under way.
          const stale = first ? [] : Object.keys(now).filter((g) => before[g] !== now[g] || !(g in loadedRef.current));
          const gone = Object.keys(before).some((g) => !(g in now));
          pulse.current = now;
          if (stale.length || gone) await reload(gone ? undefined : stale);
          else if (Object.keys(now).every((g) => g in loadedRef.current)) setSync('ready');
        } catch {
          // Offline for a moment: try again on the next tick.
          setSync('offline');
        }
      }
      running = false;
      // One timer at a time, however often the app is woken.
      if (!stopped) timer = setTimeout(tick, live.current ? 30_000 : 3000);
    };
    kick.current = () => void tick();
    tick();
    const wake = () => visible() && tick();
    const sub = AppState.addEventListener('change', wake);
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      kick.current = () => {};
      sub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
    };
  }, [name, reload]);

  useEffect(() => {
    if (!name || !userId) return;
    const client = supabase!;
    let closed = false;
    // One change can send a few hints (say, an expense and its seen mark); reload each group once.
    const changed = new Set<string>();
    let flush: ReturnType<typeof setTimeout> | undefined;
    const channel = client
      .channel(`user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, ({ payload }) => {
        if (typeof payload?.g !== 'string') return;
        changed.add(payload.g);
        clearTimeout(flush);
        flush = setTimeout(() => {
          const groups = [...changed];
          changed.clear();
          reload(groups);
        }, 200);
      });
    // Private channels check the person's sign-in when joining (supabase-js keeps the token fresh after).
    client.realtime.setAuth().then(() => {
      if (closed) return;
      channel.subscribe((status, err) => {
        const up = status === 'SUBSCRIBED';
        // Development only: says whether updates arrive live or through the slower /pulse check.
        if (__DEV__) console.info(`[live] ${status}${err ? `: ${err.message}` : ''}`);
        // Lost the channel: check now, then every 3 s, so nothing waits for the 30 s safety net.
        if (live.current && !up) kick.current();
        live.current = up;
      });
    });
    return () => {
      closed = true;
      clearTimeout(flush);
      live.current = false;
      client.removeChannel(channel);
    };
  }, [name, userId, reload]);

  const dispatch = useCallback(
    (a: Action) => {
      const before = latest.current;
      const group = actionGroup(before.state, a);
      const key = ++pendingKey.current;
      const sentAt = ++seq.current;
      // Shown at once, on top of the group as it was before (see withPending), until the server's own
      // record of it is in. Several quick changes in one group share the same starting point.
      setPending((list) => {
        const open = group ? list.find((p) => p.group === group && !settled(p, loadedRef.current)) : undefined;
        const base = !group ? undefined : open ? open.base : (loadedRef.current[group] ?? null);
        return [...list, { key, action: a, group, sentAt, base }];
      });
      // One at a time, in the order they were made: an Undo must not reach the server before the change it undoes.
      const sent = queue.current.then(() => perform(a, before));
      queue.current = sent.catch(() => {});
      sent
        .catch((err) => setError(words(err)))
        .then(() => {
          const doneAt = ++seq.current;
          setPending((list) => list.map((p) => (p.key === key ? { ...p, doneAt } : p)));
          return reload(group ? [group] : undefined);
        })
        .finally(() => {
          // Ungrouped changes have nothing to wait for; grouped ones are dropped below once confirmed.
          setPending((list) => (group ? list.map((p) => (p.key === key ? { ...p, reloaded: true } : p)) : list.filter((p) => p.key !== key)));
        });
    },
    [reload],
  );
  // A group's changes are let go together, once all of them are confirmed, so none is drawn on a
  // snapshot that doesn't have the others.
  useEffect(() => {
    const done = [...new Set(pending.map((p) => p.group))].filter((g) => g && pending.every((p) => p.group !== g || settled(p, snaps)));
    if (done.length) setPending((list) => list.filter((p) => !done.includes(p.group) || !settled(p, snaps)));
  }, [snaps, pending]);

  const addReceipt = useCallback(
    async (expenseId: string, file: ReceiptFile) => {
      const group = latest.current.state.expenses.find((e) => e.id === expenseId)?.groupId;
      const res = await uploadReceipt(expenseId, uuidv7(), file.blob, file.type, file.width && file.height ? { width: file.width, height: file.height } : undefined);
      await reload(group ? [group] : undefined);
      return { duplicateOf: (res.duplicateOf ?? null) as DuplicateOf | null };
    },
    [reload],
  );

  const run = useCallback(async (a: Action) => {
    await perform(a, latest.current);
  }, []);
  const refresh = useCallback(async (groupIds?: string[]) => {
    await reload(groupIds);
  }, [reload]);

  const markSeen = useCallback((groupId: string, items: SeenItem[]) => {
    const key = (x: SeenItem) => `${groupId}|${x.type}|${x.id}|${x.version ?? ''}|${x.upTo ?? ''}`;
    const fresh = items.filter((x) => !seenSent.current.has(key(x)));
    if (!fresh.length) return;
    for (const x of fresh) seenSent.current.add(key(x));
    const at = new Date().toISOString();
    setSeenLocally((list) => [...list.filter((m) => !fresh.some((x) => x.type === m.type && x.id === m.id)), ...fresh.map((x) => ({ groupId, by: ME, type: x.type, id: x.id, version: x.version, at }))]);
    sendSeen(groupId, fresh.map(({ upTo: _, ...x }) => x), latest.current).catch(() => {
      for (const x of fresh) seenSent.current.delete(key(x));
    });
  }, []);

  const account: Account = {
    status: session === undefined || (session && name === undefined) ? 'loading' : !session ? 'signed_out' : name === null ? 'needs_name' : 'ready',
    email: session?.user.email,
    name: name ?? undefined,
    async saveName(displayName) {
      const me = await api.send('PUT', '/me', { displayName });
      setName(me.displayName);
    },
    async signOut() {
      // While still signed in: this device stops getting this person's notifications.
      await forgetThisDevice().catch(() => {});
      await auth.signOut();
      // Websites go back to the landing page; the phone apps show sign-in.
      if (Platform.OS === 'web') window.location.assign('/');
    },
    async inviteLink(groupId) {
      const inv = await api.send('POST', `/groups/${groupId}/invites`, {});
      return `${appUrl()}/join#t=${inv.token}`;
    },
    async revokeInvites(groupId) {
      return (await api.send('POST', `/groups/${groupId}/invites/revoke-all`)).revoked as number;
    },
    preview: (token) => api.send('POST', '/invites/preview', { token }),
    async join(token, claimMemberId, displayName) {
      const d = await api.send('POST', '/invites/accept', { token, claimMemberId, displayName: claimMemberId ? undefined : displayName });
      await reload();
      return d.group.id as string;
    },
  };

  return (
    <StoreContext.Provider value={{
        state: remote.state,
        dispatch,
        run,
        refresh,
        features: remote.features,
        addReceipt,
        receiptUrl: remoteReceiptUrl,
        markSeen,
        account,
        sync,
        error,
        clearError: () => setError(null),
      }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** The signed-in person's name (demo: the seeded "me"). */
export function useMyName(): string {
  const { state, account } = useStore();
  return account?.name ?? state.members[ME]?.name ?? 'You';
}
