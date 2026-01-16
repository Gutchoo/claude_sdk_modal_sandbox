# Question for Claude Documentation

## Our Setup
We're running the Claude Agent SDK inside a Modal sandbox. To avoid the ~4 second Python import overhead on every message, we created a **persistent worker** - a background Python process that imports the SDK once and stays running.

## The Problem
Modal sandboxes don't provide a direct way to communicate with background processes. We can only:
- Run commands (`sb.exec()`)
- Read/write files (`sb.open()`)

## Our Current Solution: File-Based Communication

```
Modal Function                    Persistent Worker (background Python)
      │                                      │
      │  1. Check /tmp/worker_ready exists   │
      │─────────────────────────────────────>│
      │                                      │
      │  2. Write user message to            │
      │     /tmp/worker_request.json         │
      │─────────────────────────────────────>│
      │                                      │
      │                                      │  3. Worker polls for request,
      │                                      │     calls Claude SDK,
      │                                      │     writes responses to
      │                                      │     /tmp/worker_output.jsonl
      │                                      │
      │  4. Poll /tmp/worker_output.jsonl    │
      │     for new lines, stream back       │
      │<─────────────────────────────────────│
```

## The Cost
Each file operation goes over Modal's network:
- `worker_check`: ~200-1500ms
- `worker_request_write`: ~300-1300ms
- Polling output file: adds latency

**Total overhead: ~500-2000ms per request just for file I/O**

## Our Question
Is there a better way to communicate with a persistent background process in a Modal sandbox? Should we be using:
- Unix sockets?
- A different architecture entirely?
- Something built into the Claude SDK for this use case?
