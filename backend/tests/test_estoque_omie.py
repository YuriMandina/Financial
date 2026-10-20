import asyncio
import unittest
from datetime import date
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models.models as models
from core.deps import current_org
from services import estoque_engine as engine
from services import estoque_omie_service as omie_service
from services import estoque_service as service
from services import omie_estoque as omie
from services.circuit_breaker import circuit_breaker
from services.omie_worker import JOB_HANDLERS


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


TABLES = [
    models.Organization.__table__, models.User.__table__,
    models.BoningFamily.__table__, models.BoningProduct.__table__,
    models.ProductPackaging.__table__, models.InventoryCount.__table__,
    models.InventoryCountItem.__table__, models.InventoryItemReason.__table__,
    models.InventoryCountEntry.__table__, models.InventoryAdjustment.__table__,
    models.InventoryDocument.__table__, models.OmieJobQueue.__table__,
]


class FakeOmie:
    """Simula a Omie: posições por produto e registro das chamadas de ajuste."""

    def __init__(self, positions):
        self.positions = positions
        self.adjust_calls = []
        self.deleted = []
        self.fail_once = {}
        self.next_id = 1000

    def listar_posicoes(self, data, local=None, **kw):
        # Como o cliente real, depende das credenciais da organização no contexto
        assert current_org.get().omie_app_key == "k"
        return {k: dict(v) for k, v in self.positions.items()}

    def obter_ultimo_custo(self, omie_id, data, local=None):
        return 2.0

    def incluir_ajuste(self, omie_id, data, tipo, motivo, quan, valor, cod_int, obs, local=None):
        if omie_id in self.fail_once:
            raise self.fail_once.pop(omie_id)
        self.adjust_calls.append({"omie_id": omie_id, "tipo": tipo, "motivo": motivo, "quan": quan,
                                  "valor": valor, "cod_int": cod_int})
        pos = self.positions.setdefault(omie_id, {"saldo": 0.0, "cmc": 0.0, "valor": 0.0})
        if tipo == "SLD":
            pos["saldo"], pos["cmc"] = quan, valor
        elif tipo == "SAI":
            pos["saldo"] -= quan
        else:
            pos["saldo"] += quan
        self.next_id += 1
        return self.next_id

    def excluir_ajuste(self, id_ajuste):
        self.deleted.append(id_ajuste)
        return True


class TestIntegracaoOmie(unittest.TestCase):

    def setUp(self):
        circuit_breaker.record_success()
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        models.Base.metadata.create_all(eng, tables=TABLES)
        self.Session = sessionmaker(bind=eng)
        self.db = self.Session()
        db = self.db
        org = models.Organization(name="Org", omie_app_key="k", omie_app_secret="s")
        db.add(org)
        db.flush()
        self.org = org
        self.user = models.User(name="G", email="g", password_hash="x", organization_id=org.id)
        fam = models.BoningFamily(omie_id=1, name="Bebidas", organization_id=org.id, is_active_for_inventory=True)
        db.add_all([self.user, fam])
        db.flush()
        self.fam = fam
        # Coca: falta simples (caso A). Agua: negativo zerado (caso D). Guarana: sem divergência.
        self.prods = {}
        for omie_id, name in [(10, "Coca"), (11, "Agua"), (12, "Guarana")]:
            p = models.BoningProduct(omie_id=omie_id, name=name, unit_price=1, family_id=fam.id,
                                     organization_id=org.id, unit="UN")
            db.add(p)
            self.prods[omie_id] = p
        db.commit()
        self.fake = FakeOmie({
            10: {"saldo": 10.0, "cmc": 5.0, "valor": 50.0},
            11: {"saldo": -6.0, "cmc": 1.6, "valor": -9.6},
            12: {"saldo": 4.0, "cmc": 3.0, "valor": 12.0},
        })
        self.patches = [
            mock.patch.object(omie_service, "SessionLocal", self.Session),
            mock.patch.object(omie, "listar_posicoes", self.fake.listar_posicoes),
            mock.patch.object(omie, "obter_ultimo_custo", self.fake.obter_ultimo_custo),
            mock.patch.object(omie, "incluir_ajuste", self.fake.incluir_ajuste),
            mock.patch.object(omie, "excluir_ajuste", self.fake.excluir_ajuste),
            mock.patch.object(omie_service, "ITEM_PAUSE_SECONDS", 0),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db.close()
        circuit_breaker.record_success()

    # --- helpers ---

    def _count(self, count_id):
        self.db.expire_all()
        return self.db.query(models.InventoryCount).filter_by(id=count_id).first()

    def _run_worker(self, max_jobs=50):
        """Processa a fila como o omie_worker faria (somente handlers registrados)."""
        for _ in range(max_jobs):
            circuit_breaker.record_success()
            db = self.Session()
            job = db.query(models.OmieJobQueue).filter_by(status="PENDING").order_by(models.OmieJobQueue.id).first()
            if not job:
                db.close()
                return
            job.status = "PROCESSING"
            db.commit()
            # Como o omie_worker: injeta a organização do job no contexto antes do handler
            current_org.set(db.query(models.Organization).filter_by(id=job.organization_id).first())
            asyncio.run(JOB_HANDLERS[job.action_type](db, job))
            db.close()

    def _approved_count(self):
        db = self.db
        count = service.create_count(db, self.org.id, self.user, self.fam.id, date.today())
        service.apply_transition(db, self.user, count, "iniciar")
        items = {i.omie_id: i for i in count.items}
        service.sync_entries(db, count, self.user, [
            {"client_uuid": "e-coca-0001", "item_id": items[10].id, "mode": "UN", "raw_qty": 7},
            {"client_uuid": "e-guar-0001", "item_id": items[12].id, "mode": "UN", "raw_qty": 4},
        ])
        service.confirm_zero(db, items[11], True)
        service.apply_transition(db, self.user, count, "encerrar")
        task_id = omie_service.start_snapshot(db, self.user, count)
        omie_service.bg_capture_snapshot(task_id, count.id)
        count = self._count(count.id)
        items = {i.omie_id: i for i in count.items}
        self.assertEqual(items[11].adjustment_case, engine.CASE_D)
        self.assertEqual(items[10].reference_cost, 2.0)
        service.set_reasons(db, self.user, items[10], [{"reason": "AVARIA", "quantity": 1},
                                                       {"reason": "DESAPARECIMENTO", "quantity": 2}])
        service.batch_review(db, self.user, count, [items[11].id], reason="ERRO_PDV",
                             justification="Saneamento inicial: estoque negativo histórico")
        service.apply_transition(db, self.user, count, "enviar")
        service.apply_transition(db, self.user, count, "aprovar")
        return count.id

    def _effectivate(self, count_id):
        count = self._count(count_id)
        task_id = omie_service.start_effectivation(self.db, self.user, count)
        omie_service.bg_prepare_effectivation(task_id, count_id)
        self._run_worker()
        return self._count(count_id)

    # --- testes ---

    def test_snapshot_preserva_custo_manual(self):
        count = service.create_count(self.db, self.org.id, self.user, self.fam.id, date.today())
        service.apply_transition(self.db, self.user, count, "iniciar")
        service.apply_transition(self.db, self.user, count, "encerrar")
        coca = next(i for i in count.items if i.omie_id == 10)
        service.update_review(self.db, self.user, coca, {"reference_cost": 4.5})
        task_id = omie_service.start_snapshot(self.db, self.user, count)
        omie_service.bg_capture_snapshot(task_id, count.id)
        count = self._count(count.id)
        coca = next(i for i in count.items if i.omie_id == 10)
        self.assertEqual((coca.system_qty, coca.cmc, coca.reference_cost), (10.0, 5.0, 4.5))
        self.assertEqual(coca.reference_cost_source, "MANUAL")
        self.assertIsNotNone(count.snapshot_at)

    def test_efetivacao_completa_e_conferida(self):
        count = self._effectivate(self._approved_count())
        self.assertEqual(count.status, engine.EFETIVADO, count.last_error)
        calls = {c["omie_id"]: c for c in self.fake.adjust_calls}
        self.assertEqual(set(calls), {10, 11})  # Guarana sem divergência não gera ajuste
        self.assertEqual((calls[10]["tipo"], calls[10]["motivo"], calls[10]["quan"], calls[10]["valor"]),
                         ("SAI", "PER", 3.0, 5.0))
        self.assertEqual((calls[11]["tipo"], calls[11]["motivo"], calls[11]["quan"]), ("SLD", "INV", 0.0))
        self.assertTrue(calls[10]["cod_int"].endswith("-1"))
        self.assertTrue(all(i.verify_status == "OK" for i in count.items))
        self.assertIsNone(count.last_error)

    def test_saldo_mudou_desde_aprovacao_volta_para_conferencia(self):
        count_id = self._approved_count()
        self.fake.positions[10]["saldo"] = 12.0  # NF lançada com data até o corte
        count = self._effectivate(count_id)
        self.assertEqual(count.status, engine.CONFERENCIA)
        self.assertIsNone(count.approved_at)
        self.assertIn("Coca", count.last_error)
        self.assertEqual(self.fake.adjust_calls, [])
        coca = next(i for i in count.items if i.omie_id == 10)
        self.assertEqual(coca.system_qty, 12.0)

    def test_falha_e_reprocessamento_sem_reenviar_os_efetivados(self):
        count_id = self._approved_count()
        self.fake.fail_once[11] = omie.OmieError("Produto bloqueado para ajuste")
        count = self._effectivate(count_id)
        self.assertEqual(count.status, engine.EFETIVANDO_COM_ERRO)
        self.assertIn("Agua", count.last_error)
        omie_service.start_reprocess(self.db, self.user, count)
        self._run_worker()
        count = self._count(count_id)
        self.assertEqual(count.status, engine.EFETIVADO, count.last_error)
        self.assertEqual([c["omie_id"] for c in self.fake.adjust_calls].count(10), 1)

    def test_bloqueio_temporario_reenfileira(self):
        count_id = self._approved_count()
        self.fake.fail_once[10] = omie.OmieError("Consumo redundante detectado. Aguarde 5 segundos", retry_after=6)
        count = self._effectivate(count_id)
        self.assertEqual(count.status, engine.EFETIVADO, count.last_error)
        retried = self.db.query(models.OmieJobQueue).filter(models.OmieJobQueue.retry_count > 0).count()
        self.assertEqual(retried, 1)

    def test_reversao_exclui_ajustes_e_incrementa_sequencial(self):
        count_id = self._approved_count()
        count = self._effectivate(count_id)
        omie_service.start_revert(self.db, self.user, count)
        self._run_worker()
        count = self._count(count_id)
        self.assertEqual(count.status, engine.CONFERENCIA)
        self.assertEqual(len(self.fake.deleted), 2)
        self.assertEqual(count.effectivation_seq, 2)
        self.assertTrue(all(i.adjustment is None for i in count.items))
        self.assertIsNone(count.approved_at)

    def test_conteudo_alterado_apos_aprovacao_bloqueia(self):
        count_id = self._approved_count()
        count = self._count(count_id)
        coca = next(i for i in count.items if i.omie_id == 10)
        coca.counted_qty = 9.0  # alteração direta (fora do fluxo)
        self.db.commit()
        with self.assertRaises(service.InventoryError):
            omie_service.start_effectivation(self.db, self.user, self._count(count_id))

    def test_transicao_generica_nao_executa_acoes_omie(self):
        count_id = self._approved_count()
        with self.assertRaises(service.InventoryError):
            service.apply_transition(self.db, self.user, self._count(count_id), "efetivar")


class TestClienteOmie(unittest.TestCase):

    def test_retry_after(self):
        self.assertEqual(omie._retry_after("Consumo redundante detectado. Aguarde 45 segundos para tentar"), 46)
        self.assertEqual(omie._retry_after("API bloqueada. Tente novamente em 120 segundos"), 121)
        self.assertEqual(omie._retry_after("Produto não encontrado"), 0)

    def test_ajuste_duplicado_devolve_id_existente(self):
        err = omie.OmieError("ERROR: Já existe um ajuste de estoque para o código de integração [INV-1-1-1] "
                             "com o ID [5480917277] para o produto", code="SOAP-ENV:Client-1035")
        with mock.patch.object(omie, "_post", side_effect=err):
            self.assertEqual(omie.incluir_ajuste(1, date.today(), "SAI", "PER", 1, 1, "INV-1-1-1", "obs"), 5480917277)

    def test_alterar_familia_restaura_se_omie_mudar_outros_campos(self):
        before = {"codigo_produto": 1, "descricao": "AGUA", "ncm": "2201.10.00", "codigo_familia": 1}
        after = {"codigo_produto": 1, "descricao": "AGUA", "ncm": "", "codigo_familia": 2}
        posts = []
        with mock.patch.object(omie, "consultar_produto", side_effect=[before, after]), \
                mock.patch.object(omie, "_post", side_effect=lambda *a: posts.append(a[2]) or {}), \
                mock.patch.object(omie.time, "sleep"):
            with self.assertRaises(omie.OmieError) as ctx:
                omie.alterar_familia_produto(1, 2)
        self.assertIn("ncm", ctx.exception.message)
        self.assertEqual(posts[-1], {"ncm": "2201.10.00", "codigo_produto": 1})

    def test_alterar_familia_ok(self):
        before = {"codigo_produto": 1, "descricao": "AGUA", "ncm": "2201.10.00", "codigo_familia": 1}
        after = dict(before, codigo_familia=2)
        with mock.patch.object(omie, "consultar_produto", side_effect=[before, after]), \
                mock.patch.object(omie, "_post", return_value={}), mock.patch.object(omie.time, "sleep"):
            self.assertEqual(omie.alterar_familia_produto(1, 2)["codigo_familia"], 2)


if __name__ == "__main__":
    unittest.main()
