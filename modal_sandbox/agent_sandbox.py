"""
Claude Agent SDK running in Modal Sandbox

This is a bare-bones template for running Claude Agent SDK in isolated Modal sandboxes.
Based on:
- Anthropic Hosting Docs: https://platform.claude.com/docs/en/agent-sdk/hosting
- Modal Sandbox Demo: https://github.com/modal-projects/claude-slack-gif-creator

Architecture:
1. Modal Sandbox per session - Each user session gets its own isolated sandbox
2. Claude Agent SDK (Python) runs INSIDE the sandbox via agent_entrypoint.py
3. Custom MCP tools for file reading (Excel, CSV, JSON)
4. Persistent Volume for file storage across sessions
5. Sandbox remains alive for follow-up requests (20 minute idle timeout)
"""

import modal
import os
from pathlib import Path

# =============================================================================
# Modal App Configuration
# =============================================================================

app = modal.App("claude-agent-modal-box")

# =============================================================================
# API Provider Configuration
# =============================================================================
# Option 1: AWS Bedrock (currently active)
# - Uses IAM-based auth via aws-bedrock Modal secret
# - Run ./refresh-modal-creds.sh to update credentials before demos
USE_BEDROCK = True
AWS_REGION = "us-west-2"

# Option 2: Direct Anthropic API via Proxy (disabled)
# - Uncomment and set USE_BEDROCK = False to use
# - Requires anthropic-api-key Modal secret
# - Proxy isolates API key from sandbox (prevents prompt injection extraction)
# ANTHROPIC_PROXY_URL = "https://gutchoo--claude-agent-modal-box-proxy-anthropic-proxy.modal.run"

# Persistent volume for file storage (user documents)
vol = modal.Volume.from_name("agent-workspace", create_if_missing=True)
VOL_MOUNT_PATH = Path("/workspace")

# Persistent volume for Claude SDK session state (~/.claude)
# This allows session resumption to work across sandbox restarts
claude_storage_vol = modal.Volume.from_name("claude-agent-storage", create_if_missing=True)
CLAUDE_STORAGE_PATH = Path("/root/.claude")

# =============================================================================
# Agent Entrypoint Script (embedded as string constant)
# =============================================================================

AGENT_SCRIPT = r'''#!/usr/bin/env python3
"""Entrypoint script for Claude Agent SDK with streaming input mode.

This uses the recommended streaming input mode for rich, interactive sessions:
- Full access to all tools and MCP servers
- Image upload support
- Hooks support
- Context persistence across turns
- Real-time streaming of tool calls and results
- Interrupt support via signal file
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Add root directory to path so Python can find custom_tools package
sys.path.insert(0, "/")

# Interrupt signal file path - checked during message iteration
INTERRUPT_SIGNAL_FILE = Path("/tmp/.interrupt_signal")

# AWS Bedrock is enabled via CLAUDE_CODE_USE_BEDROCK env var
# AWS credentials are passed from Modal secrets

# Setup Braintrust tracing BEFORE importing Claude Agent SDK client
from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

setup_claude_agent_sdk(
    project="claude-agent-modal-box",
    api_key=os.environ.get("BRAINTRUST_API_KEY"),
)

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    create_sdk_mcp_server,
)

# Import custom tools
from custom_tools import ALL_TOOLS, get_mcp_tool_names


def emit_event(event_type: str, data: dict):
    """Emit a JSON event to stdout for streaming."""
    event = {"type": event_type, **data}
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def check_interrupt_signal() -> bool:
    """Check if interrupt signal file exists and clear it."""
    if INTERRUPT_SIGNAL_FILE.exists():
        INTERRUPT_SIGNAL_FILE.unlink()  # Clear the signal
        return True
    return False


def clear_interrupt_signal():
    """Clear any existing interrupt signal at startup."""
    if INTERRUPT_SIGNAL_FILE.exists():
        INTERRUPT_SIGNAL_FILE.unlink()


def truncate_content(content, max_length: int = 500) -> str:
    """Truncate content for display, preserving useful info."""
    if content is None:
        return ""
    if isinstance(content, list):
        # Handle list of content blocks
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))
            elif isinstance(item, str):
                text_parts.append(item)
        content = "\n".join(text_parts)
    content = str(content)
    if len(content) > max_length:
        return content[:max_length] + f"... ({len(content)} chars total)"
    return content


SYSTEM_PROMPT = """You are a helpful AI assistant with access to file reading and data analysis tools.
You can read files, search through documents, and help with various tasks.
When working with files, use the available tools to read and analyze content in the /data directory.
Be concise and helpful in your responses."""


def get_session_file(app_session_id: str) -> Path:
    """Get the path to store Claude session ID for this app session."""
    sessions_dir = Path("/root/.claude/sessions")
    sessions_dir.mkdir(parents=True, exist_ok=True)
    return sessions_dir / f"{app_session_id}.txt"


def load_claude_session_id(app_session_id: str) -> str | None:
    """Load Claude SDK session ID from persistent storage."""
    session_file = get_session_file(app_session_id)
    if session_file.exists():
        return session_file.read_text().strip()
    return None


def save_claude_session_id(app_session_id: str, claude_session_id: str) -> None:
    """Save Claude SDK session ID to persistent storage."""
    session_file = get_session_file(app_session_id)
    session_file.write_text(claude_session_id)


async def create_message_generator(user_msg: str):
    """
    Create an async generator for streaming input mode.

    This is the recommended pattern from the SDK docs - it allows:
    - Dynamic message queueing
    - Image attachments
    - Interruption support
    - Natural multi-turn conversations
    """
    yield {
        "type": "user",
        "message": {
            "role": "user",
            "content": user_msg
        }
    }


async def monitor_interrupt_signal(client, interrupt_event: asyncio.Event):
    """Background task to monitor for interrupt signal and call client.interrupt()."""
    while not interrupt_event.is_set():
        if check_interrupt_signal():
            emit_event("interrupted", {"reason": "user_requested"})
            try:
                await client.interrupt()
            except Exception as e:
                emit_event("text", {"content": f"[Interrupt error: {e}]"})
            interrupt_event.set()
            break
        await asyncio.sleep(0.2)  # Check every 200ms


async def main(user_msg: str, app_session_id: str):
    """Run the Claude agent using streaming input mode."""

    # Clear any stale interrupt signal from previous runs
    clear_interrupt_signal()

    claude_session_id = load_claude_session_id(app_session_id)

    # Create MCP server with custom tools
    tools_server = create_sdk_mcp_server(
        name="tools",
        version="1.0.0",
        tools=ALL_TOOLS
    )

    # Get MCP tool names for allowed_tools
    mcp_tools = get_mcp_tool_names("tools")

    options = ClaudeAgentOptions(
        model="us.anthropic.claude-opus-4-5-20251101-v1:0",
        system_prompt=SYSTEM_PROMPT,
        cwd="/data",
        mcp_servers={"tools": tools_server},
        allowed_tools=["Read", "Glob", "Grep"] + mcp_tools,
        permission_mode="acceptEdits",
        max_turns=25,
        resume=claude_session_id,
        include_partial_messages=True,
    )

    # Track tool calls for pairing with results
    pending_tools = {}

    async with ClaudeSDKClient(options=options) as client:
        # Use streaming input mode - pass an async generator
        await client.query(create_message_generator(user_msg))

        # Track if we've been interrupted
        interrupt_event = asyncio.Event()

        # Start background task to monitor for interrupt signal
        monitor_task = asyncio.create_task(monitor_interrupt_signal(client, interrupt_event))

        try:
            async for msg in client.receive_response():
                # Check if we were interrupted by the background monitor
                if interrupt_event.is_set():
                    break

                msg_class = type(msg).__name__
                msg_subtype = getattr(msg, 'subtype', None)

                # Capture session ID from init message
                if msg_subtype == 'init':
                    new_session_id = getattr(msg, 'session_id', None)
                    if new_session_id is None and hasattr(msg, 'data'):
                        data = msg.data
                        if isinstance(data, dict):
                            new_session_id = data.get('session_id')
                    if new_session_id:
                        save_claude_session_id(app_session_id, new_session_id)
                    emit_event("init", {"session_id": new_session_id})
                    continue

                # Handle AssistantMessage - contains text, tool_use, and tool_result blocks
                if msg_class == 'AssistantMessage' and hasattr(msg, 'content'):
                    content_blocks = msg.content

                    if content_blocks and isinstance(content_blocks, list):
                        for block in content_blocks:
                            block_class = type(block).__name__
                            block_type = getattr(block, 'type', None)

                            # TextBlock - Claude's text response
                            if block_class == 'TextBlock' or block_type == 'text':
                                text = getattr(block, 'text', '')
                                if text:
                                    emit_event("text", {"content": text})

                            # ToolUseBlock - Claude is invoking a tool
                            elif block_class == 'ToolUseBlock' or block_type == 'tool_use':
                                tool_id = getattr(block, 'id', '')
                                tool_name = getattr(block, 'name', 'unknown')
                                tool_input = getattr(block, 'input', {})

                                # Store for later pairing with result
                                pending_tools[tool_id] = tool_name

                                emit_event("tool_use", {
                                    "tool_use_id": tool_id,
                                    "tool": tool_name,
                                    "input": tool_input if isinstance(tool_input, dict) else str(tool_input)
                                })

                            # ToolResultBlock - Result from a tool execution
                            elif block_class == 'ToolResultBlock' or block_type == 'tool_result':
                                tool_use_id = getattr(block, 'tool_use_id', '')
                                content = getattr(block, 'content', '')
                                is_error = getattr(block, 'is_error', False)

                                # Get the tool name from our pending map
                                tool_name = pending_tools.pop(tool_use_id, 'unknown')

                                emit_event("tool_result", {
                                    "tool_use_id": tool_use_id,
                                    "tool": tool_name,
                                    "content": truncate_content(content),
                                    "is_error": bool(is_error)
                                })

                # Handle ResultMessage - final result with metadata
                if msg_class == 'ResultMessage':
                    result_data = {
                        "duration_ms": getattr(msg, 'duration_ms', 0),
                        "num_turns": getattr(msg, 'num_turns', 0),
                        "session_id": getattr(msg, 'session_id', ''),
                    }
                    # Include cost if available
                    total_cost = getattr(msg, 'total_cost_usd', None)
                    if total_cost is not None:
                        result_data["total_cost_usd"] = total_cost

                    emit_event("result", result_data)

        finally:
            # Cancel the monitor task
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

        # Signal completion (or interruption)
        if interrupt_event.is_set():
            emit_event("done", {"interrupted": True})
        else:
            emit_event("done", {})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--message", type=str, required=True)
    parser.add_argument("--app-session-id", type=str, required=True)
    args = parser.parse_args()

    asyncio.run(main(args.message, args.app_session_id))
'''

# =============================================================================
# Persistent Worker Script - Keeps imports loaded between requests
# =============================================================================

PERSISTENT_WORKER_SCRIPT = r'''#!/usr/bin/env python3
"""Persistent worker process that keeps Python imports loaded between requests.

Communication protocol (file-based):
- Request: Write JSON to /tmp/worker_request.json
- Response: Worker writes JSON lines to /tmp/worker_output.jsonl
- Ready signal: Worker writes {"type": "worker_ready"} when ready for requests
- Completion: Worker writes {"type": "request_done"} when finished

This eliminates the ~3.7 second import overhead on each request.
"""

import asyncio
import json
import os
import signal
import sys
import time
from pathlib import Path

# Paths for file-based communication
REQUEST_FILE = Path("/tmp/worker_request.json")
OUTPUT_FILE = Path("/tmp/worker_output.jsonl")
READY_FILE = Path("/tmp/worker_ready")
INTERRUPT_SIGNAL_FILE = Path("/tmp/.interrupt_signal")

# Add root directory to path so Python can find custom_tools package
sys.path.insert(0, "/")

# AWS Bedrock is enabled via CLAUDE_CODE_USE_BEDROCK env var
# AWS credentials are passed from Modal secrets

# ============================================================
# Import everything at startup (one-time ~3.7s cost)
# ============================================================
from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

setup_claude_agent_sdk(
    project="claude-agent-modal-box",
    api_key=os.environ.get("BRAINTRUST_API_KEY"),
)

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    create_sdk_mcp_server,
)

# Import custom tools
from custom_tools import ALL_TOOLS, get_mcp_tool_names

# ============================================================
# Helper functions (same as agent_entrypoint.py)
# ============================================================

def emit_event(event_type: str, data: dict):
    """Append a JSON event to output file."""
    event = {"type": event_type, **data}
    with open(OUTPUT_FILE, "a") as f:
        f.write(json.dumps(event) + "\n")
        f.flush()


def check_interrupt_signal() -> bool:
    """Check if interrupt signal file exists and clear it."""
    if INTERRUPT_SIGNAL_FILE.exists():
        INTERRUPT_SIGNAL_FILE.unlink()
        return True
    return False


def clear_interrupt_signal():
    """Clear any existing interrupt signal at startup."""
    if INTERRUPT_SIGNAL_FILE.exists():
        INTERRUPT_SIGNAL_FILE.unlink()


def truncate_content(content, max_length: int = 500) -> str:
    """Truncate content for display, preserving useful info."""
    if content is None:
        return ""
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))
            elif isinstance(item, str):
                text_parts.append(item)
        content = "\n".join(text_parts)
    content = str(content)
    if len(content) > max_length:
        return content[:max_length] + f"... ({len(content)} chars total)"
    return content


SYSTEM_PROMPT = """You are a helpful AI assistant with access to file reading and data analysis tools.
You can read files, search through documents, and help with various tasks.
When working with files, use the available tools to read and analyze content in the /data directory.
Be concise and helpful in your responses."""


def get_session_file(app_session_id: str) -> Path:
    """Get the path to store Claude session ID for this app session."""
    sessions_dir = Path("/root/.claude/sessions")
    sessions_dir.mkdir(parents=True, exist_ok=True)
    return sessions_dir / f"{app_session_id}.txt"


def load_claude_session_id(app_session_id: str) -> str | None:
    """Load Claude SDK session ID from persistent storage."""
    session_file = get_session_file(app_session_id)
    if session_file.exists():
        return session_file.read_text().strip()
    return None


def save_claude_session_id(app_session_id: str, claude_session_id: str) -> None:
    """Save Claude SDK session ID to persistent storage."""
    session_file = get_session_file(app_session_id)
    session_file.write_text(claude_session_id)


async def create_message_generator(user_msg: str):
    """Create an async generator for streaming input mode."""
    yield {
        "type": "user",
        "message": {
            "role": "user",
            "content": user_msg
        }
    }


async def monitor_interrupt_signal(client, interrupt_event: asyncio.Event):
    """Background task to monitor for interrupt signal."""
    while not interrupt_event.is_set():
        if check_interrupt_signal():
            emit_event("interrupted", {"reason": "user_requested"})
            try:
                await client.interrupt()
            except Exception as e:
                emit_event("text", {"content": f"[Interrupt error: {e}]"})
            interrupt_event.set()
            break
        await asyncio.sleep(0.2)


async def process_request(user_msg: str, app_session_id: str):
    """Process a single agent request (reuses loaded imports)."""

    clear_interrupt_signal()
    claude_session_id = load_claude_session_id(app_session_id)

    # Create MCP server with custom tools
    tools_server = create_sdk_mcp_server(
        name="tools",
        version="1.0.0",
        tools=ALL_TOOLS
    )

    mcp_tools = get_mcp_tool_names("tools")

    options = ClaudeAgentOptions(
        model="us.anthropic.claude-opus-4-5-20251101-v1:0",
        system_prompt=SYSTEM_PROMPT,
        cwd="/data",
        mcp_servers={"tools": tools_server},
        allowed_tools=["Read", "Glob", "Grep"] + mcp_tools,
        permission_mode="acceptEdits",
        max_turns=25,
        resume=claude_session_id,
        include_partial_messages=True,
    )

    pending_tools = {}

    async with ClaudeSDKClient(options=options) as client:
        await client.query(create_message_generator(user_msg))

        interrupt_event = asyncio.Event()
        monitor_task = asyncio.create_task(monitor_interrupt_signal(client, interrupt_event))

        try:
            async for msg in client.receive_response():
                if interrupt_event.is_set():
                    break

                msg_class = type(msg).__name__
                msg_subtype = getattr(msg, 'subtype', None)

                if msg_subtype == 'init':
                    new_session_id = getattr(msg, 'session_id', None)
                    if new_session_id is None and hasattr(msg, 'data'):
                        data = msg.data
                        if isinstance(data, dict):
                            new_session_id = data.get('session_id')
                    if new_session_id:
                        save_claude_session_id(app_session_id, new_session_id)
                    emit_event("init", {"session_id": new_session_id})
                    continue

                if msg_class == 'AssistantMessage' and hasattr(msg, 'content'):
                    content_blocks = msg.content

                    if content_blocks and isinstance(content_blocks, list):
                        for block in content_blocks:
                            block_class = type(block).__name__
                            block_type = getattr(block, 'type', None)

                            if block_class == 'TextBlock' or block_type == 'text':
                                text = getattr(block, 'text', '')
                                if text:
                                    emit_event("text", {"content": text})

                            elif block_class == 'ToolUseBlock' or block_type == 'tool_use':
                                tool_id = getattr(block, 'id', '')
                                tool_name = getattr(block, 'name', 'unknown')
                                tool_input = getattr(block, 'input', {})
                                pending_tools[tool_id] = tool_name
                                emit_event("tool_use", {
                                    "tool_use_id": tool_id,
                                    "tool": tool_name,
                                    "input": tool_input if isinstance(tool_input, dict) else str(tool_input)
                                })

                            elif block_class == 'ToolResultBlock' or block_type == 'tool_result':
                                tool_use_id = getattr(block, 'tool_use_id', '')
                                content = getattr(block, 'content', '')
                                is_error = getattr(block, 'is_error', False)
                                tool_name = pending_tools.pop(tool_use_id, 'unknown')
                                emit_event("tool_result", {
                                    "tool_use_id": tool_use_id,
                                    "tool": tool_name,
                                    "content": truncate_content(content),
                                    "is_error": bool(is_error)
                                })

                if msg_class == 'ResultMessage':
                    result_data = {
                        "duration_ms": getattr(msg, 'duration_ms', 0),
                        "num_turns": getattr(msg, 'num_turns', 0),
                        "session_id": getattr(msg, 'session_id', ''),
                    }
                    total_cost = getattr(msg, 'total_cost_usd', None)
                    if total_cost is not None:
                        result_data["total_cost_usd"] = total_cost
                    emit_event("result", result_data)

        finally:
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

        if interrupt_event.is_set():
            emit_event("done", {"interrupted": True})
        else:
            emit_event("done", {})


async def main_loop():
    """Main worker loop - waits for requests and processes them."""

    # Signal that worker is ready
    READY_FILE.touch()
    print(json.dumps({"type": "worker_ready"}), flush=True)

    while True:
        # Wait for request file to appear
        if REQUEST_FILE.exists():
            try:
                # Read and parse request
                request = json.loads(REQUEST_FILE.read_text())
                REQUEST_FILE.unlink()  # Clear request file

                # Clear output file for new response
                if OUTPUT_FILE.exists():
                    OUTPUT_FILE.unlink()
                OUTPUT_FILE.touch()

                # Process the request
                user_message = request.get("user_message", "")
                app_session_id = request.get("app_session_id", "")

                emit_event("worker_processing", {"request_id": request.get("request_id", "")})

                await process_request(user_message, app_session_id)

                # Signal completion
                emit_event("request_done", {})

            except Exception as e:
                emit_event("error", {"message": str(e)})
                emit_event("request_done", {})

        # Small sleep to avoid busy-waiting
        await asyncio.sleep(0.05)


def handle_sigterm(signum, frame):
    """Handle graceful shutdown."""
    print(json.dumps({"type": "worker_shutdown"}), flush=True)
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_sigterm)
    asyncio.run(main_loop())
'''

# =============================================================================
# Tool Code - Embedded as string literals (Modal-safe)
# =============================================================================

TOOLS_INIT_CODE = r'''
"""Custom tools for Claude Agent SDK."""

from .file_tools import read_excel, read_csv, read_json, list_files

__all__ = [
    "read_excel",
    "read_csv",
    "read_json",
    "list_files",
]
'''

FILE_TOOLS_CODE = r'''
"""File reading tools."""

import json
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd

# Global cache for Excel data - allows efficient queries on large files
_excel_cache: Dict[str, pd.DataFrame] = {}


def read_excel(
    file_path: str,
    sheet_name: Optional[str] = None,
    skiprows: Optional[int] = None
) -> Dict[str, Any]:
    """
    Read Excel file and return data as dict.

    For large files (>5000 rows), only metadata is returned.
    Use filter_rows or lookup_value to work with the data efficiently.

    Args:
        file_path: Path to the Excel file
        sheet_name: Optional sheet name to read
        skiprows: Optional number of rows to skip at the start

    Returns:
        {
            "data": list of row dicts (limited to 5000 rows),
            "shape": [rows, cols],
            "columns": list of column names,
            "cache_key": key for subsequent lookups,
            "truncated": bool (true if data was truncated)
        }
    """
    try:
        df = pd.read_excel(file_path, sheet_name=sheet_name, skiprows=skiprows)

        # Store full dataframe in cache for later use
        global _excel_cache
        cache_key = f"{file_path}:{sheet_name}:{skiprows}"
        _excel_cache[cache_key] = df

        result = {
            "shape": list(df.shape),
            "columns": df.columns.tolist(),
            "cache_key": cache_key
        }

        # Only return data if file is small enough
        if len(df) > 5000:
            result["data"] = []
            result["truncated"] = True
            result["message"] = (
                f"File has {len(df)} rows. Data not returned to save tokens. "
                "Use lookup_value or filter_rows to query this dataset."
            )
        else:
            result["data"] = df.to_dict('records')
            result["truncated"] = False

        return result
    except Exception as e:
        return {"error": f"Failed to read Excel file: {str(e)}"}


def read_csv(file_path: str) -> Dict[str, Any]:
    """
    Read CSV file and return data as dict.

    Args:
        file_path: Path to the CSV file

    Returns:
        {
            "data": list of row dicts,
            "shape": [rows, cols],
            "columns": list of column names
        }
    """
    try:
        df = pd.read_csv(file_path)
        return {
            "data": df.to_dict('records'),
            "shape": list(df.shape),
            "columns": df.columns.tolist()
        }
    except Exception as e:
        return {"error": f"Failed to read CSV file: {str(e)}"}


def read_json(file_path: str) -> Dict[str, Any]:
    """
    Read JSON file and return contents.

    Args:
        file_path: Path to the JSON file

    Returns:
        The parsed JSON content (dict or list)
    """
    try:
        with open(file_path) as f:
            return json.load(f)
    except Exception as e:
        return {"error": f"Failed to read JSON file: {str(e)}"}


def list_files(directory: str = "/data", pattern: str = "*") -> Dict[str, Any]:
    """
    List files in a directory with optional pattern matching.

    Args:
        directory: Directory to list
        pattern: Glob pattern to match (default: *)

    Returns:
        {
            "directory": str,
            "files": list of {name, size, is_dir},
            "count": int
        }
    """
    try:
        dir_path = Path(directory)
        if not dir_path.exists():
            return {"error": f"Directory not found: {directory}"}

        files = []
        for f in dir_path.glob(pattern):
            files.append({
                "name": f.name,
                "size": f.stat().st_size if f.is_file() else None,
                "is_dir": f.is_dir(),
                "path": str(f)
            })

        return {
            "directory": str(dir_path),
            "files": sorted(files, key=lambda x: x["name"]),
            "count": len(files)
        }
    except Exception as e:
        return {"error": f"Failed to list files: {str(e)}"}
'''

CUSTOM_TOOLS_CODE = r'''
"""
Custom tools for Claude Agent SDK.
MCP tools using @tool decorator.

These tools are registered with the Claude Agent SDK MCP server
and made available to the agent.
"""

import json
from typing import Any, Dict

from claude_agent_sdk import tool

# Import tool implementations
from tools.file_tools import read_excel, read_csv, read_json, list_files


# =============================================================================
# File Reading Tools
# =============================================================================

@tool(
    "read_excel",
    "Read an Excel file. For large files (>5000 rows), returns metadata and cache_key for efficient queries.",
    {
        "file_path": str,
        "sheet_name": str,  # Optional
        "skiprows": int,    # Optional
    }
)
async def tool_read_excel(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read Excel file tool."""
    result = read_excel(
        args["file_path"],
        args.get("sheet_name"),
        args.get("skiprows")
    )
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]}


@tool(
    "read_csv",
    "Read a CSV file and return its contents as structured data.",
    {"file_path": str}
)
async def tool_read_csv(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read CSV file tool."""
    result = read_csv(args["file_path"])
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]}


@tool(
    "read_json",
    "Read a JSON file and return its contents.",
    {"file_path": str}
)
async def tool_read_json(args: Dict[str, Any]) -> Dict[str, Any]:
    """Read JSON file tool."""
    result = read_json(args["file_path"])
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]}


@tool(
    "list_files",
    "List files in a directory with optional pattern matching.",
    {
        "directory": str,
        "pattern": str,  # Optional, default "*"
    }
)
async def tool_list_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """List files in directory."""
    result = list_files(
        args.get("directory", "/data"),
        args.get("pattern", "*")
    )
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]}


# =============================================================================
# Tool Registration
# =============================================================================

def get_mcp_tool_names(server_name: str = "tools") -> list[str]:
    """Get the full MCP tool names for allowed_tools configuration."""
    return [
        f"mcp__{server_name}__read_excel",
        f"mcp__{server_name}__read_csv",
        f"mcp__{server_name}__read_json",
        f"mcp__{server_name}__list_files",
    ]


# Export all tools for MCP server creation
ALL_TOOLS = [
    tool_read_excel,
    tool_read_csv,
    tool_read_json,
    tool_list_files,
]
'''


# =============================================================================
# Sandbox Image - Pre-built with Claude Agent SDK and dependencies
# =============================================================================

sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates", "bash", "git")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .run_commands("npm install -g @anthropic-ai/claude-code")
    .pip_install(
        "claude-agent-sdk",
        "braintrust",
        # Dependencies for custom tools
        "pandas",
        "openpyxl",  # For Excel file reading
    )
)

# Image for the wrapper function (minimal - braintrust tracing happens inside sandbox)
wrapper_image = modal.Image.debian_slim(python_version="3.12")


# =============================================================================
# Streaming Agent Function - Yields events as they happen
# =============================================================================

@app.function(
    image=wrapper_image,
    secrets=[
        modal.Secret.from_name("braintrust"),
        modal.Secret.from_name("aws-bedrock"),
    ],
    volumes={VOL_MOUNT_PATH: vol, CLAUDE_STORAGE_PATH: claude_storage_vol},
    timeout=300,
)
def run_agent_streaming(
    account_id: str,
    session_id: str,
    user_message: str,
):
    """
    Run the Claude Agent SDK inside a Modal Sandbox with streaming output.
    Yields JSON events as they happen for real-time UI updates.

    Event types:
    - {"type": "init", "session_id": "..."} - Session initialized
    - {"type": "text", "content": "..."} - Text from Claude
    - {"type": "tool_use", "tool": "...", "input": {...}} - Tool being called
    - {"type": "tool_result", "tool_use_id": "...", "status": "completed"} - Tool finished
    - {"type": "done"} - Agent finished
    - {"type": "error", "message": "..."} - Error occurred
    """
    import json as json_module

    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]
    data_dir = f"/workspace/{account_id}/{session_id}"

    import time
    timings = {}
    total_start = time.time()

    def emit_timing(phase: str, duration_ms: float):
        """Emit a timing event for real-time visibility."""
        return json_module.dumps({
            "type": "timing",
            "phase": phase,
            "duration_ms": round(duration_ms, 1),
            "elapsed_ms": round((time.time() - total_start) * 1000, 1)
        })

    # Try to get existing sandbox
    t0 = time.time()
    sb = None
    is_new_sandbox = False
    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
    except modal.exception.NotFoundError:
        pass
    timings["sandbox_lookup"] = (time.time() - t0) * 1000
    yield emit_timing("sandbox_lookup", timings["sandbox_lookup"])

    # Create new sandbox if needed
    if sb is None:
        t0 = time.time()
        is_new_sandbox = True
        try:
            sb = modal.Sandbox.create(
                app=app,
                image=sandbox_image,
                volumes={
                    VOL_MOUNT_PATH: vol,
                    CLAUDE_STORAGE_PATH: claude_storage_vol,
                },
                workdir="/workspace",
                env={
                    "BRAINTRUST_API_KEY": os.environ.get("BRAINTRUST_API_KEY", ""),
                    # AWS Bedrock configuration
                    "CLAUDE_CODE_USE_BEDROCK": "1",
                    "AWS_REGION": AWS_REGION,
                    "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                    "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                    "AWS_SESSION_TOKEN": os.environ.get("AWS_SESSION_TOKEN", ""),
                },
                timeout=5 * 60 * 60,
                idle_timeout=20 * 60,
                name=sandbox_name,
            )
        except modal.exception.AlreadyExistsError:
            # Race condition: warm_sandbox created it between our lookup and create
            # Just fetch the existing sandbox
            sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
            is_new_sandbox = False
        timings["sandbox_create"] = (time.time() - t0) * 1000
        yield emit_timing("sandbox_create", timings["sandbox_create"])

    # Yield sandbox creation status
    yield json_module.dumps({"type": "sandbox_status", "is_new": is_new_sandbox})

    # Create data directory and symlink (only on new sandbox)
    if is_new_sandbox:
        t0 = time.time()
        sb.exec("bash", "-c", f"mkdir -p {data_dir} && rm -rf /data && ln -s {data_dir} /data")
        timings["mkdir_symlink"] = (time.time() - t0) * 1000
        yield emit_timing("mkdir_symlink", timings["mkdir_symlink"])
    else:
        yield json_module.dumps({"type": "timing", "phase": "skip_mkdir_symlink", "duration_ms": 0, "elapsed_ms": round((time.time() - total_start) * 1000, 1), "reason": "warm_sandbox"})

    # Write tool files only on new sandbox
    # Warm sandboxes already have tools from either:
    # 1. warm_sandbox() pre-warming, or
    # 2. A previous run_agent_streaming() call
    if is_new_sandbox:
        # Create tools directory and write files (only on cold start)
        t0 = time.time()
        sb.exec("bash", "-c", "mkdir -p /tools")
        timings["mkdir_tools"] = (time.time() - t0) * 1000
        yield emit_timing("mkdir_tools", timings["mkdir_tools"])

        t0 = time.time()
        tool_files = {
            "/tools/__init__.py": TOOLS_INIT_CODE,
            "/tools/file_tools.py": FILE_TOOLS_CODE,
            "/custom_tools.py": CUSTOM_TOOLS_CODE,
        }

        for file_path, content in tool_files.items():
            if content:
                with sb.open(file_path, "w") as f:
                    f.write(content)
        timings["write_tool_files"] = (time.time() - t0) * 1000
        yield emit_timing("write_tool_files", timings["write_tool_files"])

        # Write the agent script (fallback)
        t0 = time.time()
        with sb.open("/agent_entrypoint.py", "w") as f:
            f.write(AGENT_SCRIPT)
        timings["write_agent_script"] = (time.time() - t0) * 1000
        yield emit_timing("write_agent_script", timings["write_agent_script"])

        # Write and start persistent worker
        t0 = time.time()
        with sb.open("/persistent_worker.py", "w") as f:
            f.write(PERSISTENT_WORKER_SCRIPT)
        # Start worker in background using nohup
        sb.exec("bash", "-c", "nohup python /persistent_worker.py > /tmp/worker.log 2>&1 &")
        timings["start_worker"] = (time.time() - t0) * 1000
        yield emit_timing("start_worker", timings["start_worker"])

        # Wait for worker to be ready (imports take ~3-5 seconds)
        t0 = time.time()
        worker_available = False
        wait_timeout = 60  # seconds
        while (time.time() - t0) < wait_timeout:
            check = sb.exec("test", "-f", "/tmp/worker_ready")
            if check.wait() == 0:
                worker_available = True
                break
            time.sleep(0.3)
        timings["worker_wait"] = (time.time() - t0) * 1000
        yield emit_timing("worker_wait", timings["worker_wait"])

    else:
        # Warm sandbox - tools already exist, skip everything
        yield json_module.dumps({"type": "timing", "phase": "skip_tool_files", "duration_ms": 0, "elapsed_ms": round((time.time() - total_start) * 1000, 1), "reason": "warm_sandbox"})

        # Check if persistent worker is available (should be ready from warm_sandbox)
        t0 = time.time()
        worker_check = sb.exec("test", "-f", "/tmp/worker_ready")
        worker_available = worker_check.wait() == 0
        timings["worker_check"] = (time.time() - t0) * 1000
        yield emit_timing("worker_check", timings["worker_check"])

    if worker_available:
        # Use persistent worker (fast path - imports already loaded)
        yield json_module.dumps({"type": "timing", "phase": "using_persistent_worker", "duration_ms": 0, "elapsed_ms": round((time.time() - total_start) * 1000, 1)})

        import uuid
        request_id = str(uuid.uuid4())

        # Clear any stale output file and write request
        t0 = time.time()
        request = json_module.dumps({
            "request_id": request_id,
            "app_session_id": session_id,
            "user_message": user_message
        })
        sb.exec("bash", "-c", "rm -f /tmp/worker_output.jsonl && touch /tmp/worker_output.jsonl")
        with sb.open("/tmp/worker_request.json", "w") as f:
            f.write(request)
        timings["worker_request_write"] = (time.time() - t0) * 1000
        yield emit_timing("worker_request_write", timings["worker_request_write"])

        # Poll output file for responses
        t0 = time.time()
        first_output = True
        lines_read = 0
        request_done = False
        timeout_seconds = 120  # 2 minute timeout

        while not request_done and (time.time() - t0) < timeout_seconds:
            # Read all new lines from output file
            result = sb.exec("bash", "-c", f"tail -n +{lines_read + 1} /tmp/worker_output.jsonl 2>/dev/null || true")
            new_lines = result.stdout.read().strip()

            if new_lines:
                for line in new_lines.split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    lines_read += 1

                    if first_output:
                        timings["time_to_first_output"] = (time.time() - t0) * 1000
                        yield emit_timing("worker_first_output", timings["time_to_first_output"])
                        first_output = False

                    # Check if this is the completion signal
                    try:
                        event = json_module.loads(line)
                        if event.get("type") == "request_done":
                            request_done = True
                            continue
                        if event.get("type") == "worker_processing":
                            continue  # Internal event, don't forward
                    except:
                        pass

                    yield line
            else:
                # No new output, wait a bit
                time.sleep(0.05)

        timings["stream_output"] = (time.time() - t0) * 1000
        yield emit_timing("stream_output", timings["stream_output"])

        if not request_done:
            yield json_module.dumps({"type": "error", "message": "Worker request timed out"})

    else:
        # Fallback disabled - worker must be available
        # If we get here, something is wrong with the worker
        yield json_module.dumps({
            "type": "error",
            "message": "Persistent worker not available. Please wait for sandbox to fully initialize or try again."
        })

    # Commit volume changes
    t0 = time.time()
    vol.commit()
    claude_storage_vol.commit()
    timings["volume_commit"] = (time.time() - t0) * 1000
    yield emit_timing("volume_commit", timings["volume_commit"])

    timings["total"] = (time.time() - total_start) * 1000

    # Yield final timing summary
    yield json_module.dumps({"type": "timings", "data": timings})


# =============================================================================
# Sandbox Warm-up Function - Pre-initialize sandbox without running agent
# =============================================================================

@app.function(
    image=wrapper_image,
    secrets=[
        modal.Secret.from_name("braintrust"),
        modal.Secret.from_name("aws-bedrock"),
    ],
    volumes={VOL_MOUNT_PATH: vol, CLAUDE_STORAGE_PATH: claude_storage_vol},
    timeout=120,
)
def warm_sandbox(account_id: str, session_id: str) -> dict:
    """
    Pre-initialize a sandbox for a session without running an agent query.
    This reduces cold start latency when the user sends their first message.

    The sandbox will:
    1. Create the container if it doesn't exist
    2. Set up the data directory symlink
    3. Write all tool files
    4. Pre-import Python dependencies (optional warm-up)

    Returns:
        {
            "success": bool,
            "sandbox_name": str,
            "status": "created" | "exists" | "error",
            "message": str
        }
    """
    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]
    data_dir = f"/workspace/{account_id}/{session_id}"

    # Check if sandbox already exists and is running
    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
        exit_code = sb.poll()
        if exit_code is None:
            # Sandbox already running, just ensure data dir is set up
            sb.exec("bash", "-c", f"mkdir -p {data_dir} && rm -rf /data && ln -s {data_dir} /data")
            return {
                "success": True,
                "sandbox_name": sandbox_name,
                "status": "exists",
                "message": "Sandbox already running"
            }
        # Sandbox terminated, need to create new one
    except modal.exception.NotFoundError:
        pass

    # Create new sandbox
    try:
        sb = modal.Sandbox.create(
            app=app,
            image=sandbox_image,
            volumes={
                VOL_MOUNT_PATH: vol,
                CLAUDE_STORAGE_PATH: claude_storage_vol,
            },
            workdir="/workspace",
            env={
                "BRAINTRUST_API_KEY": os.environ.get("BRAINTRUST_API_KEY", ""),
                # AWS Bedrock configuration
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "AWS_REGION": AWS_REGION,
                "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                "AWS_SESSION_TOKEN": os.environ.get("AWS_SESSION_TOKEN", ""),
            },
            timeout=5 * 60 * 60,  # 5 hour max lifetime
            idle_timeout=20 * 60,  # 20 minute idle timeout
            name=sandbox_name,
        )

        # Create data directory and symlink
        sb.exec("bash", "-c", f"mkdir -p {data_dir} && rm -rf /data && ln -s {data_dir} /data")

        # Create tools directory
        sb.exec("bash", "-c", "mkdir -p /tools")

        # Write tool files to the sandbox
        tool_files = {
            "/tools/__init__.py": TOOLS_INIT_CODE,
            "/tools/file_tools.py": FILE_TOOLS_CODE,
            "/custom_tools.py": CUSTOM_TOOLS_CODE,
        }

        for file_path, content in tool_files.items():
            if content:
                with sb.open(file_path, "w") as f:
                    f.write(content)

        # Write the agent script (fallback for non-worker mode)
        with sb.open("/agent_entrypoint.py", "w") as f:
            f.write(AGENT_SCRIPT)

        # Write the persistent worker script
        with sb.open("/persistent_worker.py", "w") as f:
            f.write(PERSISTENT_WORKER_SCRIPT)

        # Start persistent worker in background
        # This pre-imports all dependencies (~3.7s one-time cost)
        # Worker will signal ready by creating /tmp/worker_ready file
        import time
        sb.exec("bash", "-c", "nohup python /persistent_worker.py > /tmp/worker.log 2>&1 &")

        # Wait for worker to be ready (with timeout)
        worker_ready = False
        start_time = time.time()
        timeout_seconds = 30  # Wait up to 30 seconds for imports

        while time.time() - start_time < timeout_seconds:
            check = sb.exec("test", "-f", "/tmp/worker_ready")
            if check.wait() == 0:
                worker_ready = True
                break
            time.sleep(0.5)

        return {
            "success": True,
            "sandbox_name": sandbox_name,
            "status": "created",
            "message": "Sandbox created with persistent worker" if worker_ready else "Sandbox created (worker starting)",
            "worker_ready": worker_ready
        }

    except Exception as e:
        return {
            "success": False,
            "sandbox_name": sandbox_name,
            "status": "error",
            "message": str(e)
        }


# =============================================================================
# Sandbox Status Function
# =============================================================================

@app.function(timeout=10)
def get_sandbox_status(account_id: str, session_id: str) -> dict:
    """Check if sandbox exists and is running."""
    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]

    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
        exit_code = sb.poll()
        if exit_code is None:
            return {"status": "running", "sandbox_name": sandbox_name}
        else:
            return {"status": "terminated", "sandbox_name": sandbox_name, "exit_code": exit_code}
    except modal.exception.NotFoundError:
        return {"status": "not_found", "sandbox_name": sandbox_name}


# =============================================================================
# File Management Functions
# =============================================================================

@app.function(timeout=30)
def invalidate_sandbox(account_id: str, session_id: str) -> dict:
    """
    Terminate an existing sandbox so it gets recreated with fresh volume data.

    This should be called after files are uploaded to ensure the sandbox
    sees the latest files. Modal volumes are snapshotted when a sandbox is
    created, so existing sandboxes don't see new files without recreation.

    Returns:
        {"invalidated": bool, "sandbox_name": str, "message": str}
    """
    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]

    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
        exit_code = sb.poll()
        if exit_code is None:
            # Sandbox is running, terminate it
            sb.terminate()
            return {
                "invalidated": True,
                "sandbox_name": sandbox_name,
                "message": "Sandbox terminated - will be recreated on next chat message"
            }
        else:
            return {
                "invalidated": False,
                "sandbox_name": sandbox_name,
                "message": "Sandbox already terminated"
            }
    except modal.exception.NotFoundError:
        return {
            "invalidated": False,
            "sandbox_name": sandbox_name,
            "message": "No sandbox found"
        }


@app.function(timeout=10)
def interrupt_agent(account_id: str, session_id: str) -> dict:
    """
    Send an interrupt signal to a running agent.

    This writes a signal file to the sandbox that the agent script checks
    during message iteration. When detected, the agent calls client.interrupt()
    to stop the current query.

    Returns:
        {"interrupted": bool, "sandbox_name": str, "message": str}
    """
    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]

    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
        exit_code = sb.poll()
        if exit_code is None:
            # Sandbox is running, write the interrupt signal file
            with sb.open("/tmp/.interrupt_signal", "w") as f:
                f.write("interrupt")
            return {
                "interrupted": True,
                "sandbox_name": sandbox_name,
                "message": "Interrupt signal sent to agent"
            }
        else:
            return {
                "interrupted": False,
                "sandbox_name": sandbox_name,
                "message": "Sandbox not running"
            }
    except modal.exception.NotFoundError:
        return {
            "interrupted": False,
            "sandbox_name": sandbox_name,
            "message": "No sandbox found"
        }


@app.function(volumes={VOL_MOUNT_PATH: vol}, timeout=60)
def save_file(account_id: str, session_id: str, filename: str, content: bytes) -> dict:
    """Save a file to the session directory."""
    session_dir = VOL_MOUNT_PATH / account_id / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    file_path = session_dir / filename
    file_path.write_bytes(content)
    vol.commit()
    return {"filename": filename, "size": len(content), "path": str(file_path)}


@app.function(volumes={VOL_MOUNT_PATH: vol}, timeout=60)
def list_session_files(account_id: str, session_id: str) -> list[dict]:
    """List files in a session directory."""
    session_dir = VOL_MOUNT_PATH / account_id / session_id
    if not session_dir.exists():
        return []
    return [{"name": f.name, "size": f.stat().st_size} for f in session_dir.iterdir() if f.is_file()]


@app.function(volumes={VOL_MOUNT_PATH: vol}, timeout=60)
def delete_file(account_id: str, session_id: str, filename: str) -> dict:
    """Delete a file from the session directory."""
    file_path = VOL_MOUNT_PATH / account_id / session_id / filename
    if file_path.exists():
        file_path.unlink()
        vol.commit()
        return {"deleted": True, "filename": filename}
    return {"deleted": False, "error": "File not found"}


@app.function(volumes={VOL_MOUNT_PATH: vol}, timeout=60)
def get_file_content(account_id: str, session_id: str, filename: str) -> dict:
    """Get file content from the session directory."""
    file_path = VOL_MOUNT_PATH / account_id / session_id / filename
    if not file_path.exists():
        return {"error": "File not found", "content": None}

    content = file_path.read_bytes()
    return {"filename": filename, "content": content, "size": len(content)}


@app.function(volumes={CLAUDE_STORAGE_PATH: claude_storage_vol}, timeout=60)
def debug_claude_storage() -> dict:
    """Debug function to explore the Claude SDK storage structure."""
    import os

    result = {
        "base_path": str(CLAUDE_STORAGE_PATH),
        "exists": CLAUDE_STORAGE_PATH.exists(),
        "contents": []
    }

    if CLAUDE_STORAGE_PATH.exists():
        for root, dirs, files in os.walk(CLAUDE_STORAGE_PATH):
            rel_root = os.path.relpath(root, CLAUDE_STORAGE_PATH)
            for f in files:
                file_path = Path(root) / f
                try:
                    size = file_path.stat().st_size
                    result["contents"].append({
                        "path": os.path.join(rel_root, f),
                        "size": size
                    })
                except Exception:
                    pass

    return result


@app.function(volumes={CLAUDE_STORAGE_PATH: claude_storage_vol}, timeout=60)
def get_session_messages(app_session_id: str) -> dict:
    """
    Get the conversation messages for a session from Claude SDK storage.

    The Claude SDK stores conversation data in JSONL files.
    Each line is a JSON object representing a message or event.

    Returns:
        {
            "messages": [
                {"id": str, "role": "user"|"assistant", "content": str, "timestamp": str, "contentBlocks": [...]}
            ]
        }
    """
    import json
    import os
    from datetime import datetime

    # First, get the Claude session ID from our mapping
    session_file = CLAUDE_STORAGE_PATH / "sessions" / f"{app_session_id}.txt"

    if not session_file.exists():
        return {"messages": [], "error": "No session found"}

    claude_session_id = session_file.read_text().strip()

    # Find the JSONL file for this session
    # Claude SDK stores them in: ~/.claude/projects/{project_hash}/{session_id}.jsonl
    jsonl_file = None
    for root, dirs, files in os.walk(CLAUDE_STORAGE_PATH / "projects"):
        for f in files:
            if f == f"{claude_session_id}.jsonl":
                jsonl_file = Path(root) / f
                break
        if jsonl_file:
            break

    if not jsonl_file or not jsonl_file.exists():
        return {"messages": [], "error": "Session JSONL not found"}

    # Parse the JSONL file to extract messages
    messages = []
    message_counter = 0

    try:
        with open(jsonl_file, 'r') as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue

                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = entry.get("type")

                # Handle user messages
                if entry_type == "user":
                    message_counter += 1
                    message_data = entry.get("message", {})
                    content = message_data.get("content", "")

                    # Content can be string or list of content blocks
                    if isinstance(content, list):
                        text_parts = []
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                        content = "\n".join(text_parts)

                    messages.append({
                        "id": f"user-{message_counter}",
                        "role": "user",
                        "content": content,
                        "timestamp": entry.get("timestamp", datetime.now().isoformat()),
                    })

                # Handle assistant messages
                elif entry_type == "assistant":
                    message_counter += 1
                    message_data = entry.get("message", {})
                    content_blocks = message_data.get("content", [])

                    # Build text content and structured content blocks
                    text_parts = []
                    structured_blocks = []

                    for block in content_blocks:
                        if not isinstance(block, dict):
                            continue

                        block_type = block.get("type")

                        if block_type == "text":
                            text = block.get("text", "")
                            text_parts.append(text)
                            structured_blocks.append({
                                "type": "text",
                                "text": text
                            })

                        elif block_type == "tool_use":
                            tool_call = {
                                "id": block.get("id", ""),
                                "tool": block.get("name", "unknown"),
                                "input": block.get("input", {}),
                                "status": "completed",  # Historical messages are complete
                            }
                            structured_blocks.append({
                                "type": "tool_call",
                                "toolCall": tool_call
                            })

                        elif block_type == "tool_result":
                            # Find and update the matching tool call
                            tool_use_id = block.get("tool_use_id", "")
                            result_content = block.get("content", "")

                            # Extract text from result content
                            if isinstance(result_content, list):
                                result_text_parts = []
                                for item in result_content:
                                    if isinstance(item, dict) and item.get("type") == "text":
                                        result_text_parts.append(item.get("text", ""))
                                result_content = "\n".join(result_text_parts)

                            # Update the corresponding tool call in structured_blocks
                            for sb in structured_blocks:
                                if sb.get("type") == "tool_call" and sb.get("toolCall", {}).get("id") == tool_use_id:
                                    sb["toolCall"]["result"] = result_content[:500] if len(str(result_content)) > 500 else result_content
                                    sb["toolCall"]["status"] = "completed"

                    messages.append({
                        "id": f"assistant-{message_counter}",
                        "role": "assistant",
                        "content": "\n\n".join(text_parts),
                        "timestamp": entry.get("timestamp", datetime.now().isoformat()),
                        "contentBlocks": structured_blocks if structured_blocks else None,
                    })

    except Exception as e:
        return {"messages": [], "error": f"Failed to parse JSONL: {str(e)}"}

    return {"messages": messages}


@app.function(volumes={VOL_MOUNT_PATH: vol, CLAUDE_STORAGE_PATH: claude_storage_vol}, timeout=60)
def cleanup_session(account_id: str, session_id: str) -> dict:
    """
    Clean up all data for a session.

    This removes:
    1. User files from the workspace volume
    2. Claude session state from the storage volume
    3. Terminates any running sandbox

    Returns:
        {
            "success": bool,
            "files_deleted": int,
            "session_state_deleted": bool,
            "sandbox_terminated": bool
        }
    """
    result = {
        "success": True,
        "files_deleted": 0,
        "session_state_deleted": False,
        "sandbox_terminated": False
    }

    # 1. Delete user files
    session_dir = VOL_MOUNT_PATH / account_id / session_id
    if session_dir.exists():
        import shutil
        file_count = sum(1 for _ in session_dir.iterdir() if _.is_file())
        shutil.rmtree(session_dir)
        result["files_deleted"] = file_count
        vol.commit()

    # 2. Delete Claude session state
    session_file = CLAUDE_STORAGE_PATH / "sessions" / f"{session_id}.txt"
    if session_file.exists():
        session_file.unlink()
        result["session_state_deleted"] = True
        claude_storage_vol.commit()

    # 3. Try to terminate sandbox
    sandbox_name = f"agent-{account_id}-{session_id}".replace(".", "-")[:63]
    try:
        sb = modal.Sandbox.from_name(app_name=app.name, name=sandbox_name)
        if sb.poll() is None:
            sb.terminate()
            result["sandbox_terminated"] = True
    except modal.exception.NotFoundError:
        pass

    return result
