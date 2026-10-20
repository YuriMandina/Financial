import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models.models as models
from services import estoque_service as service
from services import estoque_report as report
from tests.test_estoque_service import TABLES


class TestRelatorioPerdas(unittest.TestCase):

    def setUp(self):
        eng = create_engine("sqlite://")
        models.Base.metadata.create_all(eng, tables=TABLES)
        self.db = sessionmaker(bind=eng)()
        db = self.db
        org = models.Organization(name="Açougue Teste", company={"razao_social": "Açougue São João LTDA", "cnpj": "00.000.000/0001-00"})
        db.add(org)
        db.flush()
        self.org = org
        self.user = models.User(name="Gerente Ágata", email="g", password_hash="x", organization_id=org.id)
        fam = models.BoningFamily(omie_id=1, name="Mercearia Açúcar", organization_id=org.id, is_active_for_inventory=True)
        db.add_all([self.user, fam])
        db.flush()
        self.fam = fam
        # Muitos itens para forçar várias páginas (cabeçalho de tabela repetido)
        for n in range(60):
            db.add(models.BoningProduct(omie_id=100 + n, name=f"Produto número {n} – embalagem “especial”", unit_price=1,
                                        family_id=fam.id, organization_id=org.id, unit="UN"))
        db.commit()

    def _count(self):
        db = self.db
        count = service.create_count(db, self.org.id, self.user, self.fam.id, date(2026, 10, 20))
        service.apply_transition(db, self.user, count, "iniciar")
        for idx, item in enumerate(count.items):
            service.sync_entries(db, count, self.user, [{"client_uuid": f"uuid-{idx:04d}", "item_id": item.id, "raw_qty": 10}])
        service.apply_transition(db, self.user, count, "encerrar")
        for idx, item in enumerate(count.items):
            item.system_qty = [12, 10, 9][idx % 3]
            item.cmc = item.reference_cost = 4.5
        db.commit()
        for idx, item in enumerate(count.items):
            service.recompute_item(item, 30)
            if idx % 3 == 0:
                service.set_reasons(db, self.user, item, [{"reason": "AVARIA", "quantity": 1}, {"reason": "DESAPARECIMENTO", "quantity": 1}])
            elif idx % 3 == 2:
                service.set_reasons(db, self.user, item, [{"reason": "ERRO_PDV", "quantity": 1}])
        return count

    def test_previa_antes_da_aprovacao(self):
        count = self._count()
        pdf = report.build_report(count, self.org.company, self.org.name, "Gerente Ágata")
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 5000)

    def test_relatorio_oficial_apos_aprovacao(self):
        count = self._count()
        service.apply_transition(self.db, self.user, count, "enviar")
        service.apply_transition(self.db, self.user, count, "aprovar")
        pdf = report.build_report(count, self.org.company, self.org.name, "Gerente Ágata")
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertIn("Mercearia", report.report_filename(count))


if __name__ == "__main__":
    unittest.main()
