import unittest
from services.estoque_engine import (
    evaluate_expression,
    compute_entry_quantity,
    sum_entries,
    compute_difference,
    needs_recount,
    classify_case,
    build_adjustment,
    validate_items_for_approval,
    suggest_pairs,
    summarize,
    snapshot_hash,
    check_transition,
    CASE_A, CASE_B, CASE_C, CASE_D,
    EM_CONTAGEM, CONFERENCIA, EFETIVADO, CANCELADO,
)


def make_item(**kwargs):
    base = {
        "id": 1, "product_id": 1, "product_name": "Produto", "unit": "UN",
        "system_qty": 10.0, "counted_qty": 10.0, "confirmed_zero": False,
        "count_status": "CONTADO", "reason": None, "justification": None,
        "case": CASE_A, "has_entries": True, "cmc": 5.0, "reference_cost": 5.0,
        "cmc_correction_approved": False,
    }
    base.update(kwargs)
    return base


class TestExpressaoELancamentos(unittest.TestCase):

    def test_expressao_caixas_mais_avulsas(self):
        self.assertEqual(evaluate_expression("12*12+6"), 150.0)
        self.assertEqual(evaluate_expression("12x12 + 6"), 150.0)

    def test_expressao_decimal_com_virgula(self):
        self.assertEqual(evaluate_expression("3,450 + 2,120"), 5.57)

    def test_expressao_rejeita_codigo(self):
        with self.assertRaises(ValueError):
            evaluate_expression("__import__('os')")
        with self.assertRaises(ValueError):
            evaluate_expression("2**10")
        with self.assertRaises(ValueError):
            evaluate_expression("1/0")

    def test_lancamento_embalagem(self):
        # 12 caixas fechadas com 12 unidades cada
        self.assertEqual(compute_entry_quantity("EMB", 12, factor=12), 144.0)

    def test_lancamento_peso_com_tara(self):
        # Caixa de carne: bruto 12,5 kg, tara 0,8 kg
        self.assertEqual(compute_entry_quantity("PESO", 12.5, tare_total=0.8), 11.7)

    def test_lancamento_invalido(self):
        with self.assertRaises(ValueError):
            compute_entry_quantity("UN", 0)
        with self.assertRaises(ValueError):
            compute_entry_quantity("PESO", 0.5, tare_total=0.8)
        with self.assertRaises(ValueError):
            compute_entry_quantity("EMB", 2, factor=0)
        with self.assertRaises(ValueError):
            compute_entry_quantity("XYZ", 1)

    def test_soma_ignora_estornos_e_outras_rodadas(self):
        entries = [
            {"quantity": 144, "round": 1},
            {"quantity": 6, "round": 1},
            {"quantity": 10, "round": 1, "voided": True},
            {"quantity": 149, "round": 2},
        ]
        self.assertEqual(sum_entries(entries, 1), 150.0)
        self.assertEqual(sum_entries(entries, 2), 149.0)


class TestDivergenciaERecontagem(unittest.TestCase):

    def test_diferenca(self):
        self.assertEqual(compute_difference(8, 10), -2.0)
        self.assertEqual(compute_difference(5, -6), 11.0)
        self.assertIsNone(compute_difference(5, None))

    def test_recontagem_por_percentual(self):
        self.assertTrue(needs_recount(-1, 10, 1.0, pct_threshold=5, value_threshold=0))
        self.assertFalse(needs_recount(-1, 100, 1.0, pct_threshold=5, value_threshold=0))

    def test_recontagem_por_valor(self):
        # 2 un x R$ 30 = R$ 60 > R$ 50
        self.assertTrue(needs_recount(-2, 1000, 30.0, pct_threshold=5, value_threshold=50))

    def test_sem_divergencia_nao_reconta(self):
        self.assertFalse(needs_recount(0, 10, 100.0))


class TestClassificacaoEAjuste(unittest.TestCase):

    def test_caso_a_falta_baixa_por_perda_a_cmc(self):
        case = classify_case(10, 8, cmc=5.0, reference_cost=5.2)
        self.assertEqual(case, CASE_A)
        adj = build_adjustment(10, 8, 5.0, 5.2, case)
        self.assertEqual(adj, {"tipo": "SAI", "motivo": "PER", "quan": 2.0, "valor": 5.0})

    def test_caso_a_sobra_entrada_inventario_a_cmc(self):
        adj = build_adjustment(10, 13, 5.0, 5.2, CASE_A)
        self.assertEqual(adj, {"tipo": "ENT", "motivo": "INV", "quan": 3.0, "valor": 5.0})

    def test_caso_a_sem_diferenca(self):
        self.assertIsNone(build_adjustment(10, 10, 5.0, 5.0, CASE_A))

    def test_caso_b_negativo_com_contagem(self):
        case = classify_case(-6, 5, cmc=1.5, reference_cost=1.52)
        self.assertEqual(case, CASE_B)
        adj = build_adjustment(-6, 5, 1.5, 1.52, case)
        self.assertEqual(adj, {"tipo": "SLD", "motivo": "INV", "quan": 5.0, "valor": 1.52})

    def test_caso_d_negativo_zerado(self):
        # Caso do print: sistema -6, físico 0
        case = classify_case(-6, 0, cmc=1.524167, reference_cost=1.52)
        self.assertEqual(case, CASE_D)
        adj = build_adjustment(-6, 0, 1.524167, 1.52, case)
        self.assertEqual(adj["tipo"], "SLD")
        self.assertEqual(adj["quan"], 0.0)

    def test_caso_b_exige_custo_de_referencia(self):
        with self.assertRaises(ValueError):
            build_adjustment(-6, 5, 0, 0, CASE_B)

    def test_caso_c_cmc_suspeito(self):
        self.assertEqual(classify_case(10, 10, cmc=15.0, reference_cost=5.0), CASE_C)
        self.assertEqual(classify_case(10, 10, cmc=-2.0, reference_cost=5.0), CASE_C)

    def test_caso_c_sem_aprovacao_segue_caso_a(self):
        adj = build_adjustment(10, 8, 15.0, 5.0, CASE_C, cmc_correction_approved=False)
        self.assertEqual(adj["tipo"], "SAI")
        self.assertEqual(adj["valor"], 15.0)

    def test_caso_c_aprovado_corrige_cmc(self):
        adj = build_adjustment(10, 8, 15.0, 5.0, CASE_C, cmc_correction_approved=True)
        self.assertEqual(adj, {"tipo": "SLD", "motivo": "INV", "quan": 8.0, "valor": 5.0})
        adj_sem_diff = build_adjustment(10, 10, 15.0, 5.0, CASE_C, cmc_correction_approved=True)
        self.assertEqual(adj_sem_diff["motivo"], "CMC")


class TestValidacaoAprovacao(unittest.TestCase):

    def codes(self, items):
        return {i["code"] for i in validate_items_for_approval(items)}

    def test_item_ok(self):
        self.assertEqual(validate_items_for_approval([make_item()]), [])

    def test_nao_contado_bloqueia_e_zerado_confirmado_libera(self):
        self.assertIn("NAO_CONTADO", self.codes([make_item(has_entries=False, counted_qty=0)]))
        ok = make_item(has_entries=False, confirmed_zero=True, counted_qty=0, reason="DESAPARECIMENTO")
        self.assertEqual(self.codes([ok]), set())

    def test_sem_snapshot(self):
        self.assertIn("SEM_SNAPSHOT", self.codes([make_item(system_qty=None)]))

    def test_motivo_obrigatorio(self):
        self.assertIn("MOTIVO_OBRIGATORIO", self.codes([make_item(counted_qty=8)]))
        # Motivo de sobra não vale para falta
        self.assertIn("MOTIVO_OBRIGATORIO", self.codes([make_item(counted_qty=8, reason="ERRO_PDV")]))

    def test_nf_entrada_pendente_bloqueia(self):
        self.assertIn("NF_ENTRADA_PENDENTE", self.codes([make_item(counted_qty=12, reason="NF_ENTRADA_PENDENTE")]))

    def test_negativo_exige_justificativa(self):
        item = make_item(system_qty=-6, counted_qty=0, case=CASE_D, reason="NAO_IDENTIFICADA", justification=None)
        self.assertIn("JUSTIFICATIVA_NEGATIVO", self.codes([item]))
        item["justification"] = "Venda registrada em produto errado"
        self.assertEqual(self.codes([item]), set())

    def test_recontagem_pendente(self):
        self.assertIn("RECONTAGEM_PENDENTE", self.codes([make_item(count_status="RECONTAGEM")]))


class TestParesEResumo(unittest.TestCase):

    def test_sugere_par_troca_de_produto(self):
        items = [
            make_item(id=1, product_name="Coca 2L", system_qty=10, counted_qty=12, cmc=8.0),
            make_item(id=2, product_name="Guaraná 2L", system_qty=10, counted_qty=8, cmc=7.5),
            make_item(id=3, product_name="Picanha", unit="KG", system_qty=10, counted_qty=8, cmc=60.0),
        ]
        pairs = suggest_pairs(items)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["falta_item_id"], 2)
        self.assertEqual(pairs[0]["sobra_item_id"], 1)

    def test_resumo_separa_quebra_tecnica(self):
        items = [
            make_item(id=1, system_qty=10, counted_qty=8, cmc=5.0, reason="AVARIA"),
            make_item(id=2, system_qty=20, counted_qty=19, cmc=40.0, reason="QUEBRA_TECNICA"),
            make_item(id=3, system_qty=5, counted_qty=6, cmc=3.0, reason="ERRO_PDV"),
        ]
        s = summarize(items)
        self.assertEqual(s["perdas_value"], -10.0)
        self.assertEqual(s["quebra_tecnica_value"], -40.0)
        self.assertEqual(s["sobras_value"], 3.0)
        self.assertEqual(s["net_value"], -47.0)

    def test_hash_determinístico_e_sensivel(self):
        items = [make_item(id=1, product_id=1), make_item(id=2, product_id=2, counted_qty=9)]
        h1 = snapshot_hash(items)
        self.assertEqual(h1, snapshot_hash(list(reversed(items))))
        items[1]["counted_qty"] = 8
        self.assertNotEqual(h1, snapshot_hash(items))


class TestTransicoes(unittest.TestCase):

    def test_fluxo_valido(self):
        self.assertEqual(check_transition("iniciar", "RASCUNHO"), EM_CONTAGEM)
        self.assertEqual(check_transition("encerrar", EM_CONTAGEM), CONFERENCIA)
        self.assertEqual(check_transition("cancelar", CONFERENCIA), CANCELADO)

    def test_fluxo_invalido(self):
        with self.assertRaises(ValueError):
            check_transition("aprovar", EM_CONTAGEM)
        with self.assertRaises(ValueError):
            check_transition("cancelar", EFETIVADO)


if __name__ == "__main__":
    unittest.main()
