import unittest
from datetime import date
from copy import deepcopy

from energy_app.actuals import confirmed_month
from energy_app.insights import history_insights


class FinanceNeighborsAndOffRadiatorsTests(unittest.TestCase):
    def sample(self):
        return {
            "settings": {"heat_accounting_mode":"apartment"},
            "meters":[{"id":"e","name":"Elektřina","utility":"electricity",
                       "base_date":"2026-09-01","base_value":0}],
            "meter_readings":[
                {"id":"e1","meter_id":"e","date":"2026-09-30","value":29},
                {"id":"e2","meter_id":"e","date":"2026-10-31","value":60},
                {"id":"e3","meter_id":"e","date":"2026-11-01","value":61},
            ],
            "heat_allocators":[
                {"id":"hot","name":"U okna","room":"Ložnice",
                 "base_date":"2026-09-01","base_value":0,"coefficient":1},
                {"id":"off_a","name":"U dveří","room":"Chodba",
                 "base_date":"2026-10-09","base_value":0,"coefficient":1,"always_off":True},
                {"id":"off_b","name":"U dveří","room":"Koupelna",
                 "base_date":"2026-09-21","base_value":0,"coefficient":1,"always_off":True},
            ],
            "heat_allocator_readings":[
                {"id":"h1","allocator_id":"hot","date":"2026-10-01","value":30},
                {"id":"h2","allocator_id":"hot","date":"2026-10-31","value":60},
                {"id":"h3","allocator_id":"hot","date":"2026-11-01","value":61},
            ],
            "appliances":[],"cycles":[],
            "tariffs":[{"effective_from":"2026-09-01",
                        "electricity_per_kwh":5,"heat_per_gj":4,
                        "electricity_fixed_monthly":30,
                        "heat_fixed_monthly":60}],
            "advances":[{"effective_from":"2026-09-01",
                        "electricity_monthly":200,"heat_monthly":300}],
        }

    def test_history_includes_neighboring_months_with_actual_financials(self):
        data=self.sample()
        result=history_insights(data,"2026-10",date(2026,11,2))
        months=result["finance_months"]
        self.assertEqual([m["month"] for m in months],
                         ["2026-08","2026-09","2026-10","2026-11","2026-12"])
        self.assertFalse(months[0]["available"])
        self.assertTrue(all(x["available"] for x in months[1:4]))
        self.assertFalse(months[4]["available"])  # Never forecast December
        for item in months[1:4]:
            direct=confirmed_month(data,item["month"],date(2026,11,2))
            self.assertAlmostEqual(item["balance"],direct["balance"])
            self.assertAlmostEqual(item["advance"],direct["advance"])
            self.assertAlmostEqual(item["total_cost"],direct["total_cost"])
            self.assertEqual(item["utility_costs"],direct["utility_costs"])
        self.assertEqual(months[2]["utility_costs"]["heat"], 60+31*4)
        self.assertAlmostEqual(months[3]["utility_costs"]["heat"],60*2/30+4)
        self.assertTrue(months[3]["partial"])

    def test_off_radiators_count_zero_and_do_not_cause_incomplete_month(self):
        data=self.sample()
        october=confirmed_month(data,"2026-10",date(2026,11,2))
        self.assertEqual(october["status"]["heat"],"complete")
        self.assertAlmostEqual(october["measured"]["heat"],31)
        rows={r["id"]:r for r in october["monthly_devices"]}
        self.assertEqual(rows["off_a"]["amount"],0)
        self.assertEqual(rows["off_b"]["amount"],0)
        self.assertTrue(rows["off_a"]["has_data"])
        self.assertTrue(rows["off_a"]["assumed_zero"])
        coverage={x["id"]:x for x in october["coverage"]["heat"]}
        self.assertEqual(coverage["off_a"]["days"],31)
        self.assertTrue(coverage["off_b"]["assumed_zero"])
        self.assertFalse(october["cost_incomplete"])

    def test_no_data_and_all_off_is_user_declared_zero_not_a_meter_reading(self):
        data=self.sample()
        data["heat_allocators"]=data["heat_allocators"][1:]
        data["heat_allocator_readings"]=[]
        data["tariffs"][0]["heat_per_gj"]=0
        month=confirmed_month(data,"2026-10",date(2026,11,2))
        self.assertEqual(month["measured"]["heat"],0)
        self.assertEqual(month["status"]["heat"],"complete")
        self.assertFalse(month["cost_incomplete"])
        self.assertEqual(sum(len(month["events"]["heat"]) for _ in [0]),0)


if __name__=="__main__":
    unittest.main()
