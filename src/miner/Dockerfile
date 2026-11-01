# Throughline miner: two stages. `build` resolves the locked dependencies with uv into a
# virtualenv; the runtime stage copies only that virtualenv and runs as a non-root user.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_IMAGE} AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_NO_CACHE=1
WORKDIR /src

# Dependencies first, so code changes don't invalidate this layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY README.md ./
COPY throughline_miner ./throughline_miner
RUN uv sync --frozen --no-dev --no-editable


FROM ${PYTHON_IMAGE} AS runtime
RUN groupadd --system --gid 10001 miner \
 && useradd --system --uid 10001 --gid miner --no-create-home --shell /usr/sbin/nologin miner

COPY --from=build /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PM4PY_SHOW_PROGRESS_BAR=False \
    PM4PY_SHOW_INTERNAL_WARNINGS=False \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=8080

USER miner
WORKDIR /tmp
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"]

# uvicorn reads WEB_CONCURRENCY for the worker count. pm4py is CPU-bound, so scale with
# workers (one per vCPU) rather than threads.
CMD ["sh", "-c", "exec uvicorn --factory throughline_miner.main:create_app --host 0.0.0.0 --port \"$PORT\" --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
