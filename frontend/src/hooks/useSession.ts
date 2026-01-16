import { useState, useEffect, useCallback, useRef } from 'react'
import { createSession, listSessions, deleteSession, updateSession, type Session, type FileInfo, uploadFiles, deleteFile, listFiles, warmSandbox } from '@/lib/api'

// Fun placeholder names for new sessions
const PLACEHOLDER_ADJECTIVES = [
  'Curious', 'Swift', 'Clever', 'Bright', 'Mellow', 'Cosmic', 'Nimble', 'Jolly',
  'Serene', 'Vibrant', 'Daring', 'Gentle', 'Bold', 'Whimsy', 'Radiant', 'Stellar'
]

const PLACEHOLDER_NOUNS = [
  'Analysis', 'Report', 'Session', 'Quest', 'Journey', 'Mission', 'Venture',
  'Task', 'Search', 'Chat', 'Thread', 'Spark', 'Wave', 'Flow', 'Path', 'Trail'
]

function generatePlaceholderName(): string {
  const adj = PLACEHOLDER_ADJECTIVES[Math.floor(Math.random() * PLACEHOLDER_ADJECTIVES.length)]
  const noun = PLACEHOLDER_NOUNS[Math.floor(Math.random() * PLACEHOLDER_NOUNS.length)]
  return `${adj} ${noun}`
}

export function useSession() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track which sessions we've already warmed to avoid duplicate calls
  const warmedSessions = useRef<Set<string>>(new Set())

  // Simple fire-and-forget sandbox warm-up
  // App.tsx handles the status polling and "warming" UI state
  const triggerWarmup = useCallback((sessionId: string) => {
    // Skip if already warmed in this browser session
    if (warmedSessions.current.has(sessionId)) {
      return
    }
    warmedSessions.current.add(sessionId)

    // Fire and forget - don't await, don't block
    warmSandbox(sessionId)
      .catch((err) => {
        // Silently log errors - warm-up failure shouldn't affect UX
        console.debug('Sandbox warm-up failed (non-critical):', err)
        // Remove from set so we can retry later
        warmedSessions.current.delete(sessionId)
      })
  }, [])

  // Load all sessions on mount
  useEffect(() => {
    const initSessions = async () => {
      try {
        setIsLoading(true)
        const existingSessions = await listSessions()
        setSessions(existingSessions)

        // Auto-select session with most files, or create new one if none exist
        if (existingSessions.length > 0) {
          const sortedByFiles = [...existingSessions].sort((a, b) => b.file_count - a.file_count)
          const bestSession = sortedByFiles[0]
          setSession(bestSession)

          if (bestSession.file_count > 0) {
            const fileList = await listFiles(bestSession.id)
            setFiles(fileList)
          }
        } else {
          // No sessions exist, create a new one with a fun name
          const newSession = await createSession(generatePlaceholderName())
          setSessions([newSession])
          setSession(newSession)
        }

        setError(null)
      } catch (err) {
        setError('Failed to load sessions')
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }

    initSessions()
  }, [])

  // Switch to a different session
  const switchSession = useCallback(async (sessionId: string) => {
    const targetSession = sessions.find(s => s.id === sessionId)
    if (!targetSession) return

    setSession(targetSession)

    // Load files for the new session
    try {
      const fileList = await listFiles(sessionId)
      setFiles(fileList)
    } catch (err) {
      console.error('Failed to load files:', err)
      setFiles([])
    }
  }, [sessions])

  // Create a new session with a fun placeholder name
  const handleCreateSession = useCallback(async () => {
    try {
      const newSession = await createSession(generatePlaceholderName())
      setSessions(prev => [...prev, newSession])
      setSession(newSession)
      setFiles([])
      return newSession
    } catch (err) {
      setError('Failed to create session')
      console.error(err)
      return null
    }
  }, [])

  // Rename a session
  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      const updatedSession = await updateSession(sessionId, newName)
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? updatedSession : s
      ))
      // Update current session if it's the one being renamed
      if (session?.id === sessionId) {
        setSession(updatedSession)
      }
      return updatedSession
    } catch (err) {
      setError('Failed to rename session')
      console.error(err)
      return null
    }
  }, [session])

  const handleUploadFiles = useCallback(
    async (filesToUpload: File[]) => {
      if (!session) return

      try {
        const uploaded = await uploadFiles(session.id, filesToUpload)
        setFiles((prev) => [...prev, ...uploaded])
        // Update session file count in both the list and current session
        const newFileCount = session.file_count + uploaded.length
        setSessions(prev => prev.map(s =>
          s.id === session.id
            ? { ...s, file_count: newFileCount }
            : s
        ))
        setSession(prev => prev ? { ...prev, file_count: newFileCount } : null)

        // Clear warmed status for this session since sandbox was invalidated
        // The backend automatically re-warms, but clear tracking just in case
        warmedSessions.current.delete(session.id)
      } catch (err) {
        setError('Failed to upload files')
        console.error(err)
      }
    },
    [session]
  )

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!session) return

      try {
        await deleteFile(session.id, fileId)
        setFiles((prev) => prev.filter((f) => f.id !== fileId))
        // Update session file count in both the list and current session
        const newFileCount = Math.max(0, session.file_count - 1)
        setSessions(prev => prev.map(s =>
          s.id === session.id
            ? { ...s, file_count: newFileCount }
            : s
        ))
        setSession(prev => prev ? { ...prev, file_count: newFileCount } : null)
      } catch (err) {
        setError('Failed to delete file')
        console.error(err)
      }
    },
    [session]
  )

  const refreshFiles = useCallback(async () => {
    if (!session) return

    try {
      const fileList = await listFiles(session.id)
      setFiles(fileList)
    } catch (err) {
      console.error('Failed to refresh files:', err)
    }
  }, [session])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))

      // If we deleted the current session, switch to another one
      if (session?.id === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId)
        if (remaining.length > 0) {
          setSession(remaining[0])
          const fileList = await listFiles(remaining[0].id)
          setFiles(fileList)
        } else {
          // No sessions left, create a new one with a fun name
          const newSession = await createSession(generatePlaceholderName())
          setSessions([newSession])
          setSession(newSession)
          setFiles([])
        }
      }
    } catch (err) {
      setError('Failed to delete session')
      console.error(err)
    }
  }, [session, sessions])

  return {
    sessions,
    session,
    files,
    isLoading,
    error,
    switchSession,
    createSession: handleCreateSession,
    renameSession: handleRenameSession,
    deleteSession: handleDeleteSession,
    uploadFiles: handleUploadFiles,
    deleteFile: handleDeleteFile,
    refreshFiles,
    triggerWarmup,
  }
}
