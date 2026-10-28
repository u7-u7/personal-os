#!/usr/bin/env python3
"""Create local secrets without overwriting an existing configuration."""
import base64
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    raise SystemExit('.env already exists; review it without overwriting existing credentials.')
value = (root / '.env.example').read_text()
password = secrets.token_urlsafe(24)
value = value.replace('POSTGRES_PASSWORD=personalos', f'POSTGRES_PASSWORD={password}')
value = value.replace('personalos:personalos@', f'personalos:{password}@')
value = value.replace('replace-with-at-least-32-random-characters', secrets.token_urlsafe(48))
value = value.replace('replace-with-fernet-key', base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
target.write_text(value)
target.chmod(0o600)
print('Created .env with fresh local secrets. Keep this file private.')
