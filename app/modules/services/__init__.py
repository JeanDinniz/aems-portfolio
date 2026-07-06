"""
Services module - Manages service catalog (película, funilaria, veículos novos, veículos usados, oficina).
"""

from app.modules.services.enums import ServiceDepartment
from app.modules.services.models import Service

__all__ = ["Service", "ServiceDepartment"]
