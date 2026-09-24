from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import subprocess
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from urllib.request import urlopen

from energy_app.analytics import dashboard
from energy_app.storage import JsonStore

APP_NAME = "Energy Home"
APP_VERSION = "1.0.0"
RUNTIME_HEARTBEAT_INTERVAL = 3.0
RUNTIME_HEARTBEAT_TIMEOUT = 20.0
RUNTIME_STARTUP_TIMEOUT = 30.0

BASE_DIR = Path(__file__).resolve().parent


def get_user_data_dir() -> Path:
    """Return a writable per-user directory for persistent Energy Home data."""
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))

    target = root / "EnergyHome"
    target.mkdir(parents=True, exist_ok=True)
    return target


DATA_DIR = get_user_data_dir()
DATA_FILE = DATA_DIR / "energy_data.json"
RUNTIME_FILE = DATA_DIR / "runtime.json"
BROWSER_PROFILE_DIR = DATA_DIR / "browser-profile"

_heartbeat_lock = threading.Lock()
_last_heartbeat = 0.0
_heartbeat_seen = threading.Event()

# One-time migration from the old portable/project layout.
legacy_data_file = BASE_DIR / "data" / "energy_data.json"
legacy_backup_file = BASE_DIR / "data" / "energy_data.backup.json"

if not DATA_FILE.exists() and legacy_data_file.is_file():
    try:
        shutil.copy2(legacy_data_file, DATA_FILE)
        if legacy_backup_file.is_file():
            shutil.copy2(legacy_backup_file, DATA_DIR / "energy_data.backup.json")
    except OSError:
        pass

store = JsonStore(DATA_FILE)

UTILITY_UNITS = {"electricity": "kWh", "cold_water": "m³", "hot_water": "m³", "gas": "m³", "heat": "GJ"}
SENSOR_DEFAULT_UNITS = {"temperature": "°C", "humidity": "%", "custom": ""}


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def integer(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "ano"}


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def valid_date(value: Any) -> str:
    text = str(value or "")[:10]
    if len(text) != 10 or text[4] != "-" or text[7] != "-":
        raise ValueError("Datum musí být ve formátu YYYY-MM-DD.")
    return text


def valid_month(value: Any) -> str:
    text = str(value or "")[:7]
    if len(text) != 7 or text[4] != "-":
        raise ValueError("Měsíc musí být ve formátu YYYY-MM.")
    return text


def save_meter(p: dict) -> dict:
    data = store.load()
    meter_id = str(p.get("id") or uid("meter"))
    utility = str(p.get("utility", "electricity"))
    if utility not in UTILITY_UNITS:
        raise ValueError("Neplatný typ měřidla.")
    base_value = number(p.get("base_value"))
    if base_value < 0:
        raise ValueError("Počáteční stav nesmí být záporný.")
    base_date = valid_date(p.get("base_date"))
    row = {
        "id": meter_id,
        "name": str(p.get("name", "Měřidlo")).strip() or "Měřidlo",
        "utility": utility,
        "unit": UTILITY_UNITS[utility],
        "base_value": base_value,
        "base_date": base_date,
    }
    data["meters"] = [m for m in data["meters"] if m.get("id") != meter_id]
    data["meters"].append(row)
    store.save(data)
    return {"ok": True, "id": meter_id}


def save_meter_reading(p: dict) -> dict:
    data = store.load()
    meter_id = str(p.get("meter_id", ""))
    meter = next((m for m in data["meters"] if m.get("id") == meter_id), None)
    if not meter:
        raise ValueError("Vyberte existující měřidlo.")
    reading_date = valid_date(p.get("date"))
    value = number(p.get("value"))
    if value < 0:
        raise ValueError("Stav měřidla nesmí být záporný.")
    if reading_date < meter.get("base_date", ""):
        raise ValueError("Odečet nemůže být před datem počátečního stavu měřidla.")
    reading_id = str(p.get("id") or uid("reading"))
    row = {"id": reading_id, "meter_id": meter_id, "date": reading_date, "value": value}
    data["meter_readings"] = [r for r in data["meter_readings"] if r.get("id") != reading_id]
    data["meter_readings"].append(row)
    data["meter_readings"].sort(key=lambda r: (r.get("date", ""), r.get("meter_id", "")))
    store.save(data)
    return {"ok": True, "id": reading_id, "dashboard": dashboard(data)}


def save_appliance(p: dict) -> dict:
    data = store.load()
    appliance_id = p.get("id") or uid("app")
    kind = p.get("kind", "active")
    if kind not in {"active", "passive"}:
        raise ValueError("Neplatný typ spotřebiče.")
    row = {
        "id": appliance_id,
        "name": str(p.get("name", "Spotřebič")).strip() or "Spotřebič",
        "kind": kind,
        "electricity_kwh_per_day": number(p.get("electricity_kwh_per_day")),
        "cold_water_l_per_day": number(p.get("cold_water_l_per_day")),
        "hot_water_l_per_day": number(p.get("hot_water_l_per_day")),
        "gas_m3_per_day": number(p.get("gas_m3_per_day")),
        "electricity_kwh_per_cycle": number(p.get("electricity_kwh_per_cycle")),
        "cold_water_l_per_cycle": number(p.get("cold_water_l_per_cycle")),
        "hot_water_l_per_cycle": number(p.get("hot_water_l_per_cycle")),
        "gas_m3_per_cycle": number(p.get("gas_m3_per_cycle")),
    }
    data["appliances"] = [a for a in data["appliances"] if a.get("id") != appliance_id]
    data["appliances"].append(row)
    store.save(data)
    return {"ok": True, "id": appliance_id}


def save_cycle(p: dict) -> dict:
    month = valid_month(p.get("month"))
    appliance_id = str(p.get("appliance_id", ""))
    cycles = max(0, integer(p.get("cycles")))
    data = store.load()
    data["cycles"] = [c for c in data["cycles"] if not (c.get("month") == month and c.get("appliance_id") == appliance_id)]
    data["cycles"].append({"month": month, "appliance_id": appliance_id, "cycles": cycles})
    store.save(data)
    return {"ok": True}


def save_tariff(p: dict) -> dict:
    effective_from = valid_date(p.get("effective_from"))
    data = store.load()
    row_id = str(p.get("id") or uid("tariff"))
    row = {
        "id": row_id,
        "effective_from": effective_from,
        "electricity_per_kwh": number(p.get("electricity_per_kwh")),
        "cold_water_per_m3": number(p.get("cold_water_per_m3")),
        "hot_water_per_m3": number(p.get("hot_water_per_m3")),
        "gas_per_m3": number(p.get("gas_per_m3")),
        "heat_per_gj": number(p.get("heat_per_gj")),
        "electricity_fixed_monthly": number(p.get("electricity_fixed_monthly")),
        "cold_water_fixed_monthly": number(p.get("cold_water_fixed_monthly")),
        "hot_water_fixed_monthly": number(p.get("hot_water_fixed_monthly")),
        "gas_fixed_monthly": number(p.get("gas_fixed_monthly")),
        "heat_fixed_monthly": number(p.get("heat_fixed_monthly")),
    }
    # Same date = replace that version; a new date creates a new historical version.
    data["tariffs"] = [t for t in data["tariffs"] if t.get("id") != row_id and t.get("effective_from") != effective_from]
    data["tariffs"].append(row)
    data["tariffs"].sort(key=lambda t: t["effective_from"])
    store.save(data)
    return {"ok": True, "id": row_id}


def save_advance(p: dict) -> dict:
    effective_from = valid_date(p.get("effective_from"))
    data = store.load()
    row_id = str(p.get("id") or uid("advance"))
    row = {
        "id": row_id,
        "effective_from": effective_from,
        "electricity_monthly": number(p.get("electricity_monthly")),
        "cold_water_monthly": number(p.get("cold_water_monthly")),
        "hot_water_monthly": number(p.get("hot_water_monthly")),
        "gas_monthly": number(p.get("gas_monthly")),
        "heat_monthly": number(p.get("heat_monthly")),
    }
    data["advances"] = [a for a in data["advances"] if a.get("id") != row_id and a.get("effective_from") != effective_from]
    data["advances"].append(row)
    data["advances"].sort(key=lambda a: a["effective_from"])
    store.save(data)
    return {"ok": True, "id": row_id}


def save_sensor(p: dict) -> dict:
    data = store.load()
    sensor_id = str(p.get("id") or uid("sensor"))
    kind = str(p.get("kind", "temperature"))
    if kind not in SENSOR_DEFAULT_UNITS:
        raise ValueError("Neplatný typ čidla.")
    unit = str(p.get("unit", "")).strip() or SENSOR_DEFAULT_UNITS[kind]
    row = {
        "id": sensor_id,
        "name": str(p.get("name", "Čidlo")).strip() or "Čidlo",
        "location": str(p.get("location", "")).strip(),
        "kind": kind,
        "unit": unit,
    }
    data["sensors"] = [s for s in data["sensors"] if s.get("id") != sensor_id]
    data["sensors"].append(row)
    store.save(data)
    return {"ok": True, "id": sensor_id}


def save_sensor_reading(p: dict) -> dict:
    data = store.load()
    sensor_id = str(p.get("sensor_id", ""))
    if not any(s.get("id") == sensor_id for s in data["sensors"]):
        raise ValueError("Vyberte existující čidlo.")
    dt = str(p.get("datetime", ""))[:16]
    if len(dt) < 16 or dt[4] != "-" or dt[7] != "-" or "T" not in dt:
        raise ValueError("Zadejte platné datum a čas měření.")
    row_id = str(p.get("id") or uid("sensorreading"))
    row = {"id": row_id, "sensor_id": sensor_id, "datetime": dt, "value": number(p.get("value"))}
    data["sensor_readings"] = [r for r in data["sensor_readings"] if r.get("id") != row_id]
    data["sensor_readings"].append(row)
    data["sensor_readings"].sort(key=lambda r: r.get("datetime", ""))
    store.save(data)
    return {"ok": True, "id": row_id}


def save_heat_allocator(p: dict) -> dict:
    data = store.load()
    allocator_id = str(p.get("id") or uid("heatalloc"))
    base_value = number(p.get("base_value"))
    coefficient = number(p.get("coefficient"), 1.0)
    if base_value < 0:
        raise ValueError("Počáteční stav topného měřiče nesmí být záporný.")
    if coefficient <= 0:
        raise ValueError("Přepočtový koeficient musí být větší než 0.")
    base_date = valid_date(p.get("base_date"))
    row = {
        "id": allocator_id,
        "name": str(p.get("name", "Radiátor")).strip() or "Radiátor",
        "room": str(p.get("room", "")).strip(),
        "serial_number": str(p.get("serial_number", "")).strip(),
        "unit": str(p.get("unit", "jednotek")).strip() or "jednotek",
        "coefficient": coefficient,
        "base_value": base_value,
        "base_date": base_date,
    }
    data["heat_allocators"] = [h for h in data["heat_allocators"] if h.get("id") != allocator_id]
    data["heat_allocators"].append(row)
    data["heat_allocators"].sort(key=lambda h: (str(h.get("room", "")).lower(), str(h.get("name", "")).lower()))
    store.save(data)
    return {"ok": True, "id": allocator_id}


def save_heat_allocator_reading(p: dict) -> dict:
    data = store.load()
    allocator_id = str(p.get("allocator_id", ""))
    allocator = next((h for h in data["heat_allocators"] if h.get("id") == allocator_id), None)
    if not allocator:
        raise ValueError("Vyberte existující topný měřič.")
    reading_date = valid_date(p.get("date"))
    value = number(p.get("value"))
    reset = boolean(p.get("reset"))
    if value < 0:
        raise ValueError("Stav topného měřiče nesmí být záporný.")
    if reading_date < allocator.get("base_date", ""):
        raise ValueError("Odečet nemůže být před datem počátečního stavu.")

    reading_id = str(p.get("id") or uid("heatreading"))
    existing = [r for r in data["heat_allocator_readings"] if r.get("allocator_id") == allocator_id and r.get("id") != reading_id]
    prior = [r for r in existing if str(r.get("date", "")) < reading_date]
    if prior:
        prev = max(prior, key=lambda r: str(r.get("date", "")))
        prev_value = float(prev.get("value", 0) or 0)
    else:
        prev_value = float(allocator.get("base_value", 0) or 0)
    if value < prev_value and not reset:
        raise ValueError("Nový stav je nižší než předchozí. Pokud se měřič vynuloval nebo byl vyměněn, označte odečet jako reset / nový cyklus.")

    following = sorted([r for r in existing if str(r.get("date", "")) > reading_date], key=lambda r: str(r.get("date", "")))
    if following:
        nxt = following[0]
        if not boolean(nxt.get("reset")) and float(nxt.get("value", 0) or 0) < value:
            raise ValueError("Tento stav by byl vyšší než následující odečet. Upravte hodnotu nebo označte následující odečet jako reset.")

    row = {"id": reading_id, "allocator_id": allocator_id, "date": reading_date, "value": value, "reset": reset}
    data["heat_allocator_readings"] = [
        r for r in data["heat_allocator_readings"]
        if r.get("id") != reading_id and not (r.get("allocator_id") == allocator_id and r.get("date") == reading_date)
    ]
    data["heat_allocator_readings"].append(row)
    data["heat_allocator_readings"].sort(key=lambda r: (r.get("date", ""), r.get("allocator_id", "")))
    store.save(data)
    return {"ok": True, "id": reading_id, "dashboard": dashboard(data)}


def save_settings(p: dict) -> dict:
    data = store.load()
    data["settings"].update({
        "household_name": str(p.get("household_name", data["settings"].get("household_name", "Moje domácnost"))).strip(),
        "billing_start_month": min(12, max(1, integer(p.get("billing_start_month"), 1))),
        "currency": str(p.get("currency", "CZK")).strip() or "CZK",
        "unassigned_alert_ratio": max(0.0, number(p.get("unassigned_alert_ratio"), 0.30)),
    })
    store.save(data)
    return {"ok": True}


def mark_heartbeat() -> None:
    global _last_heartbeat
    with _heartbeat_lock:
        _last_heartbeat = time.monotonic()
    _heartbeat_seen.set()


def get_last_heartbeat() -> float:
    with _heartbeat_lock:
        return _last_heartbeat


def runtime_script() -> str:
    # Injected into index.html so the local server knows when all app windows are gone.
    return r"""
<script>
(() => {
  const heartbeat = () => {
    fetch('/api/runtime/heartbeat', {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    }).catch(() => {});
  };

  heartbeat();
  window.setInterval(heartbeat, 3000);

  // External links (for example GitHub) should not replace the Energy Home UI.
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    try {
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } catch (_) {}
  }, true);
})();
</script>
"""


def edge_executable() -> Path | None:
    candidates: list[Path] = []

    found = shutil.which("msedge")
    if found:
        candidates.append(Path(found))

    for env_name in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        root = os.environ.get(env_name)
        if root:
            candidates.append(Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe")

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def open_app_window(url: str) -> None:
    edge = edge_executable()
    if edge is not None:
        BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.Popen(
                [
                    str(edge),
                    f"--app={url}",
                    f"--user-data-dir={BROWSER_PROFILE_DIR}",
                    "--no-first-run",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except OSError:
            pass

    # Fallback for machines where Edge cannot be found.
    webbrowser.open(url)


def write_runtime_file(host: str, port: int) -> None:
    payload = {
        "app": "EnergyHome",
        "version": APP_VERSION,
        "host": host,
        "port": port,
        "pid": os.getpid(),
    }
    temp = RUNTIME_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(RUNTIME_FILE)


def remove_runtime_file(port: int) -> None:
    try:
        if not RUNTIME_FILE.is_file():
            return
        payload = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
        if int(payload.get("port", -1)) == int(port):
            RUNTIME_FILE.unlink(missing_ok=True)
    except (OSError, ValueError, json.JSONDecodeError):
        pass


def find_running_instance() -> str | None:
    if not RUNTIME_FILE.is_file():
        return None

    try:
        payload = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
        if payload.get("app") != "EnergyHome":
            return None
        host = str(payload.get("host") or "127.0.0.1")
        port = int(payload["port"])
        url = f"http://{host}:{port}"
        with urlopen(f"{url}/health", timeout=0.8) as response:
            health = json.loads(response.read().decode("utf-8"))
        if health.get("ok") and health.get("app") == "EnergyHome":
            return url
    except Exception:
        try:
            RUNTIME_FILE.unlink(missing_ok=True)
        except OSError:
            pass
    return None


def start_runtime_watchdog(server: ThreadingHTTPServer) -> None:
    started = time.monotonic()

    def watch() -> None:
        while True:
            time.sleep(2.0)

            if _heartbeat_seen.is_set():
                last = get_last_heartbeat()
                if last and (time.monotonic() - last) > RUNTIME_HEARTBEAT_TIMEOUT:
                    server.shutdown()
                    return
            elif (time.monotonic() - started) > RUNTIME_STARTUP_TIMEOUT:
                # The UI never connected (browser failed to open, was blocked, etc.).
                server.shutdown()
                return

    threading.Thread(target=watch, name="EnergyHomeWatchdog", daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server_version = "HomeEnergy/6.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # No console output in the packaged desktop build.
        return

    def _serve_index(self) -> None:
        path = BASE_DIR / "templates" / "index.html"
        if not path.is_file():
            self.send_error(404)
            return

        html = path.read_text(encoding="utf-8")
        script = runtime_script()
        if "</body>" in html:
            html = html.replace("</body>", f"{script}\n</body>", 1)
        else:
            html += script

        raw = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _serve_file(self, path: Path) -> None:
        path = path.resolve()
        if BASE_DIR.resolve() not in path.parents and path != BASE_DIR.resolve():
            self.send_error(403)
            return
        if not path.is_file():
            self.send_error(404)
            return
        raw = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith(("text/", "application/javascript")) else mime)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            return self._serve_index()
        if path == "/api/state":
            data = store.load()
            return self._json({"data": data, "dashboard": dashboard(data)})
        if path == "/health":
            return self._json({"ok": True, "app": "EnergyHome", "version": APP_VERSION})
        if path.startswith("/static/"):
            rel = unquote(path[len("/static/"):])
            return self._serve_file(BASE_DIR / "static" / rel)
        self.send_error(404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/runtime/heartbeat":
            mark_heartbeat()
            return self._json({"ok": True})

        try:
            payload = self._read_json()
            routes = {
                "/api/meters": save_meter,
                "/api/meter-readings": save_meter_reading,
                "/api/appliances": save_appliance,
                "/api/cycles": save_cycle,
                "/api/tariffs": save_tariff,
                "/api/advances": save_advance,
                "/api/sensors": save_sensor,
                "/api/sensor-readings": save_sensor_reading,
                "/api/heat-allocators": save_heat_allocator,
                "/api/heat-allocator-readings": save_heat_allocator_reading,
                "/api/settings": save_settings,
            }
            fn = routes.get(path)
            if not fn:
                self.send_error(404)
                return
            self._json(fn(payload))
        except (ValueError, json.JSONDecodeError) as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:
            self._json({"error": f"Interní chyba: {exc}"}, 500)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        data = store.load()
        if path.startswith("/api/meters/"):
            rid = unquote(path.split("/api/meters/", 1)[1])
            data["meters"] = [m for m in data["meters"] if m.get("id") != rid]
            data["meter_readings"] = [r for r in data["meter_readings"] if r.get("meter_id") != rid]
        elif path.startswith("/api/meter-readings/"):
            rid = unquote(path.split("/api/meter-readings/", 1)[1])
            data["meter_readings"] = [r for r in data["meter_readings"] if r.get("id") != rid]
        elif path.startswith("/api/appliances/"):
            rid = unquote(path.split("/api/appliances/", 1)[1])
            data["appliances"] = [a for a in data["appliances"] if a.get("id") != rid]
            data["cycles"] = [c for c in data["cycles"] if c.get("appliance_id") != rid]
        elif path.startswith("/api/tariffs/"):
            rid = unquote(path.split("/api/tariffs/", 1)[1])
            data["tariffs"] = [t for t in data["tariffs"] if t.get("id") != rid]
        elif path.startswith("/api/advances/"):
            rid = unquote(path.split("/api/advances/", 1)[1])
            data["advances"] = [a for a in data["advances"] if a.get("id") != rid]
        elif path.startswith("/api/heat-allocators/"):
            rid = unquote(path.split("/api/heat-allocators/", 1)[1])
            data["heat_allocators"] = [h for h in data["heat_allocators"] if h.get("id") != rid]
            data["heat_allocator_readings"] = [r for r in data["heat_allocator_readings"] if r.get("allocator_id") != rid]
        elif path.startswith("/api/heat-allocator-readings/"):
            rid = unquote(path.split("/api/heat-allocator-readings/", 1)[1])
            data["heat_allocator_readings"] = [r for r in data["heat_allocator_readings"] if r.get("id") != rid]
        elif path.startswith("/api/sensors/"):
            rid = unquote(path.split("/api/sensors/", 1)[1])
            data["sensors"] = [s for s in data["sensors"] if s.get("id") != rid]
            data["sensor_readings"] = [r for r in data["sensor_readings"] if r.get("sensor_id") != rid]
        elif path.startswith("/api/sensor-readings/"):
            rid = unquote(path.split("/api/sensor-readings/", 1)[1])
            data["sensor_readings"] = [r for r in data["sensor_readings"] if r.get("id") != rid]
        else:
            self.send_error(404)
            return
        store.save(data)
        self._json({"ok": True})


def create_server(host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Energy Home - local desktop application")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    # If an instance is already running, open another window to it instead of
    # starting a second local server.
    if not args.no_browser:
        existing = find_running_instance()
        if existing:
            open_app_window(existing)
            return

    server = create_server(args.host, args.port)
    port = int(server.server_address[1])
    url = f"http://{args.host}:{port}"
    write_runtime_file(args.host, port)

    if not args.no_browser:
        start_runtime_watchdog(server)
        threading.Timer(0.5, lambda: open_app_window(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        remove_runtime_file(port)


if __name__ == "__main__":
    main()
