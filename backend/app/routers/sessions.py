from fastapi import APIRouter, HTTPException, BackgroundTasks
from datetime import datetime
import uuid

from app.models.schemas import SessionResponse, SessionUpdateRequest
from app.services import database as db
from app.services.modal_client import (
    DEFAULT_ACCOUNT_ID,
    get_sandbox_status,
    warm_sandbox,
    get_session_messages as get_modal_messages,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse)
async def create_session(name: str = None):
    """Create a new session."""
    session_id = str(uuid.uuid4())
    session = db.create_session(
        session_id=session_id,
        account_id=DEFAULT_ACCOUNT_ID,
        name=name
    )
    files = db.get_files(session_id)
    return SessionResponse(
        id=session["id"],
        name=session["name"],
        created_at=datetime.fromisoformat(session["created_at"]),
        file_count=len(files),
    )


@router.get("", response_model=list[SessionResponse])
async def list_sessions():
    """List all sessions for the demo account."""
    sessions = db.list_sessions(DEFAULT_ACCOUNT_ID)
    result = []
    for session in sessions:
        files = db.get_files(session["id"])
        result.append(SessionResponse(
            id=session["id"],
            name=session["name"],
            created_at=datetime.fromisoformat(session["created_at"]),
            file_count=len(files),
        ))
    return result


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    """Get session information."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    files = db.get_files(session_id)
    return SessionResponse(
        id=session["id"],
        name=session["name"],
        created_at=datetime.fromisoformat(session["created_at"]),
        file_count=len(files),
    )


@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, request: SessionUpdateRequest):
    """Update a session (rename)."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    updated_session = db.update_session_name(session_id, request.name)
    files = db.get_files(session_id)
    return SessionResponse(
        id=updated_session["id"],
        name=updated_session["name"],
        created_at=datetime.fromisoformat(updated_session["created_at"]),
        file_count=len(files),
    )


@router.get("/{session_id}/messages")
async def get_session_messages(session_id: str):
    """Get all messages for a session from Claude SDK storage on Modal."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        result = await get_modal_messages(session_id)
        return result
    except Exception as e:
        print(f"Error getting messages from Modal: {e}")
        # Return empty messages on error
        return {"messages": []}


@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and its files."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Clean up files from Modal
    from app.services.modal_client import cleanup_modal_session
    try:
        await cleanup_modal_session(session_id)
    except Exception as e:
        print(f"Error cleaning up Modal session: {e}")

    # Delete from database
    db.delete_session(session_id)
    return {"status": "deleted"}


@router.get("/{session_id}/sandbox-status")
async def get_session_sandbox_status(session_id: str):
    """Get the sandbox status for a session directly from Modal."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        status = await get_sandbox_status(session_id)
        return status
    except Exception as e:
        print(f"Error getting sandbox status: {e}")
        return {"status": "error", "error": str(e)}


async def _warm_sandbox_task(session_id: str):
    """Background task to warm up sandbox."""
    try:
        result = await warm_sandbox(session_id)
        print(f"Sandbox warm-up for {session_id}: {result.get('status', 'unknown')}")
    except Exception as e:
        print(f"Error warming sandbox for {session_id}: {e}")


@router.post("/{session_id}/warm-up")
async def warm_up_sandbox(session_id: str, background_tasks: BackgroundTasks):
    """
    Pre-warm the sandbox for a session to reduce cold start latency.

    This endpoint triggers sandbox creation in the background and returns immediately.
    The sandbox will be ready when the user sends their first message.
    """
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Run warm-up in background so we don't block the frontend
    background_tasks.add_task(_warm_sandbox_task, session_id)

    return {
        "status": "warming",
        "message": "Sandbox warm-up started in background",
        "session_id": session_id
    }
