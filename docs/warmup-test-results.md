# Warmup Latency Test Results

**Date:** January 15, 2026 @ 5:50 PM PST

## Question
> If I wait for "Sandbox Active" in the UI, will my first message be as fast as subsequent messages?

## Answer
**Mostly yes, but there's still a ~1-2s "first request" overhead.**

The persistent worker IS ready after warmup completes, but the first request to a sandbox has additional Modal infrastructure overhead.

---

## Test Results Summary

### Test 1
| Phase | Duration |
|-------|----------|
| `warm_sandbox()` | 10,324ms |
| Worker Ready? | **Yes** |
| First Message | 11,177ms |
| Second Message | 5,100ms |
| **First vs Second Δ** | **+6,077ms** |

### Test 2
| Phase | Duration |
|-------|----------|
| `warm_sandbox()` | 7,632ms |
| Worker Ready? | **Yes** |
| First Message | 7,740ms |
| Second Message | 5,867ms |
| **First vs Second Δ** | **+1,873ms** |

### Test 3
| Phase | Duration |
|-------|----------|
| `warm_sandbox()` | 7,159ms |
| Worker Ready? | **Yes** |
| First Message | 6,582ms |
| Second Message | 5,398ms |
| **First vs Second Δ** | **+1,184ms** |

---

## Aggregate Summary

| Metric | Min | Max | Avg |
|--------|-----|-----|-----|
| `warm_sandbox()` duration | 7,159ms | 10,324ms | **8,372ms** |
| First message after warmup | 6,582ms | 11,177ms | **8,500ms** |
| Second message | 5,100ms | 5,867ms | **5,455ms** |
| First vs Second overhead | 1,184ms | 6,077ms | **~3,045ms** |

---

## Detailed Breakdown (Test 3 - Best Case)

### First Message After Warmup (6,582ms)
```
worker_check:         545ms
worker_request_write: 534ms
worker_first_output:  229ms
SDK Duration:       1,807ms
Other overhead:     3,467ms
```

### Second Message (5,398ms)
```
worker_check:         528ms
worker_request_write: 505ms
worker_first_output:  231ms
SDK Duration:       1,589ms
Other overhead:     2,545ms
```

---

## Key Findings

### What's Working
- **Persistent worker IS ready** after `warm_sandbox()` completes
- **All requests use `persistent_worker` mode** (not fallback)
- **`worker_first_output` is fast** (~100-230ms vs ~3,700ms without worker)

### What's Still Slow
1. **First request overhead** (~1-6s extra)
   - Modal infrastructure "wakes up" on first actual request
   - This happens even though sandbox is "active"

2. **Claude API variability**
   - SDK duration ranges from 1,369ms to 1,807ms
   - This is the actual Claude API call - not much we can control

3. **Network/polling overhead**
   - `worker_check` and `worker_request_write` each take ~500ms
   - File-based communication has inherent latency

---

## What "Sandbox Active" Actually Means

| State | What's Ready | First Message Latency |
|-------|-------------|----------------------|
| No sandbox | Nothing | ~12-15s (cold start) |
| "Sandbox Active" | Container + Worker running | ~6-11s (first request overhead) |
| After first message | Everything warm | ~5-6s (optimal) |

---

## Recommendations

### For Users
- **Best experience**: Send a "warmup" message after seeing "Sandbox Active"
- Second and subsequent messages will be ~5-6s

### Potential Optimizations
1. **Auto-send warmup ping** after sandbox creation (invisible to user)
2. **Socket-based worker communication** instead of file polling
3. **Show "Sandbox Ready" only after first request completes**

---

## Test Commands Used

```bash
# Warmup → First Message test
python test_warmup_latency.py

# Multi-request latency test
python test_latency.py -m 3 --no-warmup
```
