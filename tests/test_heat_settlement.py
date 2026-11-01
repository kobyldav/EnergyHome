import unittest
from energy_app.heat_settlement import apartment_heat_estimate

class ApartmentHeatingTests(unittest.TestCase):
    def test_area_and_corrected_unit_shares_are_separate(self):
        params={
            "heat_settlement_year":2026,
            "heat_apartment_area_m2":50,"heat_building_area_m2":1000,
            "heat_building_cost_czk":200000,
            "heat_apartment_units":100,"heat_building_units":2000,
            "heat_base_share_pct":60,
        }
        result=apartment_heat_estimate(params)
        self.assertTrue(result["ready"])
        self.assertAlmostEqual(result["base_cost"],6000)
        self.assertAlmostEqual(result["consumption_cost"],4000)
        self.assertAlmostEqual(result["total"],10000)

    def test_no_made_up_price_from_missing_building_data(self):
        self.assertFalse(apartment_heat_estimate({})["ready"])

    def test_invalid_floor_area_rejected(self):
        params={
            "heat_apartment_area_m2":55,"heat_building_area_m2":50,
            "heat_building_cost_czk":10000,
            "heat_apartment_units":0,"heat_building_units":200,
            "heat_base_share_pct":50,
        }
        self.assertFalse(apartment_heat_estimate(params)["ready"])
        params["heat_building_area_m2"]=500
        self.assertTrue(apartment_heat_estimate(params)["ready"])
        self.assertEqual(apartment_heat_estimate(params)["consumption_cost"],0)

if __name__=="__main__":
    unittest.main()
