const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export interface Session {
  id: string
  name: string
  created_at: string
  file_count: number
}

export interface SandboxStatus {
  status: 'running' | 'not_found' | 'terminated' | 'error' | 'warming' | 'uploading'
  sandbox_name?: string
  exit_code?: number
  error?: string
}

export interface FileInfo {
  id: string
  name: string
  type: string
  size: number
  uploaded_at: string
}

export async function listSessions(): Promise<Session[]> {
  const response = await fetch(`${API_URL}/api/sessions`)
  if (!response.ok) {
    throw new Error('Failed to list sessions')
  }
  return response.json()
}

export async function createSession(name?: string): Promise<Session> {
  const url = name
    ? `${API_URL}/api/sessions?name=${encodeURIComponent(name)}`
    : `${API_URL}/api/sessions`
  const response = await fetch(url, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Failed to create session')
  }
  return response.json()
}

export async function updateSession(sessionId: string, name: string): Promise<Session> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    throw new Error('Failed to update session')
  }
  return response.json()
}

export async function getSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`)
  if (!response.ok) {
    throw new Error('Failed to get session')
  }
  return response.json()
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to delete session')
  }
}

export async function uploadFiles(
  sessionId: string,
  files: File[]
): Promise<FileInfo[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/files`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error('Failed to upload files')
  }

  return response.json()
}

export async function listFiles(sessionId: string): Promise<FileInfo[]> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/files`)
  if (!response.ok) {
    throw new Error('Failed to list files')
  }
  const data = await response.json()
  return data.files
}

export async function deleteFile(
  sessionId: string,
  fileId: string
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/sessions/${sessionId}/files/${fileId}`,
    {
      method: 'DELETE',
    }
  )
  if (!response.ok) {
    throw new Error('Failed to delete file')
  }
}

export function getFileContentUrl(sessionId: string, fileId: string): string {
  return `${API_URL}/api/sessions/${sessionId}/files/${fileId}/content`
}

export interface ApiToolCall {
  id: string
  tool: string
  input: Record<string, unknown>
  status: 'running' | 'completed' | 'error'
  result?: string
  isError?: boolean
}

// Content block from Claude SDK storage - text or tool call in order
export interface ApiContentBlock {
  type: 'text' | 'tool_call'
  text?: string
  toolCall?: ApiToolCall
}

// Message format from Claude SDK storage on Modal
export interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  contentBlocks?: ApiContentBlock[]
}

export async function getMessages(sessionId: string): Promise<ApiMessage[]> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`)
  if (!response.ok) {
    throw new Error('Failed to get messages')
  }
  const data = await response.json()
  return data.messages || []
}

export function createChatWebSocket(sessionId: string): WebSocket {
  const wsUrl = API_URL.replace('http', 'ws')
  return new WebSocket(`${wsUrl}/api/sessions/${sessionId}/chat`)
}

export async function getSandboxStatus(sessionId: string): Promise<SandboxStatus> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/sandbox-status`)
  if (!response.ok) {
    throw new Error('Failed to get sandbox status')
  }
  return response.json()
}

export interface WarmupResponse {
  status: 'warming'
  message: string
  session_id: string
}

/**
 * Pre-warm the sandbox for a session to reduce cold start latency.
 * This is a fire-and-forget call that starts sandbox initialization in the background.
 */
export async function warmSandbox(sessionId: string): Promise<WarmupResponse> {
  const response = await fetch(`${API_URL}/api/sessions/${sessionId}/warm-up`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Failed to warm sandbox')
  }
  return response.json()
}
