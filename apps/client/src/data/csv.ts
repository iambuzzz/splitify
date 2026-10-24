import { simplifyDebts } from '@app/ledger';
import { formatAmount, parseAmount } from '@app/money';
import { type ExpenseIcon, type State, current, groupExpenses, balancesOf, sharesFor, ME } from './model';

/**
 * Spreadsheet export and Splitwise import. The export uses Splitwise's own CSV layout (one row per
 * expense or payment, one column per person with what that row did to their balance), so a file
 * from either app can be read back by the importer.
 */

// ---------- CSV basics ----------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * One CSV field. Text that a spreadsheet would run as a formula (=, +, -, @ first) gets a leading
 * apostrophe, so a bill named "=HYPERLINK(…)" stays text. Numbers are written as they are.
 */
function field(value: string, number = false): string {
  const safe = !number && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const money = (minor: bigint) => formatAmount(minor, 'INR');

/** YYYY-MM-DD in the device's own time zone (toISOString would give the UTC date, a day off near midnight in India). */
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const CATEGORY: Record<ExpenseIcon, string> = {
  hotel: 'Hotel',
  food: 'Dining out',
  taxi: 'Taxi',
  home: 'Rent',
  wifi: 'Utilities',
  cart: 'Groceries',
  other: 'General',
};

// ---------- export ----------

/** The group as a spreadsheet: every counted expense and confirmed payment, then everyone's total balance. */
export function groupCsv(s: State, groupId: string): string {
  const group = s.groups.find((g) => g.id === groupId);
  if (!group) return '';
  const expenses = [...groupExpenses(s, groupId)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const payments = s.payments.filter((p) => p.groupId === groupId && p.status === 'confirmed');
  // Current members, then anyone else who appears in a row (people who left).
  const people = [...group.members];
  const seen = new Set(people);
  const note = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      people.push(id);
    }
  };
  const rows: { date: string; title: string; category: string; cost: bigint; nets: Map<string, bigint> }[] = [];
  for (const e of expenses) {
    const v = current(e);
    const nets = new Map<string, bigint>();
    for (const x of sharesFor(v.total, v.split, e.id) ?? []) nets.set(x.memberId, (nets.get(x.memberId) ?? 0n) - x.amount);
    nets.set(e.payer, (nets.get(e.payer) ?? 0n) + v.total);
    for (const id of nets.keys()) note(id);
    rows.push({ date: e.date, title: e.title, category: CATEGORY[e.icon], cost: v.total, nets });
  }
  for (const p of payments) {
    note(p.from);
    note(p.to);
    rows.push({
      date: p.at ? localDate(new Date(p.at)) : '',
      title: `${s.members[p.from]?.name ?? p.from} paid ${s.members[p.to]?.name ?? p.to}`,
      category: 'Payment',
      cost: p.amount,
      nets: new Map([
        [p.from, p.amount],
        [p.to, -p.amount],
      ]),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const names = people.map((id) => s.members[id]?.name ?? id);
  const balances = new Map(balancesOf(s, groupId).map((b) => [b.memberId, b.amount]));
  const lines = [
    ['Date', 'Description', 'Category', 'Cost', 'Currency', ...names].map((x) => field(x)).join(','),
    '',
    ...rows.map((r) =>
      [field(r.date), field(r.title), field(r.category), money(r.cost), 'INR', ...people.map((id) => money(r.nets.get(id) ?? 0n))].join(','),
    ),
    '',
    [field(localDate(new Date())), 'Total balance', '', '', 'INR', ...people.map((id) => money(balances.get(id) ?? 0n))].join(','),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** "Splitify - Goa Trip - 2026-10-24.csv" (characters file systems dislike are dropped). */
export const csvFileName = (groupName: string) => `Splitify - ${groupName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'group'} - ${localDate(new Date())}.csv`;

// ---------- Splitwise import ----------

export interface SplitwiseRow {
  /** Line number in the file (1-based), for messages. */
  line: number;
  date: string;
  description: string;
  category: string;
  cost: bigint;
  currency: string;
  /** Person (as named in the file) → what this row did to their balance: + paid more than their share. */
  nets: Record<string, bigint>;
  payment: boolean;
}

export interface SplitwiseFile {
  people: string[];
  rows: SplitwiseRow[];
  skipped: { line: number; reason: string }[];
}

const signedAmount = (raw: string): bigint => {
  const t = raw.trim().replace(/,/g, '').replace(/^'/, '');
  if (t === '' || t === '-') return 0n;
  const negative = t.startsWith('-');
  const v = parseAmount(negative ? t.slice(1) : t.replace(/^\+/, ''), 'INR');
  return negative ? -v : v;
};

const DATE = /^\d{4}-\d{2}-\d{2}/;

/** Reads a Splitwise group export (or a Splitify one). Rows it can't use are listed with the reason. */
export function parseSplitwise(text: string): SplitwiseFile {
  const table = parseCsv(text);
  const headerAt = table.findIndex((r) => r.map((c) => c.trim().toLowerCase()).slice(0, 5).join('|') === 'date|description|category|cost|currency');
  if (headerAt < 0) throw new Error('This doesn’t look like a Splitwise export. It needs the columns Date, Description, Category, Cost, Currency, then one column per person.');
  const header = table[headerAt]!;
  const people = header.slice(5).map((p) => p.trim()).filter(Boolean);
  if (people.length < 2) throw new Error('The file needs at least two people’s columns after Currency.');
  const rows: SplitwiseRow[] = [];
  const skipped: SplitwiseFile['skipped'] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i]!;
    const line = i + 1;
    if (r.every((c) => c.trim() === '')) continue;
    const description = (r[1] ?? '').trim().replace(/^'/, '');
    if (description.toLowerCase() === 'total balance') continue;
    const date = (r[0] ?? '').trim();
    if (!DATE.test(date)) {
      skipped.push({ line, reason: 'No date' });
      continue;
    }
    const currency = (r[4] ?? '').trim().toUpperCase();
    if (currency !== 'INR') {
      skipped.push({ line, reason: `${description || 'Row'} is in ${currency || 'an unknown currency'}; this group is in INR` });
      continue;
    }
    try {
      const cost = signedAmount(r[3] ?? '');
      const nets: Record<string, bigint> = {};
      let total = 0n;
      people.forEach((p, k) => {
        const v = signedAmount(r[5 + k] ?? '');
        if (v !== 0n) nets[p] = v;
        total += v;
      });
      if (total !== 0n) {
        skipped.push({ line, reason: `${description || 'Row'} doesn’t add up (the people’s columns should total 0)` });
        continue;
      }
      if (cost <= 0n || Object.keys(nets).length === 0) {
        skipped.push({ line, reason: `${description || 'Row'} doesn’t change anyone’s balance` });
        continue;
      }
      rows.push({ line, date: date.slice(0, 10), description: description || 'Imported expense', category: (r[2] ?? '').trim(), cost, currency, nets, payment: (r[2] ?? '').trim().toLowerCase() === 'payment' });
    } catch {
      skipped.push({ line, reason: `${description || 'Row'} has an amount that isn’t a number` });
    }
  }
  return { people, rows, skipped };
}

/** One expense the import will create: paid by one person, with exact shares. */
export interface ImportItem {
  line: number;
  date: string;
  title: string;
  total: bigint;
  payer: string;
  /** Member id → exact share (sums to `total`). */
  shares: Record<string, bigint>;
  /** How the row was read, for the preview. */
  how: 'expense' | 'payment' | 'split-up';
}

/**
 * Turns the file's rows into expenses, given who each person in the file is in the group.
 * - One person paid (the usual case): an expense with exactly the shares Splitwise had.
 * - A payment "A paid B": an expense paid by A that only B is in, so balances end up the same.
 * - Several payers: split into "X paid for Y" parts that add up to the same balances.
 */
export function planImport(file: SplitwiseFile, memberOf: Record<string, string>): ImportItem[] {
  const out: ImportItem[] = [];
  for (const r of file.rows) {
    const nets = Object.entries(r.nets).map(([person, amount]) => ({ id: memberOf[person]!, amount }));
    const payers = nets.filter((n) => n.amount > 0n);
    if (payers.length === 1) {
      const payer = payers[0]!;
      const shares: Record<string, bigint> = {};
      let others = 0n;
      for (const n of nets) {
        if (n.amount < 0n) {
          shares[n.id] = (shares[n.id] ?? 0n) - n.amount;
          others -= n.amount;
        }
      }
      // A payment row's cost is the amount sent; for an expense, the payer's own share is what's left.
      const own = r.payment ? 0n : r.cost - others;
      if (own >= 0n) {
        if (own > 0n) shares[payer.id] = (shares[payer.id] ?? 0n) + own;
        out.push({ line: r.line, date: r.date, title: r.payment ? `Payment: ${r.description}` : r.description, total: others + own, payer: payer.id, shares, how: r.payment ? 'payment' : 'expense' });
        continue;
      }
    }
    // Several payers (or numbers that don't fit one payer): who-owes-whom parts with the same effect.
    const transfers = simplifyDebts(nets.map((n) => ({ memberId: n.id, amount: n.amount })));
    transfers.forEach((t, k) => {
      out.push({
        line: r.line,
        date: r.date,
        title: transfers.length > 1 ? `${r.description} (part ${k + 1} of ${transfers.length})` : r.description,
        total: t.amount,
        payer: t.to,
        shares: { [t.from]: t.amount },
        how: 'split-up',
      });
    });
  }
  return out;
}

/** Suggests who each person in the file is: a group member with the same name (any case), you for your own name. */
export function guessPeople(file: SplitwiseFile, s: State, groupId: string): Record<string, string | null> {
  const group = s.groups.find((g) => g.id === groupId);
  const byName = new Map<string, string>();
  for (const id of group?.members ?? []) byName.set((s.members[id]?.name ?? '').trim().toLowerCase(), id);
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const p of file.people) {
    const id = byName.get(p.trim().toLowerCase()) ?? (p.trim().toLowerCase() === 'you' ? ME : undefined);
    out[p] = id && !used.has(id) ? id : null;
    if (id) used.add(id);
  }
  return out;
}

// Browser APIs (also in Node 20+), typed here so this file needs no DOM types.
const web = globalThis as unknown as {
  crypto: { subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(s: string): Uint8Array };
};

/**
 * A stable id for an imported row (a UUID made from the group, the row's content and how many
 * identical rows came before it), so importing the same file twice doesn't add anything twice.
 */
export async function importId(groupId: string, item: ImportItem, occurrence: number): Promise<string> {
  const key = [groupId, item.date, item.title, item.total.toString(), item.payer, ...Object.entries(item.shares).sort().map(([k, v]) => `${k}=${v}`), occurrence].join('|');
  const bytes = new Uint8Array(await web.crypto.subtle.digest('SHA-256', new web.TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8: custom, name-based
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
