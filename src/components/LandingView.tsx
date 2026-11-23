import { useEffect } from 'react'

interface Props {
  onEnter: () => void
  onNew: () => void
}

const STEPS = [
  { n: '01', title: '拆成树', desc: '一门课拆到能一下午做完' },
  { n: '02', title: '标状态', desc: '没开始 / 在学 / 会了' },
  { n: '03', title: '定今天', desc: '打开就知道该动哪块' },
]

/** 预览卡片：一颗小树 + 今日清单 + 进度，纯装饰 */
function MiniApp() {
  return (
    <div className="landing-preview" aria-hidden="true">
      <span className="landing-card-glow" aria-hidden="true" />
      <div className="landing-preview-bar">
        <span />
        <span />
        <span />
        <em>branchlearn.app</em>
      </div>

      <div className="landing-app">
        <div className="landing-tree">
          <div className="landing-node landing-node-root">学期目标</div>

          <div className="landing-row">
            <div className="landing-node landing-node-done">基础概念</div>
            <div className="landing-node landing-node-learning">核心方法</div>
            <div className="landing-node">综合练习</div>
          </div>

          <div className="landing-row landing-row-sm">
            <div className="landing-node">定义</div>
            <div className="landing-node">推导</div>
            <div className="landing-node">例题</div>
            <div className="landing-node">练习</div>
            <div className="landing-node">总结</div>
          </div>

          <p className="landing-tree-foot">23 个知识点 · 已掌握 12 个</p>
        </div>

        <aside className="landing-today">
          <p className="landing-today-title">今天该做</p>
          <ul className="landing-today-list">
            <li>
              <i className="landing-dot landing-dot-learning" />
              <span>复习上一节重点</span>
              <em>25m</em>
            </li>
            <li>
              <i className="landing-dot" />
              <span>完成课后练习</span>
              <em>15m</em>
            </li>
            <li>
              <i className="landing-dot landing-dot-done" />
              <span>整理错题本</span>
              <em>10m</em>
            </li>
            <li>
              <i className="landing-dot" />
              <span>预习下一节</span>
              <em>30m</em>
            </li>
            <li>
              <i className="landing-dot" />
              <span>复盘本周进度</span>
              <em>20m</em>
            </li>
          </ul>
          <p className="landing-today-note">今天还剩 2 小时</p>
        </aside>
      </div>

      <div className="landing-progress">
        <span>已掌握</span>
        <div className="landing-bar">
          <i />
        </div>
        <strong>38%</strong>
      </div>
    </div>
  )
}

export function LandingView({ onEnter, onNew }: Props) {
  // 初始页固定一屏，进入期间锁掉页面滚动
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <span className="landing-glow landing-glow-a" />
        <span className="landing-glow landing-glow-b" />
        <span className="landing-glow landing-glow-c" />
        <span className="landing-grid" />
        <span className="landing-leaf landing-leaf-1" />
        <span className="landing-leaf landing-leaf-2" />
        <span className="landing-leaf landing-leaf-3" />
        <span className="landing-leaf landing-leaf-4" />
        <span className="landing-leaf landing-leaf-5" />
        <span className="landing-seed landing-seed-1" />
        <span className="landing-seed landing-seed-2" />
        <span className="landing-seed landing-seed-3" />
      </div>

      <div className="landing-inner">
        <nav className="landing-nav">
          <span className="landing-brand">
            <span className="landing-mark" aria-hidden="true" />
            树学
          </span>
          <div className="landing-nav-right">
            <span className="landing-nav-tag">本地优先 · 无需注册</span>
            <button type="button" className="landing-ghost" onClick={onEnter}>
              进入课程
            </button>
          </div>
        </nav>

        <section className="landing-hero">
          <div className="landing-copy">
            <span className="landing-badge">
              <i aria-hidden="true" />
              学习目标拆解器
            </span>

            <h1 className="landing-title">
              把「我要学好」
              <br />
              <span className="landing-gradient">拆成今天做完的小事</span>
            </h1>

            <p className="landing-lead">
              一个学期的目标太大了，大到不知道从哪下手。先拆成一棵树——标出哪块会了、哪块还空着，
              打开它直接告诉你今天该动哪一块。
            </p>

            <ul className="landing-points">
              <li>
                <b>自动汇总</b>父节点的进度由子节点算出来，不用手工维护
              </li>
              <li>
                <b>只用三种状态</b>没开始 / 在学 / 会了，不给自己第四个选项
              </li>
              <li>
                <b>本地优先</b>不注册、不上传，关掉网页数据还在
              </li>
              <li>
                <b>导出即分享</b>导出一份文件或链接，发给同学就能一起看
              </li>
            </ul>

            <div className="landing-actions">
              <button type="button" className="landing-cta" onClick={onNew}>
                开始拆解
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="landing-ghost landing-ghost-lg" onClick={onEnter}>
                看看我的课程
              </button>
            </div>

            <p className="landing-hint">不用注册，数据只保存在你自己的浏览器里</p>
          </div>

          <div className="landing-art">
            <MiniApp />
          </div>
        </section>

        <ol className="landing-steps">
          {STEPS.map((step) => (
            <li key={step.n} className="landing-step">
              <span className="landing-step-n">{step.n}</span>
              <span className="landing-step-title">{step.title}</span>
              <span className="landing-step-desc">{step.desc}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
