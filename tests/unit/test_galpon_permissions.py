"""
Testes unitários da semântica ADITIVA das flags de galpão.

Regra: a restrição (só galpão / ocultar galpão) só se aplica quando o usuário
tem >=1 perfil ativo e TODOS os perfis ativos carregam a flag. Usuário misto
(perfis de loja + perfil galpão) é usuário normal.
"""

from types import SimpleNamespace

from app.core.permissions import (
    hide_galpon_user,
    is_galpon_profile_user,
    profiles_all_have_flag,
)


def make_profile(is_active=True, is_galpon_profile=False, hide_galpon_option=False):
    return SimpleNamespace(
        is_active=is_active,
        is_galpon_profile=is_galpon_profile,
        hide_galpon_option=hide_galpon_option,
    )


def make_user(role="user", profiles=None):
    return SimpleNamespace(role=role, access_profiles=profiles or [])


class TestIsGalponProfileUser:
    def test_usuario_so_galpao_continua_galpao(self):
        user = make_user(profiles=[make_profile(is_galpon_profile=True)])
        assert is_galpon_profile_user(user) is True

    def test_usuario_multiplos_perfis_todos_galpao(self):
        user = make_user(
            profiles=[
                make_profile(is_galpon_profile=True),
                make_profile(is_galpon_profile=True),
            ]
        )
        assert is_galpon_profile_user(user) is True

    def test_usuario_misto_loja_e_galpao_nao_e_galpao(self):
        """Caso do bug: 3 perfis de loja + 1 perfil galpão → usuário normal."""
        user = make_user(
            profiles=[
                make_profile(),  # BYD Unidade 08
                make_profile(),  # Fiat Unidade 11
                make_profile(is_galpon_profile=True),  # Galpão
                make_profile(),  # Toyota SJM
            ]
        )
        assert is_galpon_profile_user(user) is False

    def test_perfil_galpao_inativo_e_ignorado(self):
        """Perfil galpão inativo não conta: só o de loja ativo → não é galpão."""
        user = make_user(
            profiles=[
                make_profile(is_active=False, is_galpon_profile=True),
                make_profile(),
            ]
        )
        assert is_galpon_profile_user(user) is False

    def test_apenas_perfil_galpao_inativo_nao_e_galpao(self):
        user = make_user(profiles=[make_profile(is_active=False, is_galpon_profile=True)])
        assert is_galpon_profile_user(user) is False

    def test_usuario_sem_perfis_nao_e_galpao(self):
        assert is_galpon_profile_user(make_user()) is False

    def test_owner_nunca_e_galpao(self):
        user = make_user(role="owner", profiles=[make_profile(is_galpon_profile=True)])
        assert is_galpon_profile_user(user) is False


class TestHideGalponUser:
    def test_usuario_so_ocultar_continua_sem_galpao(self):
        user = make_user(profiles=[make_profile(hide_galpon_option=True)])
        assert hide_galpon_user(user) is True
        assert is_galpon_profile_user(user) is False

    def test_usuario_misto_nao_oculta_galpao(self):
        user = make_user(
            profiles=[
                make_profile(hide_galpon_option=True),
                make_profile(),
            ]
        )
        assert hide_galpon_user(user) is False

    def test_usuario_sem_perfis_nao_oculta(self):
        assert hide_galpon_user(make_user()) is False

    def test_owner_nunca_oculta(self):
        user = make_user(role="owner", profiles=[make_profile(hide_galpon_option=True)])
        assert hide_galpon_user(user) is False


class TestConflitoGalpaoOcultar:
    def test_perfil_galpao_mais_perfil_ocultar_nenhuma_restricao(self):
        """Conflito entre perfis: nenhum domina — usuário vê tudo das suas lojas."""
        user = make_user(
            profiles=[
                make_profile(is_galpon_profile=True),
                make_profile(hide_galpon_option=True),
            ]
        )
        assert is_galpon_profile_user(user) is False
        assert hide_galpon_user(user) is False


class TestProfilesAllHaveFlag:
    def test_lista_vazia_e_false(self):
        assert profiles_all_have_flag([], "is_galpon_profile") is False

    def test_todos_com_flag(self):
        profiles = [make_profile(is_galpon_profile=True), make_profile(is_galpon_profile=True)]
        assert profiles_all_have_flag(profiles, "is_galpon_profile") is True

    def test_um_sem_flag(self):
        profiles = [make_profile(is_galpon_profile=True), make_profile()]
        assert profiles_all_have_flag(profiles, "is_galpon_profile") is False

    def test_atributo_ausente_conta_como_false(self):
        profiles = [SimpleNamespace(is_active=True)]
        assert profiles_all_have_flag(profiles, "is_galpon_profile") is False

    def test_aceita_generator(self):
        profiles = (make_profile(hide_galpon_option=True) for _ in range(2))
        assert profiles_all_have_flag(profiles, "hide_galpon_option") is True
