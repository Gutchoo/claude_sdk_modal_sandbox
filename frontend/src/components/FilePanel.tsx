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

// Floating particle component for the dropzone
function FloatingParticle({
  index,
  isDragging
}: {
  index: number
  isDragging: boolean
}) {
  const baseDelay = index * 0.15
  const size = 3 + (index % 3)
  const initialX = 20 + (index * 37) % 60
  const initialY = 20 + (index * 23) % 60

  return (
    <motion.div
      className="absolute rounded-full bg-foreground/10 dark:bg-foreground/20"
      style={{
        width: size,
        height: size,
        left: `${initialX}%`,
        top: `${initialY}%`,
      }}
      animate={isDragging ? {
        y: [0, -12, 0],
        x: [0, (index % 2 === 0 ? 6 : -6), 0],
        scale: [1, 1.5, 1],
        opacity: [0.3, 0.8, 0.3],
      } : {
        y: [0, -4, 0],
        opacity: [0.15, 0.25, 0.15],
      }}
      transition={{
        duration: isDragging ? 1.5 : 3,
        repeat: Infinity,
        delay: baseDelay,
        ease: "easeInOut",
      }}
    />
  )
}

// Animated border gradient component
function AnimatedBorderGradient({ isDragging }: { isDragging: boolean }) {
  return (
    <motion.div
      className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: isDragging ? 1 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="absolute inset-[-2px] rounded-xl"
        style={{
          background: 'conic-gradient(from 0deg, transparent, hsl(var(--foreground) / 0.4), transparent, hsl(var(--foreground) / 0.2), transparent)',
        }}
        animate={{
          rotate: [0, 360],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "linear",
        }}
      />
      <div className="absolute inset-[1px] rounded-xl bg-card" />
    </motion.div>
  )
}

// Ripple effect on successful drop
function DropRipple({ isActive }: { isActive: boolean }) {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute w-16 h-16 rounded-full border border-foreground/30"
              initial={{ scale: 0.5, opacity: 0.8 }}
              animate={{ scale: 3, opacity: 0 }}
              transition={{
                duration: 0.8,
                delay: i * 0.15,
                ease: "easeOut",
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Upload icon with sophisticated animation
function AnimatedUploadIcon({ isDragging, isUploading }: { isDragging: boolean; isUploading: boolean }) {
  return (
    <div className="relative w-14 h-14 mx-auto">
      {/* Outer glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={isDragging ? {
          boxShadow: [
            '0 0 0 0 hsl(var(--foreground) / 0)',
            '0 0 0 8px hsl(var(--foreground) / 0.1)',
            '0 0 0 0 hsl(var(--foreground) / 0)',
          ],
        } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
      />

      {/* Icon container with glass effect */}
      <motion.div
        className="absolute inset-0 rounded-full bg-muted/50 dark:bg-muted/30 backdrop-blur-sm border border-border/50 flex items-center justify-center"
        animate={isDragging ? {
          scale: [1, 1.08, 1],
          borderColor: ['hsl(var(--border) / 0.5)', 'hsl(var(--foreground) / 0.3)', 'hsl(var(--border) / 0.5)'],
        } : {
          scale: 1,
        }}
        transition={{
          duration: 1.5,
          repeat: isDragging ? Infinity : 0,
          ease: "easeInOut",
        }}
      >
        <motion.div
          animate={isDragging ? {
            y: [-3, 3, -3],
            rotate: [0, 5, -5, 0],
          } : isUploading ? {
            y: [0, -2, 0],
          } : {
            y: 0,
            rotate: 0,
          }}
          transition={{
            duration: isDragging ? 1.2 : 0.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Upload
            className={cn(
              "h-6 w-6 transition-colors duration-300",
              isDragging ? "text-foreground" : "text-muted-foreground"
            )}
          />
        </motion.div>
      </motion.div>

      {/* Orbiting dots when dragging */}
      <AnimatePresence>
        {isDragging && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute w-1.5 h-1.5 rounded-full bg-foreground/40"
                style={{
                  top: '50%',
                  left: '50%',
                }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0.5, 1, 0.5],
                  x: [0, Math.cos((i * 120 * Math.PI) / 180) * 32, 0],
                  y: [0, Math.sin((i * 120 * Math.PI) / 180) * 32, 0],
                }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.3,
                  ease: "easeInOut",
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>
    </div>
  )
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
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    scale: 0.95,
    transition: {
      duration: 0.2,
      ease: 'easeIn' as const,
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
          /* Empty state - sophisticated animated drop zone (full panel) */
          <motion.div
            className={cn(
              'flex-1 flex flex-col items-center justify-center relative overflow-hidden',
              'bg-gradient-to-b from-muted/20 via-transparent to-muted/10',
              isUploading && 'opacity-50 pointer-events-none'
            )}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {/* Animated rotating border gradient */}
            <AnimatedBorderGradient isDragging={isDragging} />

            {/* Subtle background pattern */}
            <div
              className="absolute inset-0 opacity-[0.02] pointer-events-none"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
                backgroundSize: '20px 20px',
              }}
            />

            {/* Ambient glow when dragging */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, hsl(var(--foreground) / 0.08) 0%, transparent 70%)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: isDragging ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            />

            {/* Floating particles - spread across full panel */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <FloatingParticle key={i} index={i} isDragging={isDragging} />
            ))}

            <div className="text-center relative z-10">
              {/* Animated upload icon */}
              <AnimatedUploadIcon isDragging={isDragging} isUploading={isUploading} />

              {/* Text with animation */}
              <motion.div
                className="mt-4 mb-4"
                animate={isDragging ? { y: -2 } : { y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.p
                  className={cn(
                    "text-sm font-medium transition-colors duration-300",
                    isDragging ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {isUploading ? (
                    <span className="inline-flex items-center gap-2">
                      <motion.span
                        animate={{ opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      >
                        Uploading
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                      >
                        •
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                      >
                        •
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.6 }}
                      >
                        •
                      </motion.span>
                    </span>
                  ) : isDragging ? (
                    'Release to upload'
                  ) : (
                    'Drop files here'
                  )}
                </motion.p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  PDF, Excel, images & more
                </p>
              </motion.div>

              {/* Browse button with hover effect */}
              <label>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp"
                  disabled={isUploading}
                />
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    disabled={isUploading}
                    className="bg-background/50 backdrop-blur-sm hover:bg-background/80 border-border/50 hover:border-border transition-all duration-200"
                  >
                    <span className="cursor-pointer px-4">Browse</span>
                  </Button>
                </motion.div>
              </label>
            </div>

            {/* Ripple effect container */}
            <DropRipple isActive={false} />
          </motion.div>
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

            {/* Sophisticated drag overlay */}
            <AnimatePresence>
              {isDragging && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 m-2 rounded-xl z-10 pointer-events-none overflow-hidden"
                >
                  {/* Animated rotating border */}
                  <motion.div
                    className="absolute inset-[-2px] rounded-xl"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent, hsl(var(--foreground) / 0.5), transparent, hsl(var(--foreground) / 0.3), transparent)',
                    }}
                    animate={{ rotate: [0, 360] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                  />

                  {/* Inner background */}
                  <div className="absolute inset-[1px] rounded-xl bg-card/95 backdrop-blur-sm" />

                  {/* Ambient glow */}
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    style={{
                      background: 'radial-gradient(ellipse at center, hsl(var(--foreground) / 0.06) 0%, transparent 60%)',
                    }}
                    animate={{
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />

                  {/* Floating particles in overlay */}
                  {[0, 1, 2, 3].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute w-1 h-1 rounded-full bg-foreground/30"
                      style={{
                        left: `${25 + i * 20}%`,
                        top: `${30 + (i % 2) * 40}%`,
                      }}
                      animate={{
                        y: [0, -15, 0],
                        opacity: [0.2, 0.6, 0.2],
                        scale: [1, 1.3, 1],
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        delay: i * 0.2,
                      }}
                    />
                  ))}

                  {/* Center content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    {/* Animated icon */}
                    <motion.div
                      className="w-12 h-12 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center"
                      animate={{
                        scale: [1, 1.05, 1],
                        borderColor: ['hsl(var(--border) / 0.5)', 'hsl(var(--foreground) / 0.3)', 'hsl(var(--border) / 0.5)'],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <motion.div
                        animate={{ y: [-2, 2, -2] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <Upload className="h-5 w-5 text-foreground" />
                      </motion.div>
                    </motion.div>

                    <motion.p
                      className="text-sm text-foreground font-medium"
                      animate={{ opacity: [0.7, 1, 0.7] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      Release to add files
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
