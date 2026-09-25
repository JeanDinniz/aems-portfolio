"""
Testes unitários para a lógica de classificação por item do Fechamento.

Cobre:
- _svc_agg: agrupamento de serviços por grupo de Oficina (por item)
- _build_item_filter: construção de predicados de filtro por item
- _prefilter_orders_by_service_name: omissão de O.S. inteiras no export
"""

from types import SimpleNamespace

import pytest

from app.modules.service_orders.export import _svc_agg
from app.modules.service_orders.router import (
    _build_item_filter,
    _prefilter_orders_by_service_name,
)

# ---------------------------------------------------------------------------
# Helpers — objetos stub simples (SimpleNamespace)
# ---------------------------------------------------------------------------


def _svc(name: str, code: str = "") -> SimpleNamespace:
    return SimpleNamespace(name=name, code=code)


def _item(
    svc_name: str | None, unit_price: float = 100.0, quantity: int = 1, code: str = ""
) -> SimpleNamespace:
    """Cria um item stub. Se svc_name for None, item.service fica None."""
    service = _svc(svc_name, code) if svc_name is not None else None
    return SimpleNamespace(service=service, unit_price=unit_price, quantity=quantity)


def _order(
    department: str,
    items: list,
    is_courtesy: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(department=department, items=items, is_courtesy=is_courtesy)


# ---------------------------------------------------------------------------
# Testes de _svc_agg
# ---------------------------------------------------------------------------


class TestSvcAggWorkshopCourtesy:
    """O.S. cortesia → todos os itens em workshop_courtesy, nada nos outros."""

    def test_cortesia_agrega_todos_os_itens(self):
        order = _order(
            "workshop",
            [
                _item("Lavagem Simples", unit_price=50.0),
                _item("Polimento", unit_price=200.0),
            ],
            is_courtesy=True,
        )
        result = _svc_agg([order], "workshop_courtesy")
        assert "Lavagem Simples" in result
        assert "Polimento" in result

    def test_cortesia_nao_aparece_em_lavagem(self):
        order = _order(
            "workshop",
            [_item("Lavagem Simples", unit_price=50.0)],
            is_courtesy=True,
        )
        result = _svc_agg([order], "workshop_lavagem")
        assert result == {}

    def test_cortesia_nao_aparece_em_other(self):
        order = _order(
            "workshop",
            [_item("Polimento", unit_price=200.0)],
            is_courtesy=True,
        )
        result = _svc_agg([order], "workshop_other")
        assert result == {}


class TestSvcAggCortesiaOutrosDepartamentos:
    """Cortesia de Película/Segurança/PPF migra para workshop_courtesy; sai do próprio depto."""

    @pytest.mark.parametrize("dept", ["film", "security_film", "ppf"])
    def test_cortesia_migra_para_courtesy(self, dept):
        order = _order(dept, [_item("Película Polarizada", unit_price=300.0)], is_courtesy=True)
        cort = _svc_agg([order], "workshop_courtesy")
        assert "Película Polarizada" in cort
        assert cort["Película Polarizada"]["total"] == 300.0

    @pytest.mark.parametrize("dept", ["film", "security_film", "ppf"])
    def test_cortesia_nao_aparece_no_proprio_departamento(self, dept):
        order = _order(dept, [_item("Película Polarizada", unit_price=300.0)], is_courtesy=True)
        # No próprio bucket do departamento a cortesia não deve mais aparecer
        assert _svc_agg([order], dept) == {}

    @pytest.mark.parametrize("dept", ["film", "security_film", "ppf"])
    def test_nao_cortesia_permanece_no_departamento(self, dept):
        order = _order(dept, [_item("Película Polarizada", unit_price=300.0)], is_courtesy=False)
        assert "Película Polarizada" in _svc_agg([order], dept)
        assert _svc_agg([order], "workshop_courtesy") == {}

    @pytest.mark.parametrize("dept", ["vn", "vu", "bodywork", "vd"])
    def test_cortesia_de_outros_deptos_nao_migra(self, dept):
        """Escopo restrito: VN/VU/Funilaria/VD cortesia NÃO vão para Oficina Cortesia."""
        order = _order(dept, [_item("Serviço X", unit_price=100.0)], is_courtesy=True)
        assert _svc_agg([order], "workshop_courtesy") == {}


class TestSvcAggWorkshopSoLavagem:
    """O.S. apenas com Lavagem Simples → vai para workshop_lavagem, não para workshop_other."""

    def test_so_lavagem_vai_para_lavagem(self):
        order = _order(
            "workshop",
            [_item("Lavagem Simples", unit_price=50.0)],
        )
        result = _svc_agg([order], "workshop_lavagem")
        assert "Lavagem Simples" in result
        assert result["Lavagem Simples"]["count"] == 1
        assert result["Lavagem Simples"]["total"] == 50.0

    def test_so_lavagem_nao_vai_para_other(self):
        order = _order(
            "workshop",
            [_item("Lavagem Simples", unit_price=50.0)],
        )
        result = _svc_agg([order], "workshop_other")
        assert result == {}


class TestSvcAggWorkshopSoOutros:
    """O.S. apenas com serviços não-lavagem → vai para workshop_other, não para workshop_lavagem."""

    def test_so_polimento_vai_para_other(self):
        order = _order(
            "workshop",
            [_item("Polimento", unit_price=200.0)],
        )
        result = _svc_agg([order], "workshop_other")
        assert "Polimento" in result
        assert result["Polimento"]["count"] == 1

    def test_so_polimento_nao_vai_para_lavagem(self):
        order = _order(
            "workshop",
            [_item("Polimento", unit_price=200.0)],
        )
        result = _svc_agg([order], "workshop_lavagem")
        assert result == {}


class TestSvcAggWorkshopMista:
    """O.S. mista (Lavagem Simples + Polimento) → cada item vai para seu grupo."""

    def setup_method(self):
        self.order = _order(
            "workshop",
            [
                _item("Lavagem Simples", unit_price=50.0),
                _item("Polimento", unit_price=200.0),
            ],
        )

    def test_lavagem_vai_para_lavagem(self):
        result = _svc_agg([self.order], "workshop_lavagem")
        assert "Lavagem Simples" in result
        assert "Polimento" not in result
        assert result["Lavagem Simples"]["total"] == 50.0

    def test_polimento_vai_para_other(self):
        result = _svc_agg([self.order], "workshop_other")
        assert "Polimento" in result
        assert "Lavagem Simples" not in result
        assert result["Polimento"]["total"] == 200.0

    def test_sem_dupla_contagem(self):
        """A soma dos dois grupos deve ser igual ao total dos dois itens."""
        lav = _svc_agg([self.order], "workshop_lavagem")
        other = _svc_agg([self.order], "workshop_other")
        total_lav = sum(v["total"] for v in lav.values())
        total_other = sum(v["total"] for v in other.values())
        assert total_lav + total_other == 250.0

    def test_cortesia_com_lavagem_simples_nao_duplica(self):
        """O.S. cortesia com lavagem simples → tudo em courtesy, nada em lavagem/other."""
        order_cort = _order(
            "workshop",
            [
                _item("Lavagem Simples", unit_price=50.0),
                _item("Polimento", unit_price=200.0),
            ],
            is_courtesy=True,
        )
        lav = _svc_agg([order_cort], "workshop_lavagem")
        other = _svc_agg([order_cort], "workshop_other")
        cort = _svc_agg([order_cort], "workshop_courtesy")
        assert lav == {}
        assert other == {}
        assert len(cort) == 2

    def test_item_sem_service_vai_para_other(self):
        """Item sem service (service=None) NÃO casa com contains, vai para workshop_other."""
        order = _order("workshop", [_item(None, unit_price=100.0)])
        result_lav = _svc_agg([order], "workshop_lavagem")
        result_other = _svc_agg([order], "workshop_other")
        assert result_lav == {}
        assert "Serviço sem nome" in result_other


class TestSvcAggMatchCaseInsensitive:
    """Matching de 'lavagem simples' deve ser case-insensitive."""

    @pytest.mark.parametrize(
        "name", ["LAVAGEM SIMPLES", "Lavagem Simples", "lavagem simples", "Lavagem simples"]
    )
    def test_lavagem_simples_case_insensitive(self, name):
        order = _order("workshop", [_item(name, unit_price=50.0)])
        result = _svc_agg([order], "workshop_lavagem")
        assert name in result

    def test_polimento_nao_casa_com_lavagem_simples(self):
        order = _order("workshop", [_item("Polimento", unit_price=200.0)])
        result = _svc_agg([order], "workshop_lavagem")
        assert result == {}


# ---------------------------------------------------------------------------
# Testes de _build_item_filter
# ---------------------------------------------------------------------------


class TestBuildItemFilterNone:
    """Quando ambos os parâmetros são vazios, retorna None (sem filtro)."""

    def test_nenhum_param_retorna_none(self):
        assert _build_item_filter([], []) is None


class TestBuildItemFilterContains:
    """service_name_contains: item passa se service existe e needle está no nome."""

    def setup_method(self):
        self.f = _build_item_filter(["lavagem simples"], [])

    def test_item_com_nome_que_casa(self):
        item = _item("Lavagem Simples")
        assert self.f(item) is True

    def test_item_case_insensitive(self):
        item = _item("LAVAGEM SIMPLES")
        assert self.f(item) is True

    def test_item_nome_parcial(self):
        """Needle parcial no meio do nome deve casar."""
        item = _item("Lavagem Simples Premium")
        assert self.f(item) is True

    def test_item_sem_match(self):
        item = _item("Polimento")
        assert self.f(item) is False

    def test_item_sem_service_nao_casa(self):
        """Item sem service NÃO passa no filtro contains."""
        item = _item(None)
        assert self.f(item) is False


class TestBuildItemFilterNotContains:
    """service_name_not_contains: item passa se não casa (ou se service é None)."""

    def setup_method(self):
        self.f = _build_item_filter([], ["lavagem simples"])

    def test_item_sem_needle_passa(self):
        item = _item("Polimento")
        assert self.f(item) is True

    def test_item_com_needle_nao_passa(self):
        item = _item("Lavagem Simples")
        assert self.f(item) is False

    def test_item_case_insensitive(self):
        item = _item("LAVAGEM SIMPLES")
        assert self.f(item) is False

    def test_item_sem_service_passa(self):
        """Item sem service passa no not_contains (pertence ao grupo Serviços)."""
        item = _item(None)
        assert self.f(item) is True


class TestBuildItemFilterPrecedencia:
    """Quando ambos são fornecidos, contains tem precedência."""

    def test_contains_tem_precedencia_sobre_not_contains(self):
        f = _build_item_filter(["lavagem simples"], ["lavagem simples"])
        # Com precedência de contains, item com "lavagem simples" passa
        assert f(_item("Lavagem Simples")) is True
        # E item sem "lavagem simples" não passa
        assert f(_item("Polimento")) is False


# Lista usada pelos cards VN/VU Lavagem no frontend (web e mobile)
_LAVAGEM_VN_VU = [
    "lavagem", "ducha", "test drive", "teste drive", "lav c/aspira", "lav. simples", "lav test",
]


class TestBuildItemFilterAnyMatch:
    """Múltiplos padrões (split VN/VU Lavagem): item casa se ALGUM needle está no nome."""

    def setup_method(self):
        self.f = _build_item_filter(_LAVAGEM_VN_VU, [])
        self.f_not = _build_item_filter([], _LAVAGEM_VN_VU)

    @pytest.mark.parametrize(
        "name",
        [
            "VN Lavagem completa com motor",
            "Lavagem com aspiração",
            "VU Ducha acordo 18,00",
            "Test Drive",
            "Lavagem Teste Drive",
            "LAV C/ASPIRAÇÃO",
        ],
    )
    def test_lavagens_casam_com_contains(self, name):
        assert self.f(_item(name)) is True

    @pytest.mark.parametrize(
        "name", ["Polimento", "Higienização", "VIP CAR Polimento+Higienização"]
    )
    def test_nao_lavagens_nao_casam_com_contains(self, name):
        assert self.f(_item(name)) is False

    def test_not_contains_exclui_qualquer_padrao(self):
        assert self.f_not(_item("Ducha")) is False
        assert self.f_not(_item("Lavagem completa com motor")) is False
        assert self.f_not(_item("Polimento")) is True

    def test_item_sem_service_segue_as_regras(self):
        assert self.f(_item(None)) is False
        assert self.f_not(_item(None)) is True


# ---------------------------------------------------------------------------
# Testes de _prefilter_orders_by_service_name
# ---------------------------------------------------------------------------


class TestPrefilterContains:
    """contains: omite O.S. sem nenhum item que case."""

    def test_os_com_item_que_casa_e_mantida(self):
        order = _order("workshop", [_item("Lavagem Simples")], is_courtesy=True)
        result = _prefilter_orders_by_service_name([order], ["lavagem simples"], [])
        assert result == [order]

    def test_os_sem_item_que_casa_e_omitida(self):
        order = _order("workshop", [_item("Polimento")])
        result = _prefilter_orders_by_service_name([order], ["lavagem simples"], [])
        assert result == []

    def test_os_sem_itens_e_omitida(self):
        order = _order("workshop", [])
        result = _prefilter_orders_by_service_name([order], ["lavagem simples"], [])
        assert result == []

    def test_any_match_vn_ducha_e_mantida(self):
        """Card VN Lavagem: O.S. só com Ducha casa com a lista de padrões."""
        order = _order("vn", [_item("Ducha")])
        result = _prefilter_orders_by_service_name([order], _LAVAGEM_VN_VU, [])
        assert result == [order]


class TestPrefilterNotContains:
    """not_contains: omite O.S. cujos itens casaram TODOS (linha zerada)."""

    def test_cortesia_so_lavagem_e_omitida(self):
        """Card Cortesia não deve trazer O.S. cujo único serviço é Lavagem Simples."""
        order = _order("workshop", [_item("Lavagem Simples")], is_courtesy=True)
        result = _prefilter_orders_by_service_name([order], [], ["lavagem simples"])
        assert result == []

    def test_os_mista_e_mantida(self):
        order = _order(
            "workshop",
            [_item("Lavagem Simples"), _item("Polimento")],
            is_courtesy=True,
        )
        result = _prefilter_orders_by_service_name([order], [], ["lavagem simples"])
        assert result == [order]

    def test_os_originalmente_sem_itens_e_mantida(self):
        """O.S. sem itens pertence ao grupo Serviços — mantida (linha zerada original)."""
        order = _order("workshop", [])
        result = _prefilter_orders_by_service_name([order], [], ["lavagem simples"])
        assert result == [order]

    def test_item_sem_service_mantem_a_os(self):
        """Item sem service não casa com not_contains → a O.S. ainda tem item válido."""
        order = _order("workshop", [_item("Lavagem Simples"), _item(None)])
        result = _prefilter_orders_by_service_name([order], [], ["lavagem simples"])
        assert result == [order]

    def test_any_match_vn_so_lavagens_e_omitida(self):
        """Card VN: O.S. só com lavagens (Lavagem + Ducha) sai do card de serviços."""
        order = _order("vn", [_item("Lavagem completa com motor"), _item("Ducha")])
        result = _prefilter_orders_by_service_name([order], [], _LAVAGEM_VN_VU)
        assert result == []

    def test_any_match_vn_mista_e_mantida(self):
        order = _order("vn", [_item("Lavagem completa com motor"), _item("Polimento")])
        result = _prefilter_orders_by_service_name([order], [], _LAVAGEM_VN_VU)
        assert result == [order]


class TestPrefilterSemParams:
    """Sem parâmetros, retorna a lista intacta; contains tem precedência."""

    def test_sem_params_retorna_tudo(self):
        orders = [_order("workshop", [_item("Polimento")])]
        assert _prefilter_orders_by_service_name(orders, [], []) == orders

    def test_contains_tem_precedencia(self):
        order = _order("workshop", [_item("Polimento")])
        result = _prefilter_orders_by_service_name(
            [order], ["lavagem simples"], ["lavagem simples"]
        )
        assert result == []
