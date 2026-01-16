from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime, timezone
import asyncio
import json
import traceback

from app.services import database as db
from app.services.modal_client import call_agent_streaming, interrupt_agent

router = APIRouter(tags=["chat"])


@router.websocket("/api/sessions/{session_id}/chat")
async def chat_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for chat messages with streaming responses.

    Messages are stored by Claude SDK on the Modal volume, not in SQLite.
    This endpoint just streams events to the frontend in real-time.

    Supports two message types from client:
    - {"message": "..."} - Send a chat message
    - {"type": "stop"} - Stop the current generation
    """
    session = db.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    # Queue for incoming messages from the client
    message_queue: asyncio.Queue = asyncio.Queue()
    # Event to signal when streaming should stop
    stop_event = asyncio.Event()
    # Track if we received an interrupt during streaming
    was_interrupted = False

    async def receive_messages():
        """Task to receive messages from WebSocket and put them in the queue."""
        nonlocal was_interrupted
        try:
            while True:
                data = await websocket.receive_text()
                message_data = json.loads(data)

                # Handle stop request immediately
                if message_data.get("type") == "stop":
                    stop_event.set()
                    try:
                        result = await interrupt_agent(session_id)
                        print(f"Interrupt result: {result}")
                        was_interrupted = True
                        await websocket.send_json({
                            "type": "stream",
                            "event": {"type": "stop_acknowledged", "result": result},
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                    except Exception as e:
                        print(f"Error interrupting agent: {e}")
                        traceback.print_exc()
                else:
                    # Put regular messages in the queue
                    await message_queue.put(message_data)
        except WebSocketDisconnect:
            await message_queue.put(None)  # Signal disconnect
        except Exception as e:
            print(f"Error receiving messages: {e}")
            await message_queue.put(None)

    async def process_messages():
        """Task to process messages from the queue."""
        nonlocal was_interrupted

        while True:
            message_data = await message_queue.get()

            if message_data is None:
                break  # WebSocket disconnected

            user_message = message_data.get("message", "")
            if not user_message:
                continue

            # Check for file references (@mentions)
            file_ids = message_data.get("file_ids", [])
            if file_ids:
                # Look up file names from database
                referenced_files = []
                for file_id in file_ids:
                    file_info = db.get_file(file_id)
                    if file_info and file_info.get("session_id") == session_id:
                        referenced_files.append(file_info)

                if referenced_files:
                    # Build file context to prepend to message
                    file_context_lines = ["[REFERENCED FILES]"]
                    file_context_lines.append("The user has specifically referenced these files. Read them directly without listing first:")
                    for f in referenced_files:
                        file_context_lines.append(f"- /data/{f['name']}")
                    file_context_lines.append("[END REFERENCED FILES]")
                    file_context_lines.append("")

                    # Prepend file context to user message
                    user_message = "\n".join(file_context_lines) + user_message

            # Reset stop event and interrupted flag for new message
            stop_event.clear()
            was_interrupted = False

            # Update session timestamp to keep it sorted by recent activity
            db.update_session_timestamp(session_id)

            try:
                # Track response content for completion message
                all_text_content = []

                # Stream events from Modal agent (Claude SDK stores conversation in JSONL)
                async for event_chunk in call_agent_streaming(
                    session_id=session_id,
                    user_message=user_message,
                ):
                    # Modal may yield multiple JSON lines in one chunk, split them
                    for event_str in event_chunk.split('\n'):
                        event_str = event_str.strip()
                        if not event_str:
                            continue

                        try:
                            event = json.loads(event_str)
                            event_type = event.get("type")

                            # Check if this is an interruption event from the agent
                            if event_type == "interrupted":
                                was_interrupted = True

                            # Send streaming event to client
                            await websocket.send_json({
                                "type": "stream",
                                "event": event,
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            })

                            # Track text for completion message
                            if event_type == "text":
                                content = event.get("content", "")
                                if content:
                                    all_text_content.append(content)

                        except json.JSONDecodeError:
                            # Non-JSON output, send as text
                            if not event_str.startswith('{') and not event_str.startswith('['):
                                all_text_content.append(event_str)
                                await websocket.send_json({
                                    "type": "stream",
                                    "event": {"type": "text", "content": event_str},
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                })

                if was_interrupted:
                    response_content = "\n\n".join(all_text_content) if all_text_content else "[Stopped by user]"
                else:
                    response_content = "\n\n".join(all_text_content) if all_text_content else "Task completed."

            except Exception as e:
                print(f"Error calling Modal agent: {e}")
                traceback.print_exc()
                response_content = f"Error: {str(e)}"
                await websocket.send_json({
                    "type": "stream",
                    "event": {"type": "error", "message": str(e)},
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Send completion message to client
            await websocket.send_json({
                "type": "complete",
                "role": "assistant",
                "content": response_content,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    # Run both tasks concurrently
    receive_task = asyncio.create_task(receive_messages())
    process_task = asyncio.create_task(process_messages())

    try:
        # Wait for either task to complete (usually the receive task on disconnect)
        done, pending = await asyncio.wait(
            [receive_task, process_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        # Cancel any pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    except Exception as e:
        print(f"WebSocket error: {e}")
        traceback.print_exc()
        receive_task.cancel()
        process_task.cancel()
        await websocket.close(code=1011, reason=str(e))
