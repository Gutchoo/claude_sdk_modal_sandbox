import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'

// The visual component for the file mention chip
function FileMentionComponent({ node }: { node: { attrs: Record<string, unknown> } }) {
  const label = node.attrs.label as string
  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="inline-flex items-center gap-0.5 mx-0.5 px-2 py-0.5 bg-primary/15 text-primary rounded-md font-medium text-sm border border-primary/25 select-none"
        contentEditable={false}
      >
        <span className="opacity-60">@</span>
        {label}
      </span>
    </NodeViewWrapper>
  )
}

// Plugin key for the mention extension
export const FileMentionPluginKey = new PluginKey('fileMention')

// Custom TipTap extension for file mentions
export const FileMention = Node.create({
  name: 'fileMention',

  group: 'inline',

  inline: true,

  // This is the key - atom: true makes it delete as a single unit
  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-id'),
        renderHTML: attributes => {
          if (!attributes.id) return {}
          return { 'data-id': attributes.id }
        },
      },
      label: {
        default: null,
        parseHTML: element => element.getAttribute('data-label'),
        renderHTML: attributes => {
          if (!attributes.label) return {}
          return { 'data-label': attributes.label }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`,
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-type': this.name }, HTMLAttributes),
      `@${HTMLAttributes['data-label']}`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileMentionComponent)
  },

  // Helper command to insert a file mention
  addCommands() {
    return {
      insertFileMention: (attributes: { id: string; label: string }) => ({ chain }) => {
        return chain()
          .insertContent([
            {
              type: this.name,
              attrs: attributes,
            },
            {
              type: 'text',
              text: ' ',
            },
          ])
          .run()
      },
    }
  },
})

// Extend TipTap's command types
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileMention: {
      insertFileMention: (attributes: { id: string; label: string }) => ReturnType
    }
  }
}
