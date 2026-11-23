import { useTreeStore } from '../store/useTreeStore'

export function NoticeBar() {
  const notice = useTreeStore((s) => s.notice)
  const dismiss = useTreeStore((s) => s.dismissNotice)

  if (!notice) return null

  return (
    <div className="notice" role="status">
      <span>{notice}</span>
      <button type="button" className="notice-close" onClick={dismiss} aria-label="关闭提示">
        ×
      </button>
    </div>
  )
}
