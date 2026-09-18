export type DifyClientOptions = {
  baseUrl: string
  knowledgeApiKey: string
  chatAppApiKey?: string
  timeoutMs?: number
}

export type DifyErrorBody = {
  code?: string
  message?: string
  status?: number
}

export class DifyApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'DifyApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type RetrievalModel = {
  search_method: 'keyword_search' | 'semantic_search' | 'full_text_search' | 'hybrid_search'
  reranking_enable: boolean
  reranking_mode?: 'reranking_model' | 'weighted_score' | null
  reranking_model?: {
    reranking_provider_name: string
    reranking_model_name: string
  }
  top_k: number
  score_threshold_enabled: boolean
  score_threshold?: number | null
  weights?: Record<string, unknown> | null
  metadata_filtering_conditions?: {
    logical_operator: 'and' | 'or'
    conditions: Array<{
      name: string
      comparison_operator: string
      value?: string | string[] | number | null
    }>
  }
}

export type ProcessRule = {
  mode: 'automatic' | 'custom' | 'hierarchical'
  rules?: {
    pre_processing_rules?: Array<{ id: string; enabled: boolean }>
    segmentation?: {
      separator: string
      max_tokens: number
      chunk_overlap?: number
    }
    parent_mode?: 'full-doc' | 'paragraph'
    subchunk_segmentation?: {
      separator: string
      max_tokens: number
      chunk_overlap?: number
    }
  }
}

export type CreateKnowledgeBaseInput = {
  name: string
  description?: string
  indexing_technique?: 'high_quality' | 'economy'
  embedding_model?: string
  embedding_model_provider?: string
  retrieval_model?: RetrievalModel
  summary_index_setting?: Record<string, unknown>
}

export type DifyKnowledgeBase = {
  id: string
  name: string
  description: string
  indexing_technique: string
  embedding_model: string | null
  embedding_model_provider: string | null
  doc_form: string
  document_count: number
  total_available_documents: number
  word_count: number
  retrieval_model_dict: RetrievalModel
  created_at: number
  updated_at: number
}

export type DifyDocument = {
  id: string
  name: string
  indexing_status: string
  display_status: string
  enabled: boolean
  archived: boolean
  dataset_id?: string
  doc_form?: string
  error?: string | null
  completed_segments?: number
  total_segments?: number
}

export type DifyIndexingStatus = {
  id: string
  indexing_status: string
  processing_started_at: number | null
  parsing_completed_at: number | null
  cleaning_completed_at: number | null
  splitting_completed_at: number | null
  completed_at: number | null
  paused_at: number | null
  stopped_at: number | null
  completed_segments: number
  total_segments: number
  error: string | null
}

export type DifyRetrievalRecord = {
  score: number
  segment: {
    id: string
    content: string
    answer?: string
    position: number
    document_id: string
    document: {
      id: string
      name: string
      data_source_type?: string
    }
  }
  child_chunks?: Array<{
    id: string
    content: string
    position: number
    score: number
  }>
  summary?: string | null
  files?: Array<{
    id: string
    name: string
    extension: string
    mime_type: string
    size: number
    source_url: string
  }>
}

export type DifyUploadDocumentResponse = {
  batch: string
  document?: DifyDocument
  documents?: DifyDocument[]
}

export type DifyChatStreamEvent = {
  event: string
  task_id?: string
  message_id?: string
  conversation_id?: string
  answer?: string
  metadata?: {
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      total_price?: string
      currency?: string
    }
  }
  data?: Record<string, unknown>
  status?: number
  code?: string
  message?: string
}

type DocumentMutationInput = {
  indexing_technique: 'high_quality' | 'economy'
  doc_form: 'text_model' | 'qa_model' | 'hierarchical_model'
  doc_language: string
  process_rule: ProcessRule
  retrieval_model?: RetrievalModel
  embedding_model?: string
  embedding_model_provider?: string
}

type RequestOptions = {
  method?: string
  body?: unknown
  formData?: FormData
  signal?: AbortSignal
}

export class DifyKnowledgeClient {
  private readonly baseUrl: string
  private readonly knowledgeApiKey: string
  private readonly chatAppApiKey?: string
  private readonly timeoutMs: number

  constructor(options: DifyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.knowledgeApiKey = options.knowledgeApiKey
    this.chatAppApiKey = options.chatAppApiKey
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  async listKnowledgeBases(query: { page?: number; limit?: number; keyword?: string } = {}) {
    const params = new URLSearchParams()
    params.set('page', String(query.page ?? 1))
    params.set('limit', String(query.limit ?? 100))
    if (query.keyword) params.set('keyword', query.keyword)
    return this.request<{ data: DifyKnowledgeBase[]; total: number; page: number; limit: number }>(
      `/datasets?${params.toString()}`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async createKnowledgeBase(input: CreateKnowledgeBaseInput) {
    return this.request<DifyKnowledgeBase>(
      '/datasets',
      { method: 'POST', body: input },
      this.knowledgeApiKey,
    )
  }

  async getKnowledgeBase(datasetId: string) {
    return this.request<DifyKnowledgeBase>(
      `/datasets/${datasetId}`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async updateKnowledgeBase(datasetId: string, input: Partial<CreateKnowledgeBaseInput>) {
    return this.request<DifyKnowledgeBase>(
      `/datasets/${datasetId}`,
      { method: 'PATCH', body: input },
      this.knowledgeApiKey,
    )
  }

  async deleteKnowledgeBase(datasetId: string) {
    return this.request<{ result: string }>(
      `/datasets/${datasetId}`,
      { method: 'DELETE' },
      this.knowledgeApiKey,
    )
  }

  async listModels(modelType: 'text-embedding' | 'rerank' | 'llm') {
    return this.request<{
      data: Array<{
        provider: string
        label: Record<string, string>
        models: Array<{
          model: string
          label?: Record<string, string>
          model_type: string
          status: string
        }>
      }>
    }>(
      `/workspaces/current/models/model-types/${modelType}`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async createMetadataField(datasetId: string, name: string, type: 'string' | 'number' | 'time') {
    return this.request<{ id: string; name: string; type: string }>(
      `/datasets/${datasetId}/metadata`,
      { method: 'POST', body: { name, type } },
      this.knowledgeApiKey,
    )
  }

  async listMetadataFields(datasetId: string) {
    return this.request<{
      doc_metadata: Array<{ id: string; name: string; type: string; count?: number }>
      built_in_fields?: Array<{ id: string; name: string; type: string; enabled?: boolean }>
    }>(
      `/datasets/${datasetId}/metadata`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async updateDocumentMetadata(
    datasetId: string,
    documentId: string,
    fieldId: string,
    fieldName: string,
    value: string | number | null,
  ) {
    return this.request<{ result: string }>(
      `/datasets/${datasetId}/documents/metadata`,
      {
        method: 'POST',
        body: {
          operation_data: [
            {
              document_id: documentId,
              metadata_list: [{ id: fieldId, name: fieldName, value }],
              partial_update: true,
            },
          ],
        },
      },
      this.knowledgeApiKey,
    )
  }

  async createDocumentByText(
    datasetId: string,
    name: string,
    text: string,
    config: DocumentMutationInput,
  ) {
    return this.request<DifyUploadDocumentResponse>(
      `/datasets/${datasetId}/document/create-by-text`,
      { method: 'POST', body: { name, text, ...config } },
      this.knowledgeApiKey,
    )
  }

  async createDocumentByFile(
    datasetId: string,
    file: { filename: string; mimeType: string; buffer: Buffer },
    config: DocumentMutationInput,
  ) {
    const formData = new FormData()
    formData.append('data', JSON.stringify(config))
    formData.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType || 'application/octet-stream' }),
      file.filename,
    )
    return this.request<DifyUploadDocumentResponse>(
      `/datasets/${datasetId}/document/create-by-file`,
      { method: 'POST', formData },
      this.knowledgeApiKey,
    )
  }

  async getIndexingStatus(datasetId: string, batchId: string) {
    return this.request<{ data: DifyIndexingStatus[] }>(
      `/datasets/${datasetId}/documents/${batchId}/indexing-status`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async listDocuments(
    datasetId: string,
    query: { page?: number; limit?: number; keyword?: string; status?: string } = {},
  ) {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      limit: String(query.limit ?? 100),
    })
    if (query.keyword) params.set('keyword', query.keyword)
    if (query.status) params.set('status', query.status)
    return this.request<{ data: DifyDocument[]; total: number }>(
      `/datasets/${datasetId}/documents?${params.toString()}`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async listChunks(datasetId: string, documentId: string, query: { page?: number; limit?: number } = {}) {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      limit: String(query.limit ?? 100),
    })
    return this.request<{
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
      `/datasets/${datasetId}/documents/${documentId}/segments?${params.toString()}`,
      { method: 'GET' },
      this.knowledgeApiKey,
    )
  }

  async updateChunk(
    datasetId: string,
    documentId: string,
    chunkId: string,
    input: { content: string; answer?: string; keywords?: string[]; enabled?: boolean },
  ) {
    return this.request<Record<string, unknown>>(
      `/datasets/${datasetId}/documents/${documentId}/segments/${chunkId}`,
      { method: 'POST', body: input },
      this.knowledgeApiKey,
    )
  }

  async retrieve(
    datasetId: string,
    query: string,
    retrievalModel?: RetrievalModel,
    attachmentIds?: string[],
  ) {
    return this.request<{ query: { content: string }; records: DifyRetrievalRecord[] }>(
      `/datasets/${datasetId}/retrieve`,
      {
        method: 'POST',
        body: {
          query,
          retrieval_model: retrievalModel,
          attachment_ids: attachmentIds ?? [],
        },
      },
      this.knowledgeApiKey,
    )
  }

  async streamChat(input: {
    query: string
    userId: string
    conversationId?: string
    inputs: Record<string, unknown>
    signal?: AbortSignal
  }) {
    if (!this.chatAppApiKey) throw new Error('DIFY_CHAT_APP_API_KEY is not configured')
    const response = await this.fetchWithTimeout(
      '/chat-messages',
      {
        method: 'POST',
        body: {
          query: input.query,
          user: input.userId,
          conversation_id: input.conversationId ?? '',
          inputs: input.inputs,
          response_mode: 'streaming',
          auto_generate_name: false,
        },
        signal: input.signal,
      },
      this.chatAppApiKey,
    )
    if (!response.body) throw new DifyApiError(response.status, 'empty_stream', 'Dify returned no stream')
    return parseSseStream(response.body)
  }

  async chat(input: {
    query: string
    userId: string
    conversationId?: string
    inputs: Record<string, unknown>
    signal?: AbortSignal
  }) {
    if (!this.chatAppApiKey) throw new Error('DIFY_CHAT_APP_API_KEY is not configured')
    return this.request<{
      answer: string
      conversation_id: string
      message_id: string
      metadata?: {
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      }
    }>(
      '/chat-messages',
      {
        method: 'POST',
        body: {
          query: input.query,
          user: input.userId,
          conversation_id: input.conversationId ?? '',
          inputs: input.inputs,
          response_mode: 'blocking',
          auto_generate_name: false,
        },
        signal: input.signal,
      },
      this.chatAppApiKey,
    )
  }

  async listConversationMessages(conversationId: string, userId: string) {
    const params = new URLSearchParams({ conversation_id: conversationId, user: userId })
    return this.request<{ data: unknown[]; has_more: boolean }>(
      `/messages?${params.toString()}`,
      { method: 'GET' },
      this.chatAppApiKey ?? this.knowledgeApiKey,
    )
  }

  private async request<T>(path: string, options: RequestOptions, apiKey: string): Promise<T> {
    const response = await this.fetchWithTimeout(path, options, apiKey)
    if (response.status === 204) return undefined as T
    const payload = (await response.json()) as T
    return payload
  }

  private async fetchWithTimeout(path: string, options: RequestOptions, apiKey: string) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const abortFromCaller = () => controller.abort()
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })

    try {
      const headers = new Headers({ Authorization: `Bearer ${apiKey}` })
      let body: BodyInit | undefined
      if (options.formData) {
        body = options.formData
      } else if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json')
        body = JSON.stringify(options.body)
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'POST',
        headers,
        body,
        signal: controller.signal,
      })
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as DifyErrorBody
        throw new DifyApiError(
          response.status,
          errorBody.code ?? 'dify_request_failed',
          errorBody.message ?? `Dify request failed with status ${response.status}`,
          errorBody,
        )
      }
      return response
    } catch (error) {
      if (error instanceof DifyApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DifyApiError(408, 'dify_timeout', 'Dify request timed out', error)
      }
      throw new DifyApiError(502, 'dify_unreachable', 'Unable to reach Dify', error)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<DifyChatStreamEvent> {
  const reader = stream.getReader()
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
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data || data === '[DONE]') continue
        yield JSON.parse(data) as DifyChatStreamEvent
      }
    }
  } finally {
    reader.releaseLock()
  }
}
