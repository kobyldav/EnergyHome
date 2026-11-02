"""Historical, reading-backed trends and explicitly *modelled* appliance use.

A dashboard month is not the only time period represented in the charts.  The
same confirmed_month allocation engine supplies every historical month so that
cross-boundary readings and all other meter totals have identical semantics.
Appliance profiles are independent estimates, never separate measurements.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from energy_app.actuals import confirmed_month


def history_insights(data: dict, selected_month: str, today: date | None = None, count: int = 12) -> dict:
    today = today or date.today()
    # Validate the month before performing date arithmetic.
    year, number = map(int, selected_month.split("-"))
    if selected_month != f"{year:04d}-{number:02d}" or not 1 <= number <= 12:
        raise ValueError("Neplatný měsíc.")
    if not 1 <= count <= 24:
        raise ValueError("Neplatný rozsah.")
    selected_index = year * 12 + number - 1
    appliances = data.get("appliances", [])
    cycles = {(str(x.get("appliance_id")), str(x.get("month"))): max(0, float(x.get("cycles") or 0))
              for x in data.get("cycles", [])}
    cycle_keys = {(str(x.get("appliance_id")), str(x.get("month"))) for x in data.get("cycles", [])}
    result = []
    for idx in range(selected_index - count + 1, selected_index + 1):
        y, m0 = divmod(idx, 12)
        if y < 1:
            continue
        month = f"{y:04d}-{m0 + 1:02d}"
        actual = confirmed_month(data, month, today=today)
        days = actual["days"]
        days_covered = sum(bool(d["has_allocation"]["electricity"]) for d in days)
        days_in_month = monthrange(y, m0 + 1)[1]
        models = []
        for appliance in appliances:
            appliance_id = str(appliance.get("id") or "")
            kind = "passive" if appliance.get("kind") == "passive" else "active"
            name = str(appliance.get("name") or "Spotřebič")
            cycle_key = (appliance_id, month)
            cycles_count = cycles.get(cycle_key, 0)
            if kind == "passive":
                daily_kwh = max(0.0, float(appliance.get("electricity_kwh_per_day") or 0))
            else:
                daily_kwh = (cycles_count * max(0.0, float(appliance.get("electricity_kwh_per_cycle") or 0))
                             / days_in_month)
            models.append({
                "id": appliance_id, "name": name, "kind": kind,
                "daily_kwh": daily_kwh,
                "estimated_kwh": daily_kwh * days_covered,
                "cycles": cycles_count if kind == "active" and cycle_key in cycle_keys else None,
            })
        passive = sum(a["estimated_kwh"] for a in models if a["kind"] == "passive")
        active = sum(a["estimated_kwh"] for a in models if a["kind"] == "active")
        measured = actual["measured"]["electricity"]
        unassigned = None if measured is None else max(0.0, measured - passive - active)
        excess = None if measured is None else max(0.0, passive + active - measured)
        heat = actual["measured"]["heat"]
        heat_devices = [
            {"id": d["id"], "room": d["room"], "name": d["name"],
             "amount": d["amount"], "has_data": d["has_data"]}
            for d in actual["monthly_devices"] if d["utility"] == "heat"
        ]
        result.append({
            "month": month,
            "electricity_kwh": measured,
            "electricity_status": actual["status"]["electricity"],
            "electricity_covered_days": days_covered,
            "heat_units": heat,
            "heat_status": actual["status"]["heat"],
            "heat_devices": heat_devices,
            "appliances": models,
            "passive_kwh": passive, "active_kwh": active,
            "unassigned_kwh": unassigned,
            "model_excess_kwh": excess,
        })
    return {
        "selected_month": selected_month, "months": result,
        "basis": "Odečty měřidel jsou rozpočítané mezi skutečně pozorovanými stavy. "
                 "Pračky, ledničky a ostatní spotřebiče jsou modelované z jejich profilů a zadaných cyklů.",
    }
