from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import sessions, files, chat

app = FastAPI(
    title="Claude Agent API",
    description="Backend API for Claude Agent SDK + Modal sandbox template",
    version="0.1.0",
)

# Configure CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(sessions.router)
app.include_router(files.router)
app.include_router(chat.router)


@app.get("/")
async def root():
    return {"message": "Claude Agent API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
