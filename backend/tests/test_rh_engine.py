import unittest
from services.rh_engine import (
    compute_raw_minutes,
    apply_month_rounding,
    format_minutes_to_hours,
    derive_day_benefits,
    calculate_work_days_summary
)

class TestRHEngine(unittest.TestCase):

    def test_compute_raw_minutes_standard(self):
        # 08:00 às 17:00 com 1h de almoço = 8h líquidas = 480 min
        mins = compute_raw_minutes("08:00", "12:00", "13:00", "17:00")
        self.assertEqual(mins, 480)

    def test_compute_raw_minutes_midnight_cross(self):
        # Turno noturno: 22:00 às 06:00 com almoço 02:00 às 03:00 = 7h líquidas = 420 min
        mins = compute_raw_minutes("22:00", "02:00", "03:00", "06:00")
        self.assertEqual(mins, 420)

    def test_month_rounding(self):
        # D6: Arredondamento de banco de horas no total do mês
        # 127 minutos arredondados para múltiplos de 15 minutos: mais próximo de 120 (diff 7) que de 135 (diff 8)
        self.assertEqual(apply_month_rounding(127, 15, "NEAREST"), 120)
        self.assertEqual(apply_month_rounding(128, 15, "NEAREST"), 135)
        self.assertEqual(apply_month_rounding(127, 15, "DOWN"), 120)
        self.assertEqual(apply_month_rounding(127, 15, "UP"), 135)
        # Sem arredondar (0)
        self.assertEqual(apply_month_rounding(127, 0), 127)

    def test_format_minutes(self):
        self.assertEqual(format_minutes_to_hours(440, "HHMM"), "+7h20")
        self.assertEqual(format_minutes_to_hours(-90, "HHMM"), "-1h30")
        self.assertEqual(format_minutes_to_hours(440, "DECIMAL"), "+7.33h")

    def test_derive_day_benefits_rules(self):
        class DummyDay:
            def __init__(self, status, worked_minutes, vt_override=None, va_override=None):
                self.status = status
                self.worked_minutes = worked_minutes
                self.vt_tickets_override = vt_override
                self.va_override = va_override
                self.benefit_note = None

        # Dia trabalhado com 8h (480 min >= 360 min) -> VT=2, VA=True
        d1 = DummyDay("TRABALHO", 480)
        b1 = derive_day_benefits(d1, default_tickets=2, min_daily_hours_for_meal=6.0)
        self.assertEqual(b1["vt_final"], 2)
        self.assertTrue(b1["va_final"])

        # Dia trabalhado com 5h (300 min < 360 min) -> VT=2, VA=False (jornada < 6h)
        d2 = DummyDay("TRABALHO", 300)
        b2 = derive_day_benefits(d2, default_tickets=2, min_daily_hours_for_meal=6.0)
        self.assertEqual(b2["vt_final"], 2)
        self.assertFalse(b2["va_final"])

        # Dia de folga -> VT=0, VA=False
        d3 = DummyDay("FOLGA", 0)
        b3 = derive_day_benefits(d3, default_tickets=2, min_daily_hours_for_meal=6.0)
        self.assertEqual(b3["vt_final"], 0)
        self.assertFalse(b3["va_final"])

        # Dia de folga com OVERRIDE de VT = 4 passagens (ex: evento ou plantão)
        d4 = DummyDay("FOLGA", 0, vt_override=4)
        b4 = derive_day_benefits(d4, default_tickets=2, min_daily_hours_for_meal=6.0)
        self.assertEqual(b4["vt_final"], 4)
        self.assertTrue(b4["vt_is_overridden"])

        # Dia trabalhado com OVERRIDE de remoção de VA (ex: refeição no local)
        d5 = DummyDay("TRABALHO", 480, va_override=False)
        b5 = derive_day_benefits(d5, default_tickets=2, min_daily_hours_for_meal=6.0)
        self.assertFalse(b5["va_final"])
        self.assertTrue(b5["va_is_overridden"])

if __name__ == "__main__":
    unittest.main()
