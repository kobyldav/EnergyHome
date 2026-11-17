"""Month view based on real counter differences, with transparent daily interpolation.

Between two dated readings, evenly distribute known increments over covered
calendar days including neighboring months; never extrapolate beyond last read.
"""
from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta

from energy_app.analytics import UTILITIES, advance_for_month, tariff_for_month
from energy_app.allocation import allocate_daily


def aligned_settlement(allocated: dict, first: date, last: date, cutoff: date,
                       tariff: dict, advances: dict, heat_uses_allocators: bool) -> dict:
    """Comparable costs and advances for the same observed calendar prefix.

    Missing devices cannot manufacture a zero bill. Retain a provisional
    comparison for available devices, and identify every missing input.
    The observed timeline may use a later real reading to allocate earlier
    days; do not call the allocation engine with an artificially earlier today.
    """
    coverage = allocated["coverage"]
    expected = max(0, (cutoff - first).days + 1)
    rates = {u: float(tariff.get(UTILITIES[u]["price"], 0) or 0) for u in UTILITIES}
    required = {u for u in UTILITIES if coverage[u] or rates[u] > 0}
    entries = [e for u in required for e in coverage[u]]
    prefixes = [e["continuous_days"] for e in entries
                if not e["assumed_zero"] and e["continuous_days"] > 0]
    if prefixes:
        count = min(prefixes)
    elif required and all(coverage[u] and all(e["assumed_zero"] for e in coverage[u])
                          for u in required):
        count = expected
    elif not required:
        # A fixed-only household needs no consumption interval.
        count = expected
    else:
        count = 0
    count = min(count, expected)
    if not count or tariff.get("effective_from", "0000-00-00") == "0000-00-00":
        return {"available": False, "as_of": "", "reason":
                "Chybí ceník nebo souvislé odečty od začátku měsíce."}

    days = allocated["days"][:count]
    fraction = count / monthrange(first.year, first.month)[1]
    fixed = {u: fraction * float(tariff.get(UTILITIES[u]["fixed"], 0) or 0) for u in UTILITIES}
    measured = {u: sum(d["measured"][u] for d in days) for u in UTILITIES}
    variable = {u: measured[u] * rates[u] for u in UTILITIES}
    if heat_uses_allocators and rates["heat"] <= 0:
        variable["heat"] = 0.0
    utility_costs = {u: fixed[u] + variable[u] for u in UTILITIES}
    status = {}
    incomplete = []
    missing_devices = {}
    device_names = {d["id"]: (d["room"] + " · " if d["room"] != "Bez místnosti" else "") + d["name"]
                    for d in allocated["device_monthly"]}
    for u in UTILITIES:
        gaps = [e for e in coverage[u] if e["continuous_days"] < count]
        missing = u in required and (not coverage[u] or bool(gaps))
        unpriced_heat = u == "heat" and heat_uses_allocators and rates[u] <= 0 and measured[u] > 0
        if gaps:
            missing_devices[u] = [device_names.get(e["id"], e["id"]) for e in gaps]
        elif missing:
            missing_devices[u] = ["Chybí měřidlo"]
        if missing or unpriced_heat:
            incomplete.append(u)
        status[u] = ("partial" if any(d["has_allocation"][u] for d in days) else "missing") if missing else (
            "complete" if count == monthrange(first.year, first.month)[1] else "to_date")
    total = sum(utility_costs.values())
    advance = fraction * sum(float(advances.get(u + "_monthly", 0) or 0) for u in UTILITIES)
    return {
        "available": True, "start": first.isoformat(), "end": last.isoformat(),
        "as_of": days[-1]["date"], "covered_days": count, "calendar_days": expected,
        "advance": advance, "fixed_costs": fixed, "variable_costs": variable,
        "utility_costs": utility_costs, "total_cost": total, "balance": advance-total,
        "status": status, "cost_incomplete": bool(incomplete), "incomplete_utilities": incomplete,
        "missing_devices": missing_devices, "tariff": tariff,
        "heat_provisional": heat_uses_allocators and rates["heat"] > 0,
    }


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
    heat_reading_intervals = []  # Actual intervals finishing in this month; may start earlier.

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
            # Actual radiator intervals may start in another month. Show them
            # separately as reading intervals, never as a calendar-month estimate.
            if (utility == "heat" and heat_uses_allocators and prior
                    and prior <= day and first <= observed <= cutoff and delta >= 0):
                heat_reading_intervals.append({
                    "id": str(entity.get("id") or ""),
                    "name": str(entity.get("name") or ""),
                    "room": str(entity.get("room") or "Bez místnosti"),
                    "from": prior, "date": day, "amount": delta * coefficient,
                    "crosses_month": prior < boundary,
                    "reset": bool(row.get("reset")),
                })
            # An undated baseline is not a verifiable counter interval.
            if prior and boundary <= prior <= day and first <= observed <= cutoff and delta >= 0:
                amount = delta * coefficient
                values[utility] += amount
                confirmed[utility] += 1
                events[utility].append({
                    "date": day, "from": prior, "amount": amount,
                    "name": str(entity.get("name") or ""),
                    "id": str(entity.get("id") or ""),
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
            entry["starts_at_boundary"] and not entry["invalid"] for entry in coverage[utility]
        ):
            status[utility] = "to_date"
        else:
            status[utility] = "partial"

    # Reconstruct the daily timeline from actual dated counter differences.
    # Allocation over days is an estimate; the between-reading delta is real.
    allocated = allocate_daily(data, first, last, today)
    values = allocated["measured"]
    status = allocated["status"]
    coverage = allocated["coverage"]
    events = allocated["events"]

    tariff = tariff_for_month(data.get("tariffs", []), month)
    advances = advance_for_month(data.get("advances", []), month)
    fraction = max(0, (cutoff - first).days + 1) / monthrange(year, number)[1]
    variable_costs = {
        u: values[u] * float(tariff.get(UTILITIES[u]["price"], 0) or 0)
        for u in UTILITIES
    }
    # Backward-compatible field name heat_per_gj has always been displayed
    # in the tariff form as CZK / provisional unit for radiator allocators.
    # Therefore it is an explicitly configured estimated unit price in this
    # mode, *not* a conversion from radiator units to GJ. For a real heat
    # meter (without allocators) it remains the measured GJ tariff.
    heat_rate = float(tariff.get("heat_per_gj", 0) or 0)
    if heat_uses_allocators:
        if heat_rate <= 0:
            variable_costs["heat"] = 0.0
        # For positive tariff, the initial variable_costs calculation already
        # contains allocated radiator units multiplied by the configured rate.
    heat_cost_estimate = {
        "mode": (
            "allocator_unit_estimate" if heat_uses_allocators and heat_rate > 0
            else "missing_allocator_rate" if heat_uses_allocators
            else "metered_gj"
        ),
        "quantity": values["heat"] if allocated["has_data"]["heat"] else None,
        "rate": heat_rate,
        "unit": "jedn." if heat_uses_allocators else "GJ",
        "variable_cost": variable_costs["heat"],
        "provisional": bool(heat_uses_allocators),
        "incomplete": bool(heat_uses_allocators and heat_rate <= 0 and values["heat"] > 0),
    }
    fixed_costs = {
        u: fraction * float(tariff.get(UTILITIES[u]["fixed"], 0) or 0)
        for u in UTILITIES
    }
    utility_costs = {u: variable_costs[u] + fixed_costs[u] for u in UTILITIES}
    heat_cost_estimate["fixed_cost"] = fixed_costs["heat"]
    heat_cost_estimate["total_cost"] = utility_costs["heat"]
    total_cost = sum(utility_costs.values())
    advance = fraction * sum(float(advances.get(u + "_monthly", 0) or 0) for u in UTILITIES)

    # Interval allocation already includes cross-month days without forecasting.
    day_rows = allocated["days"]
    return {
        "month": month, "start": first.isoformat(), "end": last.isoformat(),
        "as_of": cutoff.isoformat() if cutoff >= first else "",
        "days_in_month": len(day_rows), "days": day_rows,
        "measured": {u: values[u] if allocated["has_data"][u] else None for u in UTILITIES},
        "allocation_method": "uniform_between_readings",
        "actual_intervals": allocated["intervals"],
        "invalid_intervals": allocated["invalid_intervals"],
        "status": status, "coverage": coverage, "events": events,
        "heat_reading_intervals": heat_reading_intervals,
        "heat_allocated_intervals": allocated["intervals"]["heat"],
        "monthly_devices": allocated["device_monthly"],
        "heat_reading_total": sum(row["amount"] for row in heat_reading_intervals),
        "heat_cross_month_count": sum(bool(row["crosses_month"]) for row in heat_reading_intervals),
        "variable_costs": variable_costs, "fixed_costs": fixed_costs,
        "utility_costs": utility_costs, "total_cost": total_cost,
        "heat_cost_estimate": heat_cost_estimate,
        "cost_incomplete": heat_cost_estimate["incomplete"],
        "advance": advance, "balance": advance - total_cost,
        "fixed_fraction": fraction,
        "settlement": aligned_settlement(allocated, first, last, cutoff, tariff, advances, heat_uses_allocators),
        "tariff": tariff, "advance_rule": advances,
        "cost_note": "Měsíční přírůstky vycházejí z odečtů a rovnoměrného rozpočítání mezi dny. Cena radiátorových jednotek je pouze uživatelský orientační odhad, nikoli oficiální vyúčtování domu.",
    }
