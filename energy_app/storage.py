from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from copy import deepcopy
from pathlib import Path

DEFAULT_DATA = {
    "settings": {
        "household_name": "Moje domácnost",
        "billing_start_month": 3,
        "currency": "CZK",
        "unassigned_alert_ratio": 0.30,
    },
    "meters": [],
    "meter_readings": [],
    "appliances": [],
    "cycles": [],
    "tariffs": [],
    "advances": [],
    "heat_allocators": [],
    "heat_allocator_readings": [],
    "sensors": [],
    "sensor_readings": [],
}


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def migrate(data: dict) -> dict:
    """Upgrade older JSON layouts without discarding user data."""
    data = deepcopy(data) if isinstance(data, dict) else {}
    for key, value in DEFAULT_DATA.items():
        data.setdefault(key, deepcopy(value))
    for key, value in DEFAULT_DATA["settings"].items():
        data["settings"].setdefault(key, value)

    legacy = data.pop("readings", None)
    if legacy and not data.get("meters") and not data.get("meter_readings"):
        defs = [
            ("electricity", "Elektroměr", "kWh", "electricity_kwh"),
            ("cold_water", "Vodoměr studené vody", "m³", "water_m3"),
            ("gas", "Plynoměr", "m³", "gas_m3"),
        ]
        for utility, name, unit, field in defs:
            meter_id = _id("meter")
            rows = sorted(legacy, key=lambda r: r.get("month", ""))
            first = rows[0] if rows else None
            base = float(first.get(field, 0) or 0) if first else 0.0
            base_date = f"{first['month']}-01" if first and first.get("month") else ""
            data["meters"].append({"id": meter_id, "name": name, "utility": utility, "unit": unit, "base_value": base, "base_date": base_date})
            for row in rows[1:]:
                month = str(row.get("month", ""))[:7]
                if len(month) == 7:
                    data["meter_readings"].append({"id": _id("reading"), "meter_id": meter_id, "date": f"{month}-28", "value": float(row.get(field, 0) or 0)})

    migrated_advances = []
    for tariff in data.get("tariffs", []):
        effective = str(tariff.get("effective_from", ""))
        if len(effective) == 7:
            tariff["effective_from"] = effective + "-01"
        tariff.setdefault("id", _id("tariff"))
        if "water_per_m3" in tariff and "cold_water_per_m3" not in tariff:
            tariff["cold_water_per_m3"] = float(tariff.get("water_per_m3", 0) or 0)
        tariff.pop("water_per_m3", None)
        tariff.setdefault("cold_water_per_m3", 0.0)
        tariff.setdefault("hot_water_per_m3", 0.0)
        tariff.setdefault("heat_per_gj", 0.0)
        tariff.setdefault("electricity_per_kwh", 0.0)
        tariff.setdefault("gas_per_m3", 0.0)
        fixed_keys = (
            "electricity_fixed_monthly", "cold_water_fixed_monthly",
            "hot_water_fixed_monthly", "gas_fixed_monthly", "heat_fixed_monthly",
        )
        # v1-v3 had one shared fixed fee. Preserve its total by assigning it
        # to electricity on migration; the user can then split it explicitly.
        legacy_fixed = tariff.pop("fixed_monthly", None)
        if legacy_fixed is not None and not any(k in tariff for k in fixed_keys):
            tariff["electricity_fixed_monthly"] = float(legacy_fixed or 0)
        for key in fixed_keys:
            tariff.setdefault(key, 0.0)
        if "advance_monthly" in tariff:
            amount = float(tariff.pop("advance_monthly", 0) or 0)
            migrated_advances.append({
                "id": _id("advance"), "effective_from": tariff["effective_from"],
                "electricity_monthly": amount, "cold_water_monthly": 0.0,
                "hot_water_monthly": 0.0, "gas_monthly": 0.0, "heat_monthly": 0.0,
            })
    if migrated_advances and not data.get("advances"):
        data["advances"] = migrated_advances

    for a in data.get("advances", []):
        a.setdefault("id", _id("advance"))
        effective = str(a.get("effective_from", ""))
        if len(effective) == 7:
            a["effective_from"] = effective + "-01"
        if "water_monthly" in a and "cold_water_monthly" not in a:
            a["cold_water_monthly"] = float(a.get("water_monthly", 0) or 0)
        a.pop("water_monthly", None)
        for key in ("electricity_monthly", "cold_water_monthly", "hot_water_monthly", "gas_monthly", "heat_monthly"):
            a.setdefault(key, 0.0)

    for m in data.get("meters", []):
        m.setdefault("id", _id("meter"))
        if m.get("utility") == "water":
            m["utility"] = "cold_water"
            if m.get("name") == "Vodoměr":
                m["name"] = "Vodoměr studené vody"
        m.setdefault("base_value", 0.0)
        m.setdefault("base_date", "")
        units = {"electricity": "kWh", "cold_water": "m³", "hot_water": "m³", "gas": "m³", "heat": "GJ"}
        if m.get("utility") in units:
            m["unit"] = units[m["utility"]]

    for ap in data.get("appliances", []):
        if "water_l_per_day" in ap and "cold_water_l_per_day" not in ap:
            ap["cold_water_l_per_day"] = float(ap.get("water_l_per_day", 0) or 0)
        if "water_l_per_cycle" in ap and "cold_water_l_per_cycle" not in ap:
            ap["cold_water_l_per_cycle"] = float(ap.get("water_l_per_cycle", 0) or 0)
        ap.pop("water_l_per_day", None)
        ap.pop("water_l_per_cycle", None)
        ap.setdefault("cold_water_l_per_day", 0.0)
        ap.setdefault("hot_water_l_per_day", 0.0)
        ap.setdefault("cold_water_l_per_cycle", 0.0)
        ap.setdefault("hot_water_l_per_cycle", 0.0)

    for r in data.get("meter_readings", []):
        r.setdefault("id", _id("reading"))
    for h in data.get("heat_allocators", []):
        h.setdefault("id", _id("heatalloc"))
        h.setdefault("name", "Radiátor")
        h.setdefault("room", "")
        h.setdefault("serial_number", "")
        h.setdefault("unit", "jednotek")
        h.setdefault("coefficient", 1.0)
        h.setdefault("base_value", 0.0)
        h.setdefault("base_date", "")
    for r in data.get("heat_allocator_readings", []):
        r.setdefault("id", _id("heatreading"))
        r.setdefault("reset", False)

    # Starší verze obsahovala teplotní/vlhkostní senzory. Data ponecháváme
    # v JSON beze změny kvůli bezpečné migraci, ale už je nevydáváme za
    # měřiče spotřeby tepla na radiátorech.
    for s in data.get("sensors", []):
        s.setdefault("id", _id("sensor"))
    for r in data.get("sensor_readings", []):
        r.setdefault("id", _id("sensorreading"))

    return data


class JsonStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        if not self.path.exists():
            self._write(DEFAULT_DATA)

    def _write(self, data: dict) -> None:
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(self.path)

    def load(self) -> dict:
        with self._lock:
            try:
                with self.path.open("r", encoding="utf-8") as f:
                    raw = json.load(f)
            except (json.JSONDecodeError, OSError):
                raw = deepcopy(DEFAULT_DATA)
            data = migrate(raw)
            if data != raw:
                self._write(data)
            return data

    def save(self, data: dict) -> None:
        with self._lock:
            data = migrate(data)
            if self.path.exists():
                backup = self.path.with_name(self.path.stem + ".backup" + self.path.suffix)
                try:
                    shutil.copy2(self.path, backup)
                except OSError:
                    pass
            self._write(data)
