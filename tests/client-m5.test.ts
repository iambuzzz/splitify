import { describe, expect, it } from 'vitest';
import { groupCsv, guessPeople, importId, parseCsv, parseSplitwise, planImport } from '../apps/client/src/data/csv';
import { ME, type State, balancesOf, current, explainBalance, parsePercent, parseShares, percentText, reducer, seed, sharesFor, splitWords, versionChanges } from '../apps/client/src/data/model';
import { expenseShareText, groupSummaryText } from '../apps/client/src/data/share';

const balances = (s: State, g: string) => Object.fromEntries(balancesOf(s, g).map((b) => [b.memberId, b.amount]));

describe('expense history (M5)', () => {
  it('lists each difference between two versions: amount, name, payer, split and each share', () => {
    const s = seed();
    const taxi = s.expenses.find((e) => e.id === 'e3')!;
    const [v1, v2] = taxi.versions;
    const changes = versionChanges(v1!, v2!, taxi.id);
    expect(changes).toContainEqual({ kind: 'amount', from: 120000n, to: 90000n });
    expect(changes).toContainEqual({ kind: 'title', from: 'Cab', to: 'Taxi' });
    expect(changes).toContainEqual({ kind: 'removed', member: 'chitra', from: 30000n });
    // ₹1,200 among 4 → ₹900 among 3: each remaining share stays ₹300, so no share line for them.
    expect(changes.filter((c) => c.kind === 'share')).toEqual([]);
  });

  it('an edit records who, when, the new name and payer, and the history shows the change', () => {
    let s = seed();
    s = reducer(s, { type: 'edit_expense', id: 'e1', title: 'Hotel Zostel', total: 600000n, payer: ME, split: current(s.expenses.find((e) => e.id === 'e1')!).split });
    const hotel = s.expenses.find((e) => e.id === 'e1')!;
    const v2 = current(hotel);
    expect(v2).toMatchObject({ n: 2, by: ME, title: 'Hotel Zostel', payer: ME });
    expect(v2.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const changes = versionChanges(hotel.versions[0]!, v2, hotel.id);
    expect(changes[0]).toEqual({ kind: 'amount', from: 660000n, to: 600000n });
    expect(changes.some((c) => c.kind === 'share' && c.member === 'bilal')).toBe(true);
  });
});

describe('why do I owe this (M5)', () => {
  it('adds up: paid − share + payments sent − received = balance, for everyone', () => {
    const s = seed();
    for (const g of s.groups) {
      for (const m of g.members) {
        const x = explainBalance(s, g.id, m);
        expect(x.paid - x.share + x.sent - x.received).toBe(x.balance);
        expect(x.expenses.reduce((a, r) => a + r.effect, 0n)).toBe(x.paid - x.share);
      }
    }
  });

  it('explains a payment to someone I never shared a bill with', () => {
    // Asha pays for Bilal; Bilal pays more for Chitra. Pooled, Asha is owed and Chitra owes her.
    let s = seed();
    s = reducer(s, { type: 'add_group', id: 'g', name: 'G', memberNames: ['B', 'C'] });
    s = reducer(s, { type: 'add_expense', id: 'x1', groupId: 'g', title: 'A for B', icon: 'other', total: 10000n, payer: ME, split: { method: 'equal', members: ['gm0'] } });
    s = reducer(s, { type: 'add_expense', id: 'x2', groupId: 'g', title: 'B for C', icon: 'other', total: 10000n, payer: 'gm0', split: { method: 'equal', members: ['gm1'] } });
    const x = explainBalance(s, 'g', ME);
    expect(x.balance).toBe(10000n);
    expect(x.plan).toEqual([{ from: 'gm1', to: ME, amount: 10000n }]);
    expect(x.expenses.map((r) => r.title)).toEqual(['A for B']);
  });
});

describe('CSV (M5)', () => {
  it('parses quotes, commas, line breaks, CRLF and a byte-order mark', () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n"line\nbreak",,x\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['line\nbreak', '', 'x'],
    ]);
  });

  it('exports in Splitwise layout, keeps formulas as text, and columns add up to the balances', () => {
    let s = seed();
    s = reducer(s, { type: 'add_expense', id: 'evil', groupId: 'goa', title: '=HYPERLINK("x")', icon: 'food', total: 40000n, payer: 'dev', split: { method: 'equal', members: [ME, 'dev'] } });
    const csv = groupCsv(s, 'goa');
    const rows = parseCsv(csv).filter((r) => r.some((c) => c !== ''));
    expect(rows[0]).toEqual(['Date', 'Description', 'Category', 'Cost', 'Currency', 'Asha', 'Bilal', 'Chitra', 'Dev']);
    expect(rows.find((r) => r[1]!.includes('HYPERLINK'))![1]).toBe(`'=HYPERLINK("x")`);
    const total = rows.at(-1)!;
    expect(total[1]).toBe('Total balance');
    const bal = balances(s, 'goa');
    expect(total.slice(5)).toEqual([ME, 'bilal', 'chitra', 'dev'].map((m) => ((Number(bal[m] ?? 0n) / 100).toFixed(2))));
  });
});

const SPLITWISE = `Date,Description,Category,Cost,Currency,Riya Sharma,Ambuj,Kavita\r
\r
2026-09-01,Hotel,Hotel,3000.00,INR,2000.00,-1000.00,-1000.00\r
2026-09-02,"Dinner, beach",Dining out,1500.00,INR,-500.00,1000.00,-500.00\r
2026-09-03,Ambuj paid Riya Sharma,Payment,500.00,INR,-500.00,500.00,0.00\r
2026-09-04,Fuel (two payers),Gas/fuel,900.00,INR,300.00,300.00,-600.00\r
2026-09-05,Souvenirs,General,50.00,USD,25.00,-25.00,0.00\r
2026-09-06,Broken row,General,100.00,INR,100.00,-50.00,0.00\r
\r
2026-10-24,Total balance, , ,INR,1300.00,800.00,-2100.00\r
`;

describe('Splitwise import (M5)', () => {
  it('reads the export, skips rows it can’t use and says why', () => {
    const f = parseSplitwise(SPLITWISE);
    expect(f.people).toEqual(['Riya Sharma', 'Ambuj', 'Kavita']);
    expect(f.rows.map((r) => r.description)).toEqual(['Hotel', 'Dinner, beach', 'Ambuj paid Riya Sharma', 'Fuel (two payers)']);
    expect(f.rows[2]!.payment).toBe(true);
    expect(f.skipped.map((x) => x.line)).toEqual([7, 8]);
    expect(f.skipped[0]!.reason).toContain('USD');
    expect(f.skipped[1]!.reason).toContain('add up');
    expect(() => parseSplitwise('a,b\n1,2')).toThrow(/Splitwise export/);
  });

  it('plans exact expenses; payments and multi-payer rows keep balances the same', () => {
    const f = parseSplitwise(SPLITWISE);
    const items = planImport(f, { 'Riya Sharma': 'r', Ambuj: 'a', Kavita: 'k' });
    expect(items[0]).toMatchObject({ title: 'Hotel', total: 300000n, payer: 'r', shares: { a: 100000n, k: 100000n, r: 100000n }, how: 'expense' });
    expect(items[2]).toMatchObject({ title: 'Payment: Ambuj paid Riya Sharma', total: 50000n, payer: 'a', shares: { r: 50000n }, how: 'payment' });
    expect(items.filter((i) => i.how === 'split-up')).toHaveLength(2);
    // Net effect per person equals the file's columns.
    const net: Record<string, bigint> = {};
    for (const it of items) {
      net[it.payer] = (net[it.payer] ?? 0n) + it.total;
      for (const [m, v] of Object.entries(it.shares)) net[m] = (net[m] ?? 0n) - v;
    }
    expect(net).toEqual({ r: 130000n, a: 80000n, k: -210000n });
  });

  it('round trip: a group exported and imported into a new group has the same balances', async () => {
    let s = seed();
    s = reducer(s, { type: 'record_payment', groupId: 'goa', from: ME, to: 'dev', amount: 10000n, via: 'cash' });
    const file = parseSplitwise(groupCsv(s, 'goa'));
    // A fresh group with the same names, then the import through the reducer.
    s = reducer(s, { type: 'add_group', id: 'copy', name: 'Copy', memberNames: ['Bilal', 'Chitra', 'Dev'] });
    const guess = guessPeople(file, s, 'copy');
    expect(guess).toEqual({ Asha: ME, Bilal: 'copym0', Chitra: 'copym1', Dev: 'copym2' });
    const items = planImport(file, guess as Record<string, string>);
    for (const [i, it] of items.entries()) {
      s = reducer(s, { type: 'import_expense', id: await importId('copy', it, i), groupId: 'copy', title: it.title, date: it.date, total: it.total, payer: it.payer, shares: it.shares });
    }
    // Imported expenses keep exact amounts (never read as shares).
    const imported = s.expenses.filter((e) => e.groupId === 'copy');
    expect(imported.every((e) => current(e).split.method === 'exact')).toBe(true);
    expect(splitWords(current(imported[0]!).split)).toBe('by exact amounts');
    const map: Record<string, string> = { [ME]: ME, bilal: 'copym0', chitra: 'copym1', dev: 'copym2' };
    const original = balances(s, 'goa');
    const copy = balances(s, 'copy');
    for (const [m, v] of Object.entries(original)) expect(copy[map[m]!] ?? 0n).toBe(v);
  });

  it('gives the same row the same id, so a second import adds nothing', async () => {
    const it = { line: 3, date: '2026-09-01', title: 'Hotel', total: 300000n, payer: 'r', shares: { a: 100000n }, how: 'expense' as const };
    const a = await importId('g1', it, 0);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await importId('g1', it, 0)).toBe(a);
    expect(await importId('g1', it, 1)).not.toBe(a);
    expect(await importId('g2', it, 0)).not.toBe(a);
  });
});

describe('sharing (M5)', () => {
  it('leaves amounts out unless asked, and always ends with the link', () => {
    const s = seed();
    const link = 'https://splitify.example/group/goa/settle';
    const plain = groupSummaryText(s, 'goa', link, false);
    expect(plain).not.toMatch(/₹/);
    expect(plain.trim().endsWith(link)).toBe(true);
    expect(groupSummaryText(s, 'goa', link, true)).toMatch(/pays .+ ₹/);
    const hotel = s.expenses.find((e) => e.id === 'e1')!;
    expect(expenseShareText(s, hotel, 'L', false)).not.toMatch(/₹/);
    expect(expenseShareText(s, hotel, 'L', true)).toContain('₹6,600');
  });
});

describe('ways of splitting', () => {
  it('names each one in words', () => {
    expect(splitWords({ method: 'equal', members: [ME] })).toBe('equally');
    expect(splitWords({ method: 'shares', shares: { [ME]: 1 } })).toBe('by shares');
    expect(splitWords({ method: 'percent', basisPoints: { [ME]: 10000 } })).toBe('by percentage');
    expect(splitWords({ method: 'exact', amounts: { [ME]: 1n } })).toBe('by exact amounts');
  });

  it('splits by percentage only when it adds up to 100%, rounding fairly to the paisa', () => {
    expect(sharesFor(100000n, { method: 'percent', basisPoints: { a: 5000, b: 2500, c: 2500 } }, 'x')).toEqual([
      { memberId: 'a', amount: 50000n },
      { memberId: 'b', amount: 25000n },
      { memberId: 'c', amount: 25000n },
    ]);
    const thirds = sharesFor(10000n, { method: 'percent', basisPoints: { a: 3334, b: 3333, c: 3333, d: 0 } }, 'x')!;
    expect(thirds.reduce((s, x) => s + x.amount, 0n)).toBe(10000n);
    expect(thirds.map((x) => x.memberId)).toEqual(['a', 'b', 'c']);
    expect(sharesFor(10000n, { method: 'percent', basisPoints: { a: 5000, b: 4000 } }, 'x')).toBeNull();
  });

  it('reads typed percentages and shares, and refuses what isn’t one', () => {
    expect(parsePercent('25')).toBe(2500);
    expect(parsePercent('12.5%')).toBe(1250);
    expect(parsePercent('33.33')).toBe(3333);
    expect(parsePercent('')).toBe(0);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(percentText(2500)).toBe('25%');
    expect(percentText(3333)).toBe('33.33%');
    expect(percentText(1250)).toBe('12.5%');
    expect(percentText(10000)).toBe('100%');
    expect(parseShares('2')).toBe(2);
    expect(parseShares('1.5')).toBe(1.5);
    expect(parseShares('-1')).toBeNull();
  });
});
