import unittest
from datetime import date

from energy_app.periods import daily_usage, financial_position, month_consumption


class DailyConsumptionTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "settings": {"billing_start_month": 1},
            "meters": [{"id": "elec", "name": "Elektřina", "utility": "electricity",
                        "base_date": "2026-10-01", "base_value": 0}],
            "meter_readings": [
                {"id": "a", "meter_id": "elec", "date": "2026-10-11", "value": 100},
                {"id": "b", "meter_id": "elec", "date": "2026-10-20", "value": 190},
            ],
            "heat_allocators": [], "heat_allocator_readings": [], "tariffs": [], "advances": []
        }

    def test_daily_axis_is_correct_for_31_day_month_and_multiple_readings(self):
        series = month_consumption(self.payload, "2026-10")
        self.assertEqual(series["days_in_month"], 31)
        self.assertEqual(len(series["days"]), 31)
        self.assertEqual(series["days"][0]["day"], 1)
        self.assertEqual(series["days"][-1]["day"], 31)
        self.assertAlmostEqual(series["days"][10]["measured"]["electricity"], 10)
        self.assertAlmostEqual(series["days"][19]["measured"]["electricity"], 10)
        self.assertEqual(series["days"][10]["readings"]["electricity"], 1)
        self.assertEqual(series["days"][19]["readings"]["electricity"], 1)
        self.assertAlmostEqual(sum(row["measured"]["electricity"] for row in series["days"]), 190)
        self.assertTrue(series["days"][4]["estimated"]["electricity"])

    def test_multiple_readings_on_same_day_are_aggregated_and_marked(self):
        self.payload["meter_readings"] = [
            {"id": "a", "meter_id": "elec", "date": "2026-10-11", "value": 100},
            {"id": "b", "meter_id": "elec", "date": "2026-10-11", "value": 130},
        ]
        series = month_consumption(self.payload, "2026-10")
        self.assertEqual(series["days"][10]["readings"]["electricity"], 2)
        self.assertAlmostEqual(sum(row["measured"]["electricity"] for row in series["days"]), 130)
        self.assertAlmostEqual(series["days"][10]["measured"]["electricity"], 40)

    def test_legacy_meter_without_base_date_uses_reading_day(self):
        self.payload["meters"][0]["base_date"] = ""
        self.payload["meter_readings"] = [{
            "id": "first", "meter_id": "elec",
            "date": "2026-10-15", "value": 27
        }]
        series = month_consumption(self.payload, "2026-10")
        self.assertAlmostEqual(series["days"][14]["measured"]["electricity"], 27)
        self.assertAlmostEqual(
            sum(day["measured"]["electricity"] for day in series["days"]), 27
        )

    def test_leap_february_and_invalid_month(self):
        series = month_consumption(self.payload, "2028-02")
        self.assertEqual(series["days_in_month"], 29)
        self.assertEqual(series["days"][-1]["day"], 29)
        with self.assertRaises(ValueError):
            month_consumption(self.payload, "2026-13")

    def test_radiator_heat_reset_and_multiple_readings(self):
        self.payload["heat_allocators"] = [{
            "id": "h1", "name": "Radiátor", "base_date": "2026-10-01",
            "base_value": 100, "coefficient": 2
        }]
        self.payload["heat_allocator_readings"] = [
            {"id": "r1", "allocator_id": "h1", "date": "2026-10-04", "value": 109},
            {"id": "r2", "allocator_id": "h1", "date": "2026-10-09", "value": 4, "reset": True},
        ]
        series = month_consumption(self.payload, "2026-10")
        self.assertAlmostEqual(sum(r["measured"]["heat"] for r in series["days"]), 26)
        self.assertEqual(series["days"][3]["readings"]["heat"], 1)
        self.assertEqual(series["days"][8]["readings"]["heat"], 1)


class FinancialPeriodTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "meters": [{
                "id": "elec", "name": "Main meter", "utility": "electricity",
                "base_date": "2026-10-01", "base_value": 0
            }],
            "meter_readings": [
                {"id": "read", "meter_id": "elec", "date": "2026-10-10", "value": 90}
            ],
            "heat_allocators": [], "heat_allocator_readings": [],
            "tariffs": [{
                "effective_from": "2026-01-01",
                "electricity_per_kwh": 2,
                "electricity_fixed_monthly": 310
            }],
            "advances": [{"effective_from": "2026-01-01", "electricity_monthly": 620}]
        }

    def test_six_day_custom_period_uses_exact_selected_days(self):
        result = financial_position(self.payload, "2026-10-05", "2026-10-10", date(2026, 10, 10))
        self.assertAlmostEqual(result["actual_cost"], 6 * (10 * 2 + 310 / 31))
        self.assertAlmostEqual(result["paid"], 6 * 620 / 31)
        self.assertAlmostEqual(result["current_balance"], -60)
        self.assertEqual(result["projected_balance"], result["current_balance"])

    def test_current_month_projects_after_today_not_as_paid(self):
        result = financial_position(self.payload, "2026-10-01", "2026-10-31", date(2026, 10, 10))
        self.assertAlmostEqual(result["paid"], 10 * 620 / 31)
        self.assertAlmostEqual(result["projected_paid_total"], 620)
        self.assertAlmostEqual(result["actual_cost"], 90 * 2 + 10 * 310 / 31)
        # Base date is Oct 1; the first measured interval covers Oct 2–10.
        # Forecast applies 10 units/day only to the remaining 21 days.
        self.assertAlmostEqual(result["projected_cost_total"], 30 * 10 * 2 + 310)

    def test_cross_month_custom_period_and_date_validation(self):
        result = financial_position(self.payload, "2026-09-30", "2026-10-02", date(2026, 10, 10))
        self.assertEqual(result["start"], "2026-09-30")
        self.assertEqual(result["end"], "2026-10-02")
        with self.assertRaises(ValueError):
            financial_position(self.payload, "2026-10-11", "2026-10-10")
        with self.assertRaises(ValueError):
            financial_position(self.payload, "2026-02-30", "2026-03-30")


if __name__ == "__main__":
    unittest.main()
