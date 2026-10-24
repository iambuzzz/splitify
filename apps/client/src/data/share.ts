import { type Expense, type State, ME, current, groupExpenses, inr, sharesFor, splitWords, transfersOf } from './model';

/**
 * Text for sharing to WhatsApp. Amounts are left out unless asked for (a forwarded message can end up
 * anywhere); the link opens the exact page, and people who aren't signed in sign in first.
 */

const nameIn = (s: State) => (id: string) => s.members[id]?.name ?? id;

/** "Goa Trip on Splitify: 6 expenses. To settle up: • Bilal pays Asha ₹300 …" plus the link. */
export function groupSummaryText(s: State, groupId: string, link: string, amounts: boolean): string {
  const group = s.groups.find((g) => g.id === groupId);
  if (!group) return link;
  const name = nameIn(s);
  const expenses = groupExpenses(s, groupId);
  const spent = expenses.reduce((a, e) => a + current(e).total, 0n);
  const plan = transfersOf(s, groupId);
  const lines = [
    `${group.name} on Splitify`,
    `${expenses.length} expense${expenses.length === 1 ? '' : 's'}${amounts ? ` · ${inr(spent)} spent` : ''}`,
    '',
    plan.length ? 'To settle up:' : 'Everyone is settled up.',
    ...plan.map((t) => `• ${name(t.from)} pays ${name(t.to)}${amounts ? ` ${inr(t.amount)}` : ''}`),
    '',
    'See the details:',
    link,
  ];
  return lines.join('\n');
}

/** "Hotel in Goa Trip: paid by Asha, split by shares among 4 (your share ₹1,650)" plus the link. */
export function expenseShareText(s: State, e: Expense, link: string, amounts: boolean): string {
  const group = s.groups.find((g) => g.id === e.groupId);
  const name = nameIn(s);
  const v = current(e);
  const people = (sharesFor(v.total, v.split, e.id) ?? []).filter((x) => x.amount > 0n).length;
  const head = `${e.title}${amounts ? ` · ${inr(v.total)}` : ''} in ${group?.name ?? 'our group'} on Splitify`;
  const detail = `Paid by ${e.payer === ME ? name(ME) : name(e.payer)}, split ${splitWords(v.split)} among ${people}.`;
  return [head, detail, '', 'Have a look, and ask there if something seems off:', link].join('\n');
}
