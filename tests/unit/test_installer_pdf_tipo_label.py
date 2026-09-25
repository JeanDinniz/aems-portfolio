"""
Testes unitários de ``_tipo_label`` (app.modules.installer_performance.pdf).

O helper monta o texto da coluna TIPO nos PDFs de Desempenho (Diário e
Individual) a partir das flags ``is_return``, ``is_courtesy`` e ``has_shared``.
Antes da correção, ``has_shared`` era ignorado e um serviço apenas dividido
saía como "-" no PDF, embora a tela exibisse o badge "Dividido".
"""

from app.modules.installer_performance.pdf import _tipo_label


def test_sem_flags_retorna_traco():
    assert _tipo_label(False, False, False) == "-"


def test_apenas_dividido():
    assert _tipo_label(False, False, True) == "Dividido"


def test_apenas_retorno():
    assert _tipo_label(True, False, False) == "Retorno"


def test_apenas_cortesia():
    assert _tipo_label(False, True, False) == "Cortesia"


def test_retorno_e_dividido():
    assert _tipo_label(True, False, True) == "Retorno · Dividido"


def test_todas_as_flags():
    assert _tipo_label(True, True, True) == "Retorno · Cortesia · Dividido"


def test_has_shared_default_false():
    # Chamadas antigas sem o argumento continuam funcionando.
    assert _tipo_label(False, False) == "-"
    assert _tipo_label(True, False) == "Retorno"
