# Claude Agent Modal Box

A template for running the Claude Agent SDK within Modal Sandboxes.

## What is this?

This project demonstrates how to run Claude's Agent SDK inside Modal's isolated sandbox containers. Modal provides serverless infrastructure with strong isolation guarantees, making it suitable for running AI agents that may execute code or interact with files.

## Status

Work in progress.

## Current Challenge

I'm facing significant latency issues—every request takes at least 10 seconds to get a response. The goal is to figure out how to run a persistent process within Modal Sandboxes that can return quick responses from the Claude Agent SDK.

The latency appears to come from sandbox cold starts and/or the overhead of spinning up the agent for each request. I need to explore patterns for keeping a warm, persistent worker inside the sandbox that can handle multiple requests without the startup penalty.

## Setup

### 1. Modal CLI

Install and authenticate with Modal:

```bash
pip install modal
modal setup
```

This opens a browser to link your Modal account.

### 2. Modal Secrets

Create the required secrets in Modal:

**For AWS Bedrock (recommended):**
```bash
# If you have AWS SSO configured:
./refresh-modal-creds.sh

# Or manually create the secret:
modal secret create aws-bedrock \
  AWS_ACCESS_KEY_ID="..." \
  AWS_SECRET_ACCESS_KEY="..." \
  AWS_SESSION_TOKEN="..." \
  AWS_REGION="us-west-2"
```

**For Braintrust tracing (optional):**
```bash
modal secret create braintrust BRAINTRUST_API_KEY="..."
```

### 3. Deploy Modal App

```bash
cd modal_sandbox
modal deploy agent_sandbox.py
```

### 4. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 5. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## API Provider

Currently configured to use **AWS Bedrock**. Run `./refresh-modal-creds.sh` before demos to refresh AWS SSO credentials (they expire pretty quick).

The project also supports direct Anthropic API via a proxy layer—see `modal_sandbox/agent_sandbox.py` to switch providers.
