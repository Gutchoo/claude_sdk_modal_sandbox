import { useState, useEffect, useCallback, useRef } from 'react'
import { createChatWebSocket, getMessages } from '@/lib/api'

// Tool call with its result - displayed inline in messages
export interface ToolCall {
  id: string
  tool: string
  input: Record<string, unknown>
  status: 'running' | 'completed' | 'error'
  result?: string
  isError?: boolean
}

// Content block - either text or a tool call (preserves chronological order)
export interface ContentBlock {
  type: 'text' | 'tool_call'
  text?: string
  toolCall?: ToolCall
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string  // Legacy: plain text content for user messages
  contentBlocks?: ContentBlock[]  // Ordered content blocks for assistant messages
  timestamp: Date
  isStreaming?: boolean
  toolCalls?: ToolCall[]  // Legacy: kept for backward compatibility with persisted data
  fileMentions?: Array<{ fileId: string; fileName: string }>  // Files referenced via @ mentions
}

// Streaming event from the backend
export interface StreamEvent {
  type: 'sandbox_status' | 'init' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'done' | 'error' | 'interrupted' | 'stop_acknowledged'
  content?: string
  tool?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  status?: string
  message?: string
  is_new?: boolean
  session_id?: string
  is_error?: boolean
  // Result metadata
  duration_ms?: number
  num_turns?: number
  total_cost_usd?: number
  // Interrupt data
  reason?: string
  result?: Record<string, unknown>
}

// Current streaming status for UI display
export interface StreamingStatus {
  isActive: boolean
  currentTool?: string
  toolInput?: Record<string, unknown>
}

// Result metadata from the agent
export interface ResultMetadata {
  durationMs: number
  numTurns: number
  totalCostUsd?: number
}

// Parse timestamp string, treating timestamps without timezone as UTC
function parseTimestamp(timestamp: string): Date {
  // If the timestamp doesn't have timezone info, append 'Z' to treat as UTC
  if (!timestamp.includes('+') && !timestamp.includes('Z') && !timestamp.includes('-', 10)) {
    return new Date(timestamp + 'Z')
  }
  return new Date(timestamp)
}

export function useWebSocket(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>({
    isActive: false,
  })
  const [elapsedTime, setElapsedTime] = useState<number>(0)
  const [resultMetadata, setResultMetadata] = useState<ResultMetadata | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)
  // Use a ref to accumulate content to avoid stale closure issues
  const accumulatedContentRef = useRef<string>('')
  // Track tool calls for the current streaming message
  const toolCallsRef = useRef<ToolCall[]>([])
  // Track content blocks in order (text and tool calls interleaved)
  const contentBlocksRef = useRef<ContentBlock[]>([])
  // Timer refs for tracking elapsed time
  const timerStartRef = useRef<number | null>(null)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start the timer
  const startTimer = useCallback(() => {
    // Clear any existing timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
    }
    timerStartRef.current = Date.now()
    setElapsedTime(0)

    timerIntervalRef.current = setInterval(() => {
      if (timerStartRef.current) {
        setElapsedTime(Date.now() - timerStartRef.current)
      }
    }, 100) // Update every 100ms for smooth display
  }, [])

  // Stop the timer
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }
    // Keep the final elapsed time displayed
    if (timerStartRef.current) {
      setElapsedTime(Date.now() - timerStartRef.current)
    }
    timerStartRef.current = null
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }, [])

  // Track the previous session ID to detect actual session changes
  const prevSessionIdRef = useRef<string | null>(null)

  // Load existing messages only when session actually changes (not on isLoading changes)
  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      prevSessionIdRef.current = null
      return
    }

    // Only load messages if the session ID actually changed
    // This prevents reloading when isLoading changes (which would clear streaming messages)
    if (prevSessionIdRef.current === sessionId) {
      return
    }

    // Session changed - immediately clear messages to show fresh UI
    setMessages([])

    // Reset all streaming state when session changes
    streamingMessageIdRef.current = null
    accumulatedContentRef.current = ''
    toolCallsRef.current = []
    contentBlocksRef.current = []
    setStreamingStatus({ isActive: false })
    setIsLoading(false)
    setElapsedTime(0)

    prevSessionIdRef.current = sessionId

    const loadMessages = async () => {
      try {
        const existingMessages = await getMessages(sessionId)
        const formattedMessages: Message[] = existingMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: parseTimestamp(msg.timestamp),
          // Load content blocks with tool calls in chronological order
          contentBlocks: msg.contentBlocks?.map((block) => ({
            type: block.type,
            text: block.text,
            toolCall: block.toolCall ? {
              id: block.toolCall.id,
              tool: block.toolCall.tool,
              input: block.toolCall.input,
              status: block.toolCall.status,
              result: block.toolCall.result,
              isError: block.toolCall.isError,
            } : undefined,
          })),
        }))
        setMessages(formattedMessages)
      } catch (err) {
        console.error('Failed to load messages:', err)
        setMessages([])
      }
    }

    loadMessages()
  }, [sessionId])

  // Connect to WebSocket when session is available
  useEffect(() => {
    if (!sessionId) return

    const ws = createChatWebSocket(sessionId)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      // Handle streaming events
      if (data.type === 'stream') {
        const streamEvent: StreamEvent = data.event

        // Create streaming message if this is the first event
        if (!streamingMessageIdRef.current) {
          streamingMessageIdRef.current = crypto.randomUUID()
          accumulatedContentRef.current = ''
          toolCallsRef.current = []  // Reset tool calls for new message
          contentBlocksRef.current = []  // Reset content blocks for new message
          // Add a new streaming message placeholder
          const streamingMessage: Message = {
            id: streamingMessageIdRef.current,
            role: 'assistant',
            content: '',
            timestamp: parseTimestamp(data.timestamp),
            isStreaming: true,
            toolCalls: [],
            contentBlocks: [],
          }
          setMessages((prev) => [...prev, streamingMessage])
        }

        const currentMessageId = streamingMessageIdRef.current

        // Helper to update message with current content blocks
        const updateMessageContentBlocks = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentMessageId
                ? {
                    ...msg,
                    toolCalls: [...toolCallsRef.current],
                    contentBlocks: [...contentBlocksRef.current]
                  }
                : msg
            )
          )
        }

        // Handle different event types
        switch (streamEvent.type) {
          case 'text': {
            // Append new text to accumulated content (for legacy compatibility)
            const newText = streamEvent.content || ''
            if (accumulatedContentRef.current) {
              accumulatedContentRef.current += '\n\n' + newText
            } else {
              accumulatedContentRef.current = newText
            }

            // Add text block to content blocks (preserves order)
            contentBlocksRef.current.push({
              type: 'text',
              text: newText,
            })

            // Update the message with accumulated content and blocks
            const updatedContent = accumulatedContentRef.current
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === currentMessageId
                  ? { ...msg, content: updatedContent, contentBlocks: [...contentBlocksRef.current] }
                  : msg
              )
            )

            // Clear tool status when we get text
            setStreamingStatus({
              isActive: true,
              currentTool: undefined,
              toolInput: undefined,
            })
            break
          }

          case 'tool_use': {
            // Add new tool call to tracking
            const toolCall: ToolCall = {
              id: streamEvent.tool_use_id || crypto.randomUUID(),
              tool: streamEvent.tool || 'unknown',
              input: streamEvent.input || {},
              status: 'running',
            }
            toolCallsRef.current.push(toolCall)

            // Add tool call block to content blocks (preserves order)
            contentBlocksRef.current.push({
              type: 'tool_call',
              toolCall: toolCall,
            })
            updateMessageContentBlocks()

            // Show tool being used in status
            setStreamingStatus({
              isActive: true,
              currentTool: streamEvent.tool,
              toolInput: streamEvent.input,
            })
            break
          }

          case 'tool_result': {
            // Find and update the matching tool call
            const toolUseId = streamEvent.tool_use_id
            const toolIndex = toolCallsRef.current.findIndex(t => t.id === toolUseId)
            if (toolIndex >= 0) {
              toolCallsRef.current[toolIndex] = {
                ...toolCallsRef.current[toolIndex],
                status: streamEvent.is_error ? 'error' : 'completed',
                result: streamEvent.content,
                isError: streamEvent.is_error,
              }
              // Also update the tool call in content blocks
              const blockIndex = contentBlocksRef.current.findIndex(
                b => b.type === 'tool_call' && b.toolCall?.id === toolUseId
              )
              if (blockIndex >= 0) {
                contentBlocksRef.current[blockIndex] = {
                  ...contentBlocksRef.current[blockIndex],
                  toolCall: toolCallsRef.current[toolIndex],
                }
              }
              updateMessageContentBlocks()
            }

            // Clear tool status
            setStreamingStatus((prev) => ({
              ...prev,
              currentTool: undefined,
              toolInput: undefined,
            }))
            break
          }

          case 'result': {
            // Store result metadata
            setResultMetadata({
              durationMs: streamEvent.duration_ms || 0,
              numTurns: streamEvent.num_turns || 0,
              totalCostUsd: streamEvent.total_cost_usd,
            })
            break
          }

          case 'interrupted':
            // Agent was interrupted by user - add a note to the content
            console.log('[Stop] Received "interrupted" event from agent - generation stopped')
            // Add interrupted notice to content blocks
            contentBlocksRef.current.push({
              type: 'text',
              text: '\n\n[Stopped by user]',
            })
            if (accumulatedContentRef.current) {
              accumulatedContentRef.current += '\n\n[Stopped by user]'
            } else {
              accumulatedContentRef.current = '[Stopped by user]'
            }
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === currentMessageId
                  ? { ...msg, content: accumulatedContentRef.current, contentBlocks: [...contentBlocksRef.current] }
                  : msg
              )
            )
            setStreamingStatus({
              isActive: false,
              currentTool: undefined,
            })
            break

          case 'stop_acknowledged':
            // Backend acknowledged our stop request
            console.log('[Stop] Backend acknowledged stop request:', streamEvent.result)
            break

          case 'error':
            console.error('Stream error:', streamEvent.message)
            setStreamingStatus({
              isActive: false,
              currentTool: undefined,
            })
            break

          case 'done':
            // Streaming complete
            setStreamingStatus({
              isActive: false,
            })
            break
        }
      }
      // Handle completion message (final message from backend)
      else if (data.type === 'complete') {
        const currentMessageId = streamingMessageIdRef.current
        const finalToolCalls = [...toolCallsRef.current]
        const finalContentBlocks = [...contentBlocksRef.current]

        if (currentMessageId) {
          // Update the streaming message with final content, tool calls, and mark as complete
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentMessageId
                ? {
                    ...msg,
                    content: data.content,
                    isStreaming: false,
                    toolCalls: finalToolCalls,
                    contentBlocks: finalContentBlocks,
                  }
                : msg
            )
          )
        } else {
          // No streaming message exists, add new one (fallback)
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: data.role,
              content: data.content,
              timestamp: parseTimestamp(data.timestamp),
              isStreaming: false,
              toolCalls: finalToolCalls,
              contentBlocks: finalContentBlocks,
            },
          ])
        }

        // Reset streaming state
        streamingMessageIdRef.current = null
        accumulatedContentRef.current = ''
        toolCallsRef.current = []
        contentBlocksRef.current = []
        setStreamingStatus({
          isActive: false,
        })
        setIsLoading(false)
        stopTimer()
      }
      // Legacy: handle old-style complete messages (backwards compatibility)
      else if (data.role) {
        const message: Message = {
          id: crypto.randomUUID(),
          role: data.role,
          content: data.content,
          timestamp: parseTimestamp(data.timestamp),
        }
        setMessages((prev) => [...prev, message])
        setIsLoading(false)
        stopTimer()
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      console.log('WebSocket disconnected')
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setIsLoading(false)
      setStreamingStatus({
        isActive: false,
      })
      stopTimer()
    }

    return () => {
      ws.close()
    }
  }, [sessionId, stopTimer])

  const sendMessage = useCallback(
    (content: string, fileMentions?: Array<{ fileId: string; fileName: string }>) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected')
        return
      }

      // Reset streaming state
      streamingMessageIdRef.current = null
      accumulatedContentRef.current = ''
      toolCallsRef.current = []
      contentBlocksRef.current = []
      setResultMetadata(null)
      setStreamingStatus({
        isActive: false,
      })

      // Start the timer when user sends a message
      startTimer()

      // Add user message to state immediately (include file mentions for display)
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date(),
        fileMentions: fileMentions && fileMentions.length > 0 ? fileMentions : undefined,
      }
      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)

      // Send to server (include file_ids if provided)
      const payload: { message: string; file_ids?: string[] } = { message: content }
      if (fileMentions && fileMentions.length > 0) {
        payload.file_ids = fileMentions.map(m => m.fileId)
      }
      wsRef.current.send(JSON.stringify(payload))
    },
    [startTimer]
  )

  // Stop the current generation by sending a stop message to the backend
  const stopGeneration = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected')
      return
    }

    console.log('[Stop] Sending stop request to backend...')
    // Send stop message to backend
    wsRef.current.send(JSON.stringify({ type: 'stop' }))

    // The backend will send an 'interrupted' event which will be handled
    // in the message handler, and then a 'complete' event to finish up
  }, [])

  return {
    messages,
    isConnected,
    isLoading,
    streamingStatus,
    elapsedTime,
    resultMetadata,
    sendMessage,
    stopGeneration,
  }
}
