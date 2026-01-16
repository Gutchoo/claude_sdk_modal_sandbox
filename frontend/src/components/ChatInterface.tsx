import { useState, useRef, useEffect, createContext, useContext, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { TipTapChatInput } from '@/components/ChatInput'
import type { Message, StreamingStatus, ToolCall } from '@/hooks/useWebSocket'
import type { FileInfo } from '@/lib/api'

// Context for scroll functionality
const ScrollContext = createContext<{ scrollToBottom: () => void }>({ scrollToBottom: () => {} })

// Regex to match inline file mentions: @[filename]
const FILE_MENTION_REGEX = /@\[([^\]]+)\]/g

// Render text with inline file mentions highlighted (for chat messages - on primary bg)
function renderTextWithMentions(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const matches = text.matchAll(FILE_MENTION_REGEX)

  for (const match of matches) {
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length
    const fileName = match[1]

    // Add text before this mention
    if (matchStart > lastIndex) {
      parts.push(text.substring(lastIndex, matchStart))
    }

    // Add highlighted mention with @ prefix - styled chip for user message bubble
    // Uses white/20 which provides contrast on both black (light mode) and white (dark mode) bubbles
    parts.push(
      <span
        key={matchStart}
        className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 bg-primary-foreground/20 rounded font-medium text-[0.9em]"
      >
        <span className="opacity-50">@</span>
        {fileName}
      </span>
    )

    lastIndex = matchEnd
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

interface ChatInterfaceProps {
  messages: Message[]
  isConnected: boolean
  isLoading: boolean
  streamingStatus?: StreamingStatus
  elapsedTime?: number
  files: FileInfo[]
  onSendMessage: (content: string, fileMentions?: Array<{ fileId: string; fileName: string }>) => void
  onStopGeneration?: () => void
}


// Smooth streaming text component with Framer Motion character animation
function StreamingText({ text, isStreaming, onUpdate }: { text: string; isStreaming: boolean; onUpdate?: () => void }) {
  // Track which characters have been "revealed" (animated in)
  const [revealedCount, setRevealedCount] = useState(0)
  const prevTextLengthRef = useRef(0)
  // Track if this component was mounted with non-streaming content (history)
  const wasInitiallyNotStreamingRef = useRef(!isStreaming && text.length > 0)

  // Animation speed: characters per second
  const CHARS_PER_SECOND = 100

  useEffect(() => {
    // If loaded from history, show everything immediately
    if (wasInitiallyNotStreamingRef.current) {
      setRevealedCount(text.length)
      prevTextLengthRef.current = text.length
      return
    }

    // If text grew, animate the new characters
    if (text.length > revealedCount) {
      const newChars = text.length - revealedCount
      const animationDuration = (newChars / CHARS_PER_SECOND) * 1000
      const interval = animationDuration / newChars

      let currentCount = revealedCount
      let scrollCounter = 0
      const timer = setInterval(() => {
        currentCount++
        scrollCounter++
        if (currentCount >= text.length) {
          setRevealedCount(text.length)
          clearInterval(timer)
          onUpdate?.()
        } else {
          setRevealedCount(currentCount)
          // Trigger scroll every 10 characters
          if (scrollCounter % 10 === 0) {
            onUpdate?.()
          }
        }
      }, interval)

      return () => clearInterval(timer)
    }

    prevTextLengthRef.current = text.length
  }, [text, revealedCount, onUpdate])

  // Split text into characters for animation
  // Only animate the last N characters for performance
  const MAX_ANIMATED_CHARS = 50
  const animationStartIndex = Math.max(0, revealedCount - MAX_ANIMATED_CHARS)

  // Show cursor while streaming or animating
  const showCursor = isStreaming || revealedCount < text.length

  return (
    <span className="inline">
      {/* Already revealed text (no animation) */}
      {animationStartIndex > 0 && (
        <span>{text.slice(0, animationStartIndex)}</span>
      )}
      {/* Animated characters */}
      {text.slice(animationStartIndex, revealedCount).split('').map((char, i) => {
        const globalIndex = animationStartIndex + i
        const isRecent = globalIndex >= revealedCount - 10 // Only animate last 10 chars

        if (!isRecent) {
          return <span key={globalIndex}>{char}</span>
        }

        return (
          <motion.span
            key={globalIndex}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.12,
              ease: [0.25, 0.1, 0.25, 1], // Smooth ease-out
            }}
            style={{ display: 'inline' }}
          >
            {char}
          </motion.span>
        )
      })}
      {/* Cursor */}
      {showCursor && (
        <motion.span
          className="inline-block w-[2px] h-[1.1em] bg-foreground/60 ml-[1px] align-middle"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </span>
  )
}

export function ChatInterface({
  messages,
  isConnected,
  isLoading,
  streamingStatus,
  elapsedTime = 0,
  files,
  onSendMessage,
  onStopGeneration,
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingStatus, scrollToBottom])

  return (
    <ScrollContext.Provider value={{ scrollToBottom }}>
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <ScrollArea className="flex-1 p-4 min-h-0" ref={scrollRef}>
        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-base">
                Upload some files and start chatting to analyze your documents.
              </p>
            </div>
          )}
          {messages.map((message, index) => {
            // Show timer on the last assistant message
            const isLastMessage = index === messages.length - 1
            const showTimer = message.role === 'assistant' && isLastMessage && elapsedTime > 0
            return (
              <MessageBubble
                key={message.id}
                message={message}
                elapsedTime={showTimer ? elapsedTime : undefined}
                isTimerActive={showTimer && isLoading}
              />
            )
          })}
          {/* Streaming Status Indicator */}
          {streamingStatus?.isActive && streamingStatus.currentTool && (
            <StreamingIndicator
              tool={streamingStatus.currentTool}
              toolInput={streamingStatus.toolInput}
            />
          )}
          {/* Loading skeleton when waiting but no streaming status */}
          {isLoading && !streamingStatus?.isActive && messages.length > 0 && !messages[messages.length - 1]?.isStreaming && (
            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            </div>
          )}
          {/* Scroll anchor */}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input Card - TipTap based with atomic file mentions */}
      <div className="p-4">
        <div className="max-w-3xl mx-auto">
          <TipTapChatInput
            files={files}
            isConnected={isConnected}
            isLoading={isLoading}
            onSendMessage={onSendMessage}
            onStopGeneration={onStopGeneration}
          />
        </div>
      </div>
    </div>
    </ScrollContext.Provider>
  )
}

function MessageBubble({ message, elapsedTime, isTimerActive }: { message: Message; elapsedTime?: number; isTimerActive?: boolean }) {
  const isUser = message.role === 'user'
  const { scrollToBottom } = useContext(ScrollContext)
  // Initialize with the message content for non-streaming messages
  const [displayedContent, setDisplayedContent] = useState(message.isStreaming ? '' : message.content)
  const [_isTyping, setIsTyping] = useState(false)
  const previousContentRef = useRef(message.isStreaming ? '' : message.content)
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Typing animation effect for streaming messages
  useEffect(() => {
    // Clean up any existing animation
    if (animationRef.current) {
      clearTimeout(animationRef.current)
      animationRef.current = null
    }

    if (isUser) {
      setDisplayedContent(message.content)
      return
    }

    // If message is complete (not streaming), show full content immediately
    if (!message.isStreaming) {
      setDisplayedContent(message.content)
      setIsTyping(false)
      previousContentRef.current = message.content
      return
    }

    // For streaming messages, animate new content
    const newContent = message.content
    const previousContent = previousContentRef.current

    // If content hasn't changed, do nothing
    if (newContent === previousContent) return

    // Find what's new
    const newPart = newContent.slice(previousContent.length)
    if (!newPart) {
      setDisplayedContent(newContent)
      previousContentRef.current = newContent
      return
    }

    // Animate the new content word by word
    setIsTyping(true)
    const words = newPart.split(/(\s+)/) // Split but keep whitespace
    let currentIndex = 0

    const typeNextWord = () => {
      if (currentIndex < words.length) {
        setDisplayedContent(prev => prev + words[currentIndex])
        currentIndex++
        // Faster for whitespace, slower for words
        const delay = words[currentIndex - 1]?.trim() ? 30 : 5
        animationRef.current = setTimeout(typeNextWord, delay)
      } else {
        setIsTyping(false)
        previousContentRef.current = newContent
        animationRef.current = null
      }
    }

    typeNextWord()

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current)
      }
    }
  }, [message.content, message.isStreaming, isUser])

  if (isUser) {
    // Parse out referenced files from content (for historical messages loaded from backend)
    let displayContent = message.content

    // Check if content has the [REFERENCED FILES] block - remove it, files are shown inline
    const refMatch = message.content.match(/\[REFERENCED FILES\][\s\S]*?\[END REFERENCED FILES\]\s*/g)
    if (refMatch) {
      // Remove the entire block from display content
      displayContent = message.content.replace(/\[REFERENCED FILES\][\s\S]*?\[END REFERENCED FILES\]\s*/g, '').trim()
    }

    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[85%] rounded-xl px-4 py-3 bg-primary text-primary-foreground">
          <p className="text-base whitespace-pre-wrap leading-relaxed">
            {renderTextWithMentions(displayContent)}
          </p>
        </div>
      </div>
    )
  }

  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0

  // Render content blocks in order (text and tool calls interleaved)
  const renderContentBlocks = () => {
    if (!hasContentBlocks) {
      // Fallback for legacy messages without contentBlocks
      const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
      return (
        <>
          {hasToolCalls && (
            <div className="space-y-2">
              {message.toolCalls!.map((toolCall) => (
                <ToolCallItem key={toolCall.id} toolCall={toolCall} />
              ))}
            </div>
          )}
          <div>
            {message.isStreaming && !displayedContent ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoadingDots />
                <span>Thinking...</span>
              </div>
            ) : (
              <p className="text-base whitespace-pre-wrap leading-relaxed text-foreground">{displayedContent}</p>
            )}
          </div>
        </>
      )
    }

    // Render content blocks in chronological order
    // Always use StreamingText for text blocks - it handles animation internally
    // and will show text immediately for messages loaded from history
    return message.contentBlocks!.map((block, index) => {
      if (block.type === 'text' && block.text) {
        return (
          <div key={`text-${index}`}>
            <p className="text-base whitespace-pre-wrap leading-relaxed text-foreground">
              <StreamingText text={block.text} isStreaming={message.isStreaming || false} onUpdate={scrollToBottom} />
            </p>
          </div>
        )
      } else if (block.type === 'tool_call' && block.toolCall) {
        return <ToolCallItem key={block.toolCall.id} toolCall={block.toolCall} />
      }
      return null
    })
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-3">
        {renderContentBlocks()}
        {elapsedTime !== undefined && (
          <ResponseTimer elapsedTime={elapsedTime} isActive={isTimerActive} />
        )}
      </div>
    </div>
  )
}

function StreamingIndicator({ tool, toolInput }: { tool: string; toolInput?: Record<string, unknown> }) {
  // Format tool name for display
  const formatToolName = (name: string) => {
    // Remove prefixes like "mcp__tools__"
    const cleaned = name.replace(/^mcp__\w+__/, '')
    // Convert snake_case to Title Case
    return cleaned
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Format tool input for display (show key fields only)
  const formatToolInput = (input?: Record<string, unknown>) => {
    if (!input) return null
    const entries = Object.entries(input)
    if (entries.length === 0) return null

    // Show only first 2 key-value pairs to keep it concise
    const preview = entries.slice(0, 2).map(([key, value]) => {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
      const truncated = valueStr.length > 40 ? valueStr.slice(0, 40) + '...' : valueStr
      return `${key}: ${truncated}`
    })

    return preview.join(', ')
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 rounded-lg p-3 bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2">
          <ToolIcon />
          <span className="text-sm font-medium text-foreground">
            {formatToolName(tool)}
          </span>
          <LoadingDots />
        </div>
        {toolInput && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {formatToolInput(toolInput)}
          </p>
        )}
      </div>
    </div>
  )
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

// Response Timer - shows elapsed time at the bottom of the agent's response
function ResponseTimer({ elapsedTime, isActive }: { elapsedTime: number; isActive?: boolean }) {
  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes > 0) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
    }
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
      <span className="font-mono">{formatElapsedTime(elapsedTime)}</span>
    </div>
  )
}

function SuccessDot() {
  return (
    <span className="w-2 h-2 bg-green-500 rounded-full" />
  )
}

// Inline tool call display - shows tool name, input, and result
function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Format tool name for display
  const formatToolName = (name: string) => {
    // Remove prefixes like "mcp__tools__"
    const cleaned = name.replace(/^mcp__\w+__/, '')
    // Convert snake_case to Title Case
    return cleaned
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Format tool input for compact display
  const formatToolInput = (input: Record<string, unknown>) => {
    const entries = Object.entries(input)
    if (entries.length === 0) return ''

    // Show key params briefly
    const preview = entries.slice(0, 2).map(([key, value]) => {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
      const truncated = valueStr.length > 30 ? valueStr.slice(0, 30) + '...' : valueStr
      return `${key}: ${truncated}`
    })

    return preview.join(', ')
  }

  const statusIcon = <SuccessDot />

  return (
    <div className="rounded-md border border-border bg-muted/30 text-sm">
      {/* Tool header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {statusIcon}
        <span className="font-medium text-foreground">{formatToolName(toolCall.tool)}</span>
        <span className="text-muted-foreground text-xs truncate flex-1">
          {formatToolInput(toolCall.input)}
        </span>
        <ChevronIcon expanded={isExpanded} />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border/50">
          {/* Input */}
          <div className="pt-2">
            <p className="text-xs text-muted-foreground mb-1">Input:</p>
            <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {/* Result (if available) */}
          {toolCall.result && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {toolCall.isError ? 'Error:' : 'Result:'}
              </p>
              <pre className={`text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap ${
                toolCall.isError ? 'bg-red-500/10 text-red-400' : 'bg-background/50'
              }`}>
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ToolIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

