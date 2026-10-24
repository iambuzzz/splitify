import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ME, type Expense, balanceOf, current, inr, memberName, percentText, reducer, sharesFor, splitWords } from '../data/model';
import { uuidv7 } from '../data/ids';
import { expenseShareText } from '../data/share';
import { appUrl, useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar, BigAmount, Button, Card, CategoryIcon, Divider, Label, Note, T, styles } from '../ui/kit';
import { History, lastEdit } from '../ui/History';
import { Receipts } from '../ui/Receipts';
import { ShareSheet } from '../ui/ShareSheet';
import { Thread, seenLine } from '../ui/Thread';

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** One expense: who owes what, open suggestions, its thread and history. Used as a page and as the laptop side panel. */
export function ExpenseDetail({ expense: e }: { expense: Expense }) {
  const { theme } = useTheme();
  const { state, dispatch, markSeen } = useStore();
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const receipt = theme.family === 'receipt';
  const v = current(e);
  const owner = e.payer === ME;
  const name = (id: string) => (id === ME ? 'You' : state.members[id]?.name ?? id);
  const shares = sharesFor(v.total, v.split, e.id) ?? [];
  // What each person put in for a shares or percentage split ("2 shares", "25%"); nothing for equal or exact.
  const inputOf = (id: string) => {
    if (v.split.method === 'shares') {
      const n = v.split.shares[id] ?? 0;
      return receipt ? ` ×${n}` : ` · ${n} share${n === 1 ? '' : 's'}`;
    }
    if (v.split.method === 'percent') return `${receipt ? ' ' : ' · '}${percentText(v.split.basisPoints[id] ?? 0)}`;
    return null;
  };
  const myDispute = e.disputes.some((d) => d.by === ME);
  const meta = `${fmtDate(e.date)} · paid by ${name(e.payer).toLowerCase() === 'you' ? 'you' : name(e.payer)} · split ${splitWords(v.split)}`;
  // Opening an expense marks its current version (and its thread) as seen by me.
  useEffect(() => {
    if (e.canChat) markSeen(e.groupId, [{ type: 'expense', id: e.id, version: v.n, upTo: e.messages.at(-1)?.id }]);
  }, [e.id, e.groupId, e.canChat, v.n, e.messages, markSeen]);
  const seenBy = state.seen
    .filter((x) => x.type === 'expense' && x.id === e.id && x.by !== ME && (x.version ?? 0) >= v.n)
    .filter((x) => !e.messages.length || x.at >= e.messages[e.messages.length - 1]!.at)
    .map((x) => name(x.by));
  // Deleting can reopen settled balances (payments stay confirmed), so say what will change first.
  const before = balanceOf(state, e.groupId);
  const after = balanceOf(reducer(state, { type: 'delete', id: e.id }), e.groupId);
  const describe = (b: bigint) => (b === 0n ? 'settled' : b > 0n ? `you get ${inr(b)}` : `you owe ${inr(-b)}`);
  const edited = lastEdit(e, name);
  const editedLine = edited ? (
    <Pressable accessibilityRole="button" accessibilityLabel="See what changed" onPress={() => setShowHistory(true)}>
      <T size={13} weight="semibold" color={theme.c.get} mono={receipt}>
        {edited}
      </T>
    </Pressable>
  ) : null;

  const breakdown = (
    <View style={{ gap: 8 }}>
      {shares.map((s) => {
        const input = inputOf(s.memberId);
        return (
          <View key={s.memberId} style={styles.between}>
            <T mono={receipt} size={15}>
              {receipt ? `${name(s.memberId).toUpperCase()}${input ?? ''}` : name(s.memberId)}
              {!receipt && input !== null ? <T size={15} color={theme.c.muted}>{input}</T> : null}
            </T>
            <T mono={receipt} size={15} weight="semibold">
              {inr(s.amount, { symbol: !receipt })}
            </T>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      {receipt ? (
        <Card tear>
          <T size={30} weight="heavy" style={{ letterSpacing: -1 }}>
            {e.title}
            {e.deleted ? ' (deleted)' : ''}
          </T>
          <Label>{meta}</Label>
          {editedLine}
          <Divider />
          {breakdown}
          <Divider />
          <View style={styles.between}>
            <T mono weight="bold">
              TOTAL
            </T>
            <BigAmount size={34} color={theme.c.text}>
              {inr(v.total)}
            </BigAmount>
          </View>
        </Card>
      ) : (
        <>
          <View style={styles.row}>
            <CategoryIcon icon={e.icon} size={52} />
            <View style={{ flex: 1 }}>
              <T size={15} color={theme.c.muted}>
                {e.title}
                {e.deleted ? ' (deleted)' : ''}
              </T>
              <BigAmount size={32} color={theme.c.text}>
                {inr(v.total)}
              </BigAmount>
              <T size={13} color={theme.c.muted}>
                {meta}
              </T>
              {editedLine}
            </View>
          </View>
        </>
      )}

      {e.disputes.map((d) => (
        <T key={d.by} size={14} weight="bold" color={theme.c.owe}>
          {name(d.by)} flagged this: {d.reason}
        </T>
      ))}

      {e.suggestions
        .filter((s) => s.status === 'open')
        .map((s) => (
          <Note key={s.id} tilt={-1}>
            <View style={styles.row}>
              <Avatar name={memberName(state, s.by)} size={28} />
              <T size={15} weight="bold" color={theme.c.attnText} style={{ flex: 1 }}>
                {s.by === ME ? 'You suggested a change' : `${name(s.by)} suggests a change`}
              </T>
            </View>
            <View style={[styles.row, { gap: 10 }]}>
              <View style={{ flex: 1, backgroundColor: receipt ? 'transparent' : theme.c.surfaceAlt, borderRadius: 12, padding: receipt ? 0 : 10 }}>
                <T size={12} color={receipt ? theme.c.attnText : theme.c.muted}>
                  Now
                </T>
                <T size={18} weight="bold" color={receipt ? theme.c.attnText : theme.c.muted} style={{ textDecorationLine: 'line-through' }}>
                  {inr(v.total)}
                </T>
              </View>
              <T size={18} color={receipt ? theme.c.attnText : theme.c.muted}>
                →
              </T>
              <View style={{ flex: 1, backgroundColor: receipt ? 'transparent' : theme.c.tint, borderRadius: 12, padding: receipt ? 0 : 10 }}>
                <T size={12} color={receipt ? theme.c.attnText : theme.c.get}>
                  Suggested
                </T>
                <T size={18} weight="heavy" color={receipt ? theme.c.attnText : theme.c.get}>
                  {inr(s.total)}
                </T>
              </View>
            </View>
            {s.reason ? (
              <T size={14} color={theme.c.attnText} style={{ fontStyle: 'italic' }}>
                “{s.reason}”
              </T>
            ) : null}
            {owner ? (
              <View style={[styles.row, { gap: 10 }]}>
                <Button title="Accept" size="md" flex={1} onPress={() => dispatch({ type: 'decide', id: e.id, suggestionId: s.id, accept: true })} />
                <Button title="Keep as is" size="md" variant="secondary" flex={1} onPress={() => dispatch({ type: 'decide', id: e.id, suggestionId: s.id, accept: false })} />
              </View>
            ) : (
              <T size={13} color={theme.c.attnText}>
                Waiting for {name(e.payer)} to accept.
              </T>
            )}
          </Note>
        ))}

      {!receipt ? <Card>{breakdown}</Card> : null}

      <Receipts expense={e} name={name} />

      <Card>
        <Label>{e.canChat ? 'Chat about this expense' : 'Chat'}</Label>
        {e.canChat ? (
          <Thread
            messages={e.messages}
            nameOf={name}
            allowQuestions={!e.deleted}
            seen={seenLine(seenBy)}
            placeholder="Write about this expense…"
            empty="Only the people in this expense see this chat. Ask if something looks off."
            onSend={(text, question) => dispatch({ type: 'post', id: e.id, messageId: uuidv7(), text, question })}
            canResolve={(m) => m.by === ME || owner}
            onResolve={(m) => dispatch({ type: 'resolve', id: e.id, messageId: m.id })}
          />
        ) : (
          <T size={14} color={theme.c.muted}>
            Only the people in this expense can see its chat.
          </T>
        )}
      </Card>

      {confirmDelete && !e.deleted ? (
        <Card style={{ borderColor: theme.c.owe, borderWidth: 1.5 }}>
          <T size={15} weight="bold">
            Delete {e.title}?
          </T>
          <T size={14} color={theme.c.muted}>
            {before === after
              ? 'Your balance stays the same. Everyone in the group can see it was deleted, and you can restore it.'
              : `Your balance in this group changes from ${describe(before)} to ${describe(after)}. Payments already confirmed stay as they are. You can restore it later.`}
          </T>
          <View style={[styles.row, { gap: 10 }]}>
            <Button
              title="Delete"
              size="md"
              variant="danger"
              flex={1}
              onPress={() => {
                dispatch({ type: 'delete', id: e.id });
                setConfirmDelete(false);
              }}
            />
            <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={() => setConfirmDelete(false)} />
          </View>
        </Card>
      ) : !e.deleted ? (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 10 }]}>
          <Button
            title={owner ? 'Edit' : 'Suggest a change'}
            icon={owner ? 'edit-2' : 'git-pull-request'}
            size="md"
            variant="secondary"
            onPress={() => router.push(`/group/${e.groupId}/add?eid=${e.id}&mode=${owner ? 'edit' : 'suggest'}`)}
          />
          <Button title="Share" icon="send" size="md" variant="secondary" onPress={() => setSharing(true)} />
          {owner ? <Button title="Delete" size="md" variant="danger-text" onPress={() => setConfirmDelete(true)} /> : null}
        </View>
      ) : owner ? (
        <Button title="Restore" size="md" variant="secondary" onPress={() => dispatch({ type: 'restore', id: e.id })} />
      ) : null}

      <View style={styles.between}>
        <Pressable accessibilityRole="button" onPress={() => setShowHistory(!showHistory)}>
          <T size={14} weight="bold" color={theme.c.get}>
            {showHistory ? 'Hide history' : e.versions.length > 1 ? `See history (${e.versions.length} versions)` : 'See history'}
          </T>
        </Pressable>
        {!owner && !e.deleted ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => dispatch(myDispute ? { type: 'withdraw_dispute', id: e.id } : { type: 'dispute', id: e.id, reason: 'Something looks wrong' })}
          >
            <T size={14} weight="bold" color={theme.c.owe}>
              {myDispute ? 'Withdraw "something\'s wrong"' : "Something's wrong?"}
            </T>
          </Pressable>
        ) : null}
      </View>
      <ShareSheet
        open={sharing}
        title={`Share ${e.title}`}
        buildText={(amounts) => expenseShareText(state, e, `${appUrl()}/group/${e.groupId}/expense/${e.id}`, amounts)}
        onClose={() => setSharing(false)}
      />
      {showHistory ? (
        <Card>
          <Label>History</Label>
          <History expense={e} name={name} />
        </Card>
      ) : null}
    </View>
  );
}
