"""Interval-backed daily allocation, never a forward forecast.

Every observed counter difference is allocated uniformly over the calendar days
(prior reading, new reading], including days in neighboring months. This is a
reconstruction from two actual values, NOT daily observation. Uncovered days
remain unknown. No allocation after the final real reading or after today.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
import math

from energy_app.analytics import UTILITIES


def allocate_daily(data: dict, month_start: date, month_end: date, today: date):
    end = min(month_end, today)
    units = tuple(UTILITIES)
    day_data: dict[str, dict] = {}
    covered: dict[str, dict[str, set[str]]] = {u: {} for u in units}
    events: dict[str, list] = {u: [] for u in units}
    all_intervals: dict[str, list] = {u: [] for u in units}
    meters_per_utility = {u: [] for u in units}
    invalid: dict[str, list] = {u: [] for u in units}
    device_monthly = defaultdict(float)
    device_info = {}
    by_meter = defaultdict(list)
    by_heat = defaultdict(list)

    for row in data.get("meter_readings", []):
        by_meter[str(row.get("meter_id"))].append(row)
    for row in data.get("heat_allocator_readings", []):
        by_heat[str(row.get("allocator_id"))].append(row)

    def accumulate(day: date, utility: str, amount: float, entity_id: str, interpolated: bool):
        if day < month_start or day > end:
            return
        key = day.isoformat()
        obj = day_data.setdefault(key, {
            "measured": {u: 0.0 for u in units},
            "readings": {u: 0 for u in units},
            "estimated": {u: False for u in units},
            "has_allocation": {u: False for u in units},
        })
        obj["measured"][utility] += amount
        obj["has_allocation"][utility] = True
        obj["estimated"][utility] |= interpolated
        covered[utility].setdefault(entity_id, set()).add(key)
        device_monthly[entity_id] += amount

    def calculate(utility: str, entity: dict, readings: list, coefficient=1., allow_reset=False):
        entity_id = str(entity.get("id") or "")
        meters_per_utility[utility].append(entity_id)
        device_info[entity_id] = {"name": str(entity.get("name") or ""),
                                  "room": str(entity.get("room") or "Bez místnosti"),
                                  "utility": utility}
        previous = str(entity.get("base_date") or "")
        try:
            previous_day = date.fromisoformat(previous)
            previous_value = float(entity.get("base_value") or 0)
        except (TypeError, ValueError):
            previous_day = None
            previous_value = 0.0
        for row in sorted(readings, key=lambda r:(str(r.get("date") or ""), str(r.get("id") or ""))):
            try:
                reading_day = date.fromisoformat(str(row.get("date") or ""))
                reading_value = float(row.get("value"))
            except (ValueError, TypeError):
                invalid[utility].append({"id": entity_id, "reason": "invalid date/value"})
                continue
            if not math.isfinite(reading_value) or reading_value < 0:
                invalid[utility].append({"id": entity_id, "reason": "invalid reading"})
                continue
            if reading_day > today:
                # Never use future entries to infer consumption in the past.
                continue
            reset = allow_reset and bool(row.get("reset"))
            delta = (reading_value if reset else reading_value - previous_value) * coefficient
            if previous_day is not None and reading_day >= previous_day and math.isfinite(delta) and delta >= 0:
                span = (reading_day - previous_day).days
                span = max(1, span)
                if reading_day >= month_start and previous_day < month_end and reading_day <= today:
                    item = {
                        "id": entity_id, "name": str(entity.get("name") or ""),
                        "room": str(entity.get("room") or "Bez místnosti"),
                        "from": previous_day.isoformat(), "date": reading_day.isoformat(),
                        "amount": delta, "interval_days": span,
                        "crosses_month": previous_day < month_start,
                        "reset": bool(reset),
                    }
                    first_day = previous_day + timedelta(days=1) if reading_day > previous_day else reading_day
                    overlap_start = max(month_start, first_day)
                    overlap_end = min(month_end, reading_day, end)
                    overlap_days = max(0, (overlap_end - overlap_start).days + 1)
                    item["monthly_amount"] = delta * overlap_days / span
                    item["monthly_days"] = overlap_days
                    all_intervals[utility].append(item)
                    if month_start <= reading_day <= end:
                        events[utility].append(item.copy())
                day = previous_day + timedelta(days=1) if reading_day > previous_day else reading_day
                daily = delta / span
                while day <= reading_day:
                    accumulate(day, utility, daily, entity_id, span > 1)
                    if month_start <= day <= end and day == reading_day:
                        day_data[day.isoformat()]["readings"][utility] += 1
                    day += timedelta(days=1)
            elif previous_day is not None and reading_day >= month_start:
                invalid[utility].append({"id": entity_id, "date": reading_day.isoformat(),
                                         "reason": "negative delta or reversed date"})
            previous_day, previous_value = reading_day, reading_value

    heat_allocators = data.get("heat_allocators", [])
    for meter in data.get("meters", []):
        utility = meter.get("utility")
        if utility not in units or (utility == "heat" and heat_allocators):
            continue
        calculate(utility, meter, by_meter[str(meter.get("id"))])
    for allocator in heat_allocators:
        entity_id = str(allocator.get("id") or "")
        if allocator.get("always_off"):
            # Explicit assumption from the user, not a fabricated actual
            # measurement: zero consumption since the saved base date.
            meters_per_utility["heat"].append(entity_id)
            device_info[entity_id] = {
                "name": str(allocator.get("name") or ""),
                "room": str(allocator.get("room") or "Bez místnosti"),
                "utility": "heat", "assumed_zero": True,
            }
            try:
                base_day = date.fromisoformat(str(allocator.get("base_date") or ""))
            except ValueError:
                base_day = None
            day = max(month_start, base_day + timedelta(days=1)) if base_day else month_start
            while day <= end:
                accumulate(day, "heat", 0.0, entity_id, False)
                day += timedelta(days=1)
            continue
        try:
            coeff = float(allocator.get("coefficient", 1) or 1)
        except (TypeError, ValueError):
            coeff = 1.
        calculate("heat", allocator, by_heat[entity_id], coeff, allow_reset=True)

    days = []
    day = month_start
    while day <= month_end:
        key = day.isoformat()
        defaults = {
            "measured": {u: 0.0 for u in units},
            "readings": {u: 0 for u in units},
            "estimated": {u: False for u in units},
            "has_allocation": {u: False for u in units},
        }
        days.append({"date": key, "day": day.day, **day_data.get(key, defaults)})
        day += timedelta(days=1)

    monthly = {u: sum(row["measured"][u] for row in days) for u in units}
    status = {}
    coverage = {}
    for u in units:
        names = meters_per_utility[u]
        sets = covered[u]
        data_days = {day for ds in sets.values() for day in ds}
        days_expected = max(0, (end - month_start).days + 1)
        full_days = {
            (month_start + timedelta(days=offset)).isoformat()
            for offset in range(days_expected)
        }
        coverage[u] = [{"id": entity, "days":len(sets.get(entity,set())),
                         "first": min(sets[entity]) if sets.get(entity) else None,
                         "last": max(sets[entity]) if sets.get(entity) else None,
                         "assumed_zero": bool(device_info.get(entity, {}).get("assumed_zero"))}
                       for entity in names]
        if not data_days:
            status[u] = "missing"
        elif all(full_days.issubset(sets.get(entity,set())) for entity in names) and days_expected > 0:
            status[u] = "complete" if end == month_end else "to_date"
        else:
            status[u] = "partial"

    return {
        "days": days, "measured": monthly, "status": status,
        "coverage": coverage, "events": events,
        "intervals": all_intervals, "invalid_intervals": invalid,
        "device_monthly": [
            {"id": id, **info, "amount": device_monthly.get(id, 0.0),
             "has_data": any(id in covered[u] and bool(covered[u][id]) for u in units)}
            for id, info in device_info.items()
        ],
        "has_data": {u: any(row["has_allocation"][u] for row in days) for u in units},
    }
