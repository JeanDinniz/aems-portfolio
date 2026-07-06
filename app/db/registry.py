"""
Registro central de models SQLAlchemy.

Importar este módulo (pelo seu efeito colateral) garante que TODOS os models
estejam registrados no `Base.registry` antes que o SQLAlchemy configure os
mappers. É necessário em contextos *standalone* — fora do processo da API —
onde os routers não são importados no startup, como os **workers Celery**.

Sem isso, ao consultar um model que possui `relationship("OutroModel")` por
nome (ex.: `PushDevice.user → "User"`), o `configure_mappers()` falha com
"failed to locate a name" porque a classe alvo nunca foi importada no processo.

A descoberta é dinâmica (varre `app.modules.*.models`) para nunca ficar
desatualizada quando um novo módulo de model for adicionado.
"""

import importlib
import pkgutil

import app.modules
from app.core import audit  # noqa: F401  — AuditLog (fora de app.modules)


def _import_all_models() -> None:
    """Importa todos os `app.modules.<pkg>.models` existentes (efeito colateral)."""
    package = app.modules
    for module_info in pkgutil.iter_modules(package.__path__):
        if not module_info.ispkg:
            continue
        models_module = f"{package.__name__}.{module_info.name}.models"
        try:
            importlib.import_module(models_module)
        except ModuleNotFoundError as exc:
            # Módulos sem models.py (ex.: analytics, audit_logs) — ignorar.
            # Qualquer outro ModuleNotFoundError (dependência real ausente) propaga.
            if exc.name != models_module:
                raise


_import_all_models()
