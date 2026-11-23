import { useMemo, useState } from 'react'
import { collectCandidates } from '../lib/status'
import { useTreeStore } from '../store/useTreeStore'
import type { Tree } from '../types/tree'

interface Props {
  tree: Tree
}

export function TodayPanel({ tree }: Props) {
  const setNodeStatus = useTreeStore((s) => s.setNodeStatus)
  const [hidden, setHidden] = useState<string[]>([])

  const candidates = useMemo(() => collectCandidates(tree.root), [tree.root])
  const visible = candidates.filter((item) => !hidden.includes(item.node.id)).slice(0, 3)

  if (candidates.length === 0) {
    return (
      <section className="today">
        <div className="today-head">
          <h2 className="today-title">今天做什么</h2>
        </div>
        <p className="today-done-text">
          这棵树里的节点都已经标记为「已掌握」。可以新加一章，或者去拆下一个目标。
        </p>
      </section>
    )
  }

  return (
    <section className="today">
      <div className="today-head">
        <div>
          <h2 className="today-title">今天做什么</h2>
          <p className="today-sub">还没开始的还有 {candidates.length} 块，这里挑出三个</p>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="today-done-text">今天的建议都看过了，可以直接在下面的树里挑一个开始。</p>
      ) : (
        <div className="today-grid">
          {visible.map((item, index) => (
            <article key={item.node.id} className="today-card">
              <div className="today-card-top">
                <span className="today-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="today-path">{item.path.join(' / ') || tree.title}</span>
              </div>
              <h3 className="today-card-title">{item.node.title}</h3>
              <p className="today-reason">{item.reason}</p>
              <div className="today-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setNodeStatus(item.node.id, 'done')}
                >
                  标记已掌握
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setHidden((current) => [...current, item.node.id])}
                >
                  换一个
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
