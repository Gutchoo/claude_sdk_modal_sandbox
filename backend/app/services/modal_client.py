"""Modal client for interacting with the agent sandbox using Claude Agent SDK."""

import asyncio
import queue
import threading

import modal

# Default account ID for demo
DEFAULT_ACCOUNT_ID = "demo-account-001"


def get_agent_functions():
    """Get references to the deployed Modal functions."""
    # Using the sandbox-based approach with Claude Agent SDK (following Modal/Claude guidelines)
    run_agent_streaming = modal.Function.from_name("claude-agent-modal-box", "run_agent_streaming")
    save_file = modal.Function.from_name("claude-agent-modal-box", "save_file")
    delete_file = modal.Function.from_name("claude-agent-modal-box", "delete_file")
    get_file_content = modal.Function.from_name("claude-agent-modal-box", "get_file_content")
    list_session_files = modal.Function.from_name("claude-agent-modal-box", "list_session_files")
    cleanup_session = modal.Function.from_name("claude-agent-modal-box", "cleanup_session")
    get_sandbox_status = modal.Function.from_name("claude-agent-modal-box", "get_sandbox_status")
    warm_sandbox = modal.Function.from_name("claude-agent-modal-box", "warm_sandbox")
    invalidate_sandbox = modal.Function.from_name("claude-agent-modal-box", "invalidate_sandbox")
    interrupt_agent = modal.Function.from_name("claude-agent-modal-box", "interrupt_agent")
    get_session_messages = modal.Function.from_name("claude-agent-modal-box", "get_session_messages")

    return {
        "run_agent_streaming": run_agent_streaming,
        "save_file": save_file,
        "delete_file": delete_file,
        "get_file_content": get_file_content,
        "list_session_files": list_session_files,
        "cleanup_session": cleanup_session,
        "get_sandbox_status": get_sandbox_status,
        "warm_sandbox": warm_sandbox,
        "invalidate_sandbox": invalidate_sandbox,
        "interrupt_agent": interrupt_agent,
        "get_session_messages": get_session_messages,
    }


async def call_agent_streaming(
    session_id: str,
    user_message: str,
    account_id: str = DEFAULT_ACCOUNT_ID
):
    """
    Call the agent in Modal sandbox with streaming output.

    Yields JSON event strings as they arrive from the agent.

    Event types:
    - {"type": "sandbox_status", "is_new": bool}
    - {"type": "init", "session_id": "..."}
    - {"type": "text", "content": "..."}
    - {"type": "tool_use", "tool": "...", "input": {...}}
    - {"type": "tool_result", "tool_use_id": "...", "status": "completed"}
    - {"type": "done"}
    - {"type": "error", "message": "..."}

    Args:
        session_id: The session ID
        user_message: The user's message
        account_id: The account ID (defaults to demo account)

    Yields:
        JSON string events
    """
    functions = get_agent_functions()
    q: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run_generator():
        try:
            for event in functions["run_agent_streaming"].remote_gen(
                account_id=account_id,
                session_id=session_id,
                user_message=user_message,
            ):
                q.put(event)
        except Exception as e:
            q.put(e)
        finally:
            q.put(done_sentinel)

    # Start the generator in a background thread
    thread = threading.Thread(target=run_generator, daemon=True)
    thread.start()

    # Yield items from the queue asynchronously
    loop = asyncio.get_event_loop()
    while True:
        # Use run_in_executor to avoid blocking the event loop
        item = await loop.run_in_executor(None, q.get)
        if item is done_sentinel:
            break
        if isinstance(item, Exception):
            raise item
        yield item


async def save_file_to_modal(
    session_id: str,
    filename: str,
    content: bytes,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """
    Save a file to the Modal volume (no sandbox operations).

    This just saves the file. Call invalidate_and_warm_sandbox() separately
    after all files are uploaded to refresh the sandbox.

    Args:
        session_id: The session ID
        filename: Name of the file
        content: File content as bytes
        account_id: The account ID

    Returns:
        dict with file info
    """
    functions = get_agent_functions()
    result = functions["save_file"].remote(
        account_id=account_id,
        session_id=session_id,
        filename=filename,
        content=content,
    )
    return result


async def invalidate_and_warm_sandbox(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """
    Invalidate existing sandbox and warm up a fresh one.

    Call this after uploading files to ensure the sandbox sees the new files.
    The warmup is triggered in the background (non-blocking).

    Args:
        session_id: The session ID
        account_id: The account ID

    Returns:
        dict with invalidation result
    """
    functions = get_agent_functions()

    invalidate_result = functions["invalidate_sandbox"].remote(
        account_id=account_id,
        session_id=session_id,
    )
    print(f"Sandbox invalidation: {invalidate_result}")

    # Trigger warmup in background (spawn() is non-blocking)
    # This ensures a new sandbox is ready without blocking the caller
    if invalidate_result.get("invalidated"):
        functions["warm_sandbox"].spawn(
            account_id=account_id,
            session_id=session_id,
        )
        print(f"Sandbox re-warmup triggered (background)")

    return invalidate_result


async def delete_file_from_modal(
    session_id: str,
    filename: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """Delete a file from the Modal volume."""
    functions = get_agent_functions()
    result = functions["delete_file"].remote(
        account_id=account_id,
        session_id=session_id,
        filename=filename,
    )
    return result


async def list_modal_files(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> list[dict]:
    """List files in a session on Modal volume."""
    functions = get_agent_functions()
    result = functions["list_session_files"].remote(
        account_id=account_id,
        session_id=session_id,
    )
    return result


async def cleanup_modal_session(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """Clean up all files for a session."""
    functions = get_agent_functions()
    result = functions["cleanup_session"].remote(
        account_id=account_id,
        session_id=session_id,
    )
    return result


async def get_file_content_from_modal(
    session_id: str,
    filename: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """Get file content from the Modal volume."""
    functions = get_agent_functions()
    result = await functions["get_file_content"].remote.aio(
        account_id=account_id,
        session_id=session_id,
        filename=filename,
    )
    return result


async def get_sandbox_status(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """Get the status of a sandbox from Modal."""
    functions = get_agent_functions()
    result = await functions["get_sandbox_status"].remote.aio(
        account_id=account_id,
        session_id=session_id,
    )
    return result


async def warm_sandbox(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """
    Pre-warm the sandbox for a session to reduce cold start latency.

    This creates the sandbox container, sets up the data directory,
    writes tool files, and pre-imports heavy dependencies.

    Args:
        session_id: The session ID
        account_id: The account ID (defaults to demo account)

    Returns:
        dict with success status and sandbox info
    """
    functions = get_agent_functions()
    result = await functions["warm_sandbox"].remote.aio(
        account_id=account_id,
        session_id=session_id,
    )
    return result


async def invalidate_sandbox(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """
    Invalidate (terminate) an existing sandbox so it gets recreated with fresh volume data.

    This should be called after files are uploaded to ensure the sandbox
    sees the latest files. Modal volumes are snapshotted when a sandbox is
    created, so existing sandboxes don't see new files without recreation.

    Args:
        session_id: The session ID
        account_id: The account ID (defaults to demo account)

    Returns:
        dict with invalidation status
    """
    functions = get_agent_functions()
    result = await functions["invalidate_sandbox"].remote.aio(
        account_id=account_id,
        session_id=session_id,
    )
    return result


async def get_session_messages(session_id: str) -> dict:
    """
    Get conversation messages from Claude SDK storage on Modal volume.

    This reads the JSONL conversation file stored by Claude SDK and returns
    messages formatted for UI display, with content blocks in chronological order.

    Args:
        session_id: The app session ID

    Returns:
        dict with "messages" array, each message having:
        - id: unique message ID
        - role: "user" or "assistant"
        - content: plain text content
        - timestamp: ISO timestamp
        - contentBlocks: array of {type: "text"|"tool_call", text?, toolCall?}
    """
    functions = get_agent_functions()
    result = await functions["get_session_messages"].remote.aio(session_id)
    return result


async def interrupt_agent(
    session_id: str,
    account_id: str = DEFAULT_ACCOUNT_ID
) -> dict:
    """
    Send an interrupt signal to a running agent.

    This tells the agent to stop the current query by calling client.interrupt()
    on the Claude SDK client.

    Args:
        session_id: The session ID
        account_id: The account ID (defaults to demo account)

    Returns:
        dict with {"interrupted": bool, "sandbox_name": str, "message": str}
    """
    functions = get_agent_functions()
    result = await functions["interrupt_agent"].remote.aio(
        account_id=account_id,
        session_id=session_id,
    )
    return result
