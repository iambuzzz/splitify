import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { ME, betweenMe, inr, newMarks } from '../data/model';
import { useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar, T } from './kit';

/**
 * Phones have no sidebar, so the group page lists its people in a row: tap someone to settle up and
 * chat privately. A dot marks a new private message; the amount is what's between the two of you.
 */
export function PeopleStrip({ groupId }: { groupId: string }) {
  const { theme } = useTheme();
  const { state } = useStore();
  const people = (state.roster[groupId] ?? []).filter((m) => m.active && m.id !== ME);
  const marks = newMarks(state);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
      {people.map((m) => {
        const name = state.members[m.id]?.name ?? 'Member';
        const b = betweenMe(state, groupId, m.id);
        const isNew = marks.people.has(`${groupId}|${m.id}`);
        return (
          <Pressable
            key={m.id}
            accessibilityRole="link"
            accessibilityLabel={`You and ${name}${b > 0n ? `, pays you ${inr(b)}` : b < 0n ? `, you pay ${inr(-b)}` : ''}${isNew ? ', something new' : ''}`}
            onPress={() => router.push(`/group/${groupId}/with/${m.id}`)}
            style={{ width: 64, alignItems: 'center', gap: 3 }}
          >
            <View>
              <Avatar name={name} size={46} />
              {isNew ? (
                <View style={{ position: 'absolute', right: -1, top: -1, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.c.primary, borderWidth: 2, borderColor: theme.c.bg }} />
              ) : null}
            </View>
            <T size={12} weight={isNew ? 'bold' : 'semibold'} numberOfLines={1}>
              {name}
            </T>
            <T size={11} weight="semibold" numberOfLines={1} color={b > 0n ? theme.c.get : b < 0n ? theme.c.owe : theme.c.muted}>
              {b === 0n ? 'even' : inr(b, { sign: true })}
            </T>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="link" accessibilityLabel="Manage members" onPress={() => router.push(`/group/${groupId}/members`)} style={{ width: 64, alignItems: 'center', gap: 3 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.c.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="user-plus" size={18} color={theme.c.muted} />
        </View>
        <T size={12} weight="semibold" color={theme.c.muted}>
          Members
        </T>
      </Pressable>
    </ScrollView>
  );
}
