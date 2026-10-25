import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Header } from './Header';
import { Button, Screen, T } from './kit';

/**
 * Stands in for a page whose group (or expense, or person) isn't in the app's data: still loading,
 * the server can't be reached, or it really isn't there (deleted, or I was removed).
 */
export function Missing({ what = 'group', back = '/groups' }: { what?: 'group' | 'expense' | 'person'; back?: string }) {
  const { theme } = useTheme();
  const { sync } = useStore();
  const waiting = sync !== 'ready';
  const gone = {
    group: ['This group isn’t here', 'It may have been deleted, or you were removed from it.'],
    expense: ['This expense isn’t here', 'It may have been deleted. Deleted expenses stay in the group’s history.'],
    person: ['This person isn’t in the group', 'They may have left, or the link is old.'],
  }[what];
  return (
    <Screen maxWidth={560}>
      <Header back={back} />
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 56 }}>
        {waiting ? (
          <>
            <ActivityIndicator color={theme.c.primary} />
            <T size={15} color={theme.c.muted}>
              {sync === 'offline' ? 'Can’t reach Splitify right now. Trying again…' : 'Loading…'}
            </T>
          </>
        ) : (
          <>
            <T size={20} weight="heavy" style={{ textAlign: 'center' }}>
              {gone[0]}
            </T>
            <T size={15} color={theme.c.muted} style={{ textAlign: 'center', maxWidth: 360 }}>
              {gone[1]}
            </T>
            <View style={{ marginTop: 8 }}>
              <Button title="Go home" size="md" variant="secondary" onPress={() => router.replace('/groups')} />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

/** Stands in for adding or importing expenses once the group is finished (or closed). */
export function Finished({ groupId, closed }: { groupId: string; closed: boolean }) {
  const { theme } = useTheme();
  return (
    <Screen maxWidth={560}>
      <Header back={`/group/${groupId}`} />
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 56 }}>
        <T size={20} weight="heavy" style={{ textAlign: 'center' }}>
          {closed ? 'This group is closed' : 'This group is finished'}
        </T>
        <T size={15} color={theme.c.muted} style={{ textAlign: 'center', maxWidth: 360 }}>
          {closed ? 'Everyone is square, so nothing can change now.' : 'Only payments now: expenses can’t be added or changed.'} An owner or admin can reopen it.
        </T>
        <View style={{ marginTop: 8 }}>
          <Button title="Back to the group" size="md" variant="secondary" onPress={() => router.replace(`/group/${groupId}` as never)} />
        </View>
      </View>
    </Screen>
  );
}
