import { computeProgress } from '../lib/status'
import type { Tree } from '../types/tree'
import { ProgressBar } from './ProgressBar'
import { ReadOnlyTree } from './ReadOnlyTree'

interface Props {
  tree: Tree
  onImport: () => void
  onExit: () => void
}

export function ReadOnlyView({ tree, onImport, onExit }: Props) {
  const progress = computeProgress(tree.root)

  return (
    <div className="app">
      <div className="share-banner">
        <span>这是一棵别人分享给你的树，只能看不能改</span>
      </div>

      <main className="main">
        <section className="overview">
          <div className="overview-head">
            <div className="overview-heading">
              <p className="overview-eyebrow">分享的课程</p>
              <h1 className="overview-title">{tree.title}</h1>
              {tree.description && <p className="overview-desc">{tree.description}</p>}
            </div>
          </div>

          <div className="tree-toolbar">
            <ProgressBar progress={progress} />
            <div className="tree-toolbar-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={onImport}>
                复制到我的树
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
                看我自己
              </button>
            </div>
          </div>

          <div className="tree-panel">
            <ReadOnlyTree root={tree.root} />
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>树学 · 今天学什么</span>
        <span>分享内容只包含这棵树，不含你的其他数据</span>
      </footer>
    </div>
  )
}
