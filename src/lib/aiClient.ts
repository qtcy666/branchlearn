/**
 * 阶段 2：真接口客户端
 *
 * 和后端约定：
 *   POST /generate  { topic, goal }  → text/event-stream
 *   event: progress  {done,total}
 *   event: node      {done,total,node}   // 前端目前不逐节点渲染，忽略
 *   event: done      {tree,cached}
 *   event: error     {code,message,errors}
 *
 * 负责：45s 超时、失败重试 ≤2、前端 5 次/分限流、SSE 解析。
 * 未配置 VITE_AI_API 时由调用方回落到 mockGenerate。
 */

import type { GenerateEvent } from './aiGenerate'
import type { SchemaTree } from './treeSchema'

const RAW_BASE = import.meta.env.VITE_AI_API ?? ''

export const AI_BASE = RAW_BASE.replace(/\/+$/, '')
export const AI_ENABLED = AI_BASE !== ''

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000
const TIMEOUT_MS = 45_000
const MAX_RETRY = 2

const hits: number[] = []

export class AiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

/** 一次生成只占一个额度，重试不重复计数。 */
function takeToken() {
  const now = Date.now()
  while (hits.length > 0 && now - hits[0] >= RATE_WINDOW_MS) hits.shift()
  if (hits.length >= RATE_LIMIT) {
    const wait = Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000)
    throw new AiError(`请求太频繁，${wait} 秒后再试`, 429)
  }
  hits.push(now)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

type ParsedEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'error'; message: string; code: number }
  | { type: 'done'; tree: SchemaTree }
  | null

function parseChunk(chunk: string): ParsedEvent {
  let event = 'message'
  const data: string[] = []

  for (const line of chunk.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }

  if (data.length === 0) return null

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(data.join('\n')) as Record<string, unknown>
  } catch {
    return null
  }

  if (event === 'progress' || event === 'node') {
    return {
      type: 'progress',
      done: Number(payload.done) || 0,
      total: Number(payload.total) || 0,
    }
  }
  if (event === 'error') {
    return {
      type: 'error',
      message: typeof payload.message === 'string' ? payload.message : '生成失败',
      code: Number(payload.code) || 502,
    }
  }
  if (event === 'done' && payload.tree) {
    return { type: 'done', tree: payload.tree as SchemaTree }
  }
  return null
}

async function* streamOnce(
  topic: string,
  goal: string,
  outer?: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (outer?.aborted) controller.abort()
  outer?.addEventListener('abort', onOuterAbort, { once: true })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)

  try {
    const res = await fetch(`${AI_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, goal }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let message = `生成失败（${res.status}）`
      try {
        const data = (await res.json()) as { message?: string }
        if (data.message) message = data.message
      } catch {
        /* 响应不是 JSON，保留默认文案 */
      }
      throw new AiError(message, res.status)
    }

    if (!res.body) throw new AiError('当前浏览器不支持流式响应', 0)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let split = buffer.indexOf('\n\n')

      while (split >= 0) {
        const chunk = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const event = parseChunk(chunk)

        if (event?.type === 'progress') {
          yield { type: 'progress', done: event.done, total: event.total }
        } else if (event?.type === 'error') {
          throw new AiError(event.message, event.code)
        } else if (event?.type === 'done') {
          yield { type: 'tree', tree: event.tree }
          finished = true
          break
        }

        split = buffer.indexOf('\n\n')
      }
    }

    if (!finished) throw new AiError('连接意外中断，请重试', 0)
  } catch (e) {
    if (timedOut) throw new AiError('生成超时，请重试', 504)
    if ((e as Error)?.name === 'AbortError') throw e
    if (e instanceof AiError) throw e
    throw new AiError('网络异常，请检查 AI 服务是否启动', 0)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 真接口版生成器。事件形状与 mockGenerate 完全一致，UI 不需要分支。
 */
export async function* generateTree(
  topic: string,
  goal = '',
  signal?: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  if (!AI_ENABLED) throw new AiError('AI 服务未配置', 0)
  takeToken()

  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    try {
      yield* streamOnce(topic, goal, signal)
      return
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e

      lastError = e
      const status = e instanceof AiError ? e.status : 0
      // 4xx（除 429）是参数或鉴权问题，重试没有意义
      if (status >= 400 && status < 500 && status !== 429) throw e

      if (attempt === MAX_RETRY) break
      await sleep(800 * (attempt + 1), signal)
    }
  }

  throw lastError ?? new AiError('生成失败，请重试', 0)
}
