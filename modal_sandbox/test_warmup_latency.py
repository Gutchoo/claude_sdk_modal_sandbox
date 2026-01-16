#!/usr/bin/env python3
"""
Test to measure latency after warm_sandbox completes.

This test simulates the frontend flow:
1. Call warm_sandbox() and wait for it to complete
2. Immediately send a message
3. Measure if we get fast worker response or slow fallback

This helps answer: "If I wait for 'Sandbox Active', will my first message be fast?"
"""

import json
import time
import uuid

import modal


def test_warmup_then_message():
    """Test latency when sending message immediately after warm_sandbox completes."""

    print("=" * 70)
    print("WARMUP → FIRST MESSAGE LATENCY TEST")
    print("=" * 70)

    # Get Modal functions
    warm_sandbox = modal.Function.from_name("claude-agent-modal-box", "warm_sandbox")
    run_agent_streaming = modal.Function.from_name("claude-agent-modal-box", "run_agent_streaming")

    session_id = f"warmup-test-{uuid.uuid4().hex[:8]}"
    account_id = "latency-test"

    print(f"\nSession ID: {session_id}")

    # Step 1: Call warm_sandbox and measure how long it takes
    print("\n" + "-" * 70)
    print("STEP 1: Warming sandbox...")
    print("-" * 70)

    warmup_start = time.time()
    result = warm_sandbox.remote(account_id=account_id, session_id=session_id)
    warmup_duration = (time.time() - warmup_start) * 1000

    print(f"  Duration: {warmup_duration:.0f}ms")
    print(f"  Status: {result.get('status')}")
    print(f"  Message: {result.get('message')}")
    print(f"  Worker Ready: {result.get('worker_ready', 'N/A')}")

    # Step 2: Immediately send a message
    print("\n" + "-" * 70)
    print("STEP 2: Sending first message IMMEDIATELY after warmup...")
    print("-" * 70)

    request_start = time.time()

    worker_info = {}
    sdk_duration = None

    for event_json in run_agent_streaming.remote_gen(
        session_id=session_id,
        account_id=account_id,
        user_message="Say 'hello' in one word."
    ):
        for line in event_json.strip().split('\n'):
            if not line:
                continue
            try:
                event = json.loads(line)
                event_type = event.get('type')

                if event_type == 'timing':
                    phase = event.get('phase', '')
                    duration = event.get('duration_ms', 0)

                    # Track worker-related timings
                    if 'worker' in phase or 'python' in phase or 'fallback' in phase.lower():
                        worker_info[phase] = duration
                        print(f"  {phase}: {duration:.0f}ms")

                    # Track if we're using worker or fallback
                    if phase == 'using_persistent_worker':
                        worker_info['mode'] = 'persistent_worker'
                    elif phase == 'using_process_fallback':
                        worker_info['mode'] = 'process_fallback'

                elif event_type == 'result':
                    sdk_duration = event.get('duration_ms')

            except json.JSONDecodeError:
                pass

    request_duration = (time.time() - request_start) * 1000

    print(f"\n  Total Request: {request_duration:.0f}ms")
    print(f"  SDK Duration: {sdk_duration}ms")
    print(f"  Mode: {worker_info.get('mode', 'unknown')}")

    # Step 3: Send second message for comparison
    print("\n" + "-" * 70)
    print("STEP 3: Sending SECOND message (should definitely use worker)...")
    print("-" * 70)

    time.sleep(1)  # Brief pause

    request2_start = time.time()

    worker_info2 = {}
    sdk_duration2 = None

    for event_json in run_agent_streaming.remote_gen(
        session_id=session_id,
        account_id=account_id,
        user_message="Say 'world' in one word."
    ):
        for line in event_json.strip().split('\n'):
            if not line:
                continue
            try:
                event = json.loads(line)
                event_type = event.get('type')

                if event_type == 'timing':
                    phase = event.get('phase', '')
                    duration = event.get('duration_ms', 0)

                    if 'worker' in phase or 'python' in phase:
                        worker_info2[phase] = duration
                        print(f"  {phase}: {duration:.0f}ms")

                    if phase == 'using_persistent_worker':
                        worker_info2['mode'] = 'persistent_worker'
                    elif phase == 'using_process_fallback':
                        worker_info2['mode'] = 'process_fallback'

                elif event_type == 'result':
                    sdk_duration2 = event.get('duration_ms')

            except json.JSONDecodeError:
                pass

    request2_duration = (time.time() - request2_start) * 1000

    print(f"\n  Total Request: {request2_duration:.0f}ms")
    print(f"  SDK Duration: {sdk_duration2}ms")
    print(f"  Mode: {worker_info2.get('mode', 'unknown')}")

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    print(f"\n{'Phase':<40} {'Time':>12}")
    print("-" * 52)
    print(f"{'warm_sandbox() call':<40} {warmup_duration:>10.0f}ms")
    print(f"{'  └─ worker_ready returned':<40} {str(result.get('worker_ready', 'N/A')):>12}")
    print(f"{'First message after warmup':<40} {request_duration:>10.0f}ms")
    print(f"{'  └─ mode':<40} {worker_info.get('mode', 'unknown'):>12}")
    print(f"{'Second message':<40} {request2_duration:>10.0f}ms")
    print(f"{'  └─ mode':<40} {worker_info2.get('mode', 'unknown'):>12}")

    # Analysis
    print("\n" + "-" * 52)
    print("ANALYSIS")
    print("-" * 52)

    if result.get('worker_ready') and worker_info.get('mode') == 'persistent_worker':
        print("SUCCESS: warm_sandbox reported worker_ready=True")
        print("         AND first message used persistent_worker")
        print(f"         First message latency: {request_duration:.0f}ms (should be ~4-5s)")
    elif result.get('worker_ready') and worker_info.get('mode') == 'process_fallback':
        print("ISSUE: warm_sandbox reported worker_ready=True")
        print("       BUT first message fell back to process_fallback")
        print("       Worker may have crashed or file check failed")
    elif not result.get('worker_ready'):
        print("EXPECTED: warm_sandbox timed out waiting for worker")
        print("          First message likely used process_fallback")
        print(f"          warm_sandbox took {warmup_duration:.0f}ms (30s timeout)")

    return {
        'warmup_duration_ms': warmup_duration,
        'worker_ready': result.get('worker_ready'),
        'first_message_ms': request_duration,
        'first_message_mode': worker_info.get('mode'),
        'second_message_ms': request2_duration,
        'second_message_mode': worker_info2.get('mode'),
    }


def test_delay_after_warmup():
    """Test what happens if we wait a few seconds after warmup before sending."""

    print("\n" + "=" * 70)
    print("DELAYED MESSAGE TEST (5s wait after warmup)")
    print("=" * 70)

    warm_sandbox = modal.Function.from_name("claude-agent-modal-box", "warm_sandbox")
    run_agent_streaming = modal.Function.from_name("claude-agent-modal-box", "run_agent_streaming")

    session_id = f"delay-test-{uuid.uuid4().hex[:8]}"
    account_id = "latency-test"

    print(f"\nSession ID: {session_id}")

    # Warm up
    print("\nWarming sandbox...")
    warmup_start = time.time()
    result = warm_sandbox.remote(account_id=account_id, session_id=session_id)
    warmup_duration = (time.time() - warmup_start) * 1000
    print(f"  Warmup: {warmup_duration:.0f}ms, worker_ready={result.get('worker_ready')}")

    # Wait 5 seconds
    print("\nWaiting 5 seconds...")
    time.sleep(5)

    # Send message
    print("\nSending message...")
    request_start = time.time()
    mode = None

    for event_json in run_agent_streaming.remote_gen(
        session_id=session_id,
        account_id=account_id,
        user_message="Say 'test' in one word."
    ):
        for line in event_json.strip().split('\n'):
            if not line:
                continue
            try:
                event = json.loads(line)
                if event.get('type') == 'timing':
                    phase = event.get('phase', '')
                    if phase == 'using_persistent_worker':
                        mode = 'persistent_worker'
                    elif phase == 'using_process_fallback':
                        mode = 'process_fallback'
            except:
                pass

    request_duration = (time.time() - request_start) * 1000
    print(f"  Request: {request_duration:.0f}ms, mode={mode}")

    return {
        'warmup_duration_ms': warmup_duration,
        'worker_ready': result.get('worker_ready'),
        'delay_seconds': 5,
        'request_duration_ms': request_duration,
        'mode': mode,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test warmup → first message latency")
    parser.add_argument("--delayed", "-d", action="store_true",
                        help="Also run delayed test (5s wait after warmup)")

    args = parser.parse_args()

    # Main test
    results = test_warmup_then_message()

    # Optional delayed test
    if args.delayed:
        delayed_results = test_delay_after_warmup()

        print("\n" + "=" * 70)
        print("COMPARISON: Immediate vs Delayed")
        print("=" * 70)
        print(f"{'Scenario':<30} {'Latency':>12} {'Mode':>20}")
        print("-" * 62)
        print(f"{'Immediate after warmup':<30} {results['first_message_ms']:>10.0f}ms {results['first_message_mode'] or 'unknown':>20}")
        print(f"{'5s delay after warmup':<30} {delayed_results['request_duration_ms']:>10.0f}ms {delayed_results['mode'] or 'unknown':>20}")
