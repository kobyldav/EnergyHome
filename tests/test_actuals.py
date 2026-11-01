import unittest
from datetime import date
from math import isclose

from energy_app.actuals import confirmed_month


class AllocatedMonthTests(unittest.TestCase):
    def base(self):
        return {
            "settings": {"heat_accounting_mode": "house"},
            "meters": [{"id": "meter", "name": "Elektroměr", "utility": "electricity",
                        "base_date": "2026-09-30", "base_value": 100}],
            "meter_readings": [], "heat_allocators": [], "heat_allocator_readings": [],
            "tariffs": [{"effective_from": "2026-01-01",
                         "electricity_per_kwh": 2, "electricity_fixed_monthly": 310}],
            "advances": [{"effective_from": "2026-01-01", "electricity_monthly": 620}],
        }

    def test_actual_intervals_are_linear_not_step_spikes(self):
        data = self.base()
        data["meter_readings"] = [
            {"date": "2026-10-15", "value": 140, "id": "r1", "meter_id": "meter"},
            {"date": "2026-10-31", "value": 200, "id": "r2", "meter_id": "meter"},
        ]
        v = confirmed_month(data, "2026-10", date(2026, 11, 1))
        self.assertEqual(v["status"]["electricity"], "complete")
        self.assertAlmostEqual(v["measured"]["electricity"], 100)
        self.assertAlmostEqual(v["days"][0]["measured"]["electricity"], 40 / 15)
        self.assertAlmostEqual(v["days"][14]["measured"]["electricity"], 40 / 15)
        self.assertAlmostEqual(v["days"][15]["measured"]["electricity"], 60 / 16)
        self.assertAlmostEqual(v["days"][30]["measured"]["electricity"], 60 / 16)
        self.assertTrue(v["days"][0]["estimated"]["electricity"])
        self.assertEqual(sum(d["readings"]["electricity"] for d in v["days"]), 2)
        self.assertAlmostEqual(v["total_cost"], 510)
        self.assertAlmostEqual(v["advance"], 620)
        self.assertEqual(v["allocation_method"], "uniform_between_readings")

    def test_cross_month_interval_is_prorated_by_exact_days(self):
        data = self.base()
        data["meters"][0]["base_date"] = "2026-09-27"
        data["meter_readings"] = [
            {"date": "2026-10-10", "value": 200, "id": "r1", "meter_id": "meter"},
            {"date": "2026-10-25", "value": 215, "id": "r2", "meter_id": "meter"},
        ]
        v = confirmed_month(data, "2026-10", date(2026, 11, 1))
        self.assertEqual(v["status"]["electricity"], "partial")
        self.assertAlmostEqual(v["measured"]["electricity"], 100 * 10 / 13 + 15)
        self.assertAlmostEqual(v["days"][0]["measured"]["electricity"], 100 / 13)
        self.assertEqual(v["days"][25]["measured"]["electricity"], 0)
        self.assertFalse(v["days"][25]["has_allocation"]["electricity"])

    def test_future_readings_never_used_or_forecast(self):
        data=self.base()
        data["meter_readings"]=[
            {"date":"2026-10-10","value":150,"id":"r1","meter_id":"meter"},
            {"date":"2026-10-21","value":200,"id":"r2","meter_id":"meter"},
        ]
        v=confirmed_month(data,"2026-10",date(2026,10,10))
        self.assertEqual(v["status"]["electricity"],"to_date")
        self.assertAlmostEqual(v["measured"]["electricity"],50)
        self.assertAlmostEqual(v["advance"],200)
        self.assertAlmostEqual(v["fixed_costs"]["electricity"],100)
        self.assertFalse(v["days"][20]["has_allocation"]["electricity"])
        self.assertNotIn("projected_cost_total",v)

    def test_radiator_reset_and_explicit_provisional_unit_price(self):
        data=self.base()
        data["heat_allocators"]=[{"id":"h1","name":"Ložnice","coefficient":2,
                                  "base_date":"2026-09-30","base_value":100}]
        data["heat_allocator_readings"]=[
            {"id":"r1","allocator_id":"h1","date":"2026-10-10","value":110},
            {"id":"r2","allocator_id":"h1","date":"2026-10-31","value":5,"reset":True},
        ]
        data["tariffs"][0]["heat_per_gj"]=5
        data["tariffs"][0]["heat_fixed_monthly"]=833
        v=confirmed_month(data,"2026-10",date(2026,11,1))
        self.assertAlmostEqual(v["measured"]["heat"],30)
        self.assertEqual(v["status"]["heat"],"complete")
        self.assertAlmostEqual(v["variable_costs"]["heat"],150)
        self.assertAlmostEqual(v["utility_costs"]["heat"],983)
        self.assertEqual(v["heat_cost_estimate"]["mode"],"allocator_unit_estimate")
        self.assertTrue(v["heat_cost_estimate"]["provisional"])
        self.assertFalse(v["cost_incomplete"])
        self.assertEqual(v["heat_cost_estimate"]["unit"],"jedn.")
        self.assertAlmostEqual(v["total_cost"],1293)
        self.assertAlmostEqual(v["balance"],-1293)


    def test_missing_heat_rate_flags_financial_result_as_incomplete(self):
        data=self.base()
        data["heat_allocators"]=[{"id":"h","name":"Radiátor","base_date":"2026-09-30",
                                  "base_value":0,"coefficient":1}]
        data["heat_allocator_readings"]=[
            {"id":"r","allocator_id":"h","date":"2026-10-31","value":50}]
        data["tariffs"][0]["heat_fixed_monthly"]=833
        v=confirmed_month(data,"2026-10",date(2026,11,1))
        self.assertEqual(v["measured"]["heat"],50)
        self.assertEqual(v["heat_cost_estimate"]["mode"],"missing_allocator_rate")
        self.assertTrue(v["cost_incomplete"])
        self.assertEqual(v["variable_costs"]["heat"],0)
        self.assertEqual(v["utility_costs"]["heat"],833)

    def test_real_heat_meter_uses_gj_rate_without_provisional_unit_label(self):
        data=self.base()
        data["meters"].append({"id":"heat_meter","name":"GJ meter","utility":"heat",
                               "base_date":"2026-09-30","base_value":10})
        data["meter_readings"].append({"id":"heat_reading","meter_id":"heat_meter",
                                      "date":"2026-10-31","value":13})
        data["tariffs"][0]["heat_per_gj"]=100
        v=confirmed_month(data,"2026-10",date(2026,11,1))
        self.assertAlmostEqual(v["variable_costs"]["heat"],300)
        self.assertEqual(v["heat_cost_estimate"]["mode"],"metered_gj")
        self.assertEqual(v["heat_cost_estimate"]["unit"],"GJ")
        self.assertFalse(v["heat_cost_estimate"]["provisional"])

    def test_october_november_radiator_split_from_user_scenario(self):
        data=self.base()
        data["heat_allocators"]=[
            {"id":"loznice","name":"U okna","room":"Ložnice","base_date":"2026-09-21","base_value":0,"coefficient":1},
            {"id":"kuchyne","name":"U okna","room":"Kuchyně","base_date":"2026-09-21","base_value":0,"coefficient":1},
            {"id":"obyvak","name":"U okna","room":"Obývací pokoj","base_date":"2026-09-21","base_value":0,"coefficient":1},
        ]
        data["heat_allocator_readings"]=[
            {"id":"l1","allocator_id":"loznice","date":"2026-10-21","value":4},
            {"id":"l2","allocator_id":"loznice","date":"2026-11-01","value":31},
            {"id":"k1","allocator_id":"kuchyne","date":"2026-10-21","value":2},
            {"id":"k2","allocator_id":"kuchyne","date":"2026-11-01","value":23},
            {"id":"o1","allocator_id":"obyvak","date":"2026-11-01","value":2},
        ]
        oct_v=confirmed_month(data,"2026-10",date(2026,11,1))
        nov_v=confirmed_month(data,"2026-11",date(2026,11,1))
        # Oct 22-31 = 10 of the 11 days of the 27/21 units interval.
        loznice_oct=4*21/30+27*10/11
        kuchyne_oct=2*21/30+21*10/11
        obyvak_oct=2*31/41
        expected_oct=loznice_oct+kuchyne_oct+obyvak_oct
        expected_nov=27/11+21/11+2/41
        self.assertAlmostEqual(oct_v["measured"]["heat"],expected_oct)
        self.assertAlmostEqual(nov_v["measured"]["heat"],expected_nov)
        self.assertAlmostEqual(oct_v["measured"]["heat"]+nov_v["measured"]["heat"],
                               4*21/30+2*21/30+27+21+2*32/41)
        self.assertEqual(len(oct_v["heat_allocated_intervals"]),5)
        self.assertAlmostEqual(
            sum(x["amount"] for x in oct_v["monthly_devices"] if x["utility"]=="heat"),
            expected_oct)
        self.assertAlmostEqual(nov_v["days"][0]["measured"]["heat"],expected_nov)
        self.assertFalse(nov_v["days"][1]["has_allocation"]["heat"])
        # The existing configured provisional tariff must now affect monthly
        # finance for each month, without changing the interpolated units.
        data["tariffs"][0]["heat_per_gj"]=5
        data["tariffs"][0]["heat_fixed_monthly"]=833
        oct_priced=confirmed_month(data,"2026-10",date(2026,11,1))
        nov_priced=confirmed_month(data,"2026-11",date(2026,11,1))
        self.assertAlmostEqual(oct_priced["variable_costs"]["heat"],expected_oct*5)
        self.assertAlmostEqual(nov_priced["variable_costs"]["heat"],expected_nov*5)
        self.assertAlmostEqual(oct_priced["utility_costs"]["heat"],833+expected_oct*5)
        self.assertAlmostEqual(nov_priced["utility_costs"]["heat"],833/30+expected_nov*5)


    def test_missing_and_invalid_month(self):
        data=self.base()
        v=confirmed_month(data,"2026-10",date(2026,11,1))
        self.assertIsNone(v["measured"]["electricity"])
        self.assertEqual(v["status"]["electricity"],"missing")
        for bad in ("2026-13","2026-1","2026-02-01",""):
            with self.assertRaises(ValueError):
                confirmed_month(data,bad)


if __name__=="__main__":
    unittest.main()
