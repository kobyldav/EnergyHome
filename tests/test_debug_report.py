import unittest
from copy import deepcopy
from datetime import date

from energy_app.debug import build_debug_report, sanitized
from energy_app.storage import DEFAULT_DATA


class DebugReportTests(unittest.TestCase):
    def test_report_contains_heat_history_and_redacts_credentials(self):
        data = deepcopy(DEFAULT_DATA)
        data["heat_allocators"] = [{
            "id": "h1", "name": "U okna", "room": "Kuchyně",
            "base_date": "2026-09-21", "base_value": 0, "coefficient": 1,
        }]
        data["heat_allocator_readings"] = [
            {"id": "r1", "allocator_id": "h1", "date": "2026-10-21", "value": 2}
        ]
        data["token"] = "SUPER_SECRET_VALUE_DO_NOT_LEAK"
        data["settings"]["private_key"] = "OTHER_SECRET_VALUE"
        text = build_debug_report(
            data, "2026-10", version="1.0.1", build_id="test-build",
            sync_status={"configured": True, "repo": "user/private-data",
                         "last_error": "", "last_synced": None},
        )
        self.assertIn("ENERGYHOME", text)
        self.assertIn("test-build", text)
        self.assertIn("Kuchyně", text)
        self.assertIn("2026-10-21", text)
        self.assertIn("heat_reading_intervals", text)
        self.assertIn("[REDACTED]", text)
        self.assertNotIn("SUPER_SECRET_VALUE_DO_NOT_LEAK", text)
        self.assertNotIn("OTHER_SECRET_VALUE", text)
        self.assertNotIn("user/private-data", text)

    def test_sanitizer_recurses_into_lists(self):
        value = {"readings": [{"number": 42, "api_key": "SECRET"},
                              {"password": "SECRET2", "value": 3}]}
        result = sanitized(value)
        self.assertEqual(result["readings"][0]["number"], 42)
        self.assertEqual(result["readings"][0]["api_key"], "[REDACTED]")
        self.assertEqual(result["readings"][1]["password"], "[REDACTED]")


if __name__ == "__main__":
    unittest.main()
