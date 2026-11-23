import { useEffect, useState } from 'react'
import { Logo } from './Logo'

export function SplashScreen() {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    const t1 = window.setTimeout(() => setLeaving(true), 2800)
    const t2 = window.setTimeout(() => setGone(true), 3550)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  if (gone) return null

  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving}>
      <div className="splash-inner">
        <Logo size={52} />
        <h1 className="splash-brand">树学</h1>
        <p className="splash-slogan">把知识长成一棵树</p>
      </div>
    </div>
  )
}
