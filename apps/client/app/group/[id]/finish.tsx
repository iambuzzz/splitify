import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { ME, beforeClosing, groupPhase, inr, isAdmin } from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Button, Card, Divider, Label, Screen, T, isHovered, styles } from '../../../src/ui/kit';

/**
 * Finishing a group (trip over): first a check of what's still open, then no new or changed expenses.
 * Payments go on; the last confirmed one closes the group as paid. Reopening undoes it.
 */
export default function Finish() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state, dispatch } = useStore();
  const group = state.groups.find((g) => g.id === id);
  if (!group) return <Missing />;

  const receipt = theme.family === 'receipt';
  const phase = groupPhase(state, group.id);
  const admin = isAdmin(state, group.id);
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);
  const left = beforeClosing(state, group.id);
  const square = left.transfers.length === 0 && left.awaiting.length === 0;
  const loose = left.questions.length + left.suggestions.length + left.disputes.length;
  const back = () => router.replace(`/group/${group.id}`);

  if (!admin) {
    return (
      <Screen maxWidth={560}>
        <Header back={`/group/${group.id}`} title={phase === 'open' ? 'Finish group' : 'Reopen group'} />
        <Card>
          <T size={15}>Only the group’s owner or an admin can {phase === 'open' ? 'finish' : 'reopen'} {group.name}.</T>
        </Card>
      </Screen>
    );
  }

  if (phase !== 'open') {
    return (
      <Screen maxWidth={560} footer={<Button
            title="Reopen group"
            icon="rotate-ccw"
            onPress={() => {
              dispatch({ type: 'reopen_group', groupId: group.id });
              back();
            }}
          />}>
        <Header back={`/group/${group.id}`} title={receipt ? undefined : 'Reopen group'} />
        <T size={receipt ? 32 : 26} weight="heavy" style={{ letterSpacing: receipt ? -1 : -0.4 }}>
          Reopen {group.name}?
        </T>
        <Card>
          <Point icon="edit-3" text="Everyone can add and change expenses again." />
          <Point icon="list" text={phase === 'closed' ? 'It moves back up to Your groups.' : 'Payments carry on as before.'} />
          <Point icon="flag" text="You can finish it again whenever you like." />
        </Card>
      </Screen>
    );
  }

  const row = (key: string, text: string, href?: string) => (
    <Pressable
      key={key}
      accessibilityRole={href ? 'link' : undefined}
      disabled={!href}
      onPress={() => href && router.push(href as never)}
      style={(st) => [styles.between, { paddingVertical: 6, opacity: isHovered(st) ? 0.8 : 1 }]}
    >
      <T size={15} mono={receipt} style={{ flex: 1 }}>
        {text}
      </T>
      {href ? <Feather name="chevron-right" size={18} color={theme.c.muted} /> : null}
    </Pressable>
  );

  return (
    <Screen
      maxWidth={560}
      footer={
        <Button
          title={square ? 'Finish and close' : 'Finish group'}
          icon="flag"
          onPress={() => {
            dispatch({ type: 'finish_group', groupId: group.id });
            back();
          }}
        />
      }
    >
      <Header back={`/group/${group.id}`} title={receipt ? undefined : 'Finish group'} />
      <T size={receipt ? 32 : 26} weight="heavy" style={{ letterSpacing: receipt ? -1 : -0.4 }}>
        Finish {group.name}?
      </T>

      <Card>
        <Label>What happens</Label>
        <Point icon="slash" text="No new expenses or changes from now on." />
        <Point icon="check-circle" text="Everyone can still record and confirm payments." />
        <Point
          icon="archive"
          text={square ? 'Everyone is already square, so it closes right away as Paid.' : 'When the last payment is confirmed, it closes as Paid and moves to Closed.'}
        />
        <Point icon="rotate-ccw" text="You can reopen it any time." />
      </Card>

      <Card tear>
        <Label>Before you finish</Label>
        {square ? (
          <View style={[styles.row, { gap: 8 }]}>
            <Feather name="check" size={18} color={theme.c.get} />
            <T size={15} weight="semibold" color={theme.c.get}>
              Everyone is square.
            </T>
          </View>
        ) : (
          <>
            {left.transfers.length ? (
              <T size={13} weight="bold" color={theme.c.muted}>
                Still to pay
              </T>
            ) : null}
            {left.transfers.map((t) => row(`${t.from}${t.to}`, `${name(t.from)} → ${name(t.to)}  ${inr(t.amount)}`, `/group/${group.id}/settle`))}
            {left.awaiting.length ? (
              <T size={13} weight="bold" color={theme.c.muted}>
                Waiting for a confirmation
              </T>
            ) : null}
            {left.awaiting.map((p) => row(p.id, `${name(p.from)} says they paid ${name(p.to)} ${inr(p.amount)}`, `/group/${group.id}/settle`))}
          </>
        )}
        {loose ? (
          <>
            <Divider />
            <T size={13} weight="bold" color={theme.c.muted}>
              Still open (sort them out first, or finish anyway)
            </T>
            {left.questions.map((q) => row(q.message.id, `Question on ${q.expense.title}: “${q.message.text}”`, `/group/${group.id}/expense/${q.expense.id}`))}
            {left.suggestions.map((x) => row(x.suggestion.id, `${name(x.suggestion.by)} suggested ${x.expense.title} at ${inr(x.suggestion.total)}`, `/group/${group.id}/expense/${x.expense.id}`))}
            {left.disputes.map((d) => row(`${d.expense.id}${d.by}`, `${name(d.by)} flagged ${d.expense.title}`, `/group/${group.id}/expense/${d.expense.id}`))}
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

function Point({ icon, text }: { icon: ComponentProps<typeof Feather>['name']; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, { gap: 10, alignItems: 'flex-start' }]}>
      <Feather name={icon} size={17} color={theme.c.muted} style={{ marginTop: 2 }} />
      <T size={15} style={{ flex: 1 }}>
        {text}
      </T>
    </View>
  );
}
