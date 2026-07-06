"""
Unit tests for service order semaphore logic.
Tests time calculation and color determination based on department thresholds.
"""

from datetime import UTC, datetime, timedelta

from app.modules.service_orders.enums import SemaphoreColor
from app.modules.service_orders.semaphore import (
    calculate_elapsed_minutes,
    calculate_semaphore,
    get_department_thresholds,
)
from app.modules.services.enums import ServiceDepartment


class TestCalculateElapsedMinutes:
    """Tests for elapsed minutes calculation."""

    def test_calculate_elapsed_minutes_recent(self):
        """Should calculate minutes for recent entry."""
        entry_time = datetime.now(UTC) - timedelta(minutes=30)
        elapsed = calculate_elapsed_minutes(entry_time)
        assert 29 <= elapsed <= 31  # Allow small variance

    def test_calculate_elapsed_minutes_old(self):
        """Should calculate minutes for older entry."""
        entry_time = datetime.now(UTC) - timedelta(hours=2)
        elapsed = calculate_elapsed_minutes(entry_time)
        assert 119 <= elapsed <= 121  # Allow small variance

    def test_calculate_elapsed_minutes_naive_datetime(self):
        """Should handle naive datetime by assuming UTC."""
        entry_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=15)
        elapsed = calculate_elapsed_minutes(entry_time)
        assert 14 <= elapsed <= 16


class TestCalculateSemaphoreFilm:
    """Tests for semaphore calculation for film department."""

    def test_film_white_under_45_min(self):
        """Film should be white under 45 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=30)
        color, elapsed = calculate_semaphore("film", entry_time)
        assert color == SemaphoreColor.WHITE
        assert 29 <= elapsed <= 31

    def test_film_yellow_45_to_90_min(self):
        """Film should be yellow between 45-90 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=60)
        color, elapsed = calculate_semaphore("film", entry_time)
        assert color == SemaphoreColor.YELLOW
        assert 59 <= elapsed <= 61

    def test_film_orange_90_to_180_min(self):
        """Film should be orange between 90-180 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=120)
        color, elapsed = calculate_semaphore("film", entry_time)
        assert color == SemaphoreColor.ORANGE
        assert 119 <= elapsed <= 121

    def test_film_red_over_180_min(self):
        """Film should be red over 180 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=200)
        color, elapsed = calculate_semaphore("film", entry_time)
        assert color == SemaphoreColor.RED
        assert 199 <= elapsed <= 201


class TestCalculateSemaphoreVN:
    """Tests for semaphore calculation for VN (Veículos Novos) department."""

    def test_vn_white_under_30_min(self):
        """VN should be white under 30 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=20)
        color, elapsed = calculate_semaphore("vn", entry_time)
        assert color == SemaphoreColor.WHITE

    def test_vn_yellow_30_to_60_min(self):
        """VN should be yellow between 30-60 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=45)
        color, elapsed = calculate_semaphore("vn", entry_time)
        assert color == SemaphoreColor.YELLOW

    def test_vn_orange_60_to_120_min(self):
        """VN should be orange between 60-120 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=90)
        color, elapsed = calculate_semaphore("vn", entry_time)
        assert color == SemaphoreColor.ORANGE

    def test_vn_red_over_120_min(self):
        """VN should be red over 120 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=150)
        color, elapsed = calculate_semaphore("vn", entry_time)
        assert color == SemaphoreColor.RED


class TestCalculateSemaphoreBodywork:
    """Tests for semaphore calculation for bodywork department."""

    def test_bodywork_white_under_60_min(self):
        """Bodywork should be white under 60 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=30)
        color, elapsed = calculate_semaphore("bodywork", entry_time)
        assert color == SemaphoreColor.WHITE

    def test_bodywork_yellow_60_to_120_min(self):
        """Bodywork should be yellow between 60-120 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=90)
        color, elapsed = calculate_semaphore("bodywork", entry_time)
        assert color == SemaphoreColor.YELLOW

    def test_bodywork_orange_120_to_240_min(self):
        """Bodywork should be orange between 120-240 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=180)
        color, elapsed = calculate_semaphore("bodywork", entry_time)
        assert color == SemaphoreColor.ORANGE

    def test_bodywork_red_over_240_min(self):
        """Bodywork should be red over 240 minutes."""
        entry_time = datetime.now(UTC) - timedelta(minutes=300)
        color, elapsed = calculate_semaphore("bodywork", entry_time)
        assert color == SemaphoreColor.RED


class TestCalculateSemaphoreInvalidDepartment:
    """Tests for semaphore with invalid department."""

    def test_invalid_department_uses_film_thresholds(self):
        """Invalid department should default to film thresholds."""
        entry_time = datetime.now(UTC) - timedelta(minutes=30)
        color, elapsed = calculate_semaphore("invalid_dept", entry_time)
        # Should use film thresholds, so under 45 min = white
        assert color == SemaphoreColor.WHITE


class TestGetDepartmentThresholds:
    """Tests for getting department thresholds."""

    def test_get_film_thresholds(self):
        """Should return correct thresholds for film."""
        thresholds = get_department_thresholds(ServiceDepartment.FILM)
        assert thresholds["white"] == 45
        assert thresholds["yellow"] == 90
        assert thresholds["orange"] == 180

    def test_get_vn_thresholds(self):
        """Should return correct thresholds for VN."""
        thresholds = get_department_thresholds(ServiceDepartment.VN)
        assert thresholds["white"] == 30
        assert thresholds["yellow"] == 60
        assert thresholds["orange"] == 120

    def test_get_bodywork_thresholds(self):
        """Should return correct thresholds for bodywork."""
        thresholds = get_department_thresholds(ServiceDepartment.BODYWORK)
        assert thresholds["white"] == 60
        assert thresholds["yellow"] == 120
        assert thresholds["orange"] == 240


class TestSemaphoreColorEnum:
    """Tests for SemaphoreColor enum."""

    def test_semaphore_color_values(self):
        """Should have correct color values."""
        assert SemaphoreColor.WHITE.value == "white"
        assert SemaphoreColor.YELLOW.value == "yellow"
        assert SemaphoreColor.ORANGE.value == "orange"
        assert SemaphoreColor.RED.value == "red"

    def test_semaphore_color_labels(self):
        """Should have correct Portuguese labels."""
        assert SemaphoreColor.WHITE.label == "Branco"
        assert SemaphoreColor.YELLOW.label == "Amarelo"
        assert SemaphoreColor.ORANGE.label == "Laranja"
        assert SemaphoreColor.RED.label == "Vermelho"
