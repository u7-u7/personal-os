#!/usr/bin/env python3
"""Exercise the real API, Redis, DB and independent Worker without an external model key.

This intentionally verifies a persisted failure, never a fabricated AI success.
Run only against a disposable local/test instance. It creates a named test account.
"""
import json
import os
import secrets
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

base_url = os.environ.get('PERSONALOS_API_URL', 'http://127.0.0.1:8000')
with httpx.Client(base_url=base_url, timeout=30) as client:
    registered = client.post('/api/auth/register', json={
        'email': f'worker-smoke-{secrets.token_hex(8)}@example.com',
        'password': secrets.token_urlsafe(24), 'name': 'Worker acceptance fixture',
    })
    registered.raise_for_status()
    settings = client.get('/api/settings').json()
    if settings['api_key_configured']:
        raise SystemExit('This smoke scenario requires an unconfigured model; refusing a live external invocation.')
    created = client.post('/api/automations', json={
        'title': 'Explicit unconfigured-model acceptance', 'prompt': 'Read my actual tasks',
        'cron': None, 'next_run_at': (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
        'timezone': 'Asia/Shanghai',
    })
    created.raise_for_status()
    automation_id = created.json()['id']
    for _ in range(2):
        result = subprocess.run([sys.executable, '-m', 'personalos.worker', '--once'], check=False,
                                capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError('Worker process failed before it could persist the expected execution failure')
    runs_response = client.get(f'/api/automations/{automation_id}/runs')
    runs_response.raise_for_status()
    runs = runs_response.json()
    assert len(runs) == 1, f'Expected one occurrence across restart, got {len(runs)}'
    run = runs[0]
    assert run['status'] == 'failed', run['status']
    assert run['attempts'] == 1 and not run['result']
    report = {
        'scenario': 'Real independent process with missing model credentials',
        'worker_processes': 2, 'worker_exit_codes': [0, 0],
        'persisted_occurrences': len(runs), 'status': run['status'],
        'attempts': run['attempts'], 'result_empty': not bool(run['result']),
        'external_model_invoked': False,
        'claim': 'Unconfigured dependency fails visibly; restarting does not replay the one-time schedule.',
    }
path = Path(__file__).resolve().parents[1] / 'docs/evidence/worker-smoke.json'
path.write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
