"""Evidence-only month view.

Unlike analytics.compute_months, this module never distributes consumption
uniformly across days/months and never projects unobserved consumption.
Only a nonnegative delta between two actual dated counter states can count.
If an interval crosses a month boundary it is *not* attributed to either
month. A complete month needs boundary readings for every relevant meter.
"""
from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta

from energy_app.analytics import UTILITIES, advance_for_month, tariff_for_month


def confirmed_month(data: dict, month: str, today: date | None = None) -> dict:
    try:
        year, number = map(int, month.split("-"))
        if month != f"{year:04d}-{number:02d}" or not 1 <= number <= 12:
            raise ValueError()
        first = date(year, number, 1)
        last = date(year, number, monthrange(year, number)[1])
    except (AttributeError, TypeError, ValueError):
        raise ValueError("Vyberte platný měsíc ve formátu YYYY-MM.") from None

    today = today or date.today()
    cutoff = min(last, today)
    boundary = (first - timedelta(days=1)).isoformat()
    utility_rows = defaultdict(list)
    heating_rows = defaultdict(list)
    for row in data.get("meter_readings", []):
        utility_rows[str(row.get("meter_id"))].append(row)
    for row in data.get("heat_allocator_readings", []):
        heating_rows[str(row.get("allocator_id"))].append(row)

    values = {u: 0.0 for u in UTILITIES}
    coverage = {u: [] for u in UTILITIES}
    events = {u: [] for u in UTILITIES}
    devices = {u: 0 for u in UTILITIES}
    confirmed = {u: 0 for u in UTILITIES}
    complete = {u: 0 for u in UTILITIES}
    heat_allocators = data.get("heat_allocators", [])
    heat_uses_allocators = bool(heat_allocators)

    def consume(utility, entity, rows, coefficient=1.0, allow_reset=False):
        devices[utility] += 1
        previous_date = str(entity.get("base_date") or "")
        previous_value = float(entity.get("base_value") or 0)
        first_verified = None
        last_verified = None
        device_valid = False
        start_at_boundary = False
        invalid = False
        for row in sorted(rows, key=lambda r: (str(r.get("date", "")), str(r.get("id", "")))):
            day = str(row.get("date") or "")
            try:
                observed = date.fromisoformat(day)
                value = float(row.get("value"))
            except (TypeError, ValueError):
                continue
            delta = value if allow_reset and row.get("reset") else value - previous_value
            prior = previous_date
            # An undated baseline is not a verifiable counter interval.
            if prior and boundary <= prior < day and first <= observed <= cutoff and delta >= 0:
                amount = delta * coefficient
                values[utility] += amount
                confirmed[utility] += 1
                events[utility].append({
                    "date": day, "from": prior, "amount": amount,
                    "name": str(entity.get("name") or ""),
                })
                if first_verified is None:
                    first_verified = prior
                    start_at_boundary = prior == boundary
                last_verified = day
                device_valid = True
            elif first <= observed <= cutoff and delta < 0:
                invalid = True
            previous_date, previous_value = day, value
        if device_valid:
            coverage[utility].append({
                "name": str(entity.get("name") or ""), "from": first_verified,
                "to": last_verified, "starts_at_boundary": start_at_boundary,
                "invalid": invalid,
            })
            if start_at_boundary and last_verified == last.isoformat() and not invalid:
                complete[utility] += 1

    for meter in data.get("meters", []):
        utility = meter.get("utility")
        if utility not in UTILITIES or utility == "heat" and heat_uses_allocators:
            continue
        consume(utility, meter, utility_rows[str(meter.get("id"))])
    if heat_uses_allocators:
        for allocator in heat_allocators:
            coeff = float(allocator.get("coefficient", 1) or 1)
            consume("heat", allocator, heating_rows[str(allocator.get("id"))],
                    coefficient=coeff, allow_reset=True)

    status = {}
    for utility in UTILITIES:
        if not confirmed[utility]:
            status[utility] = "missing"
        elif complete[utility] == devices[utility] and cutoff == last:
            status[utility] = "complete"
        elif len(coverage[utility]) == devices[utility] and all(
            entry["starts_at_boundary"] for entry in coverage[utility]
        ):
            status[utility] = "to_date"
        else:
            status[utility] = "partial"

    tariff = tariff_for_month(data.get("tariffs", []), month)
    advances = advance_for_month(data.get("advances", []), month)
    fraction = max(0, (cutoff - first).days + 1) / monthrange(year, number)[1]
    variable_costs = {
        u: values[u] * float(tariff.get(UTILITIES[u]["price"], 0) or 0)
        for u in UTILITIES
    }
    fixed_costs = {
        u: fraction * float(tariff.get(UTILITIES[u]["fixed"], 0) or 0)
        for u in UTILITIES
    }
    utility_costs = {u: variable_costs[u] + fixed_costs[u] for u in UTILITIES}
    total_cost = sum(utility_costs.values())
    advance = fraction * sum(float(advances.get(u + "_monthly", 0) or 0) for u in UTILITIES)

    # Historical rows remain immutable. For the day chart, put each confirmed
    # interval delta on the date it was read: no interpolation or future days.
    daily = {}
    for utility, rows in events.items():
        for item in rows:
            key = item["date"]
            daily.setdefault(key, {"measured": {u: 0.0 for u in UTILITIES},
                                   "readings": {u: 0 for u in UTILITIES}})
            daily[key]["measured"][utility] += item["amount"]
            daily[key]["readings"][utility] += 1
    day_rows = []
    for day in range(1, monthrange(year, number)[1] + 1):
        key = f"{month}-{day:02d}"
        row = daily.get(key, {"measured": {u: 0.0 for u in UTILITIES},
                              "readings": {u: 0 for u in UTILITIES}})
        day_rows.append({"day": day, "date": key, **row,
                         "estimated": {u: False for u in UTILITIES}})
    return {
        "month": month, "start": first.isoformat(), "end": last.isoformat(),
        "as_of": cutoff.isoformat() if cutoff >= first else "",
        "days_in_month": len(day_rows), "days": day_rows,
        "measured": {u: values[u] if confirmed[u] else None for u in UTILITIES},
        "status": status, "coverage": coverage, "events": events,
        "variable_costs": variable_costs, "fixed_costs": fixed_costs,
        "utility_costs": utility_costs, "total_cost": total_cost,
        "advance": advance, "balance": advance - total_cost,
        "fixed_fraction": fraction,
        "tariff": tariff, "advance_rule": advances,
        "cost_note": "Náklady podle nastaveného ceníku; neověřují faktury ani zaplacené zálohy.",
    }
