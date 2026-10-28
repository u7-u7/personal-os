FROM ghcr.io/astral-sh/uv:0.9.18@sha256:5713fa8217f92b80223bc83aac7db36ec80a84437dbc0d04bbc659cae030d8c9 AS uv
FROM python:3.12-slim@sha256:6b25cbe6577518889d553cdd5a5da97d259348d8f6e45b527dd731caaba27a07
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_CACHE_DIR=/tmp/uv-cache UV_HTTP_TIMEOUT=180 UV_CONCURRENT_DOWNLOADS=4 PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
ARG PYPI_INDEX_URL=https://pypi.org/simple
# Export the exact lock with hashes so a network mirror never changes versions
# or trusted artifacts. Runtime does not contact a package registry.
RUN --mount=type=cache,target=/tmp/uv-cache uv export --frozen --no-dev --no-emit-project --format requirements-txt > /tmp/requirements.txt \
    && uv venv .venv \
    && uv pip install --require-hashes --index-url "$PYPI_INDEX_URL" -r /tmp/requirements.txt
COPY apps/api/ ./
RUN --mount=type=cache,target=/tmp/uv-cache uv pip install --no-deps --index-url "$PYPI_INDEX_URL" . \
    && useradd --system --create-home --uid 10001 personalos && chown -R personalos /app
ENV UV_NO_SYNC=1
USER personalos
EXPOSE 8000
CMD ["uv", "run", "--frozen", "uvicorn", "personalos.main:app", "--host", "0.0.0.0", "--port", "8000"]
