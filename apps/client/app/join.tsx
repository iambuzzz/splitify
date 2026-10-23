import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { takePendingInvite } from '../src/data/invite';
import { type InvitePreview, useStore } from '../src/data/StoreProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { Header } from '../src/ui/Header';
import { Button, Chip, Field, Label, Screen, T, styles } from '../src/ui/kit';

/** The token is in the link's #fragment on the web (never sent to any server), or ?t= in app links. */
function useInviteToken(): string | undefined {
  const { t } = useLocalSearchParams<{ t?: string }>();
  if (t) return t;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URLSearchParams(window.location.hash.slice(1)).get('t') ?? undefined;
  }
  return undefined;
}

export default function Join() {
  const { theme } = useTheme();
  const { account } = useStore();
  const token = useInviteToken();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [claim, setClaim] = useState<string | undefined>(undefined);
  /** Joining as new: the name to use in this group (my profile name to start with). */
  const [newName, setNewName] = useState(account?.name ?? '');
  /** A join the API refused (the link itself still works). */
  const [joinProblem, setJoinProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  useEffect(() => {
    if (!account || !token) return;
    account
      .preview(token)
      .then((p) => {
        setInvite(p);
        // A friend already added me under my own name: that's most likely me.
        const mine = account.name ? p.placeholders.find((x) => same(x.displayName, account.name!)) : undefined;
        if (mine) setClaim(mine.id);
      })
      .catch((err) => setProblem(err instanceof Error ? err.message : 'This invite link is not valid any more'));
    // Once per link: `account` is a new object on every render.
  }, [token]);

  const join = async () => {
    if (!account || !token) return;
    setBusy(true);
    setJoinProblem(null);
    try {
      const groupId = await account.join(token, claim, claim ? undefined : newName.trim());
      takePendingInvite(); // used up
      // Keep the token out of the address bar and browser history from here on.
      if (Platform.OS === 'web') window.history.replaceState(null, '', '/');
      router.replace(`/group/${groupId}`);
    } catch (err) {
      setJoinProblem(err instanceof Error ? err.message : 'Could not join. Try again');
      setBusy(false);
    }
  };

  if (!account) {
    return (
      <Screen maxWidth={480}>
        <Header title="Join a group" />
        <T>Invite links work once you sign in. This copy of the app runs on demo data.</T>
      </Screen>
    );
  }

  // Joining as new under a name a placeholder already has would be refused: say so before tapping.
  const clash = !claim && invite ? invite.placeholders.find((p) => same(p.displayName, newName)) : undefined;
  const nameOk = !!claim || (newName.trim().length > 0 && newName.trim().length <= 60 && !clash);

  return (
    <Screen
      maxWidth={480}
      footer={invite ? <Button title={busy ? 'Joining…' : `Join ${invite.name}`} disabled={busy || !nameOk} onPress={join} /> : undefined}
    >
      <Header title="Join a group" />
      {!token ? <T>This link is missing its invite code. Ask for a new link.</T> : null}
      {problem ? (
        <View accessibilityRole="alert" style={{ gap: 12 }}>
          <T size={15} color={theme.c.owe}>
            {problem}
          </T>
          <Button title="Go to my groups" variant="secondary" size="md" onPress={() => router.replace('/')} />
        </View>
      ) : null}
      {token && !invite && !problem ? <ActivityIndicator color={theme.c.primary} /> : null}
      {invite ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <T size={24} weight="heavy">
              {invite.name}
            </T>
            <T size={14} color={theme.c.muted}>
              {invite.memberCount} {invite.memberCount === 1 ? 'person' : 'people'} so far
            </T>
          </View>
          {invite.placeholders.length ? (
            <View style={{ gap: 8 }}>
              <Label>Are you one of these?</Label>
              <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
                {invite.placeholders.map((p) => (
                  <Chip key={p.id} label={p.displayName} on={claim === p.id} onPress={() => setClaim(claim === p.id ? undefined : p.id)} />
                ))}
                <Chip label="No, I'm new" on={claim === undefined} onPress={() => setClaim(undefined)} />
              </View>
              <T size={13} color={theme.c.muted}>
                Pick your name if a friend already added you, so the expenses they entered for you become yours.
              </T>
            </View>
          ) : null}
          {!claim ? (
            <View style={{ gap: 8 }}>
              <Label>Your name in this group</Label>
              <Field accessibilityLabel="Your name in this group" value={newName} onChangeText={setNewName} placeholder="e.g. Riya S" maxLength={60} />
              {clash ? (
                <T size={13} color={theme.c.owe}>
                  {`${clash.displayName} is already in this group. If that’s you, tap “${clash.displayName}” above. If not, use a different name here (for example, add your surname).`}
                </T>
              ) : null}
            </View>
          ) : null}
          {joinProblem ? (
            <View accessibilityRole="alert">
              <T size={14} weight="semibold" color={theme.c.owe}>
                {joinProblem}
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
