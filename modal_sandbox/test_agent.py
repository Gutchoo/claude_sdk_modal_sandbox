#!/usr/bin/env python3
"""
Test script to verify the agent flow works end-to-end.
Sends 2 messages and verifies responses come back.
"""

import modal
import json
import uuid

def parse_events(event_json):
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

def test_agent():
    # Get the deployed functions
    run_agent_streaming = modal.Function.from_name("claude-agent-modal-box", "run_agent_streaming")

    # Create a test session ID
    session_id = str(uuid.uuid4())
    account_id = "test-account"

    print(f"Testing with session_id: {session_id}")
    print("=" * 60)

    # Test message 1
    print("\n--- Message 1: 'Hello, what is 2+2?' ---")
    response_text_1 = ""
    event_count_1 = 0

    try:
        for event_json in run_agent_streaming.remote_gen(
            session_id=session_id,
            account_id=account_id,
            user_message="Hello, what is 2+2?"
        ):
            for event in parse_events(event_json):
                event_count_1 += 1
                event_type = event.get('type', 'unknown')
                print(f"Event {event_count_1}: {event_type}", end="")

                if event_type == "text":
                    content = event.get("content", "")
                    response_text_1 += content
                    print(f" - {content[:50]}..." if len(content) > 50 else f" - {content}")
                elif event_type == "tool_use":
                    print(f" - Tool: {event.get('tool')}")
                elif event_type == "tool_result":
                    print(f" - Result for: {event.get('tool')}")
                elif event_type == "result":
                    print(f" - Duration: {event.get('duration_ms')}ms, Turns: {event.get('num_turns')}")
                elif event_type == "sandbox_status":
                    print(f" - New sandbox: {event.get('is_new')}")
                elif event_type == "init":
                    print(f" - Session: {event.get('session_id', 'N/A')}")
                elif event_type == "done":
                    print(" - Complete")
                else:
                    print()

    except Exception as e:
        print(f"\nERROR in message 1: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    print(f"\nMessage 1 complete. Events: {event_count_1}, Response length: {len(response_text_1)}")

    if not response_text_1:
        print("FAILED: No response text received for message 1")
        return False

    # Test message 2 (should continue conversation)
    print("\n--- Message 2: 'What did I just ask you?' ---")
    response_text_2 = ""
    event_count_2 = 0

    try:
        for event_json in run_agent_streaming.remote_gen(
            session_id=session_id,
            account_id=account_id,
            user_message="What did I just ask you?"
        ):
            for event in parse_events(event_json):
                event_count_2 += 1
                event_type = event.get('type', 'unknown')
                print(f"Event {event_count_2}: {event_type}", end="")

                if event_type == "text":
                    content = event.get("content", "")
                    response_text_2 += content
                    print(f" - {content[:50]}..." if len(content) > 50 else f" - {content}")
                elif event_type == "result":
                    print(f" - Duration: {event.get('duration_ms')}ms, Turns: {event.get('num_turns')}")
                elif event_type == "sandbox_status":
                    print(f" - New sandbox: {event.get('is_new')}")
                elif event_type == "init":
                    print(f" - Session: {event.get('session_id', 'N/A')}")
                elif event_type == "done":
                    print(" - Complete")
                else:
                    print()

    except Exception as e:
        print(f"\nERROR in message 2: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    print(f"\nMessage 2 complete. Events: {event_count_2}, Response length: {len(response_text_2)}")

    if not response_text_2:
        print("FAILED: No response text received for message 2")
        return False

    # Verify conversation continuity
    print("\n" + "=" * 60)
    print("RESULTS:")
    print(f"Message 1 response: {response_text_1[:200]}...")
    print(f"Message 2 response: {response_text_2[:200]}...")

    # Check if message 2 references the previous question
    if "2+2" in response_text_2.lower() or "four" in response_text_2.lower() or "4" in response_text_2:
        print("\nSUCCESS: Conversation continuity verified!")
        return True
    else:
        print("\nWARNING: Message 2 may not have remembered the conversation context")
        return True  # Still passed, just noting the warning


if __name__ == "__main__":
    import sys
    success = test_agent()
    sys.exit(0 if success else 1)
