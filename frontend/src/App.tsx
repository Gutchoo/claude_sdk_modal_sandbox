import { useState, useEffect, useCallback, useRef } from 'react'
import { FilePanel } from '@/components/FilePanel'
import { ChatInterface } from '@/components/ChatInterface'
import { SessionSidebar } from '@/components/SessionSidebar'
import { useSession } from '@/hooks/useSession'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useTheme } from '@/hooks/useTheme'
import { getSandboxStatus, type SandboxStatus } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function App() {
  const [panelWidth, setPanelWidth] = useState(280)
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)
  const { theme, toggleTheme } = useTheme()
  const {
    sessions,
    session,
    files,
    isLoading: sessionLoading,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    uploadFiles,
    deleteFile,
    triggerWarmup,
  } = useSession()

  // State for inline session name editing
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  const handleStartEditing = useCallback(() => {
    if (session) {
      setEditedName(session.name)
      setIsEditingName(true)
    }
  }, [session])

  const handleSaveName = useCallback(async () => {
    if (session && editedName.trim() && editedName !== session.name) {
      await renameSession(session.id, editedName.trim())
    }
    setIsEditingName(false)
  }, [session, editedName, renameSession])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName()
    } else if (e.key === 'Escape') {
      setIsEditingName(false)
    }
  }, [handleSaveName])
  const { messages, isConnected, isLoading: chatLoading, streamingStatus, elapsedTime, sendMessage, stopGeneration } = useWebSocket(session?.id || null)


  // Poll sandbox status every 2 seconds
  // This is the single source of truth for sandbox state
  const fetchSandboxStatus = useCallback(async () => {
    if (!session?.id) {
      setSandboxStatus(null)
      return
    }
    try {
      const status = await getSandboxStatus(session.id)
      // Only update if not warming (warming state is managed locally)
      setSandboxStatus(prev => {
        if (prev?.status === 'warming' && status.status !== 'running') {
          // Keep showing "warming" until sandbox is actually running
          return prev
        }
        return status
      })
    } catch (err) {
      console.error('Failed to fetch sandbox status:', err)
      setSandboxStatus({ status: 'error', error: 'Failed to fetch status' })
    }
  }, [session?.id])

  useEffect(() => {
    fetchSandboxStatus()
    const interval = setInterval(fetchSandboxStatus, 2000) // Poll every 2 seconds
    return () => clearInterval(interval)
  }, [fetchSandboxStatus])

  // When session changes, check if we need to warm up the sandbox
  useEffect(() => {
    if (!session?.id) return

    // Check sandbox status and trigger warmup if needed
    getSandboxStatus(session.id).then((status) => {
      if (status.status !== 'running') {
        // Set local warming state and trigger warmup
        setSandboxStatus({ status: 'warming' })
        triggerWarmup(session.id)
      }
    }).catch(() => {
      // On error, try to warm up anyway
      setSandboxStatus({ status: 'warming' })
      triggerWarmup(session.id)
    })
  }, [session?.id, triggerWarmup])

  if (sessionLoading) {
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <div className="text-center space-y-4">
          <Skeleton className="h-8 w-48 mx-auto" />
          <p className="text-muted-foreground">Initializing session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Thin Header */}
      <header className="border-b border-border px-3 py-1 flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-muted-foreground">Claude Agent</h1>
          {session && (
            <>
              <span className="text-muted-foreground/50">/</span>
              {isEditingName ? (
                <Input
                  ref={nameInputRef}
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleKeyDown}
                  className="h-6 w-48 text-sm px-1"
                />
              ) : (
                <button
                  onClick={handleStartEditing}
                  className="text-sm font-semibold hover:text-primary transition-colors flex items-center gap-1"
                  title="Click to rename session"
                >
                  {session.name}
                  <PencilIcon />
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Sandbox Status */}
          <SandboxStatusBadge status={sandboxStatus} />

          {/* WebSocket Status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            className="h-6 w-6 p-0"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </Button>
        </div>
      </header>

      {/* Main Content: 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Sessions */}
        <SessionSidebar
          sessions={sessions}
          currentSessionId={session?.id || null}
          onSelectSession={switchSession}
          onCreateSession={createSession}
          onDeleteSession={deleteSession}
        />

        {/* Center - Chat Interface */}
        <ChatInterface
          messages={messages}
          isConnected={isConnected}
          isLoading={chatLoading}
          streamingStatus={streamingStatus}
          elapsedTime={elapsedTime}
          files={files}
          onSendMessage={sendMessage}
          onStopGeneration={stopGeneration}
        />

        {/* Right Panel - Files */}
        <FilePanel
          files={files}
          sessionId={session?.id || null}
          onUpload={uploadFiles}
          onDelete={deleteFile}
          width={panelWidth}
          onWidthChange={setPanelWidth}
        />
      </div>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-50"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function SandboxStatusBadge({ status }: { status: SandboxStatus | null }) {
  const getDisplay = () => {
    if (!status) {
      return { label: 'Checking...', color: 'bg-gray-400', tooltip: 'Checking sandbox status...', animate: false }
    }

    switch (status.status) {
      case 'running':
        return { label: 'Sandbox Active', color: 'bg-green-500', tooltip: 'Sandbox is running', animate: false }
      case 'warming':
        return { label: 'Warming Up...', color: 'bg-blue-500', tooltip: 'Creating sandbox container...', animate: true }
      case 'not_found':
        return { label: 'No Sandbox', color: 'bg-gray-400', tooltip: 'Send a message to create a sandbox', animate: false }
      case 'terminated':
        return { label: 'Sandbox Stopped', color: 'bg-yellow-500', tooltip: 'Sandbox terminated. Next message will create a new one.', animate: false }
      case 'error':
        return { label: 'Status Unknown', color: 'bg-red-500', tooltip: status.error || 'Failed to get status', animate: false }
      default:
        return { label: 'Unknown', color: 'bg-gray-400', tooltip: 'Unknown status', animate: false }
    }
  }

  const display = getDisplay()

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={display.tooltip}>
      <span className={`w-1.5 h-1.5 rounded-full ${display.color} ${display.animate ? 'animate-pulse' : ''}`} />
      {display.label}
    </div>
  )
}

export default App
