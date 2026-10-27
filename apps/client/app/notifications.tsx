import { Platform, Pressable, Switch, View } from 'react-native';
import { groupPhase } from '../src/data/model';
import { label } from '../src/data/pushDevice';
import { useStore } from '../src/data/StoreProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { Header } from '../src/ui/Header';
import { Button, Card, Divider, Label, Screen, T } from '../src/ui/kit';
import { KINDS, type Kind, isOn, setPrefs, turnOff, turnOn, useNotifications } from '../src/ui/useNotifications';

/** A setting that's on or off: the whole row toggles it. */
function Row({ title, hint, value, onChange, a11y }: { title: string; hint?: string; value: boolean; onChange: (v: boolean) => void; a11y: string }) {
  const { theme } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={a11y} aria-checked={value} onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={15} weight="bold">
          {title}
        </T>
        {hint ? (
          <T size={13} color={theme.c.muted}>
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.c.border, true: theme.c.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? theme.c.onPrimary : theme.c.surface) : undefined}
        {...(Platform.OS === 'web' ? ({ activeThumbColor: theme.c.onPrimary } as object) : {})}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

/** Notifications on this device: on or off, what to tell you, and which groups to hear from. */
export default function Notifications() {
  const { theme } = useTheme();
  const { state } = useStore();
  const n = useNotifications();
  const on = n.status === 'on';
  const groups = state.groups.filter((g) => groupPhase(state, g.id) !== 'closed');

  const setKind = (kind: Kind, v: boolean) => setPrefs({ ...n.prefs, kinds: { ...n.prefs.kinds, [kind]: v } });
  const setGroup = (id: string, hear: boolean) => setPrefs({ ...n.prefs, muted: hear ? n.prefs.muted.filter((g) => g !== id) : [...n.prefs.muted, id] });

  return (
    <Screen maxWidth={560}>
      <Header title="Notifications" back="/groups" />

      <Card>
        <Label>{`This device · ${label()}`}</Label>
        {n.support === 'unsupported' ? (
          <T size={15} color={theme.c.muted}>
            This browser can’t show notifications. Use Chrome, Edge or Safari, or the Android app.
          </T>
        ) : n.support === 'install-first' ? (
          <T size={15} color={theme.c.muted}>
            On iPhone and iPad, notifications work in the app on your Home Screen. In Safari, tap Share, then Add to Home Screen. Open Splitify from there and come back to this screen.
          </T>
        ) : n.status === 'blocked' ? (
          <T size={15} color={theme.c.muted}>
            {Platform.OS === 'web'
              ? 'Notifications are blocked for Splitify in this browser. Allow them in the site settings (the icon left of the address), then come back here.'
              : 'Notifications are off for Splitify in your phone’s settings. Open Settings, then Apps, Splitify, Notifications, and allow them.'}
          </T>
        ) : on ? (
          <Row title="On" hint="Who did what, never amounts." value a11y="Notifications on this device" onChange={(v) => (v ? turnOn() : turnOff())} />
        ) : (
          <T size={15} color={theme.c.muted}>
            Off. Turn on to hear when someone pays you, suggests a change or asks about a bill. Names only, never amounts.
          </T>
        )}
        {n.busy ? (
          <T size={13} color={theme.c.muted}>
            One moment…
          </T>
        ) : null}
        {n.error ? (
          <T size={13} weight="semibold" color={theme.c.owe}>
            {n.error}
          </T>
        ) : null}
        {n.status === 'off' && n.support === 'ok' ? <Button title="Turn on notifications" icon="bell" size="md" disabled={n.busy} onPress={turnOn} /> : null}
      </Card>

      {on ? (
        <>
          <Card>
            <Label>What to tell you</Label>
            {KINDS.map((k, i) => (
              <View key={k.kind} style={{ gap: 8 }}>
                {i ? <Divider /> : null}
                <Row title={k.title} hint={k.hint} value={isOn(n.prefs, k.kind)} a11y={k.title} onChange={(v) => setKind(k.kind, v)} />
              </View>
            ))}
          </Card>

          {groups.length ? (
            <Card>
              <Label>Groups</Label>
              {groups.map((g, i) => (
                <View key={g.id} style={{ gap: 8 }}>
                  {i ? <Divider /> : null}
                  <Row title={g.name} value={!n.prefs.muted.includes(g.id)} a11y={`Notifications from ${g.name}`} onChange={(v) => setGroup(g.id, v)} />
                </View>
              ))}
            </Card>
          ) : null}

          <T size={13} color={theme.c.muted}>
            Each device has its own settings: your phone can be on while your laptop is off.
          </T>
        </>
      ) : null}
    </Screen>
  );
}
