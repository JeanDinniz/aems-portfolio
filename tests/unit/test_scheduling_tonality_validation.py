"""Testes unitários da tonalidade obrigatória por película em agendamentos.

Regra: nos departamentos film e security_film, toda entrada de film_entries
precisa ter tonalidade na criação/edição (PPF usa marca; demais departamentos
não usam película). Agendamentos legados sem tonalidade não são bloqueados no
generate-os — a validação roda apenas em create/update.
"""

import pytest

from app.core.exceptions import ValidationError
from app.modules.scheduling.schemas import FilmEntryItem
from app.modules.scheduling.service import _validate_film_tonalities


def _entry(tonality: str | None) -> FilmEntryItem:
    return FilmEntryItem(service_id=7, tonality=tonality)


class TestDepartamentosQueExigemTonalidade:
    @pytest.mark.parametrize("department", ["film", "security_film"])
    def test_entrada_sem_tonalidade_rejeita(self, department):
        with pytest.raises(ValidationError, match="tonalidade"):
            _validate_film_tonalities(department, [_entry("G35"), _entry(None)])

    @pytest.mark.parametrize("tonality", ["", "   "])
    def test_tonalidade_vazia_ou_em_branco_rejeita(self, tonality):
        with pytest.raises(ValidationError):
            _validate_film_tonalities("film", [_entry(tonality)])

    def test_todas_com_tonalidade_passa(self):
        _validate_film_tonalities("film", [_entry("G05"), _entry("G35")])

    def test_security_film_incolor_passa(self):
        _validate_film_tonalities("security_film", [_entry("Incolor")])


class TestDepartamentosSemExigencia:
    @pytest.mark.parametrize("department", ["ppf", "bodywork", "workshop", "vn", None])
    def test_nao_valida_outros_departamentos(self, department):
        _validate_film_tonalities(department, [_entry(None)])

    def test_sem_entradas_passa(self):
        _validate_film_tonalities("film", None)
        _validate_film_tonalities("film", [])


class TestEntradasComoDict:
    """No update, film_entries pode chegar como list[dict] (payload já serializado)."""

    def test_dict_sem_tonalidade_rejeita(self):
        with pytest.raises(ValidationError):
            _validate_film_tonalities("film", [{"service_id": 7, "tonality": None}])

    def test_dict_sem_chave_tonality_rejeita(self):
        with pytest.raises(ValidationError):
            _validate_film_tonalities("film", [{"service_id": 7}])

    def test_dict_com_tonalidade_passa(self):
        _validate_film_tonalities("film", [{"service_id": 7, "tonality": "G20"}])


class TestApplicationsPorRegiao:
    """Tonalidades por região (applications): todas as regiões exigem tonalidade."""

    def test_applications_completas_passam(self):
        entry = FilmEntryItem(
            service_id=7,
            applications=[
                {"tonality": "G20", "region": "Portas dianteiras"},
                {"tonality": "G05", "region": "Portas traseiras"},
            ],
        )
        _validate_film_tonalities("film", [entry])

    def test_application_dict_sem_tonalidade_rejeita(self):
        # No update, entradas chegam como dicts serializados (sem passar pelo schema)
        with pytest.raises(ValidationError, match="regiões"):
            _validate_film_tonalities(
                "film",
                [
                    {
                        "service_id": 7,
                        "tonality": "G20",
                        "applications": [
                            {"tonality": "G20", "region": "Frente"},
                            {"tonality": "", "region": "Trás"},
                        ],
                    }
                ],
            )

    def test_espelho_tonality_resumido(self):
        entry = FilmEntryItem(
            service_id=7,
            applications=[
                {"tonality": "G20", "region": "Portas dianteiras"},
                {"tonality": "G05", "region": "Portas traseiras"},
            ],
        )
        assert entry.tonality == "G20/G05"

    def test_espelho_tonalidade_unica(self):
        entry = FilmEntryItem(
            service_id=7,
            applications=[{"tonality": "g20", "region": None}],
        )
        # normalize_tonality aplica upper no padrão G##
        assert entry.tonality == "G20"

    def test_sem_applications_mantem_tonality_legado(self):
        entry = FilmEntryItem(service_id=7, tonality="G35")
        assert entry.applications is None
        assert entry.tonality == "G35"
