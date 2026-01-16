"""
Anthropic API Proxy

This proxy sits between the sandbox and Anthropic's API to isolate the API key.
The sandbox sends its MODAL_SANDBOX_ID as the x-api-key header, and this proxy:
1. Validates the sandbox exists and is still running
2. Swaps the sandbox ID for the real ANTHROPIC_API_KEY
3. Forwards the request to Anthropic's API

This prevents prompt injection attacks from extracting the API key, since
the sandbox never has access to it.
"""

import os

import modal

proxy_image = modal.Image.debian_slim(python_version="3.12").pip_install("httpx", "fastapi")

anthropic_secret = modal.Secret.from_name("anthropic-api-key")

app = modal.App("claude-agent-modal-box-proxy")


@app.function(secrets=[anthropic_secret], image=proxy_image, min_containers=1)
@modal.concurrent(max_inputs=100)
@modal.asgi_app()
def anthropic_proxy():
    import httpx
    from fastapi import FastAPI, HTTPException, Request, Response

    proxy_app = FastAPI()

    @proxy_app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
    async def proxy(request: Request, path: str):
        # Extract headers, filtering out host and content-length
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}

        # The sandbox sends its ID as the API key
        sandbox_id = headers.get("x-api-key")

        if not sandbox_id:
            raise HTTPException(status_code=401, detail="Missing x-api-key header")

        # Validate the sandbox exists and is still running
        try:
            sb = await modal.Sandbox.from_id.aio(sandbox_id)
            if sb.returncode is not None:
                raise HTTPException(status_code=403, detail="Sandbox no longer running")
        except Exception as e:
            # Handle sandbox not found or any other validation error
            if "NotFound" in type(e).__name__ or "not found" in str(e).lower():
                raise HTTPException(status_code=403, detail="Invalid sandbox ID")
            raise HTTPException(status_code=403, detail=f"Sandbox validation failed: {str(e)}")

        # Swap the sandbox ID for the real API key
        headers["x-api-key"] = os.environ["ANTHROPIC_API_KEY"]

        # Forward the request to Anthropic's API
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method=request.method,
                url=f"https://api.anthropic.com/{path}",
                headers=headers,
                content=await request.body(),
                timeout=300.0,
            )

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type="application/json"
        )

    return proxy_app
