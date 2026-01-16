import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { motion, AnimatePresence } from 'framer-motion'
import { FileMention } from './FileMentionExtension'
import './TipTapChatInput.css'
import { Button } from '@/components/ui/button'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileInfo } from '@/lib/api'

// File type icon mapping
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type ModelOption = 'opus-4.5' | 'sonnet-4'

const MODEL_LABELS: Record<ModelOption, string> = {
  'opus-4.5': 'Opus 4.5',
  'sonnet-4': 'Sonnet 4',
}

interface FileMentionData {
  fileId: string
  fileName: string
}

interface TipTapChatInputProps {
  files: FileInfo[]
  isConnected: boolean
  isLoading: boolean
  elapsedTime?: number
  onSendMessage: (content: string, fileMentions?: FileMentionData[]) => void
  onStopGeneration?: () => void
}

export function TipTapChatInput({
  files,
  isConnected,
  isLoading,
  elapsedTime = 0,
  onSendMessage,
  onStopGeneration,
}: TipTapChatInputProps) {
  const [selectedModel, setSelectedModel] = useState<ModelOption>('opus-4.5')
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [selectedDropdownIndex, setSelectedDropdownIndex] = useState(0)
  const [mentionPosition, setMentionPosition] = useState<{ from: number; to: number } | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Static placeholder text
  const placeholderText = 'Message the agent, @ to reference files...'

  // TipTap editor setup
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable features we don't need for a chat input
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      FileMention,
      Placeholder.configure({
        placeholder: placeholderText,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[24px] max-h-[200px] overflow-y-auto text-sm text-foreground',
      },
      handleKeyDown: (_view, event) => {
        // Handle dropdown navigation when visible
        if (showMentionDropdown && filteredFiles.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelectedDropdownIndex((prev) =>
              prev < filteredFiles.length - 1 ? prev + 1 : 0
            )
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelectedDropdownIndex((prev) =>
              prev > 0 ? prev - 1 : filteredFiles.length - 1
            )
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            selectMention(filteredFiles[selectedDropdownIndex])
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setShowMentionDropdown(false)
            return true
          }
        }

        // Handle Enter to submit (without shift)
        if (event.key === 'Enter' && !event.shiftKey && !showMentionDropdown) {
          event.preventDefault()
          handleSubmit()
          return true
        }

        return false
      },
    },
    onUpdate: ({ editor }) => {
      // Detect @ mentions
      const { state } = editor
      const { selection } = state
      const { $from } = selection

      // Get text before cursor
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
      const lastAtIndex = textBefore.lastIndexOf('@')

      if (lastAtIndex !== -1) {
        // Check if @ is at start or after a space
        const charBeforeAt = lastAtIndex > 0 ? textBefore[lastAtIndex - 1] : ' '
        if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) {
          const query = textBefore.slice(lastAtIndex + 1)
          // Only show dropdown if query doesn't contain spaces
          if (!query.includes(' ') && files.length > 0) {
            setMentionQuery(query)
            setMentionPosition({
              from: $from.pos - ($from.parentOffset - lastAtIndex),
              to: $from.pos,
            })
            setShowMentionDropdown(true)
            return
          }
        }
      }

      setShowMentionDropdown(false)
      setMentionQuery('')
      setMentionPosition(null)
    },
  })

  // Update placeholder when connection state or files change
  useEffect(() => {
    if (editor) {
      editor.extensionManager.extensions.forEach((extension) => {
        if (extension.name === 'placeholder') {
          // @ts-expect-error - accessing internal options
          extension.options.placeholder = placeholderText
          editor.view.dispatch(editor.state.tr)
        }
      })
    }
  }, [editor, placeholderText])

  // Filter files based on mention query
  const filteredFiles = files.filter((file) => {
    // Check if file is already mentioned
    if (editor) {
      let alreadyMentioned = false
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'fileMention' && node.attrs.id === file.id) {
          alreadyMentioned = true
        }
      })
      if (alreadyMentioned) return false
    }
    return file.name.toLowerCase().includes(mentionQuery.toLowerCase())
  })

  // Reset dropdown index when filtered files change
  useEffect(() => {
    setSelectedDropdownIndex(0)
  }, [mentionQuery])

  // Select a file from the mention dropdown
  const selectMention = useCallback(
    (file: FileInfo) => {
      if (!editor || !mentionPosition) return

      // Delete the @query text and insert the mention node
      editor
        .chain()
        .focus()
        .deleteRange({ from: mentionPosition.from, to: mentionPosition.to })
        .insertFileMention({ id: file.id, label: file.name })
        .run()

      setShowMentionDropdown(false)
      setMentionQuery('')
      setMentionPosition(null)
    },
    [editor, mentionPosition]
  )

  // Extract file mentions from editor content
  const getFileMentions = useCallback((): FileMentionData[] => {
    if (!editor) return []

    const mentions: FileMentionData[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'fileMention') {
        mentions.push({
          fileId: node.attrs.id,
          fileName: node.attrs.label,
        })
      }
    })
    return mentions
  }, [editor])

  // Get plain text with @[filename] syntax for backend
  const getTextContent = useCallback((): string => {
    if (!editor) return ''

    let text = ''
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) {
        text += node.text
      } else if (node.type.name === 'fileMention') {
        text += `@[${node.attrs.label}]`
      } else if (node.type.name === 'paragraph' && pos > 0) {
        text += '\n'
      }
    })
    return text.trim()
  }, [editor])

  const handleSubmit = useCallback(() => {
    if (!editor || isLoading || !isConnected) return

    const content = getTextContent()
    if (!content.trim()) return

    const mentions = getFileMentions()
    onSendMessage(content, mentions.length > 0 ? mentions : undefined)

    // Clear editor
    editor.commands.clearContent()
  }, [editor, isLoading, isConnected, getTextContent, getFileMentions, onSendMessage])

  // Format elapsed time
  const formatElapsedTime = (ms: number): string => {
    return (ms / 1000).toFixed(1) + 's'
  }

  return (
    <div className="bg-muted/50 rounded-xl border border-border relative">
      {/* Editor */}
      <div className="p-3 pb-0">
        <EditorContent
          editor={editor}
          disabled={isLoading || !isConnected}
          className="prose prose-sm max-w-none"
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
            <span
              className={`text-xs font-mono ${isLoading ? 'text-primary' : 'text-muted-foreground'}`}
            >
              {formatElapsedTime(elapsedTime)}
            </span>
          )}
        </div>

        {/* Right side - model picker and send/stop button */}
        <div className="flex items-center gap-2">
          {/* Model Picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
              >
                {MODEL_LABELS[selectedModel]}
                <ChevronDownIcon className="ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={selectedModel}
                onValueChange={(v) => setSelectedModel(v as ModelOption)}
              >
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
              disabled={!isConnected}
              onClick={handleSubmit}
              title="Send message"
            >
              <SendIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
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
