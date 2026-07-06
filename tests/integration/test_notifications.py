"""
Integration tests for notifications endpoints.
Tests listing, marking read, unread count, and mark-all-read.
"""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationType

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def notification_unread(db_session: AsyncSession, test_user: User) -> Notification:
    """Create an unread notification for the test user."""
    n = Notification(
        user_id=test_user.id,
        type=NotificationType.ORDER_CREATED.value,
        title="Nova O.S. criada",
        body="Ordem de serviço #123 foi criada.",
        is_read=False,
        created_at=datetime(2026, 3, 1, 10, 0, tzinfo=UTC),
    )
    db_session.add(n)
    await db_session.commit()
    await db_session.refresh(n)
    return n


@pytest.fixture
async def notification_read(db_session: AsyncSession, test_user: User) -> Notification:
    """Create a read notification for the test user."""
    n = Notification(
        user_id=test_user.id,
        type=NotificationType.ORDER_COMPLETED.value,
        title="O.S. concluída",
        body="Ordem de serviço #100 foi concluída.",
        is_read=True,
        created_at=datetime(2026, 2, 28, 15, 0, tzinfo=UTC),
    )
    db_session.add(n)
    await db_session.commit()
    await db_session.refresh(n)
    return n


@pytest.fixture
async def notification_other_user(
    db_session: AsyncSession, test_owner: User
) -> Notification:
    """Create a notification belonging to a different user (owner)."""
    n = Notification(
        user_id=test_owner.id,
        type=NotificationType.APPROVAL_NEEDED.value,
        title="Aprovação necessária",
        body="Solicitação de compra precisa de aprovação.",
        is_read=False,
        created_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )
    db_session.add(n)
    await db_session.commit()
    await db_session.refresh(n)
    return n


@pytest.fixture
async def multiple_unread(
    db_session: AsyncSession, test_user: User
) -> list[Notification]:
    """Create 3 unread notifications for the test user."""
    notifications = []
    for i in range(3):
        n = Notification(
            user_id=test_user.id,
            type=NotificationType.INVENTORY_ALERT.value,
            title=f"Alerta de estoque {i+1}",
            body=f"Estoque baixo do item {i+1}.",
            is_read=False,
            created_at=datetime(2026, 3, 1, 10 + i, 0, tzinfo=UTC),
        )
        db_session.add(n)
        notifications.append(n)
    await db_session.commit()
    for n in notifications:
        await db_session.refresh(n)
    return notifications


# ===========================================================================
# List Notifications
# ===========================================================================


class TestListNotifications:
    """Tests for GET /api/v1/notifications."""

    @pytest.mark.asyncio
    async def test_list_empty(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get("/api/v1/notifications")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_returns_own_notifications(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
        notification_read: Notification,
    ):
        response = await authenticated_client.get("/api/v1/notifications")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["pagination"]["total"] == 2

    @pytest.mark.asyncio
    async def test_list_does_not_include_other_users(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
        notification_other_user: Notification,
    ):
        response = await authenticated_client.get("/api/v1/notifications")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["id"] == notification_unread.id

    @pytest.mark.asyncio
    async def test_list_unread_first(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
        notification_read: Notification,
    ):
        """Unread notifications should appear before read ones."""
        response = await authenticated_client.get("/api/v1/notifications")
        assert response.status_code == 200
        items = response.json()["items"]
        assert items[0]["is_read"] is False
        assert items[1]["is_read"] is True

    @pytest.mark.asyncio
    async def test_list_pagination(
        self,
        authenticated_client: AsyncClient,
        multiple_unread: list[Notification],
    ):
        response = await authenticated_client.get(
            "/api/v1/notifications?page=1&limit=2"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["pagination"]["total"] == 3

    @pytest.mark.asyncio
    async def test_list_unauthenticated(self, client: AsyncClient):
        response = await client.get("/api/v1/notifications")
        assert response.status_code == 401


# ===========================================================================
# Unread Count
# ===========================================================================


class TestUnreadCount:
    """Tests for GET /api/v1/notifications/unread-count."""

    @pytest.mark.asyncio
    async def test_unread_count_zero(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            "/api/v1/notifications/unread-count"
        )
        assert response.status_code == 200
        assert response.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_unread_count_with_data(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
        notification_read: Notification,
    ):
        response = await authenticated_client.get(
            "/api/v1/notifications/unread-count"
        )
        assert response.status_code == 200
        assert response.json()["count"] == 1  # only 1 unread

    @pytest.mark.asyncio
    async def test_unread_count_excludes_other_user(
        self,
        authenticated_client: AsyncClient,
        notification_other_user: Notification,
    ):
        response = await authenticated_client.get(
            "/api/v1/notifications/unread-count"
        )
        assert response.status_code == 200
        assert response.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_unread_count_multiple(
        self,
        authenticated_client: AsyncClient,
        multiple_unread: list[Notification],
    ):
        response = await authenticated_client.get(
            "/api/v1/notifications/unread-count"
        )
        assert response.status_code == 200
        assert response.json()["count"] == 3


# ===========================================================================
# Mark As Read
# ===========================================================================


class TestMarkAsRead:
    """Tests for PATCH /api/v1/notifications/{id}/read."""

    @pytest.mark.asyncio
    async def test_mark_as_read(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
    ):
        response = await authenticated_client.patch(
            f"/api/v1/notifications/{notification_unread.id}/read"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_read"] is True
        assert data["id"] == notification_unread.id

    @pytest.mark.asyncio
    async def test_mark_as_read_already_read(
        self,
        authenticated_client: AsyncClient,
        notification_read: Notification,
    ):
        """Marking an already-read notification should still succeed."""
        response = await authenticated_client.patch(
            f"/api/v1/notifications/{notification_read.id}/read"
        )
        assert response.status_code == 200
        assert response.json()["is_read"] is True

    @pytest.mark.asyncio
    async def test_mark_as_read_not_found(self, authenticated_client: AsyncClient):
        response = await authenticated_client.patch(
            "/api/v1/notifications/99999/read"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_mark_as_read_other_users_notification(
        self,
        authenticated_client: AsyncClient,
        notification_other_user: Notification,
    ):
        """Cannot mark another user's notification as read."""
        response = await authenticated_client.patch(
            f"/api/v1/notifications/{notification_other_user.id}/read"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_mark_as_read_updates_unread_count(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
    ):
        # Before
        resp = await authenticated_client.get("/api/v1/notifications/unread-count")
        assert resp.json()["count"] == 1

        # Mark read
        await authenticated_client.patch(
            f"/api/v1/notifications/{notification_unread.id}/read"
        )

        # After
        resp = await authenticated_client.get("/api/v1/notifications/unread-count")
        assert resp.json()["count"] == 0


# ===========================================================================
# Mark All Read
# ===========================================================================


class TestMarkAllRead:
    """Tests for POST /api/v1/notifications/mark-all-read."""

    @pytest.mark.asyncio
    async def test_mark_all_read_no_notifications(
        self, authenticated_client: AsyncClient
    ):
        response = await authenticated_client.post(
            "/api/v1/notifications/mark-all-read"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["updated"] == 0

    @pytest.mark.asyncio
    async def test_mark_all_read_with_unread(
        self,
        authenticated_client: AsyncClient,
        multiple_unread: list[Notification],
    ):
        response = await authenticated_client.post(
            "/api/v1/notifications/mark-all-read"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["updated"] == 3

        # Verify count is now 0
        resp = await authenticated_client.get("/api/v1/notifications/unread-count")
        assert resp.json()["count"] == 0

    @pytest.mark.asyncio
    async def test_mark_all_read_ignores_already_read(
        self,
        authenticated_client: AsyncClient,
        notification_unread: Notification,
        notification_read: Notification,
    ):
        response = await authenticated_client.post(
            "/api/v1/notifications/mark-all-read"
        )
        assert response.status_code == 200
        assert response.json()["updated"] == 1  # only the unread one

    @pytest.mark.asyncio
    async def test_mark_all_read_does_not_affect_other_user(
        self,
        authenticated_client: AsyncClient,
        notification_other_user: Notification,
        multiple_unread: list[Notification],
    ):
        response = await authenticated_client.post(
            "/api/v1/notifications/mark-all-read"
        )
        assert response.status_code == 200
        assert response.json()["updated"] == 3  # only own notifications


# ===========================================================================
# Service-level: create_notification
# ===========================================================================


class TestCreateNotificationService:
    """Tests for the create_notification service function."""

    @pytest.mark.asyncio
    async def test_create_with_enum_type(
        self, db_session: AsyncSession, test_user: User
    ):
        from app.modules.notifications.service import create_notification

        notif = await create_notification(
            db=db_session,
            user_id=test_user.id,
            type=NotificationType.INCIDENT_REPORTED,
            title="Incidente",
            body="Um incidente foi reportado.",
        )
        assert notif.id is not None
        assert notif.type == "incident_reported"
        assert notif.is_read is False

    @pytest.mark.asyncio
    async def test_create_with_string_type(
        self, db_session: AsyncSession, test_user: User
    ):
        from app.modules.notifications.service import create_notification

        notif = await create_notification(
            db=db_session,
            user_id=test_user.id,
            type="custom_type",
            title="Custom",
            body="Custom notification.",
        )
        assert notif.type == "custom_type"
        assert notif.title == "Custom"
