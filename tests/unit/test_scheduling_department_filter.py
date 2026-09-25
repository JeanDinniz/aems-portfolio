"""
Testes unitários de scheduling_visibility_scopes.

Cada perfil ativo define um escopo (lojas × departamentos) e o usuário vê a UNIÃO
dos escopos (+ a loja direta do usuário, com todos os departamentos). Owner não é
restrito (None). Sem escopo → lista vazia (bloqueia tudo).
"""

from types import SimpleNamespace

from app.core.permissions import scheduling_visibility_scopes


def make_store(store_id: int):
    return SimpleNamespace(id=store_id)


def make_profile(is_active=True, store_ids=None, scheduling_departments=None):
    return SimpleNamespace(
        is_active=is_active,
        stores=[make_store(s) for s in (store_ids or [])],
        scheduling_departments=scheduling_departments if scheduling_departments is not None else [],
    )


def make_user(role="user", store_id=None, profiles=None):
    return SimpleNamespace(role=role, store_id=store_id, access_profiles=profiles or [])


class TestSchedulingVisibilityScopes:
    def test_owner_sem_restricao(self):
        user = make_user(role="owner", profiles=[make_profile(store_ids=[1])])
        assert scheduling_visibility_scopes(user) is None

    def test_sem_perfis_e_sem_loja_bloqueia(self):
        assert scheduling_visibility_scopes(make_user()) == []

    def test_loja_direta_do_usuario_todos_departamentos(self):
        user = make_user(store_id=5)
        assert scheduling_visibility_scopes(user) == [([5], [])]

    def test_perfil_sem_lojas_e_ignorado(self):
        user = make_user(profiles=[make_profile(store_ids=[], scheduling_departments=["film"])])
        assert scheduling_visibility_scopes(user) == []

    def test_perfil_restrito_a_departamento(self):
        user = make_user(
            profiles=[make_profile(store_ids=[1, 2], scheduling_departments=["security_film"])]
        )
        assert scheduling_visibility_scopes(user) == [([1, 2], ["security_film"])]

    def test_dois_perfis_escopos_diferentes(self):
        """Caso do bug: segurança em todas as lojas + todos no shopping."""
        user = make_user(
            profiles=[
                make_profile(store_ids=[1, 2, 3], scheduling_departments=["security_film"]),
                make_profile(store_ids=[2], scheduling_departments=[]),
            ]
        )
        assert scheduling_visibility_scopes(user) == [
            ([1, 2, 3], ["security_film"]),
            ([2], []),
        ]

    def test_perfil_inativo_e_ignorado(self):
        user = make_user(
            profiles=[
                make_profile(is_active=False, store_ids=[1], scheduling_departments=["film"]),
                make_profile(store_ids=[2], scheduling_departments=["security_film"]),
            ]
        )
        assert scheduling_visibility_scopes(user) == [([2], ["security_film"])]

    def test_loja_direta_soma_com_perfis(self):
        user = make_user(
            store_id=9,
            profiles=[make_profile(store_ids=[1], scheduling_departments=["ppf"])],
        )
        assert scheduling_visibility_scopes(user) == [([9], []), ([1], ["ppf"])]
