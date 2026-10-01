import unittest
from datetime import date

from energy_app.analytics import (
    _appliance_month_usage,
    _covered_dates,
    _fixed_fraction_for_month,
    meter_monthly_usage,
)


class IntervalAnalyticsTests(unittest.TestCase):
    def test_cross_month_interval_is_split_by_days(self):
        data = {
            "meters": [{
                "id": "m1", "name": "Elektroměr", "utility": "electricity",
                "unit": "kWh", "base_value": 100.0, "base_date": "2026-09-23",
            }],
            "meter_readings": [{
                "id": "r1", "meter_id": "m1", "date": "2026-10-01", "value": 112.8,
            }],
        }
        totals, _, coverage = meter_monthly_usage(data)
        self.assertAlmostEqual(totals["2026-09"]["electricity"], 11.2, places=6)
        self.assertAlmostEqual(totals["2026-10"]["electricity"], 1.6, places=6)
        self.assertEqual(coverage["2026-09"]["electricity"], 7)
        self.assertEqual(coverage["2026-10"]["electricity"], 1)

    def test_one_day_interval_belongs_to_current_reading_day(self):
        days = _covered_dates("2026-09-30", "2026-10-01")
        self.assertEqual(days, [date(2026, 10, 1)])

    def test_passive_profile_uses_covered_days_not_full_month(self):
        fridge = {
            "kind": "passive",
            "electricity_kwh_per_day": 0.718,
            "cold_water_l_per_day": 0,
            "hot_water_l_per_day": 0,
            "gas_m3_per_day": 0,
        }
        usage = _appliance_month_usage(
            fridge, 0, "2026-10", {"electricity": 1}
        )
        self.assertAlmostEqual(usage["electricity"], 0.718, places=6)

    def test_current_fixed_fee_can_be_prorated(self):
        self.assertAlmostEqual(
            _fixed_fraction_for_month("2026-10", date(2026, 10, 1)),
            1 / 31,
            places=9,
        )


if __name__ == "__main__":
    unittest.main()
