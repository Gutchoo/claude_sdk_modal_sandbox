from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from datetime import datetime
import uuid
import traceback
import base64

from app.models.schemas import FileInfo, FileListResponse
from app.services import database as db
from app.services.modal_client import (
    save_file_to_modal,
    delete_file_from_modal,
    get_file_content_from_modal,
    invalidate_and_warm_sandbox,
)

router = APIRouter(prefix="/api/sessions/{session_id}/files", tags=["files"])


@router.post("", response_model=list[FileInfo])
async def upload_files(session_id: str, files: list[UploadFile] = File(...)):
    """Upload files to a session."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    uploaded = []
    for file in files:
        file_id = str(uuid.uuid4())
        content = await file.read()

        try:
            # Upload to Modal volume (just saves file, no sandbox operations)
            modal_result = await save_file_to_modal(
                session_id=session_id,
                filename=file.filename,
                content=content,
            )
            print(f"Uploaded to Modal: {modal_result}")
        except Exception as e:
            print(f"Error uploading to Modal: {e}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")

        # Save to database
        file_record = db.add_file(
            file_id=file_id,
            session_id=session_id,
            name=file.filename,
            file_type=file.content_type or "application/octet-stream",
            size=len(content),
        )

        uploaded.append(FileInfo(
            id=file_record["id"],
            name=file_record["name"],
            type=file_record["type"],
            size=file_record["size"],
            uploaded_at=datetime.fromisoformat(file_record["uploaded_at"]),
        ))

    # After all files are uploaded, invalidate sandbox once and warm up a fresh one
    try:
        await invalidate_and_warm_sandbox(session_id)
    except Exception as e:
        print(f"Warning: Failed to invalidate/warm sandbox after upload: {e}")

    return uploaded


@router.get("", response_model=FileListResponse)
async def list_files(session_id: str):
    """List all files in a session."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    files = db.get_files(session_id)
    file_infos = [
        FileInfo(
            id=f["id"],
            name=f["name"],
            type=f["type"],
            size=f["size"],
            uploaded_at=datetime.fromisoformat(f["uploaded_at"]),
        )
        for f in files
    ]
    return FileListResponse(files=file_infos)


@router.delete("/{file_id}")
async def delete_file(session_id: str, file_id: str):
    """Delete a file from a session."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    file_record = db.get_file(file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        # Delete from Modal volume
        await delete_file_from_modal(session_id, file_record["name"])
    except Exception as e:
        print(f"Error deleting from Modal: {e}")
        traceback.print_exc()

    # Delete from database
    db.delete_file(file_id)

    return {"status": "deleted"}


@router.get("/{file_id}/content")
async def get_file_content(session_id: str, file_id: str):
    """Get file content for preview."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    file_record = db.get_file(file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        result = await get_file_content_from_modal(session_id, file_record["name"])

        if result.get("error"):
            raise HTTPException(status_code=404, detail=result["error"])

        content = result["content"]
        content_type = file_record["type"]

        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{file_record["name"]}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting file content: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to get file content: {str(e)}")
