import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models.models as models
from services import estoque_service as service
from services import estoque_engine as engine

TABLES = [
    models.Organization.__table__, models.User.__table__,
    models.BoningFamily.__table__, models.BoningProduct.__table__,
    models.ProductPackaging.__table__, models.InventoryCount.__table__,
    models.InventoryCountItem.__table__, models.InventoryCountEntry.__table__,
    models.InventoryAdjustment.__table__, models.InventoryDocument.__table__,
]


class TestFluxoInventario(unittest.TestCase):

    def setUp(self):
        eng = create_engine("sqlite://")
        models.Base.metadata.create_all(eng, tables=TABLES)
        self.db = sessionmaker(bind=eng)()
        db = self.db
        self.org = models.Organization(name="Açougue")
        db.add(self.org)
        db.flush()
        self.gerente = models.User(name="Gerente", email="g@x", password_hash="x", organization_id=self.org.id)
        self.contador = models.User(name="Contador", email="c@x", password_hash="x", organization_id=self.org.id,
                                    inventory_role="CONTADOR")
        self.fam = models.BoningFamily(omie_id=1, name="Bebidas", organization_id=self.org.id, is_active_for_inventory=True)
        db.add_all([self.gerente, self.contador, self.fam])
        db.flush()
        self.coca = models.BoningProduct(omie_id=10, name="Coca 2L", unit_price=10, family_id=self.fam.id,
                                         organization_id=self.org.id, unit="UN", ean="789001")
        self.agua = models.BoningProduct(omie_id=11, name="Agua 500ml", unit_price=2, family_id=self.fam.id,
                                         organization_id=self.org.id, unit="UN", ean="789002")
        self.fora = models.BoningProduct(omie_id=12, name="Fora do escopo", unit_price=1, family_id=self.fam.id,
                                         organization_id=self.org.id, unit="UN", is_inventory_default=False)
        db.add_all([self.coca, self.agua, self.fora])
        db.flush()
        self.cx = models.ProductPackaging(organization_id=self.org.id, product_id=self.coca.id, name="CX", factor=12)
        db.add(self.cx)
        db.commit()

    def tearDown(self):
        self.db.close()

    def _create(self):
        return service.create_count(self.db, self.org.id, self.gerente, self.fam.id, date.today())

    def _items(self, count):
        return {i.product_id: i for i in count.items}

    def test_escopo_padrao_e_bloqueio_de_familia_aberta(self):
        count = self._create()
        self.assertEqual({i.product_id for i in count.items}, {self.coca.id, self.agua.id})
        with self.assertRaises(service.InventoryError) as ctx:
            self._create()
        self.assertEqual(ctx.exception.status_code, 409)

    def test_contador_nao_cria_inventario(self):
        with self.assertRaises(service.InventoryError) as ctx:
            service.create_count(self.db, self.org.id, self.contador, self.fam.id, date.today())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_fluxo_completo(self):
        count = self._create()
        service.apply_transition(self.db, self.gerente, count, "iniciar")
        items = self._items(count)
        coca, agua = items[self.coca.id], items[self.agua.id]

        # 12 CX x 12 + 6 avulsas; reenvio do mesmo lote não duplica
        lote = [
            {"client_uuid": "uuid-0001", "item_id": coca.id, "mode": "EMB", "raw_qty": 12, "packaging_id": self.cx.id},
            {"client_uuid": "uuid-0002", "item_id": coca.id, "mode": "UN", "expression": "6"},
        ]
        r1 = service.sync_entries(self.db, count, self.contador, lote)
        r2 = service.sync_entries(self.db, count, self.contador, lote)
        self.assertEqual([r["status"] for r in r1["results"]], ["ACEITO", "ACEITO"])
        self.assertEqual([r["status"] for r in r2["results"]], ["DUPLICADO", "DUPLICADO"])
        self.assertEqual(coca.counted_qty, 150.0)

        # Estorno do lançamento avulso
        avulso = next(e for e in coca.entries if e.client_uuid == "uuid-0002")
        service.void_entry(self.db, self.org.id, self.contador, avulso.id)
        self.assertEqual(coca.counted_qty, 144.0)

        # Agua confirmada zerada
        service.confirm_zero(self.db, agua, True)
        self.assertEqual(agua.count_status, engine.ITEM_CONTADO)

        service.apply_transition(self.db, self.gerente, count, "encerrar")

        # Contagem encerrada rejeita lançamentos novos
        late = service.sync_entries(self.db, count, self.contador, [
            {"client_uuid": "uuid-0003", "item_id": coca.id, "mode": "UN", "raw_qty": 1}])
        self.assertEqual(late["results"][0]["reason"], "CONTAGEM_ENCERRADA")

        # Snapshot simulado (Fase 2 captura da Omie): coca 160 no sistema, agua -6
        coca.system_qty, coca.cmc, coca.reference_cost = 160.0, 5.0, 5.1
        agua.system_qty, agua.cmc, agua.reference_cost = -6.0, 1.52, 1.52
        self.db.commit()

        # Divergência relevante gera recontagem automática da coca
        flagged = service.request_suggested_recounts(self.db, self.gerente, count)
        self.assertEqual(set(flagged), {coca.id, agua.id})
        self.assertEqual(coca.count_status, engine.ITEM_RECONTAGEM)
        self.assertEqual(coca.counted_qty, 0.0)

        recount = service.sync_entries(self.db, count, self.contador, [
            {"client_uuid": "uuid-0004", "item_id": coca.id, "mode": "UN", "expression": "12*12+4"}])
        self.assertEqual(recount["results"][0]["status"], "ACEITO")
        self.assertEqual(coca.counted_qty, 148.0)
        service.confirm_zero(self.db, agua, True)
        self.assertEqual(coca.adjustment_case, engine.CASE_A)
        self.assertEqual(agua.adjustment_case, engine.CASE_D)

        # Pendências bloqueiam o envio
        with self.assertRaises(service.InventoryError) as ctx:
            service.apply_transition(self.db, self.gerente, count, "enviar")
        codes = {i["code"] for i in ctx.exception.details}
        self.assertIn("MOTIVO_OBRIGATORIO", codes)
        self.assertIn("JUSTIFICATIVA_NEGATIVO", codes)

        service.update_review(self.db, self.gerente, coca, {"reason": "AVARIA"})
        service.update_review(self.db, self.gerente, agua, {"reason": "ERRO_PDV",
                                                           "justification": "Vendas a mais registradas no PDV"})
        service.apply_transition(self.db, self.gerente, count, "enviar")
        service.apply_transition(self.db, self.gerente, count, "aprovar")
        self.assertEqual(count.status, engine.APROVADO)
        self.assertEqual(len(count.snapshot_hash), 64)

        faltas = service.build_shortages_rows(count)
        self.assertEqual(len(faltas), 1)
        self.assertEqual(faltas[0]["quantidade"], 12.0)
        self.assertEqual(faltas[0]["total"], 60.0)

    def test_pares_vinculados_nos_dois_lados(self):
        count = self._create()
        service.apply_transition(self.db, self.gerente, count, "iniciar")
        service.apply_transition(self.db, self.gerente, count, "encerrar")
        items = self._items(count)
        coca, agua = items[self.coca.id], items[self.agua.id]
        service.update_review(self.db, self.gerente, coca, {"pair_item_id": agua.id})
        self.assertEqual(agua.pair_item_id, coca.id)
        service.update_review(self.db, self.gerente, coca, {"pair_item_id": None})
        self.assertIsNone(agua.pair_item_id)


if __name__ == "__main__":
    unittest.main()
