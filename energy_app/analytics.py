from __future__ import annotations

from calendar import monthrange
from typing import Any

UTILITIES = {
    "electricity": {"label": "Elektřina", "unit": "kWh", "price": "electricity_per_kwh", "fixed": "electricity_fixed_monthly"},
    "cold_water": {"label": "Studená voda", "unit": "m³", "price": "cold_water_per_m3", "fixed": "cold_water_fixed_monthly"},
    "hot_water": {"label": "Teplá voda", "unit": "m³", "price": "hot_water_per_m3", "fixed": "hot_water_fixed_monthly"},
    "gas": {"label": "Plyn", "unit": "m³", "price": "gas_per_m3", "fixed": "gas_fixed_monthly"},
    "heat": {"label": "Teplo", "unit": "jedn.", "price": "heat_per_gj", "fixed": "heat_fixed_monthly"},
}


def month_key(value: str) -> tuple[int, int]:
    y, m = value[:7].split("-")
    return int(y), int(m)


def month_index(month: str) -> int:
    y, m = month_key(month)
    return y * 12 + (m - 1)


def month_from_index(idx: int) -> str:
    y, zero_m = divmod(idx, 12)
    return f"{y:04d}-{zero_m + 1:02d}"


def months_between(start: str, end: str) -> int:
    return month_index(end) - month_index(start)


def days_in_month(month: str) -> int:
    y, m = month_key(month)
    return monthrange(y, m)[1]


def month_end(month: str) -> str:
    y, m = month_key(month)
    return f"{y:04d}-{m:02d}-{monthrange(y, m)[1]:02d}"


def _effective_for_date(rows: list[dict], target_date: str, defaults: dict) -> dict:
    eligible = [r for r in rows if str(r.get("effective_from", "9999-12-31")) <= target_date]
    if not eligible:
        return defaults.copy()
    return max(eligible, key=lambda r: str(r.get("effective_from", "0000-00-00")))


def tariff_for_month(tariffs: list[dict], month: str) -> dict:
    return _effective_for_date(tariffs, month_end(month), {
        "effective_from": "0000-00-00",
        "electricity_per_kwh": 0.0,
        "cold_water_per_m3": 0.0,
        "hot_water_per_m3": 0.0,
        "gas_per_m3": 0.0,
        "heat_per_gj": 0.0,
        "electricity_fixed_monthly": 0.0,
        "cold_water_fixed_monthly": 0.0,
        "hot_water_fixed_monthly": 0.0,
        "gas_fixed_monthly": 0.0,
        "heat_fixed_monthly": 0.0,
    })


def advance_for_month(advances: list[dict], month: str) -> dict:
    return _effective_for_date(advances, month_end(month), {
        "effective_from": "0000-00-00",
        "electricity_monthly": 0.0,
        "cold_water_monthly": 0.0,
        "hot_water_monthly": 0.0,
        "gas_monthly": 0.0,
        "heat_monthly": 0.0,
    })


def billing_cycle(month: str, start_month: int) -> tuple[str, str]:
    y, m = month_key(month)
    start_year = y if m >= start_month else y - 1
    start_idx = start_year * 12 + (start_month - 1)
    return month_from_index(start_idx), month_from_index(start_idx + 11)


def _appliance_month_usage(appliance: dict, cycles: int, month: str) -> dict[str, float]:
    d = days_in_month(month)
    if appliance.get("kind") == "passive":
        return {
            "electricity": float(appliance.get("electricity_kwh_per_day", 0) or 0) * d,
            "cold_water": float(appliance.get("cold_water_l_per_day", 0) or 0) * d / 1000,
            "hot_water": float(appliance.get("hot_water_l_per_day", 0) or 0) * d / 1000,
            "gas": float(appliance.get("gas_m3_per_day", 0) or 0) * d,
            "heat": 0.0,
        }
    return {
        "electricity": float(appliance.get("electricity_kwh_per_cycle", 0) or 0) * cycles,
        "cold_water": float(appliance.get("cold_water_l_per_cycle", 0) or 0) * cycles / 1000,
        "hot_water": float(appliance.get("hot_water_l_per_cycle", 0) or 0) * cycles / 1000,
        "gas": float(appliance.get("gas_m3_per_cycle", 0) or 0) * cycles,
        "heat": 0.0,
    }


def meter_monthly_usage(data: dict) -> tuple[dict[str, dict[str, float]], dict[str, list[dict]]]:
    """Return monthly consumption by utility and detailed meter intervals."""
    meters = {m.get("id"): m for m in data.get("meters", [])}
    by_meter: dict[str, list[dict]] = {mid: [] for mid in meters}
    for r in data.get("meter_readings", []):
        mid = r.get("meter_id")
        if mid in by_meter and r.get("date"):
            by_meter[mid].append(r)
    totals: dict[str, dict[str, float]] = {}
    details: dict[str, list[dict]] = {}

    for mid, meter in meters.items():
        rows = sorted(by_meter.get(mid, []), key=lambda r: (r.get("date", ""), r.get("id", "")))
        prev_value = float(meter.get("base_value", 0) or 0)
        prev_date = str(meter.get("base_date", "") or "")
        utility = meter.get("utility", "electricity")
        if utility not in UTILITIES:
            continue
        for row in rows:
            current = float(row.get("value", 0) or 0)
            current_date = str(row.get("date", ""))
            delta = current - prev_value
            valid = delta >= 0 and (not prev_date or current_date >= prev_date)
            month = current_date[:7]
            if len(month) == 7:
                totals.setdefault(month, {u: 0.0 for u in UTILITIES})
                details.setdefault(month, [])
                if valid:
                    totals[month][utility] += delta
                details[month].append({
                    "meter_id": mid,
                    "meter_name": meter.get("name", "Měřidlo"),
                    "utility": utility,
                    "from_date": prev_date,
                    "to_date": current_date,
                    "from_value": prev_value,
                    "to_value": current,
                    "usage": delta if valid else 0.0,
                    "valid": valid,
                })
            prev_value, prev_date = current, current_date
    return totals, details


def heat_allocator_monthly_usage(data: dict) -> tuple[dict[str, float], dict[str, list[dict]]]:
    """Return provisional monthly heat as the sum of all radiator allocator deltas.

    Each radiator is evaluated independently from its base value and subsequent
    cumulative readings. The valid delta is multiplied by its optional coefficient.
    All adjusted deltas whose reading falls in the same month are then summed.

    This is intentionally a provisional definition of total heat. The resulting
    value is in allocation units, not physically verified GJ.
    """
    readings = data.get("heat_allocator_readings", [])
    monthly: dict[str, float] = {}
    details: dict[str, list[dict]] = {}

    for allocator in data.get("heat_allocators", []):
        aid = allocator.get("id")
        coeff = float(allocator.get("coefficient", 1.0) or 1.0)
        rows = sorted(
            [r for r in readings if r.get("allocator_id") == aid and r.get("date")],
            key=lambda r: (str(r.get("date", "")), str(r.get("id", ""))),
        )
        prev_value = float(allocator.get("base_value", 0) or 0)
        prev_date = str(allocator.get("base_date", "") or "")

        for row in rows:
            current = float(row.get("value", 0) or 0)
            current_date = str(row.get("date", ""))
            reset = bool(row.get("reset", False))
            raw_delta = current if reset else current - prev_value
            valid = raw_delta >= 0 and (not prev_date or current_date >= prev_date)
            adjusted = raw_delta * coeff if valid else 0.0
            month = current_date[:7]
            if len(month) == 7:
                monthly.setdefault(month, 0.0)
                details.setdefault(month, [])
                if valid:
                    monthly[month] += adjusted
                details[month].append({
                    "allocator_id": aid,
                    "allocator_name": allocator.get("name", "Radiátor"),
                    "room": allocator.get("room", ""),
                    "from_date": prev_date,
                    "to_date": current_date,
                    "from_value": prev_value,
                    "to_value": current,
                    "raw_usage": raw_delta if valid else 0.0,
                    "adjusted_usage": adjusted,
                    "coefficient": coeff,
                    "reset": reset,
                    "valid": valid,
                })
            prev_value, prev_date = current, current_date

    return monthly, details


def compute_months(data: dict) -> list[dict[str, Any]]:
    measured_by_month, meter_details = meter_monthly_usage(data)
    radiator_heat_by_month, radiator_heat_details = heat_allocator_monthly_usage(data)

    # Provizorní pravidlo: pokud jsou pro daný měsíc odečty radiátorů, jejich
    # součet definuje celkovou spotřebu tepla a má přednost před hlavním
    # měřidlem tepla, aby se spotřeba nepočítala dvakrát.
    for month, heat_total in radiator_heat_by_month.items():
        measured_by_month.setdefault(month, {u: 0.0 for u in UTILITIES})
        measured_by_month[month]["heat"] = heat_total
    appliances = data.get("appliances", [])
    cycle_map = {(c.get("month"), c.get("appliance_id")): int(c.get("cycles", 0) or 0) for c in data.get("cycles", [])}
    tariffs = data.get("tariffs", [])
    advances = data.get("advances", [])
    months = sorted(measured_by_month)
    out: list[dict[str, Any]] = []

    for month in months:
        measured = measured_by_month[month]
        passive = {u: 0.0 for u in UTILITIES}
        active = {u: 0.0 for u in UTILITIES}
        appliance_breakdown = []
        for a in appliances:
            cyc = cycle_map.get((month, a.get("id")), 0)
            usage = _appliance_month_usage(a, cyc, month)
            target = passive if a.get("kind") == "passive" else active
            for u in UTILITIES:
                target[u] += usage[u]
            appliance_breakdown.append({"id": a.get("id"), "name": a.get("name"), "kind": a.get("kind"), "cycles": cyc, "usage": usage})

        unassigned = {u: measured[u] - passive[u] - active[u] for u in UTILITIES}
        tariff = tariff_for_month(tariffs, month)
        advance_rule = advance_for_month(advances, month)
        variable_costs = {u: measured[u] * float(tariff.get(UTILITIES[u]["price"], 0) or 0) for u in UTILITIES}
        fixed_costs = {u: float(tariff.get(UTILITIES[u]["fixed"], 0) or 0) for u in UTILITIES}
        utility_costs = {u: variable_costs[u] + fixed_costs[u] for u in UTILITIES}
        fixed = sum(fixed_costs.values())
        total_cost = sum(utility_costs.values())
        advance_parts = {u: float(advance_rule.get(f"{u}_monthly", 0) or 0) for u in UTILITIES}
        advance_total = sum(advance_parts.values())

        out.append({
            "month": month,
            "measured": measured,
            "meter_intervals": meter_details.get(month, []),
            "heat_source": "radiators" if month in radiator_heat_by_month else ("meter" if measured.get("heat", 0) else "none"),
            "heat_allocator_intervals": radiator_heat_details.get(month, []),
            "passive": passive,
            "active": active,
            "unassigned": unassigned,
            "appliances": appliance_breakdown,
            "tariff": tariff,
            "advance_rule": advance_rule,
            "advance_parts": advance_parts,
            "variable_costs": variable_costs,
            "fixed_costs": fixed_costs,
            "utility_costs": utility_costs,
            "fixed_cost": fixed,
            "total_cost": total_cost,
            "advance": advance_total,
            "balance": advance_total - total_cost,
        })
    return out


def add_alerts(months: list[dict], ratio_threshold: float = 0.30) -> None:
    for i, m in enumerate(months):
        alerts = []
        invalid = [x for x in m.get("meter_intervals", []) if not x.get("valid")]
        for x in invalid:
            alerts.append({"severity": "danger", "text": f"Odečet měřidla {x['meter_name']} je nižší než předchozí stav. Zkontrolujte výměnu nebo přetočení měřidla."})
        for utility in UTILITIES:
            measured = m["measured"][utility]
            unassigned = m["unassigned"][utility]
            if measured <= 0:
                continue
            if unassigned < -1e-6:
                alerts.append({"severity": "danger", "text": f"Profily spotřebičů pro {UTILITIES[utility]['label'].lower()} převyšují naměřenou spotřebu."})
                continue
            history = [x["unassigned"][utility] for x in months[max(0, i - 3):i] if x["unassigned"][utility] >= 0 and x["measured"][utility] > 0]
            if history:
                avg = sum(history) / len(history)
                if avg > 0 and unassigned > avg * (1 + ratio_threshold):
                    jump = (unassigned / avg - 1) * 100
                    alerts.append({"severity": "warning", "text": f"Nezařazená spotřeba {UTILITIES[utility]['label'].lower()} je o {jump:.0f} % vyšší než nedávný průměr."})
            elif unassigned / measured > 0.7 and utility != "heat":
                alerts.append({"severity": "info", "text": f"Více než 70 % spotřeby {UTILITIES[utility]['label'].lower()} zatím není přiřazeno ke známým spotřebičům."})
        m["alerts"] = alerts


def heat_allocator_summary(data: dict) -> dict[str, Any]:
    """Summarize radiator heat allocators without pretending their units are GJ.

    Heat-cost allocators mounted on radiators normally expose cumulative allocation
    units. We therefore calculate raw and coefficient-adjusted deltas between
    readings. A reset reading starts a new counter from zero.
    """
    all_readings = data.get("heat_allocator_readings", [])
    devices = []
    rooms: dict[str, dict[str, Any]] = {}
    total_raw = 0.0
    total_adjusted = 0.0
    latest_raw = 0.0
    latest_adjusted = 0.0

    for allocator in data.get("heat_allocators", []):
        aid = allocator.get("id")
        coeff = float(allocator.get("coefficient", 1.0) or 1.0)
        rows = sorted(
            [r for r in all_readings if r.get("allocator_id") == aid],
            key=lambda r: (str(r.get("date", "")), str(r.get("id", ""))),
        )
        prev_value = float(allocator.get("base_value", 0) or 0)
        prev_date = str(allocator.get("base_date", ""))
        intervals = []
        device_raw = 0.0
        device_adjusted = 0.0

        for row in rows:
            current = float(row.get("value", 0) or 0)
            current_date = str(row.get("date", ""))
            reset = bool(row.get("reset", False))
            raw_delta = current if reset else current - prev_value
            valid = raw_delta >= 0 and (not prev_date or current_date >= prev_date)
            adjusted = raw_delta * coeff if valid else 0.0
            if valid:
                device_raw += raw_delta
                device_adjusted += adjusted
            intervals.append({
                "from_date": prev_date,
                "to_date": current_date,
                "from_value": prev_value,
                "to_value": current,
                "raw_usage": raw_delta if valid else 0.0,
                "adjusted_usage": adjusted,
                "reset": reset,
                "valid": valid,
            })
            prev_value, prev_date = current, current_date

        latest = rows[-1] if rows else None
        latest_interval = intervals[-1] if intervals else None
        room = str(allocator.get("room", "")).strip() or "Bez místnosti"
        device = {
            **allocator,
            "latest": latest,
            "latest_interval": latest_interval,
            "intervals": intervals,
            "total_raw_usage": device_raw,
            "total_adjusted_usage": device_adjusted,
        }
        devices.append(device)
        total_raw += device_raw
        total_adjusted += device_adjusted
        if latest_interval and latest_interval.get("valid"):
            latest_raw += float(latest_interval.get("raw_usage", 0) or 0)
            latest_adjusted += float(latest_interval.get("adjusted_usage", 0) or 0)

        room_row = rooms.setdefault(room, {
            "room": room, "devices": 0, "total_raw_usage": 0.0,
            "total_adjusted_usage": 0.0, "latest_raw_usage": 0.0,
            "latest_adjusted_usage": 0.0,
        })
        room_row["devices"] += 1
        room_row["total_raw_usage"] += device_raw
        room_row["total_adjusted_usage"] += device_adjusted
        if latest_interval and latest_interval.get("valid"):
            room_row["latest_raw_usage"] += float(latest_interval.get("raw_usage", 0) or 0)
            room_row["latest_adjusted_usage"] += float(latest_interval.get("adjusted_usage", 0) or 0)

    devices.sort(key=lambda d: (str(d.get("room", "")).lower(), str(d.get("name", "")).lower()))
    room_rows = sorted(rooms.values(), key=lambda r: str(r.get("room", "")).lower())
    return {
        "devices": devices,
        "rooms": room_rows,
        "total_raw_usage": total_raw,
        "total_adjusted_usage": total_adjusted,
        "latest_raw_usage": latest_raw,
        "latest_adjusted_usage": latest_adjusted,
    }


def dashboard(data: dict) -> dict[str, Any]:
    months = compute_months(data)
    threshold = float(data.get("settings", {}).get("unassigned_alert_ratio", 0.30) or 0.30)
    add_alerts(months, threshold)
    latest = months[-1] if months else None

    if latest:
        start, end = billing_cycle(latest["month"], int(data.get("settings", {}).get("billing_start_month", 1)))
        cycle_months = [m for m in months if start <= m["month"] <= end]
    else:
        start = end = None
        cycle_months = []

    actual_cost = sum(m["total_cost"] for m in cycle_months)
    paid = 0.0
    projected_paid_total = 0.0
    if latest and start and end:
        current_idx = month_index(latest["month"])
        start_idx = month_index(start)
        end_idx = month_index(end)
        for idx in range(start_idx, current_idx + 1):
            rule = advance_for_month(data.get("advances", []), month_from_index(idx))
            paid += sum(float(rule.get(f"{u}_monthly", 0) or 0) for u in UTILITIES)
        for idx in range(start_idx, end_idx + 1):
            rule = advance_for_month(data.get("advances", []), month_from_index(idx))
            projected_paid_total += sum(float(rule.get(f"{u}_monthly", 0) or 0) for u in UTILITIES)

    current_balance = paid - actual_cost
    projected_balance = current_balance
    projected_cost_total = actual_cost
    if latest and end and cycle_months:
        remaining = max(0, months_between(latest["month"], end))
        avg_cost = actual_cost / len(cycle_months)
        projected_cost_total += avg_cost * remaining
        projected_balance = projected_paid_total - projected_cost_total

    heat_advance_exists = any(float(a.get("heat_monthly", 0) or 0) > 0 for a in data.get("advances", []))
    has_radiator_heat = bool(data.get("heat_allocators"))
    has_legacy_heat_meter = any(m.get("utility") == "heat" for m in data.get("meters", []))
    heat_price_exists = any(float(t.get("heat_per_gj", 0) or 0) > 0 for t in data.get("tariffs", []))
    heat_cost_trackable = (has_radiator_heat or has_legacy_heat_meter) and heat_price_exists

    return {
        "settings": data.get("settings", {}),
        "months": months,
        "latest": latest,
        "heat_allocators": heat_allocator_summary(data),
        "finance_notes": {
            "heat_advance_without_cost": heat_advance_exists and not heat_cost_trackable,
            "heat_from_radiators": has_radiator_heat,
            "heat_definition_provisional": has_radiator_heat,
        },
        "billing": {
            "start": start,
            "end": end,
            "paid": paid,
            "actual_cost": actual_cost,
            "current_balance": current_balance,
            "projected_paid_total": projected_paid_total,
            "projected_cost_total": projected_cost_total,
            "projected_balance": projected_balance,
        },
    }
