"""
Celery workers module for background tasks.
Provides Celery app configuration and task definitions.
"""

from app.workers.celery_app import celery_app

__all__ = ["celery_app"]
