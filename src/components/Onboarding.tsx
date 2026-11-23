import { useEffect, useState } from 'react'

const STORAGE_KEY = 'branchlearn.onboarding.v2'

const STEPS = [
  {
    title: '点圆点，标状态',
    desc: '节点左边的圆点，点一下是「在学」，再点一下是「已掌握」。父节点会自动汇总，不用一节一节去点。',
  },
  {
    title: '加节点、改名字',
    desc: '鼠标移到节点上，右侧会出现 ＋ 和垃圾桶。双击标题可以直接改名，回车确认，Esc 取消。',
  },
  {
    title: '看今天做什么',
    desc: '点右上角「今天做什么」，它会挑出三个现在就能动手的节点，并写清楚为什么推荐它。不想做就换一个。',
  },
]

function markDone() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done')
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function Onboarding() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== 'done') setVisible(true)
    } catch {
      /* 隐私模式下不弹引导 */
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        markDone()
        setVisible(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  const finish = () => {
    markDone()
    setVisible(false)
  }

  return (
    <div className="overlay">
      <div
        className="dialog onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div className="onboarding-dots" aria-hidden="true">
          {STEPS.map((item, index) => (
            <span key={item.title} className={index === step ? 'is-active' : ''} />
          ))}
        </div>

        <h2 id="onboarding-title" className="dialog-title">
          {current.title}
        </h2>
        <p className="dialog-desc">{current.desc}</p>

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={finish}>
            跳过
          </button>
          {isLast ? (
            <button type="button" className="btn btn-primary" onClick={finish}>
              开始用
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep((value) => value + 1)}
            >
              下一步
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
