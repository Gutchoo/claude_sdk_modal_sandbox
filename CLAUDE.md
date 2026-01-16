# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Agent Modal Box - a template for running Claude Agent SDK in Modal Sandboxes with file upload and custom tools.

## Architecture

**Three-tier system:**
- **Frontend** (`frontend/`): React + Vite + shadcn/ui + Tailwind CSS v4
- **Backend** (`backend/`): FastAPI + SQLite
- **Modal Cloud** (`modal_sandbox/`): Claude Agent SDK running in isolated sandbox containers

## Data Flow

1. **File Upload**: Frontend → Backend (SQLite metadata) → Modal `save_file()` → Volume storage
2. **Chat**: Frontend WebSocket → Backend → Modal `run_agent_in_sandbox()` → Claude Agent SDK → Response

## Storage

| Data | Location |
|------|----------|
| Sessions, file metadata, chat messages (for UI) | SQLite: `backend/data/agent.db` |
| Uploaded files | Modal Volume: `agent-workspace` at `/workspace/{account_id}/{session_id}/` |
| Claude SDK session state (for conversation resume) | Modal Volume: `claude-agent-storage` at `/root/.claude/` |

## Session Management

Two types of session IDs are used:

| ID Type | Example | Purpose |
|---------|---------|---------|
| App Session ID | `c1b5e29f-63e4-...` | Your app's session (SQLite, UI, file storage) |
| Claude Session ID | `75ed8d5b-afe8-...` | Claude SDK's internal conversation ID |

The mapping between them is stored at `/root/.claude/sessions/{app-session-id}.txt` on the `claude-agent-storage` volume.

**Conversation Resume Flow:**
1. First message: No Claude session exists → fresh conversation → saves Claude session ID to volume
2. Subsequent messages (even after sandbox dies): Loads Claude session ID from volume → `resume={id}` → Claude continues with full context

## Key Files

- `backend/app/services/modal_client.py` - Calls Modal functions via `modal.Function.from_name()`
- `modal_sandbox/agent_sandbox.py` - Modal app with embedded `AGENT_SCRIPT` for Claude Agent SDK
- `modal_sandbox/anthropic_proxy.py` - API proxy that isolates Anthropic API key from sandboxes
- `backend/app/routers/chat.py` - WebSocket handler for chat

## Agent Configuration

Located in `AGENT_SCRIPT` within `modal_sandbox/agent_sandbox.py`:
- Model: `claude-sonnet-4-20250514` (Sonnet 4 via AWS Bedrock)
- Tools: `Read`, `Glob`, `Grep` (read-only) + custom MCP tools
- Max turns: 25
- Working directory: `/data` (symlinked to session files on Volume)

## Custom Tools

The template includes these custom MCP tools (defined in `CUSTOM_TOOLS_CODE`):
- `read_excel` - Read Excel files with caching for large files
- `read_csv` - Read CSV files
- `read_json` - Read JSON files
- `list_files` - List files in a directory

## Claude Agent SDK Documentation

Reference documentation for the Claude Agent SDK and Modal integration is located in `anthropic_sdk_docs/`. **Consult these docs when implementing or modifying SDK-related features.**

See available docs: `ls anthropic_sdk_docs/`

## Modal Sandbox Behavior

- Created on first chat message per session
- Reused for subsequent messages
- 20 min idle timeout, 5 hour max lifetime

## API Provider Options

The project supports two API providers (configured in `modal_sandbox/agent_sandbox.py`):

### Option 1: AWS Bedrock (Currently Active)

Uses IAM-based authentication via AWS credentials.

```bash
# Refresh credentials before demos (SSO tokens expire in ~1 hour)
./refresh-modal-creds.sh
```

**Secret:** `aws-bedrock` (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION)

### Option 2: Direct Anthropic API via Proxy (Disabled)

The API proxy isolates the Anthropic API key from sandboxes:

```
Sandbox → API Proxy → Anthropic API
(no key)   (has key)
```

To switch to this mode, edit `agent_sandbox.py` and set `USE_BEDROCK = False`.

**Files:**
- `modal_sandbox/anthropic_proxy.py` - FastAPI proxy app
- **Secret:** `anthropic-api-key`

## Commands

```bash
# Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev

# Deploy Modal (after changes)
cd modal_sandbox && modal deploy agent_sandbox.py

# Deploy proxy (after changes)
cd modal_sandbox && modal deploy anthropic_proxy.py
```
