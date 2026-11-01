"""Illustrative apartment heating allocation from building settlement inputs.

NOT an official annual bill: providers may apply additional room/location
corrections, minimum/maximum per-area adjustments, special categories, etc.
All building cost, area and corrected-unit totals must refer to SAME period.
"""
from __future__ import annotations

import math


def apartment_heat_estimate(settings: dict) -> dict:
    keys = (
        "heat_apartment_area_m2", "heat_building_area_m2",
        "heat_building_cost_czk", "heat_apartment_units", "heat_building_units",
    )
    values = {}
    for key in keys:
        try:
            values[key] = float(settings.get(key) or 0)
        except (ValueError, TypeError):
            values[key] = 0
    base_pct = float(settings.get("heat_base_share_pct", 50) or 50)
    missing = [key for key in keys if values[key] <= 0 and key != "heat_apartment_units"]
    if missing:
        return {"ready": False, "missing": missing, "reason": "Doplňte údaje za stejný zúčtovací rok."}
    own_area = values["heat_apartment_area_m2"]
    house_area = values["heat_building_area_m2"]
    own_units = values["heat_apartment_units"]
    house_units = values["heat_building_units"]
    cost = values["heat_building_cost_czk"]
    if (own_area > house_area or own_units < 0 or own_units > house_units or
            not all(math.isfinite(v) for v in values.values()) or
            not math.isfinite(base_pct) or not 30 <= base_pct <= 70):
        return {"ready": False, "missing": [], "reason": "Prověřte údaje: podíly musí být platné a základní složka 30–70 %."}
    basic = cost * base_pct / 100 * own_area / house_area
    consumption = cost * (100 - base_pct) / 100 * own_units / house_units
    return {
        "ready": True, "period_year": int(settings.get("heat_settlement_year") or 0),
        "base_cost": basic, "consumption_cost": consumption,
        "total": basic + consumption, "base_percent": base_pct,
        "area_fraction": own_area / house_area, "unit_fraction": own_units / house_units,
        "note": "Pouze orientační předvýpočet ze zadaných ročních údajů. Nezohledňuje povinné korekce ani limity na m²; rozhodující je vyúčtování správce.",
    }
