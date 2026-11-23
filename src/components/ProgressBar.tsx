import type { Progress } from '../lib/status'

export function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <div className="overview-progress">
      <div
        className="overview-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label="掌握进度"
      >
        <div className="overview-progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="overview-progress-text">
        {progress.percent}% · {progress.done}/{progress.total}
      </span>
    </div>
  )
}
