import type { FillResult } from '../data/treeShape'

/**
 * 填充服务地址。
 * 本地开发默认 http://localhost:8788；
 * 部署时在构建环境里设置 VITE_FILL_API 指向云函数地址。
 */
const rawBase = import.meta.env.VITE_FILL_API
const BASE_URL = (
  typeof rawBase === 'string' && rawBase.trim() ? rawBase : 'http://localhost:8788'
).replace(/\/+$/, '')

export class FillError extends Error {
  status: number
  details: string[]

  constructor(message: string, status = 0, details: string[] = []) {
    super(message)
    this.name = 'FillError'
    this.status = status
    this.details = details
  }
}

interface FillRequest {
  query: string
  goal?: string
  shape: unknown
  signal?: AbortSignal
}

export async function requestFill({
  query,
  goal,
  shape,
  signal,
}: FillRequest): Promise<FillResult> {
  let res: Response

  try {
    res = await fetch(`${BASE_URL}/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, goal, shape }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new FillError('连不上填充服务，确认服务已经启动（默认 localhost:8788）。')
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const data = body as { error?: string; errors?: string[] } | null
    throw new FillError(
      data?.error || `服务返回 ${res.status}`,
      res.status,
      data?.errors ?? [],
    )
  }

  return body as FillResult
}

/** 把服务端错误翻成一句用户能懂的话。 */
export function describeFillError(error: unknown): string {
  if (!(error instanceof FillError)) return '出了点问题，稍后再试。'

  switch (error.status) {
    case 429:
      return '生成太频繁了，等一分钟再试。'
    case 504:
      return '这次检索超时了，可以再试一次。'
    case 422:
      return '生成的结构没通过校验，换个说法或重试。'
    case 500:
      return '服务端没配置好 API Key，先找开发者确认。'
    default:
      return error.message
  }
}
