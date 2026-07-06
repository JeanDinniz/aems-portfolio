"""
Core package - Security, permissions, and exceptions.
"""

from app.core.exceptions import (
    AEMSException,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ValidationError,
)
from app.core.permissions import Permission, check_permission
from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_password_hash,
    verify_password,
)

__all__ = [
    # Security
    "create_access_token",
    "create_refresh_token",
    "get_current_user",
    "get_password_hash",
    "verify_password",
    # Permissions
    "Permission",
    "check_permission",
    # Exceptions
    "AEMSException",
    "AuthenticationError",
    "AuthorizationError",
    "NotFoundError",
    "ValidationError",
]
