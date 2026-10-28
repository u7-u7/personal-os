#!/usr/bin/env python3
"""Capture real PostgreSQL plans; no joins, writes, credentials or user content."""
import json
from pathlib import Path

from personalos.config import get_settings
from sqlalchemy import create_engine, text

engine = create_engine(get_settings().database_url)
queries = {
    'tenant_task_page': "SELECT id FROM records WHERE owner_id=:owner AND kind='task' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
    'calendar_conflict': "SELECT id FROM records WHERE owner_id=:owner AND kind='event' AND deleted_at IS NULL AND start_at < now() + interval '1 day' AND end_at > now() LIMIT 1",
    'scheduler_claim': "SELECT id FROM automations WHERE status='active' AND deleted_at IS NULL AND next_run_at <= now() ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    'execution_claim': "SELECT id FROM executions WHERE status IN ('queued','pending') AND deleted_at IS NULL AND automation_id IN (SELECT id FROM automations WHERE status != 'paused') ORDER BY scheduled_at LIMIT 100 FOR UPDATE SKIP LOCKED",
}
report = {'note': 'Natural planner choices on the current development dataset. Not a production load benchmark.', 'queries': {}}
with engine.connect() as connection:
    report['postgres_version'] = connection.scalar(text('SHOW server_version'))
    for name, sql in queries.items():
        report['queries'][name] = connection.execute(text('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql), {'owner':'00000000-0000-0000-0000-000000000000'}).scalar()
    report['indexes'] = [dict(row) for row in connection.execute(text("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename IN ('records','automations','executions','auth_sessions') ORDER BY tablename,indexname")).mappings()]
path = Path(__file__).resolve().parents[1] / 'docs' / 'evidence' / 'query-plans.json'
path.write_text(json.dumps(report, indent=2))
print(f'Captured {len(queries)} real query plans and {len(report["indexes"])} indexes; no production load claim.')
