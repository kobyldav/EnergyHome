"""Local user-initiated diagnostic TXT report.

Never reads GitHub credentials and never sends diagnostics to an external service.
The report may contain household readings and prices; UI warns before copying.
"""
from __future__ import annotations

import json
import platform
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from energy_app.actuals import confirmed_month

_PRIVATE_KEYS = ("password", "secret", "token", "credential", "authorization", "api_key", "private_key")


def sanitized(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if any(word in str(key).lower() for word in _PRIVATE_KEYS)
            else sanitized(item)
            for key, item in value.items()
        }
    if isinstance(value, (tuple, list)):
        return [sanitized(item) for item in value]
    return value


def build_debug_report(
    data: dict, month: str, *,
    version: str, build_id: str, sync_status: dict,
    data_file: Path | None = None, backup_file: Path | None = None,
) -> str:
    view = confirmed_month(data, month)
    records = (
        "meters", "meter_readings", "heat_allocators", "heat_allocator_readings",
        "appliances", "cycles", "sensors", "sensor_readings", "tariffs", "advances",
    )
    safe_sync = {key: value for key, value in sync_status.items() if key not in ("repo",)}
    safe_sync["repo"] = "[PRIVATE REPOSITORY]" if sync_status.get("configured") else "[NOT CONFIGURED]"
    summary = {
        "version": version,
        "build_id": build_id,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "python": sys.version.split()[0],
        "operating_system": platform.system(),
        "operating_system_release": platform.release(),
        "selected_month": month,
        "record_counts": {key: len(data.get(key, [])) for key in records},
        "primary_file_exists": data_file.is_file() if data_file else None,
        "primary_file_size_bytes": data_file.stat().st_size if data_file and data_file.is_file() else None,
        "backup_file_exists": backup_file.is_file() if backup_file else None,
        "sync": sanitized(safe_sync),
        "month_actual": sanitized(view),
    }
    parts = [
        "ENERGYHOME – DEBUG TXT",
        "Místní diagnostika – není automaticky odesílána nikam na internet.",
        "POZOR: Výpis obsahuje měření a nastavení domácnosti. Před sdílením jej zkontrolujte.",
        "Přístupové tokeny a hesla jsou skryté; absolutní cesta k souborům se nevypisuje.",
        "",
        "=== APLIKACE, SYNCHRONIZACE A MĚSÍČNÍ VÝPOČTY ===",
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True, default=str),
        "",
        "=== KOMPLETNÍ LOKÁLNÍ DATA DOMÁCNOSTI (BEZ TAJNÝCH ÚDAJŮ) ===",
        json.dumps(sanitized(data), ensure_ascii=False, indent=2, sort_keys=True, default=str),
        "",
        "=== KONEC VÝPISU ===",
    ]
    return "\n".join(parts) + "\n"
