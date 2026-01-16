from pydantic import BaseModel
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class SessionCreate(BaseModel):
    """Request to create a new session"""
    pass


class SessionResponse(BaseModel):
    """Response with session information"""
    id: str
    name: str
    created_at: datetime
    file_count: int = 0


class SessionUpdateRequest(BaseModel):
    """Request to update a session"""
    name: str


class FileInfo(BaseModel):
    """Information about an uploaded file"""
    id: str
    name: str
    type: str
    size: int
    uploaded_at: datetime


class FileListResponse(BaseModel):
    """Response with list of files"""
    files: list[FileInfo]


class ChatMessage(BaseModel):
    """A chat message"""
    role: MessageRole
    content: str


class ChatRequest(BaseModel):
    """Request to send a chat message"""
    message: str


class ChatResponse(BaseModel):
    """Response from the agent"""
    message: str
    timestamp: datetime
