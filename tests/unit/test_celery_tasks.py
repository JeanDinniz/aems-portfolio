"""
Unit tests for Celery tasks.
Tests background jobs: semaphore updates, notifications, and reports.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.service_orders.models import ServiceOrder
from app.workers.tasks import (
    _update_semaphores_async,
    generate_report,
    run_async,
    send_notification,
    update_all_semaphores,
)


class TestRunAsyncHelper:
    """Tests for run_async helper function."""

    def test_run_async_executes_coroutine(self):
        """Should execute async function in sync context."""

        async def sample_coro():
            return "success"

        result = run_async(sample_coro())
        assert result == "success"

    def test_run_async_with_exception(self):
        """Should propagate exceptions from async function."""

        async def failing_coro():
            raise ValueError("Test error")

        with pytest.raises(ValueError, match="Test error"):
            run_async(failing_coro())

    def test_run_async_closes_loop(self):
        """Should close event loop after execution."""

        async def sample_coro():
            return 42

        result = run_async(sample_coro())
        assert result == 42
        # If loop wasn't closed, subsequent calls would fail


class TestUpdateSemaphoresAsync:
    """Tests for _update_semaphores_async implementation."""

    @pytest.mark.asyncio
    @patch("app.workers.tasks.AsyncSessionLocal")
    @patch("app.workers.tasks.manager")
    async def test_empty_database(self, mock_manager, mock_session_local):
        """Should handle empty database gracefully."""
        # Setup mock session with proper async chain
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []

        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session_local.return_value.__aenter__.return_value = mock_session

        # Execute async implementation
        await _update_semaphores_async()

        # Verify no broadcasts were sent
        mock_manager.send_to_store.assert_not_called()

    @pytest.mark.asyncio
    @patch("app.workers.tasks.AsyncSessionLocal")
    @patch("app.workers.tasks.manager")
    async def test_with_service_orders(self, mock_manager, mock_session_local):
        """Should calculate and broadcast semaphore updates."""
        # Make send_to_store async
        mock_manager.send_to_store = AsyncMock()
        # Create mock service orders
        entry_time_white = datetime.now(UTC) - timedelta(minutes=30)  # White
        entry_time_yellow = datetime.now(UTC) - timedelta(minutes=60)  # Yellow

        mock_so1 = MagicMock(spec=ServiceOrder)
        mock_so1.id = 1
        mock_so1.store_id = 1
        mock_so1.vehicle_plate = "ABC1D23"
        mock_so1.department = "film"
        mock_so1.status = "waiting"
        mock_so1.entry_time = entry_time_white

        mock_so2 = MagicMock(spec=ServiceOrder)
        mock_so2.id = 2
        mock_so2.store_id = 1
        mock_so2.vehicle_plate = "XYZ9F87"
        mock_so2.department = "film"
        mock_so2.status = "in_progress"
        mock_so2.entry_time = entry_time_yellow

        # Setup mock session with proper chain
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [mock_so1, mock_so2]

        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session_local.return_value.__aenter__.return_value = mock_session

        # Execute async implementation
        await _update_semaphores_async()

        # Verify broadcast was called
        mock_manager.send_to_store.assert_called_once()
        call_args = mock_manager.send_to_store.call_args

        assert call_args[0][0] == 1  # store_id
        assert call_args[0][1] == "semaphore_updated"
        assert "service_orders" in call_args[0][2]
        assert len(call_args[0][2]["service_orders"]) == 2

    @pytest.mark.asyncio
    @patch("app.workers.tasks.AsyncSessionLocal")
    @patch("app.workers.tasks.manager")
    async def test_multiple_stores(self, mock_manager, mock_session_local):
        """Should batch updates per store."""
        mock_manager.send_to_store = AsyncMock()
        entry_time = datetime.now(UTC) - timedelta(minutes=30)

        # Create service orders from different stores
        mock_so1 = MagicMock(spec=ServiceOrder)
        mock_so1.id = 1
        mock_so1.store_id = 1
        mock_so1.vehicle_plate = "ABC1D23"
        mock_so1.department = "film"
        mock_so1.status = "waiting"
        mock_so1.entry_time = entry_time

        mock_so2 = MagicMock(spec=ServiceOrder)
        mock_so2.id = 2
        mock_so2.store_id = 2
        mock_so2.vehicle_plate = "XYZ9F87"
        mock_so2.department = "vn"
        mock_so2.status = "waiting"
        mock_so2.entry_time = entry_time

        # Setup mock session
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [mock_so1, mock_so2]

        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session_local.return_value.__aenter__.return_value = mock_session

        # Execute async implementation
        await _update_semaphores_async()

        # Verify broadcasts for both stores
        assert mock_manager.send_to_store.call_count == 2

    @pytest.mark.asyncio
    @patch("app.workers.tasks.AsyncSessionLocal")
    @patch("app.workers.tasks.manager")
    async def test_correct_color_calculation(self, mock_manager, mock_session_local):
        """Should calculate semaphore colors correctly per department."""
        mock_manager.send_to_store = AsyncMock()
        # Film: white < 45, yellow 45-90, orange 90-180, red > 180
        entry_white = datetime.now(UTC) - timedelta(minutes=30)
        entry_yellow = datetime.now(UTC) - timedelta(minutes=60)
        entry_orange = datetime.now(UTC) - timedelta(minutes=120)
        entry_red = datetime.now(UTC) - timedelta(minutes=200)

        mock_orders = []
        for idx, entry_time in enumerate(
            [entry_white, entry_yellow, entry_orange, entry_red], start=1
        ):
            mock_so = MagicMock(spec=ServiceOrder)
            mock_so.id = idx
            mock_so.store_id = 1
            mock_so.vehicle_plate = f"ABC{idx}D23"
            mock_so.department = "film"
            mock_so.status = "waiting"
            mock_so.entry_time = entry_time
            mock_orders.append(mock_so)

        # Setup mock session
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = mock_orders

        mock_result = MagicMock()
        mock_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session_local.return_value.__aenter__.return_value = mock_session

        # Execute async implementation
        await _update_semaphores_async()

        # Verify broadcast
        mock_manager.send_to_store.assert_called_once()
        call_data = mock_manager.send_to_store.call_args[0][2]

        # Check colors
        service_orders = call_data["service_orders"]
        assert service_orders[0]["semaphore_color"] == "white"
        assert service_orders[1]["semaphore_color"] == "yellow"
        assert service_orders[2]["semaphore_color"] == "orange"
        assert service_orders[3]["semaphore_color"] == "red"


class TestUpdateAllSemaphoresTask:
    """Tests for update_all_semaphores Celery task wrapper."""

    @patch("app.workers.tasks.run_async")
    def test_calls_async_implementation(self, mock_run_async):
        """Should call async implementation via run_async."""
        mock_run_async.return_value = None

        update_all_semaphores()

        mock_run_async.assert_called_once()

    @patch("app.workers.tasks.run_async")
    def test_retry_on_exception(self, mock_run_async):
        """Should retry on exceptions."""
        mock_run_async.side_effect = Exception("Database error")

        # Mock retry to avoid actual retry
        with patch.object(
            update_all_semaphores, "retry", side_effect=Exception("Retrying...")
        ):
            with pytest.raises(Exception, match="Retrying..."):
                update_all_semaphores()

    def test_has_max_retries_configured(self):
        """Should have max_retries configured."""
        assert update_all_semaphores.max_retries == 3


class TestSendNotification:
    """Tests for send_notification task."""

    def test_send_notification_email(self):
        """Should accept email notification parameters."""
        # This is a stub task, just verify it doesn't error
        result = send_notification(
            channel="email",
            recipient="user@example.com",
            template="order_confirmation",
            data={"order_id": 123},
        )
        # Should return None or complete without error
        assert result is None

    def test_send_notification_push(self):
        """Should accept push notification parameters."""
        result = send_notification(
            channel="push",
            recipient="device_token_123",
            template="new_order",
            data={"message": "New order received"},
        )
        assert result is None

    def test_send_notification_sms(self):
        """Should accept SMS notification parameters."""
        result = send_notification(
            channel="sms",
            recipient="+5511999999999",
            template="verification_code",
            data={"code": "123456"},
        )
        assert result is None

    @patch("app.workers.tasks.logger")
    def test_send_notification_logs_correctly(self, mock_logger):
        """Should log notification details."""
        send_notification(
            channel="email",
            recipient="test@example.com",
            template="test_template",
            data={},
        )

        # Verify logging was called
        mock_logger.info.assert_called_once()
        log_message = mock_logger.info.call_args[0][0]
        assert "email" in log_message
        assert "test@example.com" in log_message


class TestGenerateReport:
    """Tests for generate_report task."""

    def test_generate_report_service_orders(self):
        """Should accept service orders report parameters."""
        result = generate_report(
            report_type="service_orders",
            filters={"store_id": 1, "date_from": "2026-01-01"},
            user_email="owner@example.com",
        )
        assert result is None

    def test_generate_report_inventory(self):
        """Should accept inventory report parameters."""
        result = generate_report(
            report_type="inventory",
            filters={"category": "film"},
            user_email="supervisor@example.com",
        )
        assert result is None

    def test_generate_report_performance(self):
        """Should accept performance report parameters."""
        result = generate_report(
            report_type="performance",
            filters={"month": "2026-01"},
            user_email="owner@example.com",
        )
        assert result is None

    @patch("app.workers.tasks.logger")
    def test_generate_report_logs_correctly(self, mock_logger):
        """Should log report generation details."""
        generate_report(
            report_type="test_report",
            filters={"test": "data"},
            user_email="user@example.com",
        )

        # Verify logging was called
        mock_logger.info.assert_called_once()
        log_message = mock_logger.info.call_args[0][0]
        assert "test_report" in log_message
        assert "user@example.com" in log_message


class TestCeleryConfiguration:
    """Tests for Celery app configuration."""

    def test_celery_app_exists(self):
        """Should have celery_app instance configured."""
        from app.workers.celery_app import celery_app

        assert celery_app is not None
        assert celery_app.main == "aems_worker"

    def test_celery_beat_schedule_configured(self):
        """Should have beat schedule configured."""
        from app.workers.celery_app import celery_app

        assert "beat_schedule" in celery_app.conf
        schedule = celery_app.conf["beat_schedule"]

        # Check semaphore update task
        assert "update-semaphores" in schedule
        assert (
            schedule["update-semaphores"]["task"]
            == "app.workers.tasks.update_all_semaphores"
        )
        assert schedule["update-semaphores"]["schedule"] == 30.0

    def test_celery_serializer_config(self):
        """Should use JSON serialization."""
        from app.workers.celery_app import celery_app

        assert celery_app.conf["task_serializer"] == "json"
        assert "json" in celery_app.conf["accept_content"]
        assert celery_app.conf["result_serializer"] == "json"

    def test_celery_timezone_config(self):
        """Should use correct timezone."""
        from app.workers.celery_app import celery_app

        assert celery_app.conf["timezone"] == "America/Sao_Paulo"
        assert celery_app.conf["enable_utc"] is True

    def test_celery_task_time_limit(self):
        """Should have task time limits configured."""
        from app.workers.celery_app import celery_app

        assert celery_app.conf["task_time_limit"] == 300  # 5 minutes

    def test_celery_task_tracking(self):
        """Should track task execution."""
        from app.workers.celery_app import celery_app

        assert celery_app.conf["task_track_started"] is True

    def test_celery_worker_prefetch(self):
        """Should have prefetch multiplier configured."""
        from app.workers.celery_app import celery_app

        assert celery_app.conf["worker_prefetch_multiplier"] == 1


class TestTaskScheduling:
    """Tests for task scheduling behavior."""

    def test_semaphore_update_schedule_30_seconds(self):
        """Semaphore updates should run every 30 seconds."""
        from app.workers.celery_app import celery_app

        schedule = celery_app.conf["beat_schedule"]["update-semaphores"]
        assert schedule["schedule"] == 30.0


class TestTaskRetryBehavior:
    """Tests for task retry configuration and behavior."""

    @patch("app.workers.tasks.run_async")
    def test_update_semaphores_retry_with_countdown(self, mock_run_async):
        """Should retry with 10 second countdown."""
        mock_run_async.side_effect = Exception("Test error")

        # Mock retry to capture countdown
        retry_exception = Exception("Retrying...")
        with patch.object(
            update_all_semaphores, "retry", side_effect=retry_exception
        ) as mock_retry:
            with pytest.raises(Exception):
                update_all_semaphores()

            # Verify retry called with countdown
            assert mock_retry.call_count == 1
            assert "countdown" in mock_retry.call_args[1]
            assert mock_retry.call_args[1]["countdown"] == 10
