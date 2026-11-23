import { displayStatus } from '../lib/status'
import type { TreeNode } from '../types/tree'

const CHAPTER_COLORS = ['#2f6b4f', '#8a5a2b', '#4a5a8a', '#7a4a6a', '#5a7a3a', '#8a4a4a']

interface RowProps {
  node: TreeNode
  depth: number
  color: string
}

function Row({ node, depth, color }: RowProps) {
  const status = displayStatus(node)
  const style =
    depth === 1
      ? {
          paddingLeft: `calc(${depth} * var(--indent) + 10px)`,
          borderLeftColor: color,
        }
      : { paddingLeft: `calc(${depth} * var(--indent) + 10px)` }

  const className = [
    'node-row',
    depth === 0 ? 'node-row--root' : '',
    depth === 1 ? 'node-row--chapter' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className="tree-item">
      <div className={className} style={style}>
        <span className={`twisty twisty--empty`} aria-hidden="true" />
        <span className={`status-dot status-dot--${status} status-dot--static`} aria-hidden="true" />
        <span className="node-title">{node.title}</span>
        {node.children.length > 0 && depth > 0 && (
          <span className="node-count">{node.children.length}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child, index) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              color={depth === 0 ? CHAPTER_COLORS[index % CHAPTER_COLORS.length] : color}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ReadOnlyTree({ root }: { root: TreeNode }) {
  return (
    <ul className="tree-list read-only-tree">
      <Row node={root} depth={0} color={CHAPTER_COLORS[0]} />
    </ul>
  )
}
