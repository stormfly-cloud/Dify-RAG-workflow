import type {
  IngestionTask,
  KnowledgeBase,
  KnowledgeDocument,
} from '@heritage/contracts'

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3100/api'
const SESSION_KEY = 'heritage-admin-session'

function getApiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}

function getNetworkErrorMessage(path: string, error: unknown) {
  const detail = error instanceof Error && error.message ? `（${error.message}）` : ''
  return `无法连接管理 API：${getApiUrl(path)}${detail}。请确认 API 服务已启动、地址可访问，并检查浏览器 Origin 是否在 CORS 白名单中。`
}

export function getAdminToken() {
  return typeof window === 'undefined' ? '' : localStorage.getItem(SESSION_KEY) ?? ''
}

export function setAdminToken(token: string) {
  localStorage.setItem(SESSION_KEY, token)
}

export function clearAdminToken() {
  localStorage.removeItem(SESSION_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getAdminToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  let response: Response
  try {
    response = await fetch(getApiUrl(path), {
      ...init,
      headers,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error(getNetworkErrorMessage(path, error))
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | { message?: string; code?: string }
      | null
    throw new Error(error?.message ?? `请求失败：${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const adminApi = {
  async login(username: string, password: string) {
    const response = await request<{
      token: string
      expiresAt: string
      user: { id: string; username: string; role: string }
    }>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setAdminToken(response.token)
    return response
  },

  me() {
    return request<{
      id: string
      username: string
      role: string
      expiresAt: string
    }>('/auth/admin/me')
  },

  async logout() {
    try {
      await request('/auth/admin/logout', { method: 'POST' })
    } finally {
      clearAdminToken()
    }
  },

  listKnowledgeBases(keyword = '') {
    const params = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
    return request<KnowledgeBase[]>(`/admin/knowledge-bases${params}`)
  },

  getKnowledgeBase(id: string) {
    return request<KnowledgeBase>(`/admin/knowledge-bases/${id}`)
  },

  updateKnowledgeBase(id: string, input: { name: string; description: string }) {
    return request<KnowledgeBase>(`/admin/knowledge-bases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },

  deleteKnowledgeBase(id: string) {
    return request<{ result: string }>(`/admin/knowledge-bases/${id}`, {
      method: 'DELETE',
    })
  },

  createKnowledgeBase(input: Record<string, unknown>) {
    return request<KnowledgeBase>('/admin/knowledge-bases', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  listModels(type: 'text-embedding' | 'rerank' | 'llm') {
    return request<
      Array<{
        provider: string
        providerLabel: string
        model: string
        modelLabel: string
        modelType: string
        status: string
      }>
    >(`/admin/models?type=${type}`)
  },

  listDocuments(knowledgeBaseId: string) {
    return request<KnowledgeDocument[]>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents`,
    )
  },

  listTasks(knowledgeBaseId: string) {
    return request<IngestionTask[]>(
      `/admin/knowledge-bases/${knowledgeBaseId}/tasks`,
    )
  },

  uploadFile(knowledgeBaseId: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return request<{ document: KnowledgeDocument; task: IngestionTask }>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents/upload`,
      {
        method: 'POST',
        body: formData,
      },
    )
  },

  createTextDocument(
    knowledgeBaseId: string,
    input: { name: string; text: string },
  ) {
    return request<{ document: KnowledgeDocument; task: IngestionTask }>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents/text`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    )
  },

  retrievalTest(
    knowledgeBaseId: string,
    input: { query: string; include_drafts: boolean },
  ) {
    return request<{
      query: { content: string }
      records: Array<{
        score: number
        segment: {
          id: string
          content: string
          position: number
          document: { id: string; name: string }
        }
      }>
    }>(`/admin/knowledge-bases/${knowledgeBaseId}/retrieval-test`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  listChunks(knowledgeBaseId: string, documentId: string) {
    return request<{
      data: Array<{
        id: string
        position: number
        content: string
        answer?: string
        enabled: boolean
        status: string
        keywords?: string[]
      }>
      total: number
    }>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`,
    )
  },

  updateChunk(
    knowledgeBaseId: string,
    documentId: string,
    chunkId: string,
    input: { content: string; answer?: string; enabled?: boolean },
  ) {
    return request<Record<string, unknown>>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks/${chunkId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    )
  },

  publishDocument(
    knowledgeBaseId: string,
    documentId: string,
    published: boolean,
  ) {
    return request<KnowledgeDocument>(
      `/admin/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ published }),
      },
    )
  },
}

export async function subscribeToTaskEvents(
  taskId: string,
  onEvent: (event: {
    id: number
    type: string
    payload: Record<string, unknown>
    createdAt: string
  }) => void,
  signal: AbortSignal,
) {
  const path = `/admin/ingestion-tasks/${taskId}/events`
  let response: Response
  try {
    response = await fetch(getApiUrl(path), {
      headers: {
        Authorization: `Bearer ${getAdminToken()}`,
        Accept: 'text/event-stream',
      },
      signal,
    })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error
    }
    throw new Error(getNetworkErrorMessage(path, error))
  }
  if (!response.ok || !response.body) {
    throw new Error(`事件流连接失败：${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      onEvent(JSON.parse(data))
    }
  }
}
