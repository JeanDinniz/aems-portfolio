"""
Celery application configuration.
Defines the Celery app instance and beat schedule.
"""

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aems_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Sao_Paulo",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 minutes max per task
    worker_prefetch_multiplier=1,
    beat_schedule={
        "purge-old-audit-logs": {
            "task": "app.workers.tasks.purge_old_audit_logs",
            "schedule": 30 * 24 * 3600,  # Monthly (30 days)
        },
        # Lembretes de ponto: verifica a cada 5 min quem está na janela do
        # horário de entrada/saída sem batida (idempotente por funcionário/dia/tipo)
        "time-clock-reminders": {
            "task": "app.workers.tasks.send_time_clock_reminders",
            "schedule": crontab(minute="*/5"),
        },
    },
)
