'use client'

import { ArrowUp, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3100/api'

type KnowledgeScope = {
  id: string
  name: string
  description: string
  documentCount: number
}

type Citation = {
  index: number
  knowledgeBaseName: string
  documentName: string
  segmentId: string
  content: string
  score: number
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
}

function getUserId() {
  const existing = localStorage.getItem('heritage-user-id')
  if (existing) return existing
  const value = crypto.randomUUID()
  localStorage.setItem('heritage-user-id', value)
  return value
}

export function ChatApp() {
  const [scopes, setScopes] = useState<KnowledgeScope[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string>()
  const [error, setError] = useState('')

  useEffect(() => {
    void fetch(`${apiBaseUrl}/public/knowledge-bases`)
      .then(async (response) => {
        if (!response.ok) throw new Error('知识库目录加载失败')
        return response.json() as Promise<KnowledgeScope[]>
      })
      .then((items) => {
        setScopes(items)
        setSelectedIds(items[0] ? [items[0].id] : [])
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '知识库目录加载失败'),
      )
  }, [])

  const selectedNames = useMemo(
    () =>
      scopes
        .filter((scope) => selectedIds.includes(scope.id))
        .map((scope) => scope.name)
        .join('、'),
    [scopes, selectedIds],
  )

  const toggleScope = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  const send = async () => {
    const text = query.trim()
    if (!text || !selectedIds.length || streaming) return
    setQuery('')
    setError('')
    setStreaming(true)

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }
    const assistantId = crypto.randomUUID()
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ])

    const response = await fetch(`${apiBaseUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: text,
        knowledge_base_ids: selectedIds,
        conversation_id: conversationId,
        user_id: getUserId(),
      }),
    })

    if (!response.ok || !response.body) {
      setStreaming(false)
      setError(`请求失败：${response.status}`)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const event = frame
            .split(/\r?\n/)
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim()
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!data) continue
          const payload = JSON.parse(data) as Record<string, unknown>
          if (event === 'meta') {
            setConversationId(String(payload.conversationId))
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      citations: payload.citations as Citation[],
                    }
                  : message,
              ),
            )
          }
          if (event === 'delta') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + String(payload.text ?? '') }
                  : message,
              ),
            )
          }
          if (event === 'error') {
            setError(String(payload.message ?? '生成失败'))
          }
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接中断')
    } finally {
      setStreaming(false)
    }
  }

  return (
    <main className="site-shell">
      <aside className="site-aside">
        <div className="site-brand">
          <span className="site-brand-mark">遗</span>
          <span>非遗文旅智能咨询</span>
        </div>
        <h2 className="scope-title">咨询范围</h2>
        <div className="scope-list">
          {scopes.map((scope) => (
            <label
              className="scope-option"
              data-selected={selectedIds.includes(scope.id)}
              key={scope.id}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(scope.id)}
                onChange={() => toggleScope(scope.id)}
              />
              <span>
                <strong>{scope.name}</strong>
                <small>
                  {scope.description || `${scope.documentCount} 份已发布资料`}
                </small>
              </span>
            </label>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <div>
            <h1>智能咨询</h1>
            <p>{selectedNames || '请选择知识范围'}</p>
          </div>
          <div className="online-status">
            <span className="online-dot" />
            {streaming ? '正在生成' : '知识服务在线'}
          </div>
        </header>

        <div className="message-scroll">
          <div className="message-list">
            {!messages.length && (
              <div className="empty-chat">
                <div>
                  <div className="empty-chat-mark">问</div>
                  <h2>从哪里开始了解？</h2>
                  <p>选择知识范围后，可以询问项目、传承人、节庆、路线和政策信息。</p>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article className="message-row" data-role={message.role} key={message.id}>
                <div className="message-bubble">
                  {message.content || (streaming ? '正在检索并整理资料…' : '')}
                  {message.citations && message.citations.length > 0 && (
                    <div className="citation-list">
                      {message.citations.map((citation) => (
                        <div className="citation" key={citation.segmentId}>
                          <strong>
                            [{citation.index}] {citation.documentName}
                          </strong>
                          {citation.content.slice(0, 180)}
                          {citation.content.length > 180 ? '…' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
            {error && (
              <div className="citation" role="alert">
                <strong>请求异常</strong>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              value={query}
              placeholder="输入你要咨询的非遗或文旅问题"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <button
              className="send-button"
              type="button"
              disabled={streaming || !query.trim() || !selectedIds.length}
              onClick={() => void send()}
              aria-label="发送"
            >
              {streaming ? <RotateCcw size={18} /> : <ArrowUp size={19} />}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
