import base64
import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from energy_app.github_sync import GitHubSync, GitHubContents, VersionConflict, merge_documents, _dpapi
from energy_app.storage import DEFAULT_DATA, JsonStore


def doc(**changes):
    data = deepcopy(DEFAULT_DATA)
    data.update(changes)
    return data


class CredentialAndGitHubApiTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows DPAPI only")
    def test_windows_dpapi_round_trip(self):
        secret = b"test-token-not-a-real-token"
        self.assertEqual(_dpapi(_dpapi(secret), decrypt=True), secret)

    def test_sync_client_unprotects_secret_before_utf8_decoding(self):
        """Previously, encrypted bytes were passed straight to UTF-8 decode."""
        fake_token = "github_pat_example_not_real"
        # Start with bytes that cannot be decoded as UTF-8.
        encrypted = bytes([0x9d, 0xff]) + fake_token.encode("utf-8")
        config = {
            "repo": "example/private",
            "secret": base64.b64encode(encrypted).decode("ascii"),
        }
        with tempfile.TemporaryDirectory() as folder:
            store = JsonStore(Path(folder) / "energy_data.json")
            engine = GitHubSync(store, Path(folder))
            def fake_dpapi(blob, decrypt=False):
                self.assertTrue(decrypt, "Encrypted token must be decrypted before decoding")
                self.assertEqual(blob, encrypted)
                return fake_token.encode("utf-8")
            with patch("energy_app.github_sync._dpapi", side_effect=fake_dpapi) as dpapi:
                client = engine._client(config)
            self.assertEqual(dpapi.call_count, 1)
            self.assertEqual(client.token, fake_token)
            self.assertEqual(client.repo, "example/private")

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI only")
    def test_windows_sync_client_uses_real_dpapi_decryption(self):
        """Exercise the actual Windows encrypt -> config -> decrypt path."""
        fake_token = "github_pat_test_only_do_not_use"
        encrypted = _dpapi(fake_token.encode("utf-8"))
        with tempfile.TemporaryDirectory() as folder:
            store = JsonStore(Path(folder) / "energy_data.json")
            engine = GitHubSync(store, Path(folder))
            client = engine._client({
                "repo": "example/private",
                "secret": base64.b64encode(encrypted).decode("ascii"),
            })
            self.assertEqual(client.token, fake_token)
            self.assertEqual(client.repo, "example/private")

    def test_corrupt_credential_has_actionable_error(self):
        from energy_app.github_sync import SyncError
        with tempfile.TemporaryDirectory() as folder:
            store = JsonStore(Path(folder) / "energy_data.json")
            engine = GitHubSync(store, Path(folder))
            with self.assertRaisesRegex(SyncError, "GitHub token nelze přečíst"):
                engine._client({"repo": "example/private", "secret": "not-base64%"})

    def test_git_blob_fallback_for_content_over_one_megabyte(self):
        from unittest.mock import patch as mock_patch
        import base64
        api = GitHubContents("owner/private", "fake-token")
        record = {"type": "file", "sha": "abc", "encoding": "none", "content": ""}
        blob = {"content": base64.b64encode(json.dumps(DEFAULT_DATA).encode()).decode()}
        with mock_patch.object(api, "_request", side_effect=[record, blob]) as request:
            data, sha = api.read()
        self.assertEqual(sha, "abc")
        self.assertEqual(data["meters"], [])
        self.assertEqual(request.call_count, 2)


class LocalRecoveryCompatibilityTests(unittest.TestCase):
    def test_default_install_keeps_original_backup_recovery(self):
        with tempfile.TemporaryDirectory() as folder:
            store = JsonStore(Path(folder) / "energy_data.json")
            populated = store.load()
            populated["meters"].append({"id": "meter1", "name": "Existing"})
            store.save(populated)
            # An accidentally reset primary must still recover from backup.
            store.save(deepcopy(DEFAULT_DATA))
            self.assertEqual(store.load()["meters"][0]["name"], "Existing")

    def test_opted_in_device_allows_intentional_deletion_even_after_disconnect(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "energy_data.json"
            store = JsonStore(path)
            store.enable_sync_history()
            populated = store.load()
            populated["meters"].append({"id": "meter1", "name": "Existing"})
            store.save(populated)
            store.save(deepcopy(DEFAULT_DATA))
            self.assertEqual(store.load()["meters"], [])
            # Permanent marker retains the deletion after restarting app.
            second_run = JsonStore(path)
            self.assertEqual(second_run.load()["meters"], [])


class MergeTests(unittest.TestCase):
    def test_two_new_readings_on_separate_computers(self):
        b = doc()
        a = doc(meter_readings=[{"id": "r1", "meter_id": "m1", "date": "2026-10-01", "value": 1}])
        c = doc(meter_readings=[{"id": "r2", "meter_id": "m1", "date": "2026-10-02", "value": 2}])
        merged, conflicts = merge_documents(b, a, c)
        self.assertEqual(conflicts, [])
        self.assertEqual(len(merged["meter_readings"]), 2)

    def test_non_overlapping_fields_on_same_record(self):
        row = {"id": "m1", "name": "Původní", "unit": "kWh", "base_value": 0}
        b = doc(meters=[row])
        a = doc(meters=[dict(row, name="Nové")])
        c = doc(meters=[dict(row, base_value=42)])
        merged, conflicts = merge_documents(b, a, c)
        self.assertEqual(conflicts, [])
        self.assertEqual(merged["meters"][0]["name"], "Nové")
        self.assertEqual(merged["meters"][0]["base_value"], 42)

    def test_delete_does_not_resurrect_record(self):
        row = {"id": "m1", "name": "Elektroměr"}
        b = doc(meters=[row])
        merged, conflicts = merge_documents(b, doc(), b)
        self.assertFalse(conflicts)
        self.assertEqual(merged["meters"], [])

    def test_delete_versus_edit_is_conflict(self):
        row = {"id": "m1", "name": "Elektroměr"}
        b = doc(meters=[row])
        edited = doc(meters=[dict(row, name="Nové")])
        merged, conflicts = merge_documents(b, doc(), edited)
        self.assertTrue(conflicts)
        self.assertEqual(merged["meters"], [])
        resolved, _ = merge_documents(b, doc(), edited, "remote")
        self.assertEqual(resolved["meters"][0]["name"], "Nové")

    def test_simultaneous_edit_requires_explicit_choice(self):
        b = doc(settings=dict(DEFAULT_DATA["settings"], household_name="Original"))
        local = doc(settings=dict(DEFAULT_DATA["settings"], household_name="Já"))
        remote = doc(settings=dict(DEFAULT_DATA["settings"], household_name="Partner"))
        result, conflicts = merge_documents(b, local, remote)
        self.assertIn("settings.household_name", conflicts)
        self.assertEqual(result["settings"]["household_name"], "Já")
        resolved, _ = merge_documents(b, local, remote, "remote")
        self.assertEqual(resolved["settings"]["household_name"], "Partner")

    def test_same_tariff_date_is_one_logical_record(self):
        b = doc()
        a = doc(tariffs=[{"id": "t1", "effective_from": "2026-10-01", "gas_per_m3": 4}])
        c = doc(tariffs=[{"id": "t2", "effective_from": "2026-10-01", "gas_per_m3": 5}])
        _, conflicts = merge_documents(b, a, c)
        self.assertTrue(conflicts)


class FakeGitHub:
    def __init__(self):
        self.data = doc()
        self.sha = None
        self.writes = 0
        self.race = False

    def check_private(self):
        return None

    def read(self):
        return deepcopy(self.data), self.sha

    def write(self, data, sha):
        if self.race:
            self.race = False
            self.data["settings"]["currency"] = "EUR"
            self.sha = "race"
            raise VersionConflict("Changed by other client")
        if sha != self.sha:
            raise VersionConflict("Stale SHA")
        self.writes += 1
        self.data = deepcopy(data)
        self.sha = str(self.writes)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        folder = Path(self.dir.name)
        self.store = JsonStore(folder / "energy_data.json")
        self.sync = GitHubSync(self.store, folder)
        self.sync.config_file.write_text(json.dumps({"repo": "example/private", "secret": "fake"}))
        self.store.enable_sync_history()
        self.cloud = FakeGitHub()
        mock = patch.object(self.sync, "_client", return_value=self.cloud)
        mock.start()
        self.addCleanup(mock.stop)

    def test_local_upload_remote_download_and_no_data_loss(self):
        data = self.store.load()
        data["meters"].append({"id": "m1", "name": "First"})
        self.store.save(data)
        self.assertTrue(self.sync.sync()["ok"])
        self.assertEqual(self.cloud.data["meters"][0]["name"], "First")
        self.cloud.data["meter_readings"].append({
            "id": "r1", "meter_id": "m1", "date": "2026-10-01", "value": 13
        })
        self.cloud.sha = "remote2"
        self.assertTrue(self.sync.sync()["updated"])
        self.assertEqual(len(self.store.load()["meter_readings"]), 1)

    def test_conflict_blocks_push_until_resolved(self):
        self.assertTrue(self.sync.sync()["ok"])
        changed = self.store.load()
        changed["settings"]["household_name"] = "Místní"
        self.store.save(changed)
        self.cloud.data["settings"]["household_name"] = "Vzdálená"
        self.cloud.sha = "other"
        writes = self.cloud.writes
        result = self.sync.sync()
        self.assertFalse(result["ok"])
        self.assertEqual(self.cloud.writes, writes)
        self.assertEqual(self.store.load()["settings"]["household_name"], "Místní")
        self.assertTrue(self.sync.sync("remote")["ok"])
        self.assertEqual(self.store.load()["settings"]["household_name"], "Vzdálená")

    def test_retry_on_github_sha_collision_preserves_both_edits(self):
        changed = self.store.load()
        changed["settings"]["household_name"] = "Místní"
        self.store.save(changed)
        self.cloud.race = True
        self.assertTrue(self.sync.sync()["ok"])
        self.assertEqual(self.cloud.data["settings"]["household_name"], "Místní")
        self.assertEqual(self.cloud.data["settings"]["currency"], "EUR")

    def test_deleting_last_record_stays_deleted(self):
        current = self.store.load()
        current["meters"].append({"id": "m1", "name": "Temporary"})
        self.store.save(current)
        self.sync.sync()
        current = self.store.load()
        current["meters"] = []
        self.store.save(current)
        self.sync.sync()
        self.assertEqual(self.cloud.data["meters"], [])
        self.assertEqual(self.store.load()["meters"], [])


if __name__ == "__main__":
    unittest.main()
