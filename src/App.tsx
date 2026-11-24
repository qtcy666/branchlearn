import { useEffect, useMemo, useState } from 'react'
import { useTreeStore } from './store/useTreeStore'
import { parseRoute, goHome, goTree, type Route } from './lib/route'
import { decodeTree } from './lib/share'
import type { Template } from './data/templates'
import { HomeView } from './components/HomeView'
import { LandingView } from './components/LandingView'
import { TreeWorkspace } from './components/TreeWorkspace'
import { ReadOnlyView } from './components/ReadOnlyView'
import { NewTreeDialog } from './components/NewTreeDialog'
import { NoticeBar } from './components/NoticeBar'
import { Onboarding } from './components/Onboarding'

export default function App() {
  const doc = useTreeStore((s) => s.document)
  const createTreeFromTemplate = useTreeStore((s) => s.createTreeFromTemplate)
  const importTrees = useTreeStore((s) => s.importTrees)
  const notify = useTreeStore((s) => s.notify)
  const generatedUndoable = useTreeStore((s) => s.generatedUndoable)
  const undoGenerated = useTreeStore((s) => s.undoGenerated)

  const [route, setRoute] = useState<Route>(() => parseRoute())
  const [dialogOpen, setDialogOpen] = useState(false)
  // 是否已经进入课程列表：只存在内存里，刷新即回到初始页
  const [entered, setEntered] = useState(false)

  const handleBack = () => {
    setEntered(true)
    goHome()
  }

  // AI 应用后的一步撤销：Ctrl/⌘+Z。输入框内不拦截，保留文本撤销。
  useEffect(() => {
    if (!generatedUndoable) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return
      if (event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      undoGenerated()
      notify('已撤销 AI 生成。')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generatedUndoable, undoGenerated, notify])

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const sharedTree = useMemo(
    () => (route.view === 'share' ? decodeTree(route.payload) : null),
    [route],
  )

  const activeTree =
    route.view === 'tree' ? (doc.trees.find((tree) => tree.id === route.id) ?? null) : null

  // 路由指向一棵不存在的树（例如换了浏览器打开旧链接），退回首页
  useEffect(() => {
    if (route.view === 'tree' && !activeTree) {
      setEntered(true)
      goHome()
    }
  }, [route, activeTree])

  const handleUseTemplate = (template: Template) => {
    const id = createTreeFromTemplate(template)
    goTree(id)
  }

  if (route.view === 'share') {
    if (!sharedTree) {
      return (
        <div className="app">
          <main className="main">
            <div className="empty">
              <div className="empty-eyebrow">分享链接</div>
              <h1 className="empty-title">这个链接打不开</h1>
              <p className="empty-lead">
                链接可能被聊天软件截断了，或者内容已经损坏。可以请对方重新发一次，或者要一份 JSON 文件。
              </p>
              <button type="button" className="btn btn-primary btn-lg" onClick={handleBack}>
                去看我自己的树
              </button>
            </div>
          </main>
        </div>
      )
    }

    return (
      <>
        <ReadOnlyView
          tree={sharedTree}
          onImport={() => {
            importTrees([sharedTree])
            notify(`已把「${sharedTree.title}」复制到你的课程里。`)
            handleBack()
          }}
          onExit={handleBack}
        />
        <NoticeBar />
      </>
    )
  }

  if (route.view === 'landing' && !entered) {
    return (
      <div className="app">
        <NoticeBar />
        <main className="main landing-main">
          <LandingView onEnter={() => setEntered(true)} onNew={() => setDialogOpen(true)} />
        </main>

        {dialogOpen && (
          <NewTreeDialog onClose={() => setDialogOpen(false)} onCreated={(id) => goTree(id)} />
        )}
      </div>
    )
  }

  if (activeTree) {
    return (
      <>
        <TreeWorkspace tree={activeTree} onBack={handleBack} />
        <Onboarding />
      </>
    )
  }

  return (
    <div className="app">
      <NoticeBar />
      <main className="main">
        <HomeView
          trees={doc.trees}
          onOpen={goTree}
          onNew={() => setDialogOpen(true)}
          onUseTemplate={handleUseTemplate}
          onHome={() => setEntered(false)}
        />
      </main>

      <footer className="footer">
        <span>树学 · 今天学什么</span>
        <span>数据只保存在本机浏览器，不会上传</span>
      </footer>

      {dialogOpen && (
        <NewTreeDialog onClose={() => setDialogOpen(false)} onCreated={(id) => goTree(id)} />
      )}
      <Onboarding />
    </div>
  )
}
