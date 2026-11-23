import { useState } from 'react'
import { countNodes, type Tree } from '../types/tree'
import { useTreeStore } from '../store/useTreeStore'

/**
 * 反馈提交地址。
 *
 * 留空时：点击提交会把反馈内容复制到剪贴板，由使用者自己粘贴给作者。
 * 填上 Formspree 的 endpoint（形如 https://formspree.io/f/xxxxxxx）后，
 * 会直接 POST 过去，反馈会进邮箱，不需要后端。
 */
const FEEDBACK_ENDPOINT = ''

interface Props {
  tree: Tree
}

type Rating = 'up' | 'down'

export function FeedbackWidget({ tree }: Props) {
  const notify = useTreeStore((s) => s.notify)

  const [rating, setRating] = useState<Rating | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  // 空树没什么可评价的，不打扰
  if (countNodes(tree.root) < 2) return null

  const submit = async () => {
    if (!rating) return

    const payload = {
      rating: rating === 'up' ? '有用' : '没用',
      message: message.trim(),
      tree: tree.title,
      nodes: countNodes(tree.root),
      at: new Date().toISOString(),
      page: window.location.href,
    }

    if (FEEDBACK_ENDPOINT) {
      setSending(true)
      try {
        const response = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error('bad status')
        setSent(true)
      } catch {
        notify('反馈没有发出去，请稍后再试一次。')
      } finally {
        setSending(false)
      }
      return
    }

    const text = [
      `[树学 反馈] ${payload.rating}`,
      payload.message || '（没有写具体内容）',
      `树：${payload.tree}（${payload.nodes} 个节点）`,
      `时间：${payload.at}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setSent(true)
      notify('反馈已复制到剪贴板，粘贴发给作者就行。')
    } catch {
      window.prompt('复制这段反馈发给作者：', text)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <section className="feedback feedback--sent">
        <p className="feedback-title">收到了，谢谢。</p>
        <p className="feedback-desc">
          如果愿意多说一句「哪一步最卡」，对下一版更有帮助。
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setSent(false)
            setRating(null)
            setMessage('')
          }}
        >
          再写一条
        </button>
      </section>
    )
  }

  return (
    <section className="feedback">
      <div className="feedback-head">
        <p className="feedback-title">这棵树对你有用吗？</p>
        <p className="feedback-desc">一句话就够，不用客气。</p>
      </div>

      <div className="feedback-actions">
        <button
          type="button"
          className={`rating-btn ${rating === 'up' ? 'is-active' : ''}`}
          onClick={() => setRating('up')}
          aria-pressed={rating === 'up'}
        >
          <span aria-hidden="true">👍</span> 有用
        </button>
        <button
          type="button"
          className={`rating-btn ${rating === 'down' ? 'is-active' : ''}`}
          onClick={() => setRating('down')}
          aria-pressed={rating === 'down'}
        >
          <span aria-hidden="true">👎</span> 没用
        </button>
      </div>

      {rating && (
        <div className="feedback-form">
          <input
            className="input"
            value={message}
            maxLength={160}
            placeholder="哪里好、哪里卡，随便写一句"
            aria-label="反馈内容"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={sending}
          >
            {sending ? '发送中' : '提交'}
          </button>
        </div>
      )}
    </section>
  )
}
