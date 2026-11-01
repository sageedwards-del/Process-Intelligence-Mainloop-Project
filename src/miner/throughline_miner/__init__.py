"""Throughline process-mining worker.

A small FastAPI service that wraps pm4py for the algorithms that are too heavy for the
TypeScript engine: Inductive Miner discovery, token-replay conformance and XES import.
"""

import os

# pm4py reads these at import time. Progress bars and internal warnings are noise in a
# server's logs, so switch them off unless the operator explicitly asks for them.
os.environ.setdefault("PM4PY_SHOW_PROGRESS_BAR", "False")
os.environ.setdefault("PM4PY_SHOW_INTERNAL_WARNINGS", "False")

__version__ = "0.1.0"
