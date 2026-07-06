"""
Unit tests for core logging configuration.
Tests setup_logging in debug and production modes, and get_logger.
"""

import logging

from app.core.logging import get_logger, setup_logging


class TestSetupLogging:
    """Tests for setup_logging function."""

    def test_debug_mode_sets_debug_level(self):
        setup_logging(debug=True)
        root = logging.getLogger()
        assert root.level == logging.DEBUG

    def test_production_mode_sets_info_level(self):
        setup_logging(debug=False)
        root = logging.getLogger()
        assert root.level == logging.INFO

    def test_debug_mode_configures_handler(self):
        setup_logging(debug=True)
        root = logging.getLogger()
        assert len(root.handlers) == 1
        handler = root.handlers[0]
        assert isinstance(handler, logging.StreamHandler)
        assert handler.formatter is not None

    def test_production_mode_configures_handler(self):
        setup_logging(debug=False)
        root = logging.getLogger()
        assert len(root.handlers) == 1

    def test_clears_existing_handlers(self):
        root = logging.getLogger()
        root.addHandler(logging.StreamHandler())
        root.addHandler(logging.StreamHandler())
        assert len(root.handlers) >= 2

        setup_logging(debug=False)
        assert len(root.handlers) == 1

    def test_uvicorn_access_logger_level(self):
        setup_logging(debug=False)
        uvicorn_logger = logging.getLogger("uvicorn.access")
        assert uvicorn_logger.level == logging.WARNING

    def test_sqlalchemy_logger_debug_mode(self):
        setup_logging(debug=True)
        sa_logger = logging.getLogger("sqlalchemy.engine")
        assert sa_logger.level == logging.INFO

    def test_sqlalchemy_logger_production_mode(self):
        setup_logging(debug=False)
        sa_logger = logging.getLogger("sqlalchemy.engine")
        assert sa_logger.level == logging.WARNING


class TestGetLogger:
    """Tests for get_logger function."""

    def test_returns_bound_logger(self):
        logger = get_logger("test_module")
        assert logger is not None

    def test_different_names_return_loggers(self):
        logger1 = get_logger("module_a")
        logger2 = get_logger("module_b")
        assert logger1 is not None
        assert logger2 is not None
