import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { Group } from '../src/data/model';
import { uuidv7 } from '../src/data/ids';
import { useMyName, useStore } from '../src/data/StoreProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { Header } from '../src/ui/Header';
import { Avatar, Button, Chip, Field, Label, Screen, T, styles } from '../src/ui/kit';

const KINDS: { kind: Group['kind']; label: string }[] = [
  { kind: 'trip', label: 'Trip' },
  { kind: 'home', label: 'Flat / home' },
  { kind: 'food', label: 'Food & outings' },
];

export default function NewGroup() {
  const { theme } = useTheme();
  const { dispatch } = useStore();
  const myName = useMyName();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Group['kind']>('trip');
  const [people, setPeople] = useState('');
  const names = people
    .split(',')
    .map((n) => n.trim())
    .filter((n, i, all) => n !== '' && all.indexOf(n) === i);
  const valid = name.trim() !== '' && names.length > 0;
  const create = () => {
    if (!valid) return;
    // The app picks the id, so the new group can open at once and a resent request can't create two.
    const id = uuidv7();
    dispatch({ type: 'add_group', id, name: name.trim(), kind, memberNames: names });
    router.replace(`/group/${id}`);
  };

  return (
    <Screen maxWidth={560} footer={<Button title="Create group" disabled={!valid} onPress={create} />}>
      <Header title="New group" />
      <View style={{ gap: 8 }}>
        <Label>Group name</Label>
        <Field accessibilityLabel="Group name" placeholder="e.g. Manali trip" value={name} onChangeText={setName} autoFocus returnKeyType="next" />
      </View>
      <View style={{ gap: 8 }}>
        <Label>What is it for?</Label>
        <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
          {KINDS.map((k) => (
            <Chip key={k.kind} label={k.label} on={kind === k.kind} onPress={() => setKind(k.kind)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Label>Who's in? (besides you)</Label>
        <Field accessibilityLabel="Friends' names, separated by commas" placeholder="Bilal, Chitra, Dev" value={people} onChangeText={setPeople} onSubmitEditing={create} returnKeyType="done" />
        {names.length ? (
          <View style={[styles.row, { flexWrap: 'wrap', gap: 10 }]}>
            {['You', ...names].map((n, i) => (
              <View key={`${n}${i}`} style={[styles.row, { gap: 6 }]}>
                <Avatar name={i === 0 ? myName : n} size={26} />
                <T size={14} weight="semibold">
                  {n}
                </T>
              </View>
            ))}
          </View>
        ) : null}
        <T size={13} color={theme.c.muted}>
          Separate names with commas. Friends can join with an invite link later and take over their name.
        </T>
      </View>
    </Screen>
  );
}
