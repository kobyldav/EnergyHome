import unittest
from datetime import date

from energy_app.actuals import confirmed_month


class ConfirmedMonthTests(unittest.TestCase):
    def base(self):
        return {
            "meters": [{"id": "meter", "name": "Elektroměr", "utility": "electricity",
                        "base_date": "2026-09-30", "base_value": 100}],
            "meter_readings": [],
            "heat_allocators": [], "heat_allocator_readings": [],
            "tariffs": [{"effective_from": "2026-01-01",
                         "electricity_per_kwh": 2, "electricity_fixed_monthly": 310}],
            "advances": [{"effective_from": "2026-01-01", "electricity_monthly": 620}],
        }

    def test_full_month_requires_real_boundary_readings(self):
        data = self.base()
        data["meter_readings"] = [
            {"date": "2026-10-15", "value": 140, "id": "r1", "meter_id": "meter"},
            {"date": "2026-10-31", "value": 200, "id": "r2", "meter_id": "meter"},
        ]
        result = confirmed_month(data, "2026-10", today=date(2026, 11, 1))
        self.assertEqual(result["status"]["electricity"], "complete")
        self.assertEqual(result["measured"]["electricity"], 100)
        self.assertEqual(len(result["events"]["electricity"]), 2)
        self.assertEqual(result["total_cost"], 510)
        self.assertEqual(result["advance"], 620)
        self.assertEqual(result["days"][14]["measured"]["electricity"], 40)
        self.assertEqual(result["days"][30]["measured"]["electricity"], 60)
        self.assertEqual(result["days"][4]["measured"]["electricity"], 0)
        self.assertFalse(any(day["estimated"]["electricity"] for day in result["days"]))

    def test_cross_month_interval_never_disguised_as_measured_month(self):
        data = self.base()
        data["meters"][0]["base_date"] = "2026-09-27"
        data["meter_readings"] = [
            {"date": "2026-10-10", "value": 200, "id": "r1", "meter_id": "meter"},
            {"date": "2026-10-25", "value": 215, "id": "r2", "meter_id": "meter"},
        ]
        result = confirmed_month(data, "2026-10", today=date(2026, 11, 1))
        self.assertEqual(result["status"]["electricity"], "partial")
        self.assertEqual(result["measured"]["electricity"], 15)
        self.assertEqual(len(result["events"]["electricity"]), 1)

    def test_no_future_readings_or_projected_volume(self):
        data = self.base()
        data["meter_readings"] = [
            {"date": "2026-10-10", "value": 150, "id": "r1", "meter_id": "meter"},
            {"date": "2026-10-21", "value": 200, "id": "r2", "meter_id": "meter"},
        ]
        result = confirmed_month(data, "2026-10", today=date(2026, 10, 10))
        self.assertEqual(result["measured"]["electricity"], 50)
        self.assertEqual(result["status"]["electricity"], "to_date")
        self.assertEqual(result["advance"], 200)
        self.assertEqual(result["fixed_costs"]["electricity"], 100)
        self.assertEqual(result["days"][20]["measured"]["electricity"], 0)
        self.assertNotIn("projected_cost_total", result)

    def test_heating_reset_and_legacy_meter_not_double_counted(self):
        data = self.base()
        data["meters"].append({"id": "heatmeter", "utility": "heat",
                               "base_date": "2026-09-30", "base_value": 0})
        data["meter_readings"].append({"id": "hm", "meter_id": "heatmeter",
                                       "date": "2026-10-31", "value": 999})
        data["heat_allocators"] = [{"id": "h1", "name": "Ložnice", "coefficient": 2,
                                    "base_date": "2026-09-30", "base_value": 100}]
        data["heat_allocator_readings"] = [
            {"id": "h1a", "allocator_id": "h1", "date": "2026-10-10", "value": 110},
            {"id": "h1b", "allocator_id": "h1", "date": "2026-10-31", "value": 5, "reset": True},
        ]
        result = confirmed_month(data, "2026-10", today=date(2026, 11, 1))
        self.assertEqual(result["measured"]["heat"], 30)
        self.assertEqual(result["status"]["heat"], "complete")

    def test_missing_and_invalid_month(self):
        data = self.base()
        result = confirmed_month(data, "2026-10", today=date(2026, 11, 1))
        self.assertIsNone(result["measured"]["electricity"])
        self.assertEqual(result["status"]["electricity"], "missing")
        for bad in ("2026-13", "2026-1", "2026-02-01", ""):
            with self.assertRaises(ValueError):
                confirmed_month(data, bad)


if __name__ == "__main__":
    unittest.main()
