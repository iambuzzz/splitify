#!/usr/bin/env python3
"""Independent reference implementation of the split / rounding / conversion spec.

Written separately from the TypeScript engine (packages/money, packages/ledger) and used to
generate golden vectors that the engine must reproduce exactly (invariant I10). Python's
arbitrary-precision ints play the role of bigint. Standard library only.

    python3 tools/reference/oracle.py > packages/ledger/test/golden/vectors.json
"""
import json
import random

EXPONENT = {"INR": 2, "USD": 2, "EUR": 2, "JPY": 0, "KWD": 3}
MASK = 0xFFFFFFFF


def tie_break(seed: str, key: str) -> int:
    """FNV-1a over UTF-16 code units, then the murmur3 32-bit finaliser."""
    data = f"{seed}:{key}".encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & MASK
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & MASK
    h ^= h >> 16
    return h


def allocate(total: int, weights: list[int], keys: list[str], seed: str) -> list[int]:
    if total < 0:
        return [-p for p in allocate(-total, weights, keys, seed)]
    w = sum(weights)
    parts = [total * x // w for x in weights]
    rems = [total * x % w for x in weights]
    leftover = total - sum(parts)
    order = sorted(range(len(keys)), key=lambda i: (-rems[i], tie_break(seed, keys[i]), keys[i]))
    for i in order[:leftover]:
        parts[i] += 1
    return parts


def shares_for(total: int, split: dict, seed: str) -> list[tuple[str, int]]:
    m = split["method"]
    if m == "equal":
        members = sorted(split["members"])
        return list(zip(members, allocate(total, [1] * len(members), members, seed)))
    if m == "exact":
        rows = sorted(split["amounts"], key=lambda r: r["memberId"])
        return [(r["memberId"], int(r["amount"])) for r in rows]
    if m == "percent":
        rows = sorted(split["basisPoints"], key=lambda r: r["memberId"])
        ids = [r["memberId"] for r in rows]
        return list(zip(ids, allocate(total, [r["basisPoints"] for r in rows], ids, seed)))
    if m == "shares":
        rows = sorted(split["shares"], key=lambda r: r["memberId"])
        ids = [r["memberId"] for r in rows]
        weights = []
        for r in rows:
            whole, _, frac = r["shares"].partition(".")
            weights.append(int(whole + frac.ljust(2, "0")))
        return list(zip(ids, allocate(total, weights, ids, seed)))
    raise ValueError(m)


def convert(amount: int, frm: str, to: str, rate: str) -> int:
    whole, _, frac = rate.partition(".")
    num = amount * int(whole + frac) * 10 ** EXPONENT[to]
    den = 10 ** len(frac) * 10 ** EXPONENT[frm]
    q, r = abs(num) // den, abs(num) % den
    if 2 * r >= den:
        q += 1
    return q if num >= 0 else -q


def breakdown(e: dict, ledger: str) -> dict:
    total = int(e["total"])
    shares = shares_for(total, e["split"], e["expenseId"])
    payers = sorted(((p["memberId"], int(p["amount"])) for p in e["payers"]), key=lambda p: p[0])
    ledger_total = total
    if e["currency"] != ledger:
        ledger_total = convert(total, e["currency"], ledger, e["rate"])
        shares = list(zip([s[0] for s in shares], allocate(ledger_total, [s[1] for s in shares], [s[0] for s in shares], e["expenseId"])))
        payers = list(zip([p[0] for p in payers], allocate(ledger_total, [p[1] for p in payers], [p[0] for p in payers], e["expenseId"] + ":payers")))
    sign = -1 if e["kind"] == "refund" else 1
    net: dict[str, int] = {}
    for mid, amt in payers:
        net[mid] = net.get(mid, 0) + amt
    for mid, amt in shares:
        net[mid] = net.get(mid, 0) - amt
    postings = sorted(((m, a * sign) for m, a in net.items() if a != 0), key=lambda p: p[0])
    as_rows = lambda rows: [{"memberId": m, "amount": str(a)} for m, a in rows]
    return {"ledgerTotal": str(ledger_total), "shares": as_rows(shares), "payers": as_rows(payers), "postings": as_rows(postings)}


def random_case(rng: random.Random, i: int) -> dict:
    members = [f"m{c}" for c in "abcdefghij"][: rng.randint(1, 10)]
    participants = rng.sample(members, rng.randint(1, len(members)))
    total = rng.choice([rng.randint(1, 100), rng.randint(1, 10**6), rng.randint(1, 10**10)])
    method = rng.choice(["equal", "exact", "percent", "shares"])
    if method == "equal":
        split = {"method": "equal", "members": participants}
    elif method == "exact":
        cuts = sorted(rng.randint(0, total) for _ in range(len(participants) - 1))
        amounts = [b - a for a, b in zip([0] + cuts, cuts + [total])]
        split = {"method": "exact", "amounts": [{"memberId": m, "amount": str(a)} for m, a in zip(participants, amounts)]}
    elif method == "percent":
        cuts = sorted(rng.randint(0, 10000) for _ in range(len(participants) - 1))
        bps = [b - a for a, b in zip([0] + cuts, cuts + [10000])]
        split = {"method": "percent", "basisPoints": [{"memberId": m, "basisPoints": b} for m, b in zip(participants, bps)]}
    else:
        weights = [rng.randint(0, 500) for _ in participants]
        weights[0] = max(weights[0], 1)
        split = {"method": "shares", "shares": [{"memberId": m, "shares": f"{w // 100}.{w % 100:02d}"} for m, w in zip(participants, weights)]}
    payer_ids = rng.sample(members, rng.randint(1, min(3, len(members))))
    if total < len(payer_ids):
        payer_ids = payer_ids[:1]
    cuts = sorted(rng.sample(range(1, total), len(payer_ids) - 1)) if len(payer_ids) > 1 else []
    paid = [b - a for a, b in zip([0] + cuts, cuts + [total])]
    currency = rng.choice(["INR", "INR", "EUR", "USD", "JPY", "KWD"])
    case = {
        "expenseId": f"exp-{i:04d}",
        "kind": rng.choice(["expense", "expense", "refund"]),
        "currency": currency,
        "total": str(total),
        "payers": [{"memberId": m, "amount": str(a)} for m, a in zip(payer_ids, paid)],
        "split": split,
    }
    if currency != "INR":
        case["rate"] = f"{rng.randint(1, 40000000) / 10000:.4f}".rstrip("0").rstrip(".") or "1"
    return case


def main() -> None:
    rng = random.Random(20261022)
    handpicked = [
        {"expenseId": "hotel", "kind": "expense", "currency": "INR", "total": "600000",
         "payers": [{"memberId": "a", "amount": "600000"}], "split": {"method": "equal", "members": ["a", "b", "c", "d"]}},
        {"expenseId": "hotel-nights", "kind": "expense", "currency": "INR", "total": "600000",
         "payers": [{"memberId": "a", "amount": "600000"}],
         "split": {"method": "shares", "shares": [{"memberId": "a", "shares": "3"}, {"memberId": "b", "shares": "3"}, {"memberId": "c", "shares": "2"}, {"memberId": "d", "shares": "3"}]}},
        {"expenseId": "paris-dinner", "kind": "expense", "currency": "EUR", "total": "10000", "rate": "90.1234",
         "payers": [{"memberId": "a", "amount": "6000"}, {"memberId": "b", "amount": "4000"}], "split": {"method": "equal", "members": ["a", "b", "c"]}},
        {"expenseId": "tokyo-refund", "kind": "refund", "currency": "JPY", "total": "1501", "rate": "0.5612",
         "payers": [{"memberId": "c", "amount": "1501"}], "split": {"method": "percent", "basisPoints": [{"memberId": "a", "basisPoints": 3333}, {"memberId": "b", "basisPoints": 3333}, {"memberId": "c", "basisPoints": 3334}]}},
    ]
    cases = handpicked + [random_case(rng, i) for i in range(400)]
    vectors = []
    for case in cases:
        for ledger in ("INR", "JPY", "KWD") if case["expenseId"] == "paris-dinner" else ("INR",):
            try:
                expected = breakdown(case, ledger)
                if int(expected["ledgerTotal"]) <= 0 or int(expected["ledgerTotal"]) > 10**12:
                    continue
            except ZeroDivisionError:
                continue
            vectors.append({"input": case, "ledgerCurrency": ledger, "expected": expected})
    print(json.dumps({"generator": "tools/reference/oracle.py", "seed": 20261022, "vectors": vectors}, indent=1))


if __name__ == "__main__":
    main()
