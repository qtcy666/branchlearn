import { useRef } from 'react'
import { TEMPLATES, countTemplateNodes, type Template } from '../data/templates'
import { HeroIllustration } from './HeroIllustration'

interface Props {
  onCreate: () => void
  onUseTemplate: (template: Template) => void
  onAIGenerate: () => void
}

const FEATURES = [
  {
    title: '拆成树',
    desc: '课程 → 章节 → 知识点 → 今天能做的一件事',
  },
  {
    title: '标状态',
    desc: '未开始 / 在学 / 已掌握，父节点自动汇总',
  },
  {
    title: '定今天',
    desc: '自动挑出三个现在就能动手的节点',
  },
]

export function EmptyState({ onCreate, onUseTemplate, onAIGenerate }: Props) {
  const templateRef = useRef<HTMLDivElement>(null)

  return (
    <section className="empty">
      <div className="empty-hero">
        <div className="empty-copy">
          <div className="empty-eyebrow">树学 · 学习目标拆解器</div>
          <h1 className="empty-title">
            把一门课，拆成今天能<span className="hl">做完</span>的小事
          </h1>
          <p className="empty-lead">
            「我要学好线性代数」太大了，大到不知道从哪下手。拆成一棵树，标出哪里会了、哪里还空着，
            打开页面它直接告诉你现在该做哪一块。
          </p>

          <div className="empty-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onCreate}>
              新建一棵树
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onAIGenerate}>
              用 AI 生成
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() =>
                templateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              先看看模板
            </button>
          </div>

          <p className="empty-hint">不需要注册，数据只保存在你自己的浏览器里</p>
        </div>

        <div className="empty-art">
          <HeroIllustration />
        </div>
      </div>

      <div className="template-block" ref={templateRef}>
        <div className="template-head">
          <span className="template-head-title">或者，从一门课开始</span>
          <span className="template-head-desc">模板只是起点，建完可以随便改</span>
        </div>
        <div className="template-row">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              onClick={() => onUseTemplate(template)}
            >
              <span className="template-name">{template.title}</span>
              <span className="template-desc">{template.description}</span>
              <span className="template-count">{countTemplateNodes(template)} 个节点 · 点此创建</span>
            </button>
          ))}
        </div>
      </div>

      <ul className="feature-row">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="feature">
            <span className="feature-title">{feature.title}</span>
            <span className="feature-desc">{feature.desc}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
