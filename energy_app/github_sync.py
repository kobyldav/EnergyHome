"""Optional GitHub Contents API sync for a private, separate data repository.

No third-party dependencies. Token is protected by Windows DPAPI, never sent to
the browser after setup. All cloud operations require explicit configuration.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import re
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from energy_app.storage import DEFAULT_DATA, migrate

SYNC_FILENAME = "energyhome-data.json"
SYNC_INTERVAL = 30
MAX_REMOTE_BYTES = 3_000_000
COLLECTION_KEYS = {
    "meters": ("id",), "meter_readings": ("meter_id", "date"),
    "appliances": ("id",), "cycles": ("appliance_id", "month"),
    "tariffs": ("effective_from",), "advances": ("effective_from",),
    "heat_allocators": ("id",),
    "heat_allocator_readings": ("allocator_id", "date"),
    "sensors": ("id",), "sensor_readings": ("sensor_id", "datetime"),
}
_MISSING = object()


class SyncError(Exception):
    pass


class VersionConflict(SyncError):
    pass


def _dpapi(data: bytes, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        raise SyncError("Ukládání GitHub tokenu je podporované pouze ve Windows (DPAPI).")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    source = ctypes.create_string_buffer(data)
    inp = Blob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    out = Blob()
    crypt = ctypes.windll.crypt32
    func = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    # CRYPTPROTECT_UI_FORBIDDEN; user-context DPAPI encryption.
    if decrypt:
        ok = func(ctypes.byref(inp), None, None, None, None, 0x1, ctypes.byref(out))
    else:
        ok = func(ctypes.byref(inp), None, None, None, None, 0x1, ctypes.byref(out))
    if not ok:
        raise SyncError("Windows nedokázal zabezpečit nebo přečíst GitHub token.")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


def _atomic_json(path: Path, value: dict) -> None:
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _identity(row: dict, fields: tuple[str, ...]) -> tuple:
    if not isinstance(row, dict) or any(row.get(k) is None for k in fields):
        raise SyncError("Synchronizovaná kolekce obsahuje záznam bez identifikátoru.")
    return tuple(str(row[k]) for k in fields)


def _index(rows: list, fields: tuple[str, ...]) -> dict:
    if not isinstance(rows, list):
        raise SyncError("Synchronizovaná kolekce má neplatný formát.")
    result = {}
    for row in rows:
        key = _identity(row, fields)
        if key in result:
            raise SyncError("Duplicitní záznam v synchronizované kolekci.")
        result[key] = row
    return result


def merge_documents(base: dict, local: dict, remote: dict, preference: str | None = None):
    """Three-way merge. Record deletions are preserved; incompatible edits conflict.

    preference='local' / 'remote' explicitly resolves conflicting values only.
    """
    conflicts = []
    def merge(b, l, r, path):
        if l is _MISSING and r is _MISSING:
            return _MISSING
        if l == r:
            return deepcopy(l)
        if l == b:
            return deepcopy(r) if r is not _MISSING else _MISSING
        if r == b:
            return deepcopy(l) if l is not _MISSING else _MISSING
        if isinstance(l, dict) and isinstance(r, dict) and (isinstance(b, dict) or b is _MISSING):
            prior = {} if b is _MISSING else b
            result = {}
            for key in sorted(set(prior) | set(l) | set(r)):
                value = merge(prior.get(key, _MISSING), l.get(key, _MISSING),
                              r.get(key, _MISSING), path + "." + str(key))
                if value is not _MISSING:
                    result[key] = value
            return result
        conflicts.append(path)
        chosen = r if preference == "remote" else l
        return deepcopy(chosen) if chosen is not _MISSING else _MISSING

    combined = {}
    keys = set(base) | set(local) | set(remote)
    for key in sorted(keys):
        if key in COLLECTION_KEYS:
            ident = COLLECTION_KEYS[key]
            bi = _index(base.get(key, []), ident)
            li = _index(local.get(key, []), ident)
            ri = _index(remote.get(key, []), ident)
            merged_rows = []
            for rid in sorted(set(bi) | set(li) | set(ri)):
                value = merge(bi.get(rid, _MISSING), li.get(rid, _MISSING),
                              ri.get(rid, _MISSING), key + "[" + "|".join(rid) + "]")
                if value is not _MISSING:
                    merged_rows.append(value)
            combined[key] = merged_rows
        else:
            value = merge(base.get(key, _MISSING), local.get(key, _MISSING),
                          remote.get(key, _MISSING), str(key))
            if value is not _MISSING:
                combined[key] = value
    return migrate(combined), conflicts


class GitHubContents:
    def __init__(self, repo: str, token: str):
        self.repo, self.token = repo, token

    def _request(self, method: str, suffix: str, payload: dict | None = None,
                 missing_ok: bool = False):
        url = "https://api.github.com/repos/" + self.repo + suffix
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        req = Request(url, data=data, method=method, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + self.token,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "EnergyHome-Desktop",
            "Content-Type": "application/json",
        })
        try:
            with urlopen(req, timeout=12) as response:
                raw = response.read(MAX_REMOTE_BYTES * 2 + 500_000)
                return json.loads(raw)
        except HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            if error.code in (409, 422) and method == "PUT":
                raise VersionConflict("GitHub mezitím změnil data.") from None
            raise SyncError("GitHub API: HTTP " + str(error.code) + ". Ověřte přístup a oprávnění tokenu.") from None
        except (URLError, TimeoutError, OSError):
            raise SyncError("GitHub není dostupný. Místní data jsou zachována.") from None
        except (ValueError, UnicodeDecodeError):
            raise SyncError("GitHub vrátil neplatnou odpověď.") from None

    def check_private(self):
        info = self._request("GET", "")
        if not info.get("private", False):
            raise SyncError("Z bezpečnostních důvodů musí být datový repozitář soukromý (Private).")
        if info.get("archived"):
            raise SyncError("Archivovaný repozitář nelze používat pro synchronizaci.")

    def read(self):
        record = self._request("GET", "/contents/" + quote(SYNC_FILENAME), missing_ok=True)
        if record is None:
            return migrate(deepcopy(DEFAULT_DATA)), None
        if record.get("type") != "file" or not record.get("sha"):
            raise SyncError("Cílová cesta na GitHubu není platný soubor.")
        try:
            # The Contents API omits inline content for files above 1 MB.
            # Fetch the Git blob instead without relaxing our 3 MB limit.
            encoded = record.get("content")
            if not encoded or record.get("encoding") == "none":
                blob = self._request("GET", "/git/blobs/" + quote(record["sha"]))
                encoded = blob["content"]
            binary = base64.b64decode(encoded, validate=False)
            if len(binary) > MAX_REMOTE_BYTES:
                raise SyncError("Soubor na GitHubu překračuje limit 3 MB.")
            value = json.loads(binary.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError()
            for key in COLLECTION_KEYS:
                if key in value and not isinstance(value[key], list):
                    raise ValueError()
            if "settings" in value and not isinstance(value["settings"], dict):
                raise ValueError()
            return migrate(value), record["sha"]
        except (KeyError, ValueError, UnicodeDecodeError):
            raise SyncError("Data na GitHubu nejsou platný EnergyHome JSON.") from None

    def write(self, data: dict, sha: str | None):
        packed = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        if len(packed) > MAX_REMOTE_BYTES:
            raise SyncError("Data přesahují limit 3 MB pro GitHub synchronizaci.")
        payload = {
            "message": "EnergyHome: synchronize household data",
            "content": base64.b64encode(packed).decode("ascii"),
        }
        if sha:
            payload["sha"] = sha
        self._request("PUT", "/contents/" + quote(SYNC_FILENAME), payload)


class GitHubSync:
    def __init__(self, store, folder: Path):
        self.store = store
        self.folder = Path(folder)
        self.config_file = self.folder / "github-sync.json"
        self.base_file = self.folder / "github-sync-base.json"
        self.lock = threading.RLock()
        self.wakeup = threading.Event()
        self.last_synced = None
        self.last_error = ""
        self.conflicts = []
        self.running = False
        self.store.on_save = self.wakeup.set

    def _config(self):
        try:
            config = json.loads(self.config_file.read_text(encoding="utf-8"))
            if isinstance(config, dict) and config.get("repo") and config.get("secret"):
                return config
        except (OSError, ValueError):
            pass
        return None

    def _client(self, cfg):
        token = _dpapi(base64.b64decode(cfg["secret"])).decode("utf-8")
        return GitHubContents(cfg["repo"], token)

    def status(self):
        with self.lock:
            cfg = self._config()
            revision = hashlib.sha256(
                json.dumps(self.store.load(), ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()[:16]
            return {
                "configured": cfg is not None,
                "repo": cfg["repo"] if cfg else "",
                "running": self.running,
                "last_synced": self.last_synced,
                "last_error": self.last_error,
                "conflicts": self.conflicts[:40],
                "data_revision": revision,
            }

    def configure(self, repo: str, token: str):
        repo = repo.strip()
        token = token.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise SyncError("Repozitář zadejte ve formátu vlastník/název.")
        if not token or len(token) > 512:
            raise SyncError("Zadejte platný GitHub token.")
        GitHubContents(repo, token).check_private()
        protected = base64.b64encode(_dpapi(token.encode("utf-8"))).decode("ascii")
        with self.lock:
            current = self._config()
            if current is None or current["repo"] != repo:
                self.base_file.unlink(missing_ok=True)
            _atomic_json(self.config_file, {"repo": repo, "secret": protected})
            # Opted-in devices must not resurrect intentionally deleted records.
            # This marker survives disconnection, keeping existing datasets safe.
            self.store.enable_sync_history()
            self.last_error = ""
            self.conflicts = []
            self.wakeup.set()
        return self.status()

    def disconnect(self):
        with self.lock:
            self.config_file.unlink(missing_ok=True)
            self.base_file.unlink(missing_ok=True)
            self.last_error = ""
            self.conflicts = []
            self.last_synced = None
            self.wakeup.clear()
            return self.status()

    def sync(self, preference: str | None = None):
        if preference not in (None, "local", "remote"):
            raise SyncError("Neplatný způsob vyřešení konfliktu.")
        with self.lock:
            cfg = self._config()
            if not cfg:
                raise SyncError("Nejprve zapněte GitHub synchronizaci.")
            self.running = True
            try:
                api = self._client(cfg)
                # Refuse to continue if someone later makes the data repository public.
                api.check_private()
                # Lock across remote CAS: local writes cannot race with a pull/push.
                with self.store._lock:
                    local = self.store.load()
                    if self.base_file.exists():
                        base = migrate(json.loads(self.base_file.read_text(encoding="utf-8")))
                    else:
                        base = migrate(deepcopy(DEFAULT_DATA))
                    for attempt in range(4):
                        remote, sha = api.read()
                        merged, conflicts = merge_documents(base, local, remote, preference)
                        if conflicts and preference is None:
                            self.conflicts = conflicts[:40]
                            self.last_error = "Konflikt změn: vyberte, kterou hodnotu ponechat."
                            return {"ok": False, "conflicts": self.conflicts}
                        if merged != remote:
                            try:
                                api.write(merged, sha)
                            except VersionConflict:
                                if attempt == 3:
                                    raise SyncError("GitHub data se současně mění. Zkuste synchronizaci znovu.")
                                continue
                        # Only advance baseline after successful remote commit (or pull).
                        if merged != local:
                            self.store.save(merged, notify=False)
                        _atomic_json(self.base_file, merged)
                        self.last_synced = datetime.now(timezone.utc).isoformat()
                        self.last_error = ""
                        self.conflicts = []
                        return {"ok": True, "updated": merged != local}
                raise SyncError("Synchronizace se nezdařila.")
            except (SyncError, OSError, ValueError, KeyError) as error:
                self.last_error = str(error)
                raise SyncError(str(error)) from None
            finally:
                self.running = False

    def start(self):
        def worker():
            while True:
                self.wakeup.wait(SYNC_INTERVAL)
                self.wakeup.clear()
                # Collect quick successive changes into one GitHub commit.
                time.sleep(1)
                if self._config():
                    try:
                        self.sync()
                    except SyncError:
                        pass
        threading.Thread(target=worker, name="EnergyHomeGitHubSync", daemon=True).start()
        self.wakeup.set()
