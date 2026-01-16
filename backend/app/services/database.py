"""SQLite database for session and chat persistence."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager

# Database file location
DB_PATH = Path(__file__).parent.parent.parent / "data" / "agent.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection():
    """Get a database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Initialize the database schema."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );

            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT,
                size INTEGER,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
        """)

        # Migration: Add tool_calls column if it doesn't exist
        cursor = conn.execute("PRAGMA table_info(messages)")
        columns = [row[1] for row in cursor.fetchall()]
        if 'tool_calls' not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN tool_calls TEXT")


# Session operations
def create_session(session_id: str, account_id: str, name: str = None) -> dict:
    """Create a new session."""
    with get_db() as conn:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO sessions (id, account_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, account_id, name or f"Session {session_id[:8]}", now, now)
        )
    return get_session(session_id)


def get_session(session_id: str) -> dict | None:
    """Get a session by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?",
            (session_id,)
        ).fetchone()
        if row:
            return dict(row)
    return None


def update_session_name(session_id: str, name: str) -> dict | None:
    """Update a session's name."""
    with get_db() as conn:
        conn.execute(
            "UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?",
            (name, datetime.now(timezone.utc).isoformat(), session_id)
        )
    return get_session(session_id)


def list_sessions(account_id: str) -> list[dict]:
    """List all sessions for an account."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions WHERE account_id = ? ORDER BY updated_at DESC",
            (account_id,)
        ).fetchall()
        return [dict(row) for row in rows]


def update_session_timestamp(session_id: str):
    """Update the session's updated_at timestamp."""
    with get_db() as conn:
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), session_id)
        )


def delete_session(session_id: str):
    """Delete a session and all related data."""
    with get_db() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM files WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


# Message operations
def add_message(session_id: str, role: str, content: str, tool_calls: list | None = None) -> dict:
    """Add a message to a session.

    Args:
        session_id: The session ID
        role: Message role ('user' or 'assistant')
        content: Message text content
        tool_calls: Optional list of tool call objects to persist
    """
    import json

    tool_calls_json = json.dumps(tool_calls) if tool_calls else None

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, role, content, tool_calls_json, datetime.now(timezone.utc).isoformat())
        )
        # Update session timestamp
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), session_id)
        )
        return {
            "id": cursor.lastrowid,
            "session_id": session_id,
            "role": role,
            "content": content,
            "tool_calls": tool_calls,
        }


def get_messages(session_id: str) -> list[dict]:
    """Get all messages for a session."""
    import json

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,)
        ).fetchall()
        messages = []
        for row in rows:
            msg = dict(row)
            # Parse tool_calls JSON if present
            if msg.get('tool_calls'):
                try:
                    msg['tool_calls'] = json.loads(msg['tool_calls'])
                except json.JSONDecodeError:
                    msg['tool_calls'] = None
            else:
                msg['tool_calls'] = None
            messages.append(msg)
        return messages


# File operations
def add_file(file_id: str, session_id: str, name: str, file_type: str, size: int) -> dict:
    """Add a file record to a session."""
    with get_db() as conn:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO files (id, session_id, name, type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)",
            (file_id, session_id, name, file_type, size, now)
        )
        # Update session timestamp
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id)
        )
    return {
        "id": file_id,
        "session_id": session_id,
        "name": name,
        "type": file_type,
        "size": size,
        "uploaded_at": now,
    }


def get_files(session_id: str) -> list[dict]:
    """Get all files for a session."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM files WHERE session_id = ? ORDER BY uploaded_at ASC",
            (session_id,)
        ).fetchall()
        return [dict(row) for row in rows]


def delete_file(file_id: str):
    """Delete a file record."""
    with get_db() as conn:
        conn.execute("DELETE FROM files WHERE id = ?", (file_id,))


def get_file(file_id: str) -> dict | None:
    """Get a file by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM files WHERE id = ?",
            (file_id,)
        ).fetchone()
        if row:
            return dict(row)
    return None


# Initialize database on module load
init_db()
