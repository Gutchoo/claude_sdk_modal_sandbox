#!/usr/bin/env python3
"""
Latency profiling test for Claude Agent.

This script measures detailed timing at each stage of a request to identify bottlenecks.
Run with: python test_latency.py

The test:
1. Sends a simple "write me a short poem" prompt
2. Measures time to each event
3. Outputs a detailed breakdown of where time is spent
"""

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import modal


@dataclass
class TimingEvent:
    """A single timing event."""
    name: str
    timestamp: float
    delta_ms: float  # Time since last event
    cumulative_ms: float  # Time since start
    data: Optional[dict] = None


@dataclass
class LatencyProfile:
    """Complete latency profile for a request."""
    session_id: str
    start_time: float = 0.0
    events: list[TimingEvent] = field(default_factory=list)

    # Key milestones (client-side measured)
    time_to_first_event: Optional[float] = None
    time_to_sandbox_status: Optional[float] = None
    time_to_init: Optional[float] = None
    time_to_first_text: Optional[float] = None
    time_to_done: Optional[float] = None

    # Server-side timing (from timing events)
    server_timings: dict = field(default_factory=dict)

    # Server-side result metadata
    server_duration_ms: Optional[float] = None
    server_num_turns: Optional[int] = None
    server_cost_usd: Optional[float] = None

    # Counts
    text_events: int = 0
    tool_use_events: int = 0
    tool_result_events: int = 0

    def add_event(self, name: str, data: Optional[dict] = None):
        """Add a timing event."""
        now = time.perf_counter()

        if not self.events:
            delta = 0.0
            cumulative = 0.0
        else:
            delta = (now - self.events[-1].timestamp) * 1000
            cumulative = (now - self.start_time) * 1000

        event = TimingEvent(
            name=name,
            timestamp=now,
            delta_ms=delta,
            cumulative_ms=cumulative,
            data=data
        )
        self.events.append(event)

        # Track milestones
        if self.time_to_first_event is None and len(self.events) > 1:
            self.time_to_first_event = cumulative

        if name == "sandbox_status" and self.time_to_sandbox_status is None:
            self.time_to_sandbox_status = cumulative
        elif name == "init" and self.time_to_init is None:
            self.time_to_init = cumulative
        elif name == "text":
            self.text_events += 1
            if self.time_to_first_text is None:
                self.time_to_first_text = cumulative
        elif name == "tool_use":
            self.tool_use_events += 1
        elif name == "tool_result":
            self.tool_result_events += 1
        elif name == "timing" and data:
            # Server-side timing event
            phase = data.get("phase", "unknown")
            self.server_timings[phase] = {
                "duration_ms": data.get("duration_ms"),
                "elapsed_ms": data.get("elapsed_ms"),
            }
        elif name == "timings" and data:
            # Final timing summary from server
            self.server_timings["_summary"] = data.get("data", {})
        elif name == "result" and data:
            self.server_duration_ms = data.get("duration_ms")
            self.server_num_turns = data.get("num_turns")
            self.server_cost_usd = data.get("total_cost_usd")
        elif name == "done":
            self.time_to_done = cumulative


def parse_events(event_json: str) -> list[dict]:
    """Parse potentially multiple JSON objects from a string."""
    events = []
    for line in event_json.strip().split('\n'):
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return events


def run_latency_test(prompt: str = "Write me a very short 4-line poem about coding.") -> LatencyProfile:
    """
    Run a single request and profile all latency.

    Args:
        prompt: The prompt to send to the agent

    Returns:
        LatencyProfile with all timing data
    """
    # Get the deployed function
    print("Getting Modal function reference...")
    t0 = time.perf_counter()
    run_agent_streaming = modal.Function.from_name("claude-agent-modal-box", "run_agent_streaming")
    function_lookup_ms = (time.perf_counter() - t0) * 1000
    print(f"  Function lookup: {function_lookup_ms:.1f}ms")

    # Create test session
    session_id = str(uuid.uuid4())
    account_id = "latency-test"

    profile = LatencyProfile(session_id=session_id)

    print(f"\nSession ID: {session_id}")
    print(f"Prompt: {prompt}")
    print("=" * 70)

    # Start timing
    profile.start_time = time.perf_counter()
    profile.add_event("request_start")

    # Call the streaming function
    print("\nCalling Modal function...")
    profile.add_event("modal_call_start")

    response_text = ""

    try:
        generator = run_agent_streaming.remote_gen(
            session_id=session_id,
            account_id=account_id,
            user_message=prompt
        )
        profile.add_event("generator_created")

        # Iterate through events
        for event_json in generator:
            for event in parse_events(event_json):
                event_type = event.get('type', 'unknown')
                profile.add_event(event_type, event)

                # Collect response text
                if event_type == "text":
                    content = event.get("content", "")
                    response_text += content

                # Log events in real-time
                evt = profile.events[-1]
                print(f"  [{evt.cumulative_ms:7.1f}ms] (+{evt.delta_ms:6.1f}ms) {event_type}", end="")

                if event_type == "timing":
                    phase = event.get("phase", "?")
                    duration = event.get("duration_ms", 0)
                    elapsed = event.get("elapsed_ms", 0)
                    print(f" - {phase}: {duration:.1f}ms (server elapsed: {elapsed:.1f}ms)")
                elif event_type == "timings":
                    print(" - [final timing summary]")
                elif event_type == "sandbox_status":
                    print(f" - is_new: {event.get('is_new')}")
                elif event_type == "init":
                    print(f" - session: {event.get('session_id', 'N/A')[:8]}...")
                elif event_type == "text":
                    content = event.get("content", "")[:40]
                    print(f" - \"{content}...\"" if len(event.get("content", "")) > 40 else f" - \"{content}\"")
                elif event_type == "tool_use":
                    print(f" - {event.get('tool')}")
                elif event_type == "tool_result":
                    print(f" - {event.get('tool')} completed")
                elif event_type == "result":
                    print(f" - {event.get('duration_ms')}ms server, {event.get('num_turns')} turns")
                elif event_type == "done":
                    print(" - complete")
                else:
                    print()

    except Exception as e:
        profile.add_event("error", {"error": str(e)})
        print(f"\nERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

    profile.add_event("request_complete")

    return profile


def print_summary(profile: LatencyProfile):
    """Print a detailed summary of the latency profile."""
    print("\n" + "=" * 70)
    print("LATENCY SUMMARY")
    print("=" * 70)

    total_ms = profile.events[-1].cumulative_ms if profile.events else 0

    print(f"\n{'Metric':<40} {'Time (ms)':>12} {'% of Total':>12}")
    print("-" * 64)

    # Key milestones
    milestones = [
        ("Time to first event", profile.time_to_first_event),
        ("Time to sandbox_status", profile.time_to_sandbox_status),
        ("Time to init (SDK ready)", profile.time_to_init),
        ("Time to first text (TTFT)", profile.time_to_first_text),
        ("Time to done", profile.time_to_done),
        ("Total request time", total_ms),
    ]

    for name, value in milestones:
        if value is not None:
            pct = (value / total_ms * 100) if total_ms > 0 else 0
            print(f"{name:<40} {value:>10.1f}ms {pct:>10.1f}%")
        else:
            print(f"{name:<40} {'N/A':>12}")

    print("\n" + "-" * 64)
    print("SERVER-SIDE TIMING BREAKDOWN (from Modal function)")
    print("-" * 64)

    # Display server-side timing phases in order
    phase_order = [
        ("sandbox_lookup", "Sandbox lookup"),
        ("sandbox_create", "Sandbox create (if new)"),
        ("mkdir_symlink", "mkdir + symlink"),
        ("mkdir_tools", "mkdir /tools"),
        ("write_tool_files", "Write tool files (8 files)"),
        ("write_agent_script", "Write agent script"),
        ("python_exec_start", "Python exec start"),
        ("python_first_output", "Python imports + init"),
        ("volume_commit", "Volume commit"),
    ]

    for phase_key, phase_name in phase_order:
        if phase_key in profile.server_timings:
            timing = profile.server_timings[phase_key]
            duration = timing.get("duration_ms", 0)
            elapsed = timing.get("elapsed_ms", 0)
            print(f"{phase_name:<40} {duration:>8.1f}ms  (@ {elapsed:>7.1f}ms)")

    # Summary from server
    if "_summary" in profile.server_timings:
        summary = profile.server_timings["_summary"]
        print(f"\n{'Server total':<40} {summary.get('total', 0):>8.1f}ms")

    print("\n" + "-" * 64)
    print("AGENT RESULT METRICS")
    print("-" * 64)

    if profile.server_duration_ms:
        print(f"{'Agent duration (SDK)':<40} {profile.server_duration_ms:>10.1f}ms")

        # Calculate client overhead
        if profile.time_to_done:
            overhead = profile.time_to_done - profile.server_duration_ms
            print(f"{'Client/infra overhead':<40} {overhead:>10.1f}ms")

    if profile.server_num_turns:
        print(f"{'Number of turns':<40} {profile.server_num_turns:>12}")

    if profile.server_cost_usd:
        print(f"{'Cost':<40} ${profile.server_cost_usd:>11.4f}")

    print("\n" + "-" * 64)
    print("EVENT COUNTS")
    print("-" * 64)
    print(f"{'Text events':<40} {profile.text_events:>12}")
    print(f"{'Tool use events':<40} {profile.tool_use_events:>12}")
    print(f"{'Tool result events':<40} {profile.tool_result_events:>12}")

    # Phase breakdown
    print("\n" + "-" * 64)
    print("PHASE BREAKDOWN (estimated)")
    print("-" * 64)

    phases = []

    # Pre-first-event (Modal infrastructure)
    if profile.time_to_first_event:
        phases.append(("Modal infra + sandbox lookup", profile.time_to_first_event))

    # sandbox_status to init (sandbox setup + Python startup)
    if profile.time_to_sandbox_status and profile.time_to_init:
        setup_time = profile.time_to_init - profile.time_to_sandbox_status
        phases.append(("Sandbox setup + Python startup", setup_time))

    # init to first_text (API call latency)
    if profile.time_to_init and profile.time_to_first_text:
        api_latency = profile.time_to_first_text - profile.time_to_init
        phases.append(("API latency (to first token)", api_latency))

    # first_text to done (streaming)
    if profile.time_to_first_text and profile.time_to_done:
        streaming_time = profile.time_to_done - profile.time_to_first_text
        phases.append(("Response streaming", streaming_time))

    for name, value in phases:
        pct = (value / total_ms * 100) if total_ms > 0 else 0
        print(f"{name:<40} {value:>10.1f}ms {pct:>10.1f}%")

    # Detailed event timeline
    print("\n" + "-" * 64)
    print("DETAILED EVENT TIMELINE")
    print("-" * 64)
    print(f"{'#':<4} {'Event':<20} {'Delta':>10} {'Cumulative':>12}")
    print("-" * 64)

    for i, evt in enumerate(profile.events):
        print(f"{i:<4} {evt.name:<20} {evt.delta_ms:>8.1f}ms {evt.cumulative_ms:>10.1f}ms")


def run_multiple_tests(num_tests: int = 3, warm_up: bool = True):
    """
    Run multiple tests to get average latency.

    Args:
        num_tests: Number of tests to run
        warm_up: Whether to run a warm-up request first
    """
    print("\n" + "=" * 70)
    print(f"RUNNING {num_tests} LATENCY TESTS")
    if warm_up:
        print("(with warm-up request)")
    print("=" * 70)

    profiles = []

    # Optional warm-up
    if warm_up:
        print("\n--- WARM-UP REQUEST ---")
        warm_profile = run_latency_test("Say 'ready' in one word.")
        print(f"Warm-up complete: {warm_profile.time_to_done:.1f}ms")
        print("\nWaiting 2 seconds before tests...")
        time.sleep(2)

    # Run tests
    for i in range(num_tests):
        print(f"\n--- TEST {i+1}/{num_tests} ---")
        profile = run_latency_test()
        profiles.append(profile)
        print_summary(profile)

        if i < num_tests - 1:
            print("\nWaiting 3 seconds before next test...")
            time.sleep(3)

    # Aggregate summary
    if len(profiles) > 1:
        print("\n" + "=" * 70)
        print("AGGREGATE RESULTS")
        print("=" * 70)

        metrics = [
            ("Time to first event", [p.time_to_first_event for p in profiles]),
            ("Time to sandbox_status", [p.time_to_sandbox_status for p in profiles]),
            ("Time to init", [p.time_to_init for p in profiles]),
            ("Time to first text", [p.time_to_first_text for p in profiles]),
            ("Time to done", [p.time_to_done for p in profiles]),
            ("Server duration", [p.server_duration_ms for p in profiles]),
        ]

        print(f"\n{'Metric':<30} {'Min':>10} {'Max':>10} {'Avg':>10}")
        print("-" * 64)

        for name, values in metrics:
            values = [v for v in values if v is not None]
            if values:
                print(f"{name:<30} {min(values):>8.1f}ms {max(values):>8.1f}ms {sum(values)/len(values):>8.1f}ms")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Profile latency of Claude Agent")
    parser.add_argument("--multi", "-m", type=int, default=1,
                        help="Number of tests to run (default: 1)")
    parser.add_argument("--no-warmup", action="store_true",
                        help="Skip warm-up request when running multiple tests")
    parser.add_argument("--prompt", "-p", type=str,
                        default="Write me a very short 4-line poem about coding.",
                        help="Custom prompt to test")

    args = parser.parse_args()

    if args.multi > 1:
        run_multiple_tests(args.multi, warm_up=not args.no_warmup)
    else:
        profile = run_latency_test(args.prompt)
        print_summary(profile)
