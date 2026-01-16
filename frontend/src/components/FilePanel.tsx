import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Image,
  Sheet,
  FileSpreadsheet,
  FileCode,
  FileJson,
  File,
  Upload,
  Plus,
  MoreVertical,
  Eye,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FileInfo } from '@/lib/api'
import { getFileContentUrl } from '@/lib/api'
import { cn } from '@/lib/utils'

// File type to icon mapping (minimal monochrome style)
const FILE_TYPE_ICONS: Record<string, typeof File> = {
  // Documents
  pdf: FileText,
  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  webp: Image,
  svg: Image,
  // Spreadsheets
  xlsx: Sheet,
  xls: Sheet,
  csv: FileSpreadsheet,
  // Text/Markdown
  txt: FileText,
  md: FileText,
  // Code files
  js: FileCode,
  ts: FileCode,
  jsx: FileCode,
  tsx: FileCode,
  json: FileJson,
  html: FileCode,
  css: FileCode,
  xml: FileCode,
  // Office documents
  docx: FileText,
  doc: FileText,
}

// Animation variants
const dropZoneVariants = {
  idle: {
    borderColor: 'hsl(var(--muted-foreground) / 0.25)',
    boxShadow: '0 0 0 0 hsl(var(--primary) / 0)',
  },
  dragging: {
    borderColor: 'hsl(var(--primary))',
    boxShadow: [
      '0 0 0 0 hsl(var(--primary) / 0.4)',
      '0 0 0 8px hsl(var(--primary) / 0)',
    ],
    transition: {
      boxShadow: {
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeOut',
      },
      borderColor: {
        duration: 0.2,
      },
    },
  },
}

const uploadIconVariants = {
  idle: { y: 0, scale: 1 },
  dragging: {
    y: [-4, 0, -4],
    scale: 1.1,
    transition: {
      y: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
      scale: { duration: 0.2 },
    },
  },
}

const fileListContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
}

const fileItemVariants = {
  hidden: {
    opacity: 0,
    x: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.25,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    scale: 0.95,
    transition: {
      duration: 0.2,
      ease: 'easeIn',
    },
  },
}

interface FilePanelProps {
  files: FileInfo[]
  sessionId: string | null
  onUpload: (files: File[]) => Promise<void>
  onDelete: (fileId: string) => Promise<void>
  width: number
  onWidthChange: (width: number) => void
}

// File Type Icon Component (minimal monochrome style)
function FileTypeIcon({ filename, className }: { filename: string; className?: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const Icon = FILE_TYPE_ICONS[ext] || File

  return (
    <Icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', className)} />
  )
}

// File Item Component
function FileItem({
  file,
  onPreview,
  onDelete,
}: {
  file: FileInfo
  onPreview: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      layout
      variants={fileItemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-accent group cursor-pointer transition-colors"
      onClick={onPreview}
    >
      <FileTypeIcon filename={file.name} />

      <div className="min-w-0 flex-1">
        <p className="text-sm truncate font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(file.size)}
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted-foreground/20 border border-transparent hover:border-border transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onPreview}>
              <Eye className="h-4 w-4 mr-2" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </motion.div>
  )
}

export function FilePanel({ files, sessionId, onUpload, onDelete, width, onWidthChange }: FilePanelProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) {
      setIsUploading(true)
      try {
        await onUpload(droppedFiles)
      } finally {
        setIsUploading(false)
      }
    }
  }, [onUpload])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length > 0) {
      setIsUploading(true)
      try {
        await onUpload(selectedFiles)
      } finally {
        setIsUploading(false)
      }
    }
    e.target.value = ''
  }, [onUpload])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeRef.current = { startX: e.clientX, startWidth: width }

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const delta = resizeRef.current.startX - e.clientX
        const newWidth = Math.max(200, Math.min(500, resizeRef.current.startWidth + delta))
        onWidthChange(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width, onWidthChange])

  const getFileExtension = (name: string) => name.split('.').pop()?.toLowerCase() || ''

  const isImageFile = (name: string) => {
    const ext = getFileExtension(name)
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
  }

  const isPdfFile = (name: string) => getFileExtension(name) === 'pdf'

  const isTextFile = (name: string) => {
    const ext = getFileExtension(name)
    return ['txt', 'md', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts'].includes(ext)
  }

  return (
    <>
      <div
        className="border-l border-border flex flex-col bg-card relative"
        style={{ width: `${width}px`, minWidth: `${width}px` }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length === 0 ? (
          /* Empty state - animated drop zone */
          <div className="flex-1 flex items-center justify-center p-3">
            <motion.div
              className={cn(
                'w-full p-6 border-2 border-dashed rounded-xl relative overflow-hidden',
                isUploading && 'opacity-50 pointer-events-none'
              )}
              variants={dropZoneVariants}
              animate={isDragging ? 'dragging' : 'idle'}
            >
              {/* Background gradient glow when dragging */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: isDragging ? 1 : 0 }}
                transition={{ duration: 0.2 }}
              />

              <div className="text-center relative z-10">
                <motion.div
                  variants={uploadIconVariants}
                  animate={isDragging ? 'dragging' : 'idle'}
                  className="mx-auto w-fit"
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                </motion.div>

                <p className="text-sm text-muted-foreground mt-3 mb-3">
                  {isUploading ? 'Uploading...' : 'Drag & drop files here'}
                </p>

                <label>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp"
                    disabled={isUploading}
                  />
                  <Button variant="outline" size="sm" asChild disabled={isUploading}>
                    <span className="cursor-pointer">Browse Files</span>
                  </Button>
                </label>
              </div>
            </motion.div>
          </div>
        ) : (
          /* Has files - animated list */
          <>
            {/* File List */}
            <ScrollArea className="flex-1 px-3 pt-3">
              <motion.div
                className="space-y-1"
                variants={fileListContainerVariants}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence mode="popLayout">
                  {files.map((file) => (
                    <FileItem
                      key={file.id}
                      file={file}
                      onPreview={() => setPreviewFile(file)}
                      onDelete={() => onDelete(file.id)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </ScrollArea>

            {/* Animated drag overlay */}
            <AnimatePresence>
              {isDragging && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 m-2 rounded-xl z-10 pointer-events-none"
                >
                  <motion.div
                    className="absolute inset-0 rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[2px]"
                    animate={{
                      boxShadow: [
                        'inset 0 0 20px 0 hsl(var(--primary) / 0.1)',
                        'inset 0 0 40px 0 hsl(var(--primary) / 0.2)',
                        'inset 0 0 20px 0 hsl(var(--primary) / 0.1)',
                      ],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.p
                      className="text-sm text-primary font-medium"
                      animate={{ y: [-2, 2, -2] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      Drop files here
                    </motion.p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className="px-3 py-3 border-t border-border">
              <label className="block">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp"
                  disabled={isUploading}
                />
                <Button variant="outline" size="sm" className="w-full" asChild disabled={isUploading}>
                  <span className="cursor-pointer">
                    <Plus className="h-4 w-4 mr-2" />
                    Add More Files
                  </span>
                </Button>
              </label>
              <p className="text-xs text-muted-foreground text-center mt-2">
                {files.length} file{files.length !== 1 ? 's' : ''} uploaded
              </p>
            </div>
          </>
        )}

        {/* Resize Handle */}
        <div
          className={cn(
            'absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/50 transition-colors',
            isResizing && 'bg-primary/50'
          )}
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{previewFile?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {previewFile && sessionId && (
              <FilePreview
                file={previewFile}
                sessionId={sessionId}
                isImage={isImageFile(previewFile.name)}
                isPdf={isPdfFile(previewFile.name)}
                isText={isTextFile(previewFile.name)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FilePreview({
  file,
  sessionId,
  isImage,
  isPdf,
  isText
}: {
  file: FileInfo
  sessionId: string
  isImage: boolean
  isPdf: boolean
  isText: boolean
}) {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contentUrl = getFileContentUrl(sessionId, file.id)

  // Load text content if it's a text file
  if (isText && textContent === null && !loading && !error) {
    setLoading(true)
    fetch(contentUrl)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file')
        return res.text()
      })
      .then(text => {
        setTextContent(text)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }

  if (isImage) {
    return (
      <div className="flex items-center justify-center p-4 bg-muted/30 rounded-lg">
        <img
          src={contentUrl}
          alt={file.name}
          className="max-w-full max-h-[70vh] object-contain rounded"
        />
      </div>
    )
  }

  if (isPdf) {
    return (
      <iframe
        src={contentUrl}
        className="w-full h-[70vh] rounded border border-border"
        title={file.name}
      />
    )
  }

  if (isText) {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex items-center justify-center p-8">
          <p className="text-destructive">{error}</p>
        </div>
      )
    }
    return (
      <pre className="p-4 bg-muted/30 rounded-lg text-sm overflow-auto max-h-[70vh] whitespace-pre-wrap font-mono">
        {textContent}
      </pre>
    )
  }

  // Fallback for unsupported file types
  return (
    <div className="flex flex-col items-center justify-center p-8 gap-4">
      <p className="text-muted-foreground">Preview not available for this file type</p>
      <a
        href={contentUrl}
        download={file.name}
        className="text-primary hover:underline"
      >
        Download file
      </a>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
