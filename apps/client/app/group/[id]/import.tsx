import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { ApiError } from '../../../src/data/api';
import { type ImportItem, type SplitwiseFile, guessPeople, importId, parseSplitwise, planImport } from '../../../src/data/csv';
import { uuidv7 } from '../../../src/data/ids';
import { ME, inr } from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { pickFiles } from '../../../src/ui/files';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Button, Card, Divider, Label, Note, Screen, T, styles } from '../../../src/ui/kit';

const NEW = 'new';
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type Result = { added: number; already: number; failed: { line: number; title: string; why: string }[] };

/**
 * Brings a group over from Splitwise: pick its CSV export, say who each person in it is, check the
 * preview (every row, and that balances come out the same), then import. Importing the same file
 * again adds nothing twice.
 */
export default function ImportSplitwise() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state, run, refresh } = useStore();
  const group = state.groups.find((g) => g.id === id);
  const [file, setFile] = useState<SplitwiseFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [who, setWho] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Preview ids for people who'll be added: stand-ins until the import creates them.
  const memberOf = useMemo(() => Object.fromEntries(Object.entries(who).map(([p, m]) => [p, m === NEW ? `new:${p}` : m])), [who]);
  const items = useMemo(() => (file ? planImport(file, memberOf) : []), [file, memberOf]);

  if (!group) return <Missing />;
  const name = (m: string) => (m.startsWith('new:') ? `${m.slice(4)} (new)` : m === ME ? 'You' : state.members[m]?.name ?? m);

  const choose = async () => {
    setProblem(null);
    const [f] = await pickFiles('.csv,text/csv');
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setProblem('That file is over 2 MB. A Splitwise export is much smaller: check it’s the right file.');
      return;
    }
    try {
      const parsed = parseSplitwise(await f.text());
      if (!parsed.rows.length) throw new Error('No expenses found in this file.');
      const guess = guessPeople(parsed, state, group.id);
      setWho(Object.fromEntries(parsed.people.map((p) => [p, guess[p] ?? NEW])));
      setFile(parsed);
      setFileName(f.name);
      setResult(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  // Balances: what Splitwise says per person, and what the import will add up to.
  const checks = file
    ? file.people.map((p) => {
        const fromFile = file.rows.reduce((a, r) => a + (r.nets[p] ?? 0n), 0n);
        const m = memberOf[p]!;
        const after = items.reduce((a, it) => a + (it.payer === m ? it.total : 0n) - (it.shares[m] ?? 0n), 0n);
        return { p, fromFile, after };
      })
    : [];
  // Two people in the file can't be the same member.
  const chosen = Object.values(who).filter((m) => m !== NEW);
  const clash = chosen.length !== new Set(chosen).size;

  const start = async () => {
    if (!file) return;
    setProblem(null);
    const failed: Result['failed'] = [];
    let added = 0;
    let already = 0;
    try {
      // New people first, so the expenses can name them.
      const real: Record<string, string> = { ...who };
      for (const p of file.people) {
        if (who[p] !== NEW) continue;
        const memberId = uuidv7();
        await run({ type: 'add_member', groupId: group.id, memberId, name: p });
        real[p] = memberId;
      }
      const plan = planImport(file, real);
      const seen = new Map<string, number>();
      setProgress({ done: 0, total: plan.length });
      for (const [i, it] of plan.entries()) {
        const base = `${it.date}|${it.title}|${it.total}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const expenseId = await importId(group.id, it, n);
        // Already here from an earlier import (same row, same id): nothing to send.
        if (state.expenses.some((e) => e.id === expenseId)) {
          already++;
          setProgress({ done: i + 1, total: plan.length });
          continue;
        }
        try {
          await run({ type: 'import_expense', id: expenseId, groupId: group.id, title: it.title, date: it.date, total: it.total, payer: it.payer, shares: it.shares });
          added++;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'already_exists') already++;
          else failed.push({ line: it.line, title: it.title, why: err instanceof Error ? err.message : 'Failed' });
        }
        setProgress({ done: i + 1, total: plan.length });
      }
    } catch (err) {
      setProblem(err instanceof Error ? `Could not add the people from the file: ${err.message}` : 'Could not add the people from the file.');
    }
    await refresh([group.id]).catch(() => {});
    setProgress(null);
    setResult({ added, already, failed });
  };

  if (Platform.OS !== 'web') {
    return (
      <Screen maxWidth={640}>
        <Header back={`/group/${group.id}`} title="Import from Splitwise" />
        <T color={theme.c.muted}>Importing works in the browser for now. Open Splitify on a computer to import a Splitwise file.</T>
      </Screen>
    );
  }

  if (result) {
    return (
      <Screen maxWidth={640} footer={<Button title="Back to the group" onPress={() => router.replace(`/group/${group.id}`)} />}>
        <Header back={`/group/${group.id}`} title="Import from Splitwise" />
        <T size={26} weight="heavy">
          {result.failed.length ? 'Imported, with problems' : 'Imported'}
        </T>
        <Card>
          <T size={15}>{`${result.added} expense${result.added === 1 ? '' : 's'} added`}</T>
          {result.already ? <T size={15} color={theme.c.muted}>{`${result.already} already there from an earlier import (skipped)`}</T> : null}
          {result.failed.map((f) => (
            <T key={`${f.line}${f.title}`} size={14} color={theme.c.owe}>
              {`Line ${f.line}, ${f.title}: ${f.why}`}
            </T>
          ))}
        </Card>
        {result.failed.length ? <T color={theme.c.muted}>You can import the same file again: what’s already in is skipped, and only the rest is tried.</T> : null}
      </Screen>
    );
  }

  const busy = progress !== null;
  const footer = file ? (
    <Button
      title={busy ? `Importing ${progress!.done} of ${progress!.total}…` : `Import ${items.length} expense${items.length === 1 ? '' : 's'}`}
      disabled={busy || clash || items.length === 0}
      onPress={start}
    />
  ) : (
    <Button title="Choose the CSV file" icon="upload" onPress={choose} />
  );

  return (
    <Screen maxWidth={640} footer={footer}>
      <Header back={`/group/${group.id}`} title="Import from Splitwise" />
      {!file ? (
        <>
          <T size={26} weight="heavy">
            Bring your expenses over
          </T>
          <Card>
            <Label>In Splitwise</Label>
            {['Open the group on the Splitwise website.', 'Open its settings and choose “Export as spreadsheet”.', 'Come back here and choose the downloaded .csv file.'].map((step, i) => (
              <View key={i} style={[styles.row, { gap: 10, alignItems: 'flex-start' }]}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.c.tint, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={12} weight="bold">
                    {String(i + 1)}
                  </T>
                </View>
                <T size={15} style={{ flex: 1 }}>
                  {step}
                </T>
              </View>
            ))}
          </Card>
          <T size={14} color={theme.c.muted}>
            You’ll see everything before anything is added. Each expense keeps its date and exact shares; payments come in as “A paid B”, so everyone’s balance matches Splitwise. Only INR rows can be imported into this group.
          </T>
        </>
      ) : (
        <>
          <View style={styles.between}>
            <T size={15} weight="bold" numberOfLines={1} style={{ flex: 1 }}>
              {fileName}
            </T>
            <Button title="Choose another" size="sm" variant="secondary" disabled={busy} onPress={choose} />
          </View>

          <Card>
            <Label>Who is who</Label>
            <T size={13} color={theme.c.muted}>
              Match each name in the file to someone in {group.name}, or add them as a new person (they can claim the name from an invite later).
            </T>
            {file.people.map((p) => (
              <View key={p} style={{ gap: 6, paddingVertical: 4 }}>
                <T size={15} weight="bold">
                  {p}
                </T>
                <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
                  {[...group.members, NEW].map((m) => {
                    const on = who[p] === m;
                    const takenByOther = m !== NEW && Object.entries(who).some(([q, x]) => q !== p && x === m);
                    return (
                      <Pressable
                        key={m}
                        accessibilityRole="radio"
                        aria-checked={on}
                        aria-disabled={takenByOther || busy}
                        disabled={takenByOther || busy}
                        onPress={() => setWho({ ...who, [p]: m })}
                        style={{
                          paddingHorizontal: 12,
                          height: 34,
                          borderRadius: 999,
                          justifyContent: 'center',
                          borderWidth: 1.5,
                          borderColor: on ? theme.c.primary : theme.c.border,
                          backgroundColor: on ? theme.c.primary : 'transparent',
                          opacity: takenByOther ? 0.35 : 1,
                        }}
                      >
                        <T size={13} weight="semibold" color={on ? theme.c.onPrimary : theme.c.text}>
                          {m === NEW ? '+ New person' : m === ME ? `You (${state.members[ME]?.name ?? 'me'})` : name(m)}
                        </T>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </Card>

          <Card>
            <Label>Balances after import</Label>
            {checks.map((c) => {
              const ok = c.fromFile === c.after;
              return (
                <View key={c.p} style={styles.between}>
                  <T size={14} style={{ flex: 1 }}>
                    {c.p}
                  </T>
                  <T size={14} weight="bold" color={ok ? theme.c.text : theme.c.owe}>
                    {`${inr(c.after, { sign: true })} ${ok ? '✓' : `(Splitwise: ${inr(c.fromFile, { sign: true })})`}`}
                  </T>
                </View>
              );
            })}
            <T size={12} color={theme.c.muted}>
              + gets money back · − owes. ✓ means it matches the file. These add to what’s already in this group.
            </T>
          </Card>

          <Card>
            <Label>{`${items.length} expense${items.length === 1 ? '' : 's'} to add`}</Label>
            {items.slice(0, 40).map((it: ImportItem, i) => (
              <View key={i} style={{ paddingVertical: 3 }}>
                <View style={styles.between}>
                  <T size={14} weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                    {it.title}
                  </T>
                  <T size={14} weight="bold">
                    {inr(it.total)}
                  </T>
                </View>
                <T size={12} color={theme.c.muted}>
                  {`${fmtDay(it.date)} · ${name(it.payer)} paid · ${Object.keys(it.shares).length} ${Object.keys(it.shares).length === 1 ? 'person' : 'people'}${it.how === 'split-up' ? ' · several payers, split into parts' : ''}`}
                </T>
              </View>
            ))}
            {items.length > 40 ? <T size={13} color={theme.c.muted}>{`…and ${items.length - 40} more`}</T> : null}
            {file.skipped.length ? (
              <>
                <Divider />
                <Label>{`Skipped (${file.skipped.length})`}</Label>
                {file.skipped.map((s) => (
                  <T key={s.line} size={13} color={theme.c.muted}>
                    {`Line ${s.line}: ${s.reason}`}
                  </T>
                ))}
              </>
            ) : null}
          </Card>
          {clash ? <Note><T size={14} color={theme.c.attnText}>Two names in the file point to the same person. Pick a different person for one of them.</T></Note> : null}
        </>
      )}
      {problem ? (
        <T size={14} weight="semibold" color={theme.c.owe}>
          {problem}
        </T>
      ) : null}
    </Screen>
  );
}
