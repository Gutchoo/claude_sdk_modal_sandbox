import { useState, useRef, useEffect, createContext, useContext, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  Image,
  Sheet,
  FileSpreadsheet,
  FileCode,
  FileJson,
  File,
  X,
} from 'lucide-react'
import type { Message, StreamingStatus, ToolCall } from '@/hooks/useWebSocket'
import type { FileInfo } from '@/lib/api'
import { cn } from '@/lib/utils'

// Context for scroll functionality
const ScrollContext = createContext<{ scrollToBottom: () => void }>({ scrollToBottom: () => {} })

// File mention interface
interface FileMention {
  fileId: string
  fileName: string
}

// File type icon mapping (simplified version from FilePanel)
const FILE_TYPE_ICONS: Record<string, { icon: typeof File; color: string }> = {
  pdf: { icon: FileText, color: 'text-red-500' },
  png: { icon: Image, color: 'text-emerald-500' },
  jpg: { icon: Image, color: 'text-emerald-500' },
  jpeg: { icon: Image, color: 'text-emerald-500' },
  gif: { icon: Image, color: 'text-emerald-500' },
  webp: { icon: Image, color: 'text-emerald-500' },
  svg: { icon: Image, color: 'text-amber-500' },
  xlsx: { icon: Sheet, color: 'text-green-600' },
  xls: { icon: Sheet, color: 'text-green-600' },
  csv: { icon: FileSpreadsheet, color: 'text-green-500' },
  txt: { icon: FileText, color: 'text-slate-500' },
  md: { icon: FileText, color: 'text-blue-400' },
  js: { icon: FileCode, color: 'text-yellow-500' },
  ts: { icon: FileCode, color: 'text-blue-500' },
  json: { icon: FileJson, color: 'text-amber-400' },
  docx: { icon: FileText, color: 'text-blue-600' },
  doc: { icon: FileText, color: 'text-blue-600' },
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return FILE_TYPE_ICONS[ext] || { icon: File, color: 'text-muted-foreground' }
}

type ModelOption = 'opus-4.5' | 'sonnet-4'

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

// Format elapsed time in seconds with one decimal
function formatElapsedTime(ms: number): string {
  return (ms / 1000).toFixed(1) + 's'
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

const MODEL_LABELS: Record<ModelOption, string> = {
  'opus-4.5': 'Opus 4.5',
  'sonnet-4': 'Sonnet 4',
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
  const [input, setInput] = useState('')
  const [selectedModel, setSelectedModel] = useState<ModelOption>('opus-4.5')
  const [mentions, setMentions] = useState<FileMention[]>([])
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(-1) // Position of @ in input
  const [selectedDropdownIndex, setSelectedDropdownIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingStatus, scrollToBottom])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    }
  }, [input])

  // Filter files based on mention query (exclude already mentioned files)
  const filteredFiles = files.filter(
    (file) =>
      file.name.toLowerCase().includes(mentionQuery.toLowerCase()) &&
      !mentions.some((m) => m.fileId === file.id)
  )

  // Reset dropdown index when filtered files change
  useEffect(() => {
    setSelectedDropdownIndex(0)
  }, [mentionQuery])

  // Handle input changes and detect @ mentions
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    const cursorPos = e.target.selectionStart || 0
    setInput(text)

    // Find the last @ before cursor
    const textBeforeCursor = text.substring(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      // Check if there's a space before @ (or @ is at start)
      const charBeforeAt = lastAtIndex > 0 ? text[lastAtIndex - 1] : ' '
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) {
        const query = textBeforeCursor.substring(lastAtIndex + 1)
        // Only show dropdown if query doesn't contain spaces (still typing filename)
        if (!query.includes(' ') && files.length > 0) {
          setMentionQuery(query)
          setMentionIndex(lastAtIndex)
          setShowMentionDropdown(true)
          return
        }
      }
    }

    setShowMentionDropdown(false)
    setMentionQuery('')
    setMentionIndex(-1)
  }

  // Select a file from the mention dropdown
  const selectMention = useCallback((file: FileInfo) => {
    const mention: FileMention = {
      fileId: file.id,
      fileName: file.name,
    }

    // Replace @query with empty string (we'll show pills separately)
    const beforeMention = input.substring(0, mentionIndex)
    const afterMention = input.substring(mentionIndex + 1 + mentionQuery.length)
    const newInput = beforeMention + afterMention

    setInput(newInput)
    setMentions((prev) => [...prev, mention])
    setShowMentionDropdown(false)
    setMentionQuery('')
    setMentionIndex(-1)

    // Focus back on textarea
    textareaRef.current?.focus()
  }, [input, mentionIndex, mentionQuery])

  // Remove a mention
  const removeMention = (fileId: string) => {
    setMentions((prev) => prev.filter((m) => m.fileId !== fileId))
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!input.trim() || isLoading || !isConnected) return

    // Send message with file mentions
    onSendMessage(input.trim(), mentions.length > 0 ? mentions : undefined)
    setInput('')
    setMentions([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle dropdown navigation when visible
    if (showMentionDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedDropdownIndex((prev) =>
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedDropdownIndex((prev) =>
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        )
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(filteredFiles[selectedDropdownIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionDropdown(false)
        return
      }
    }

    // Normal enter behavior (submit)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

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
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
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
        </div>
      </ScrollArea>

      {/* Input Card */}
      <div className="p-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-muted/50 rounded-xl border border-border relative">
            {/* Mention Pills */}
            {mentions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                <AnimatePresence mode="popLayout">
                  {mentions.map((mention) => {
                    const { icon: Icon, color } = getFileIcon(mention.fileName)
                    return (
                      <motion.div
                        key={mention.fileId}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 text-primary rounded-md text-xs font-medium"
                      >
                        <Icon className={cn('h-3.5 w-3.5', color)} />
                        <span className="truncate max-w-[150px]">{mention.fileName}</span>
                        <button
                          onClick={() => removeMention(mention.fileId)}
                          className="hover:bg-primary/20 rounded p-0.5 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}

            {/* Textarea */}
            <div className="p-3 pb-0">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? (files.length > 0 ? 'Type @ to reference files...' : 'Reply...') : 'Connecting...'}
                disabled={isLoading || !isConnected}
                rows={1}
                className="w-full bg-transparent border-0 resize-none focus:outline-none text-foreground placeholder:text-muted-foreground text-sm min-h-[24px] max-h-[200px]"
              />
            </div>

            {/* Mention Dropdown */}
            <AnimatePresence>
              {showMentionDropdown && filteredFiles.length > 0 && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-3 right-3 mb-2 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50"
                >
                  <div className="p-1 max-h-[200px] overflow-y-auto">
                    {filteredFiles.slice(0, 8).map((file, index) => {
                      const { icon: Icon, color } = getFileIcon(file.name)
                      const isSelected = index === selectedDropdownIndex
                      return (
                        <button
                          key={file.id}
                          onClick={() => selectMention(file)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors',
                            isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', color)} />
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            {formatFileSize(file.size)}
                          </span>
                        </button>
                      )
                    })}
                    {filteredFiles.length > 8 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        +{filteredFiles.length - 8} more files
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom bar */}
            <div className="flex items-center justify-between px-3 py-2">
              {/* Left side - elapsed time */}
              <div className="flex items-center gap-2">
                {elapsedTime > 0 && (
                  <span className={`text-xs font-mono ${isLoading ? 'text-primary' : 'text-muted-foreground'}`}>
                    {formatElapsedTime(elapsedTime)}
                  </span>
                )}
              </div>

              {/* Right side - model picker and send/stop button */}
              <div className="flex items-center gap-2">
                {/* Model Picker */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground">
                      {MODEL_LABELS[selectedModel]}
                      <ChevronDownIcon className="ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup value={selectedModel} onValueChange={(v) => setSelectedModel(v as ModelOption)}>
                      <DropdownMenuRadioItem value="opus-4.5">Opus 4.5</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="sonnet-4">Sonnet 4</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Send or Stop button */}
                {isLoading ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg bg-muted hover:bg-muted-foreground/20"
                    onClick={onStopGeneration}
                    title="Stop generation"
                  >
                    <StopIcon />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8 rounded-lg"
                    disabled={!input.trim() || !isConnected}
                    onClick={() => handleSubmit()}
                    title="Send message"
                  >
                    <SendIcon />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </ScrollContext.Provider>
  )
}

function MessageBubble({ message }: { message: Message }) {
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
    // Parse out referenced files from content (for historical messages)
    let displayContent = message.content
    let referencedFileNames: string[] = []

    // Check if content has the [REFERENCED FILES] block and extract filenames
    const refMatch = message.content.match(/\[REFERENCED FILES\][\s\S]*?- \/data\/(.+?)[\s\S]*?\[END REFERENCED FILES\]\s*/g)
    if (refMatch) {
      // Extract all filenames from the block
      const fileMatches = message.content.match(/- \/data\/(.+)/g)
      if (fileMatches) {
        referencedFileNames = fileMatches.map(m => m.replace('- /data/', ''))
      }
      // Remove the entire block from display content
      displayContent = message.content.replace(/\[REFERENCED FILES\][\s\S]*?\[END REFERENCED FILES\]\s*/g, '').trim()
    }

    // Use fileMentions if available (for new messages), otherwise use parsed filenames
    const fileNames = message.fileMentions
      ? message.fileMentions.map(m => m.fileName)
      : referencedFileNames

    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[85%] rounded-xl px-4 py-3 bg-primary text-primary-foreground">
          <p className="text-base whitespace-pre-wrap leading-relaxed">{displayContent}</p>
          {/* File references shown below message */}
          {fileNames.length > 0 && (
            <p className="text-xs mt-2 opacity-75">
              Reference: {fileNames.map((name, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <span className="font-medium">{name}</span>
                </span>
              ))}
            </p>
          )}
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

function ChevronDownIcon({ className }: { className?: string }) {
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
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
