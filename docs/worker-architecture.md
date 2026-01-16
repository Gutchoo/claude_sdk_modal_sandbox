# Worker Architecture Explained

## The Problem We're Solving

Every time you send a message, we need to run Python code that uses the Claude SDK.

**The slow way (old approach):**
```
User sends message
    → Start new Python process
    → Import claude_agent_sdk (2 seconds)
    → Import pandas (1 second)
    → Import other libraries (1 second)
    → Finally call Claude API
    → Exit Python process

Total: ~4-5 seconds just for imports, EVERY message
```

**The fast way (persistent worker):**
```
Sandbox starts up:
    → Start Python process ONCE
    → Import all libraries ONCE (4 seconds, but only once)
    → Worker sits and waits for requests...

User sends message:
    → Worker already has imports loaded
    → Immediately call Claude API
    → No import delay!
```

---

## How the Worker Communicates

Since the worker is a separate Python process running in the background, we need a way to send it requests and get responses back. We use **files** as the communication channel:

```
┌─────────────────────────────────────────────────────────────────┐
│                     MODAL SANDBOX                                │
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │                  │         │                              │  │
│  │  Modal Function  │         │   Persistent Worker          │  │
│  │  (our code)      │         │   (Python process)           │  │
│  │                  │         │                              │  │
│  └────────┬─────────┘         └──────────────┬───────────────┘  │
│           │                                  │                   │
│           │  1. Write request                │                   │
│           │─────────────────────────────────>│                   │
│           │     /tmp/worker_request.json     │                   │
│           │                                  │                   │
│           │                                  │  2. Worker reads  │
│           │                                  │     request and   │
│           │                                  │     calls Claude  │
│           │                                  │                   │
│           │  3. Read responses               │                   │
│           │<─────────────────────────────────│                   │
│           │     /tmp/worker_output.jsonl     │                   │
│           │                                  │                   │
└───────────┼──────────────────────────────────┼───────────────────┘
            │                                  │
            ▼                                  │
      Back to your                             │
      browser                                  │
                                               │
                                               ▼
                                         Claude API
```

---

## The Files

### `/tmp/worker_ready`
- **What:** An empty file that just signals "I'm ready"
- **Created by:** Worker, after it finishes importing libraries
- **Checked by:** Our code, to know if worker is available

### `/tmp/worker_request.json`
- **What:** The user's message in JSON format
- **Written by:** Our Modal function
- **Read by:** Worker (polls every 100ms looking for this file)
- **Example contents:**
```json
{
  "request_id": "abc-123",
  "app_session_id": "user-session-456",
  "user_message": "Write me a poem"
}
```

### `/tmp/worker_output.jsonl`
- **What:** Worker's responses, one JSON object per line
- **Written by:** Worker (streams events as they happen)
- **Read by:** Our Modal function (polls for new lines)
- **Example contents:**
```json
{"type": "init", "session_id": "claude-789"}
{"type": "text", "content": "Here is"}
{"type": "text", "content": " a poem"}
{"type": "result", "duration_ms": 1500}
{"type": "request_done"}
```

---

## Step by Step: What Happens When You Send a Message

```
YOU: "Write me a poem"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: worker_check                                        │
│                                                             │
│   Our code runs: test -f /tmp/worker_ready                  │
│   Question: "Does the worker_ready file exist?"             │
│   If YES → worker is running, continue                      │
│   If NO  → error (worker not ready)                         │
│                                                             │
│   Time: ~200-1500ms (network to sandbox)                    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: worker_request_write                                │
│                                                             │
│   Our code writes your message to a file:                   │
│   /tmp/worker_request.json                                  │
│                                                             │
│   Time: ~300-1300ms (network to sandbox)                    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: worker_first_output                                 │
│                                                             │
│   Worker sees the request file (polls every 100ms)          │
│   Worker starts processing and writes first response        │
│   Our code sees new content in output file                  │
│                                                             │
│   Time: ~100-400ms                                          │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: stream_output (the big one)                         │
│                                                             │
│   Worker calls Claude API (~1.5-2.5 seconds)                │
│   Worker streams response chunks to output file             │
│   Our code polls output file every 50ms                     │
│   Our code yields each chunk back to your browser           │
│                                                             │
│   Time: ~4000-6000ms (mostly Claude API time)               │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
    Response appears in your browser!
```

---

## Why Files? (The Trade-off)

**Why not just call the worker directly?**

The worker is a background Python process started with `nohup`. Modal's sandbox doesn't give us a direct way to communicate with background processes - we can only:
1. Run commands (`sb.exec()`)
2. Read/write files (`sb.open()`)

So files are our only option for inter-process communication within the sandbox.

**The cost:**
- Every file read/write goes over the network (Modal's infrastructure)
- Polling adds latency (we check every 50-100ms)
- ~500-2000ms overhead per request just for file operations

**Alternative (potential optimization):**
- Use Unix sockets instead of files
- Worker listens on a socket, we connect directly
- Could save ~300-500ms per request
- More complex to implement

---

## Visual Timeline

```
Time (ms)   Event
─────────────────────────────────────────────────────
0           Start processing message
            │
200         ├── worker_check: Is worker ready? YES
            │
500         ├── worker_request_write: Write message to file
            │
650         ├── worker_first_output: Worker picked up request
            │
            │   ┌─────────────────────────────┐
            │   │ Worker calls Claude API... │
            │   │ (this takes 1.5-2.5 sec)   │
            │   └─────────────────────────────┘
            │
3000        ├── Text chunks streaming back...
            │
4500        ├── Done! Response complete
            │
5000        └── Total time
```
