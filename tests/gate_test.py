import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


sys.modules.setdefault("psycopg", types.SimpleNamespace())
spec = importlib.util.spec_from_file_location("gate", Path(__file__).parents[1] / "runtime/gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Cursor:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value


class Connection:
    def __init__(self, table=True, marker=None):
        self.table = table
        self.marker = marker

    def execute(self, query, params=None):
        if "to_regclass" in query:
            return Cursor(("railway_recipe_bootstrap" if self.table else None,))
        if query.startswith("SELECT secret_fingerprint"):
            return Cursor(self.marker)
        raise AssertionError("Unexpected DB query")


class GateTests(unittest.TestCase):
    @patch.dict(os.environ, {"AUTHENTIK_SECRET_KEY": "stable-signing-secret"}, clear=True)
    def test_missing_table_and_row_fail_closed(self):
        self.assertFalse(gate.approved(Connection(table=False)))
        self.assertFalse(gate.approved(Connection()))

    @patch.dict(os.environ, {"AUTHENTIK_SECRET_KEY": "stable-signing-secret"}, clear=True)
    def test_completed_gate_does_not_read_bootstrap_token_or_password(self):
        self.assertTrue(gate.approved(Connection(marker=(gate.fingerprint(),))))

    @patch.dict(os.environ, {"AUTHENTIK_SECRET_KEY": "changed-secret"}, clear=True)
    def test_secret_change_is_not_accepted_as_completed(self):
        with self.assertRaises(RuntimeError):
            gate.approved(Connection(marker=("old-fingerprint",)))


if __name__ == "__main__":
    unittest.main()
