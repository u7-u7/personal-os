"""Give every owner the undeletable default calendar and attach existing events to a calendar.

Re-runnable: both statements are guarded by the state they produce.
"""
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEFAULT_CALENDAR_NAME = "个人"
DEFAULT_CALENDAR_DATA = (
    '{"name": "' + DEFAULT_CALENDAR_NAME + '", "color": "blue", "position": 0, "is_default": true, "visible": true}'
)

OWNERS_WITHOUT_CALENDAR = """
SELECT u.id FROM users u
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM records r
    WHERE r.owner_id = u.id AND r.kind = 'calendar' AND r.deleted_at IS NULL
  )
"""

INSERT_CALENDAR = """
INSERT INTO records (id, owner_id, kind, title, content, status, priority, data, extra,
                     created_at, updated_at, deleted_at, version)
VALUES (:id, :owner_id, 'calendar', :title, '', 'active', 'medium',
        CAST(:data AS json), CAST('{}' AS json), :now, :now, NULL, 1)
"""

ATTACH_EVENTS = """
UPDATE records
SET data = (data::jsonb || jsonb_build_object('calendar_id', CAST(:calendar_id AS text)))::json,
    updated_at = :now, version = version + 1
WHERE owner_id = :owner_id AND kind = 'event' AND deleted_at IS NULL
  AND data->>'calendar_id' IS NULL
"""

LOCAL_PROVIDER = """
UPDATE records
SET data = (data::jsonb || jsonb_build_object('provider', 'local'))::json,
    updated_at = :now, version = version + 1
WHERE owner_id = :owner_id AND kind = 'event' AND deleted_at IS NULL
  AND data->>'provider' IS DISTINCT FROM 'local'
"""

DEFAULT_CALENDARS = """
SELECT owner_id, id FROM records
WHERE kind = 'calendar' AND deleted_at IS NULL AND data->>'is_default' = 'true'
"""


def upgrade():
    op.create_index("ix_records_kind_deleted_start", "records", ["kind", "deleted_at", "start_at"],
                    unique=False, if_not_exists=True)
    connection = op.get_bind()
    now = datetime.now(timezone.utc)
    owners = connection.execute(sa.text(OWNERS_WITHOUT_CALENDAR)).scalars().all()
    for owner_id in owners:
        connection.execute(sa.text(INSERT_CALENDAR), {
            "id": str(uuid.uuid4()), "owner_id": owner_id, "title": DEFAULT_CALENDAR_NAME,
            "data": DEFAULT_CALENDAR_DATA, "now": now})
    for owner_id, calendar_id in connection.execute(sa.text(DEFAULT_CALENDARS)).all():
        connection.execute(sa.text(ATTACH_EVENTS), {"owner_id": owner_id, "calendar_id": calendar_id, "now": now})
        connection.execute(sa.text(LOCAL_PROVIDER), {"owner_id": owner_id, "now": now})


def downgrade():
    # Calendar rows are user data by now, so only the wiring and the index go away.
    op.execute("UPDATE records SET data = (data::jsonb - 'calendar_id')::json "
               "WHERE kind = 'event' AND data->>'calendar_id' IS NOT NULL")
    op.drop_index("ix_records_kind_deleted_start", table_name="records")
