"""Date-aware optional dashboard views.

Existing 12-month billing and monthly analysis remain untouched. This module
only computes the selected-period finance card and per-day consumption chart.
Daily values between absolute meter readings are *estimates* distributed
uniformly over (previous_date, reading_date], exactly like monthly analytics.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from energy_app.analytics import UTILITIES, _covered_dates, _safe_date, advance_for_month, tariff_for_month


def _parse_day(value: str) -> date:
    day = _safe_date(value)
    if day is None or day.isoformat() != str(value):
        raise ValueError("Datum musí být ve formátu YYYY-MM-DD.")
    return day


def _day_rows(start: date, end: date) -> dict[str, dict]:
    days = {}
    day = start
    while day <= end:
        days[day.isoformat()] = {
            "date": day.isoformat(),
            "measured": {utility: 0.0 for utility in UTILITIES},
            "readings": {utility: 0 for utility in UTILITIES},
            "estimated": {utility: False for utility in UTILITIES},
        }
        day += timedelta(days=1)
    return days


def daily_usage(data: dict, start: date, end: date) -> dict[str, dict]:
    """Split consumption across days, aggregating multiple readings in one day."""
    if end < start:
        raise ValueError("Konec období nesmí předcházet začátku.")
    if (end - start).days > 3660:
        raise ValueError("Období nesmí být delší než 10 let.")
    result = _day_rows(start, end)
    meter_by_id = {m.get("id"): m for m in data.get("meters", [])}
    readings_by_meter = {meter_id: [] for meter_id in meter_by_id}
    for item in data.get("meter_readings", []):
        if item.get("meter_id") in readings_by_meter and item.get("date"):
            readings_by_meter[item["meter_id"]].append(item)

    for mid, meter in meter_by_id.items():
        utility = meter.get("utility")
        if utility not in UTILITIES:
            continue
        previous_date = str(meter.get("base_date") or "")
        previous_value = float(meter.get("base_value") or 0)
        rows = sorted(readings_by_meter[mid], key=lambda r: (str(r.get("date", "")), str(r.get("id", ""))))
        for row in rows:
            reading_day = str(row.get("date", ""))
            value = float(row.get("value") or 0)
            if reading_day in result:
                result[reading_day]["readings"][utility] += 1
            # Avoid generating years of irrelevant dates for very old intervals.
            first_day = _safe_date(previous_date)
            last_day = _safe_date(reading_day)
            if last_day and first_day and last_day >= first_day and value >= previous_value:
                count = max(1, (last_day - first_day).days)
                interval_start = max(start, first_day + timedelta(days=1) if last_day > first_day else first_day)
                interval_end = min(end, last_day)
                if interval_start <= interval_end:
                    rate = (value - previous_value) / count
                    current = interval_start
                    while current <= interval_end:
                        day = result[current.isoformat()]
                        day["measured"][utility] += rate
                        day["estimated"][utility] = count > 1
                        current += timedelta(days=1)
            previous_date, previous_value = reading_day, value

    allocator_by_id = {a.get("id"): a for a in data.get("heat_allocators", [])}
    allocator_readings = {aid: [] for aid in allocator_by_id}
    for row in data.get("heat_allocator_readings", []):
        if row.get("allocator_id") in allocator_readings and row.get("date"):
            allocator_readings[row["allocator_id"]].append(row)

    radiator_days = set()
    for aid, allocator in allocator_by_id.items():
        previous_date = str(allocator.get("base_date") or "")
        previous_value = float(allocator.get("base_value") or 0)
        coefficient = float(allocator.get("coefficient", 1) or 1)
        rows = sorted(allocator_readings[aid], key=lambda r: (str(r.get("date", "")), str(r.get("id", ""))))
        for row in rows:
            reading_day = str(row.get("date", ""))
            value = float(row.get("value") or 0)
            reset = bool(row.get("reset"))
            delta = (value if reset else value - previous_value) * coefficient
            if reading_day in result:
                result[reading_day]["readings"]["heat"] += 1
            first_day = _safe_date(previous_date)
            last_day = _safe_date(reading_day)
            if first_day and last_day and last_day >= first_day and delta >= 0:
                count = max(1, (last_day - first_day).days)
                interval_start = max(start, first_day + timedelta(days=1) if last_day > first_day else first_day)
                interval_end = min(end, last_day)
                if interval_start <= interval_end:
                    rate = delta / count
                    current = interval_start
                    while current <= interval_end:
                        key = current.isoformat()
                        radiator_days.add(key)
                        day = result[key]
                        day.setdefault("_radiator_heat", 0.0)
                        day["_radiator_heat"] += rate
                        day["estimated"]["heat"] = count > 1
                        current += timedelta(days=1)
            previous_date, previous_value = reading_day, value

    # Radiator allocator usage takes precedence over the legacy "heat" meter
    # for a given month, as in analytics.compute_months.
    radiator_months = {key[:7] for key in radiator_days}
    for row in result.values():
        if row["date"][:7] in radiator_months:
            row["measured"]["heat"] = row.pop("_radiator_heat", 0.0)
        else:
            row.pop("_radiator_heat", None)
    return result


def month_consumption(data: dict, month: str) -> dict:
    try:
        year, month_number = (int(x) for x in month.split("-"))
        if month != f"{year:04d}-{month_number:02d}" or not 1 <= month_number <= 12:
            raise ValueError()
        length = monthrange(year, month_number)[1]
        start = date(year, month_number, 1)
    except (ValueError, TypeError):
        raise ValueError("Vyberte platný měsíc ve formátu YYYY-MM.") from None
    end = date(year, month_number, length)
    days = daily_usage(data, start, end)
    samples = []
    for index, value in enumerate(days.values(), start=1):
        samples.append({
            "day": index, "date": value["date"],
            "measured": value["measured"],
            "readings": value["readings"],
            "estimated": value["estimated"],
        })
    return {"month": month, "days_in_month": length, "days": samples}


def financial_position(data: dict, start_str: str, end_str: str, today: date | None = None) -> dict:
    """Selected date range, with proportional monthly advances and fees.

    This is accrual-based analysis, not confirmed bank transactions.
    We only record incurred charges through today. Future variable cost is
    projected from the average of already covered days, if readings exist.
    """
    today = today or date.today()
    start = _parse_day(start_str)
    end = _parse_day(end_str)
    if end < start:
        raise ValueError("Konec období musí být stejný nebo pozdější než začátek.")
    if (end - start).days > 3659:
        raise ValueError("Vlastní období může zahrnovat nejvýše 10 let.")
    days = daily_usage(data, start, end)
    actual_cost = 0.0
    period_advances = 0.0
    projected_cost = 0.0
    projected_advances = 0.0
    variable_sum = {u: 0.0 for u in UTILITIES}
    covered_days = {u: 0 for u in UTILITIES}

    for key, row in days.items():
        day = date.fromisoformat(key)
        month = key[:7]
        month_length = monthrange(day.year, day.month)[1]
        tariff = tariff_for_month(data.get("tariffs", []), month)
        advances = advance_for_month(data.get("advances", []), month)
        fee_day = sum(float(tariff.get(UTILITIES[u]["fixed"], 0) or 0) for u in UTILITIES) / month_length
        advance_day = sum(float(advances.get(u + "_monthly", 0) or 0) for u in UTILITIES) / month_length
        projected_cost += fee_day
        projected_advances += advance_day
        if day > today:
            continue
        actual_cost += fee_day
        period_advances += advance_day
        for utility in UTILITIES:
            volume = float(row["measured"][utility])
            var = volume * float(tariff.get(UTILITIES[utility]["price"], 0) or 0)
            actual_cost += var
            projected_cost += var
            variable_sum[utility] += volume
            # Dates with no reading interval may not have measured consumption.
            if row["estimated"][utility] or volume > 0 or row["readings"][utility]:
                covered_days[utility] += 1

    # Estimate upcoming days with the observed daily usage rate. Respect the
    # period-specific tariff instead of applying today's price to future dates.
    for key in days:
        day = date.fromisoformat(key)
        if day <= today:
            continue
        month = key[:7]
        tariff = tariff_for_month(data.get("tariffs", []), month)
        for utility in UTILITIES:
            rate = variable_sum[utility] / covered_days[utility] if covered_days[utility] else 0.0
            projected_cost += rate * float(tariff.get(UTILITIES[utility]["price"], 0) or 0)

    projected_cost = max(0.0, projected_cost)
    current_balance = period_advances - actual_cost
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "paid": period_advances, "actual_cost": actual_cost,
        "current_balance": current_balance,
        "projected_paid_total": projected_advances,
        "projected_cost_total": projected_cost,
        "projected_balance": projected_advances - projected_cost,
        "prorated_advances": True,
        "last_observed_day": min(today, end).isoformat(),
    }
