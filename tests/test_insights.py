import unittest
from datetime import date

from energy_app.insights import history_insights


class HistoricalInsightsTests(unittest.TestCase):
    def sample(self):
        return {
            "settings": {"heat_accounting_mode": "apartment"},
            "meters": [{
                "id": "electric", "name": "Hlavní elektroměr", "utility": "electricity",
                "base_date": "2026-10-01", "base_value": 0,
            }],
            "meter_readings": [{
                "id": "e1", "meter_id": "electric", "date": "2026-11-01", "value": 31,
            }],
            "heat_allocators": [{
                "id": "heater", "name": "U okna", "room": "Kuchyně",
                "base_date": "2026-10-01", "base_value": 0, "coefficient": 1,
            }],
            "heat_allocator_readings": [{
                "id": "h1", "allocator_id": "heater", "date": "2026-11-01", "value": 62,
            }],
            "appliances": [
                {"id": "fridge", "name": "Lednička", "kind": "passive",
                 "electricity_kwh_per_day": 0.7},
                {"id": "washer", "name": "Pračka", "kind": "active",
                 "electricity_kwh_per_cycle": 1.0},
            ],
            "cycles": [{"appliance_id": "washer", "month": "2026-10", "cycles": 20}],
            "tariffs": [], "advances": [],
        }

    def test_multimonth_reading_is_split_and_appliance_models_are_separate(self):
        results = history_insights(self.sample(), "2026-11", date(2026, 11, 2))
        self.assertEqual(len(results["months"]), 12)
        bymonth = {m["month"]: m for m in results["months"]}
        october, november, september = (bymonth["2026-10"],
                                        bymonth["2026-11"],
                                        bymonth["2026-09"])
        self.assertIsNone(september["electricity_kwh"])
        self.assertIsNone(september["heat_units"])
        self.assertAlmostEqual(october["electricity_kwh"], 30)
        self.assertAlmostEqual(november["electricity_kwh"], 1)
        self.assertAlmostEqual(october["heat_units"], 60)
        self.assertAlmostEqual(november["heat_units"], 2)
        self.assertEqual(october["electricity_covered_days"], 30)
        self.assertEqual(november["electricity_covered_days"], 1)
        self.assertAlmostEqual(october["passive_kwh"], 21)
        self.assertAlmostEqual(november["passive_kwh"], 0.7)
        self.assertAlmostEqual(october["active_kwh"], 20 * 30 / 31)
        self.assertEqual(november["active_kwh"], 0)
        self.assertEqual(
            next(p for p in november["appliances"] if p["id"] == "washer")["cycles"],
            None,
        )
        self.assertAlmostEqual(
            next(p for p in october["appliances"] if p["id"] == "washer")["cycles"],
            20,
        )
        self.assertGreater(october["model_excess_kwh"], 0)
        self.assertEqual(october["unassigned_kwh"], 0)
        self.assertEqual(november["heat_devices"][0]["room"], "Kuchyně")

    def test_no_readings_does_not_create_fake_zero_month(self):
        sample=self.sample()
        sample["meter_readings"]=[]
        sample["heat_allocator_readings"]=[]
        results=history_insights(sample, "2026-11", date(2026, 11, 2))
        for month in results["months"]:
            self.assertIsNone(month["electricity_kwh"])
            self.assertIsNone(month["heat_units"])
            self.assertEqual(month["electricity_covered_days"],0)
            self.assertEqual(month["passive_kwh"],0)
            self.assertEqual(month["active_kwh"],0)
            self.assertIsNone(month["unassigned_kwh"])

    def test_invalid_months_rejected(self):
        for month in ("", "2026-13", "2026-1", "not a month"):
            with self.assertRaises(ValueError):
                history_insights(self.sample(), month)
        with self.assertRaises(ValueError):
            history_insights(self.sample(), "2026-11", count=25)


if __name__ == "__main__":
    unittest.main()
