"""
Service enums - Enumerations for service module.
"""

from enum import StrEnum


class ServiceCategory(StrEnum):
    """Categorias de serviço disponíveis."""

    INSULFILM = "insulfilm"
    PELICULA_SEGURANCA = "pelicula_seguranca"
    PPF = "ppf"
    ESTETICA = "estetica"

    @property
    def label(self) -> str:
        """Retorna o label em português da categoria."""
        labels = {
            "insulfilm": "Película",
            "pelicula_seguranca": "Película de Segurança",
            "ppf": "PPF",
            "estetica": "Estética",
        }
        return labels.get(self.value, self.value)


class ServiceDepartment(StrEnum):
    """Departamentos de serviço disponíveis."""

    FILM = "film"  # Película
    SECURITY_FILM = "security_film"  # Película de Segurança
    PPF = "ppf"  # PPF (Proteção de Pintura)
    BODYWORK = "bodywork"  # Funilaria
    VN = "vn"  # Veículos Novos
    VD = "vd"  # Venda Direta
    VU = "vu"  # Veículos Usados
    WORKSHOP = "workshop"  # Oficina

    @property
    def label(self) -> str:
        """Retorna o label em português do departamento."""
        labels = {
            self.FILM: "Película",
            self.SECURITY_FILM: "Película de Segurança",
            self.PPF: "PPF",
            self.BODYWORK: "Funilaria",
            self.VN: "Veículos Novos",
            self.VD: "Venda Direta",
            self.VU: "Veículos Usados",
            self.WORKSHOP: "Oficina",
        }
        return labels[self]
