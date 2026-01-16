# Claude Agent SDK

The [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/) is Anthropic's official SDK for building production-ready AI agents with Claude. Braintrust automatically traces agent queries, tool executions, and multi-step reasoning.

## Setup

Install the Braintrust SDK alongside the Claude Agent SDK:

<CodeGroup>
  ```bash Typescript theme={"theme":{"light":"github-light","dark":"github-dark-dimmed"}}
  # pnpm
  pnpm add braintrust @anthropic-ai/claude-agent-sdk zod
  # npm
  npm install braintrust @anthropic-ai/claude-agent-sdk zod
  ```

  ```bash Python theme={"theme":{"light":"github-light","dark":"github-dark-dimmed"}}
  pip install braintrust claude-agent-sdk
  ```
</CodeGroup>

## Trace with Claude Agent SDK

Braintrust provides wrapper functions that automatically instrument the Claude Agent SDK to capture agent interactions, tool calls, and query results.

This example creates a calculator tool and traces multi-step agent queries:

<CodeGroup dropdown>
  ```typescript title="claude-agent.ts" expandable theme={"theme":{"light":"github-light","dark":"github-dark-dimmed"}}
  import { initLogger, wrapClaudeAgentSDK } from "braintrust";
  import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";
  import { z } from "zod";

  // Initialize Braintrust logging
  initLogger({
    projectName: "claude-agent-example",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  // Wrap the Claude SDK with Braintrust tracing
  const { query, tool, createSdkMcpServer } = wrapClaudeAgentSDK(claudeSDK);

  // Create a calculator tool
  const calculator = tool(
    "calculator",
    "Performs basic arithmetic operations",
    {
      operation: z.enum(["add", "subtract", "multiply", "divide"]),
      a: z.number(),
      b: z.number(),
    },
    async (args: { operation: string; a: number; b: number }) => {
      console.log(`[Tool] Calculating: ${args.a} ${args.operation} ${args.b}`);

      let result = 0;
      switch (args.operation) {
        case "add":
          result = args.a + args.b;
          break;
        case "subtract":
          result = args.a - args.b;
          break;
        case "multiply":
          result = args.a * args.b;
          break;
        case "divide":
          if (args.b === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Division by zero",
                },
              ],
              isError: true,
            };
          }
          result = args.a / args.b;
          break;
      }

      return {
        content: [
          {
            type: "text",
            text: `The result of ${args.operation}(${args.a}, ${args.b}) is ${result}`,
          },
        ],
      };
    },
  );

  async function main() {
    console.log("Starting Claude Agent SDK example with Braintrust tracing...\n");

    try {
      // Query with mcp server for tool calls
      const result = query({
        prompt: "What is 15 multiplied by 7? Then subtract 5 from the result.",
        options: {
          model: "claude-sonnet-4-5-20250929",
          permissionMode: "bypassPermissions",
          mcpServers: {
            calculator: createSdkMcpServer({
              name: "calculator",
              version: "1.0.0",
              tools: [calculator],
            }),
          },
        },
      });

      // Stream the results
      for await (const message of result) {
        console.log(message);
      }

      console.log("\n\n✓ Example completed! Check Braintrust for tracing data.");
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  }

  main();
  ```

  ```python title="claude_agent.py" expandable theme={"theme":{"light":"github-light","dark":"github-dark-dimmed"}}
  #!/usr/bin/env python3

  import asyncio
  import os
  from typing import Any

  from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk
  from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, create_sdk_mcp_server, tool

  # Setup claude_agent_sdk with braintrust tracing
  setup_claude_agent_sdk(
      project="claude-agent-example",
      api_key=os.environ.get("BRAINTRUST_API_KEY"),
  )

  # Create a calculator tool
  @tool(
      "calculator",
      "Performs basic arithmetic operations",
      {
          "operation": str,
          "a": float,
          "b": float,
      },
  )
  async def calculator(args: dict[str, Any]) -> dict[str, Any]:
      operation = args["operation"]
      a = float(args["a"])
      b = float(args["b"])

      print(f"[Tool] Calculating: {a} {operation} {b}")

      if operation == "add":
          result = a + b
      elif operation == "subtract":
          result = a - b
      elif operation == "multiply":
          result = a * b
      elif operation == "divide":
          if b == 0:
              return {"content": [{"type": "text", "text": "Error: Division by zero"}], "is_error": True}
          result = a / b
      else:
          result = 0

      return {"content": [{"type": "text", "text": f"The result of {operation}({a}, {b}) is {result}"}]}

  async def main():
      print("Starting Claude Agent SDK example with Braintrust tracing...\n")

      try:
          # Create SDK MCP server with the calculator tool
          calculator_server = create_sdk_mcp_server(
              name="calculator",
              version="1.0.0",
              tools=[calculator],
          )

          options = ClaudeAgentOptions(
              model="claude-sonnet-4-5-20250929",
              permission_mode="bypassPermissions",
              mcp_servers={"calculator": calculator_server},
              allowed_tools=["mcp__calculator__calculator"],
          )

          # Use a persistent client session to enable custom MCP tools
          async with ClaudeSDKClient(options=options) as client:
              await client.query("What is 15 multiplied by 7? Then subtract 5 from the result.")
              async for message in client.receive_response():
                  print(message)

          print("\n\n✓ Example completed! Check Braintrust for tracing data.")
      except Exception as error:
          print(f"Error: {error}")

  asyncio.run(main())
  ```
</CodeGroup>

## Resources

* [Claude Agent SDK documentation](https://docs.claude.com/en/api/agent-sdk/)
* [Anthropic API documentation](https://docs.anthropic.com/)


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://braintrust.dev/docs/llms.txt