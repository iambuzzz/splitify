import { View } from 'react-native';
import { type Change, type Expense, inr, methodWords, sharesFor, versionChanges } from '../data/model';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './kit';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One change as a line: "Amount ₹1,200 → ₹900", "Bilal's share ₹300 → ₹450", "Chitra added · ₹300". */
export function changeText(c: Change, name: (id: string) => string): string {
  const whose = (id: string) => (name(id) === 'You' ? 'Your share' : `${name(id)}'s share`);
  switch (c.kind) {
    case 'amount':
      return `Amount ${inr(c.from)} → ${inr(c.to)}`;
    case 'title':
      return `Name “${c.from}” → “${c.to}”`;
    case 'payer':
      return `Paid by ${name(c.from)} → ${name(c.to)}`;
    case 'method':
      return `Split ${methodWords(c.from)} → ${methodWords(c.to)}`;
    case 'share':
      return `${whose(c.member)} ${inr(c.from)} → ${inr(c.to)}`;
    case 'added':
      return `${name(c.member)} added · ${inr(c.to)}`;
    case 'removed':
      return `${name(c.member)} removed · was ${inr(c.from)}`;
  }
}

/** The latest edit in one line, for under the amount: "Edited by Dev · Amount ₹1,200 → ₹900". Null for a never-edited expense. */
export function lastEdit(e: Expense, name: (id: string) => string): string | null {
  if (e.versions.length < 2) return null;
  const next = e.versions[e.versions.length - 1]!;
  const prev = e.versions[e.versions.length - 2]!;
  const first = versionChanges(prev, next, e.id)[0];
  return `Edited by ${name(next.by)}${first ? ` · ${changeText(first, name)}` : ''}`;
}

/**
 * Every version of an expense, newest first, each with who made it, when, and exactly what changed:
 * the "nobody's numbers change behind their back" record.
 */
export function History({ expense: e, name }: { expense: Expense; name: (id: string) => string }) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  const rows = e.versions.map((v, i) => ({ v, changes: i === 0 ? null : versionChanges(e.versions[i - 1]!, v, e.id) })).reverse();
  return (
    <View style={{ gap: 0 }}>
      {rows.map(({ v, changes }, i) => {
        const people = (sharesFor(v.total, v.split, e.id) ?? []).filter((x) => x.amount > 0n).length;
        const lines = changes
          ? changes.length
            ? changes.map((c) => changeText(c, name))
            : ['Saved again with no change to the money']
          : [`${inr(v.total)} · split ${methodWords(v.split.method)} among ${people} ${people === 1 ? 'person' : 'people'}`];
        const last = i === rows.length - 1;
        return (
          <View key={v.n} style={{ flexDirection: 'row', gap: 12 }}>
            {/* A small timeline: a dot per version, joined by a line. */}
            <View style={{ alignItems: 'center', width: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: i === 0 ? theme.c.primary : theme.c.borderStrong }} />
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: theme.c.border, marginVertical: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, gap: 3, paddingBottom: last ? 0 : 14 }}>
              <T size={14} weight="bold" mono={receipt}>
                {changes ? `Edited by ${name(v.by)}` : `Added by ${name(v.by)}`}
                <T size={13} color={theme.c.muted}>{`  v${v.n}${v.at ? ` · ${fmtWhen(v.at)}` : ''}`}</T>
              </T>
              {lines.map((l, j) => (
                <T key={j} size={14} color={theme.c.muted} mono={receipt}>
                  {l}
                </T>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
