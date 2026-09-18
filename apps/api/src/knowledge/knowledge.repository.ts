import { Inject, Injectable } from '@nestjs/common'
import type {
  DocumentLifecycleStatus,
  IngestionEvent,
  IngestionTask,
  KnowledgeBase,
  KnowledgeDocument,
} from '@heritage/contracts'
import type { PoolClient } from 'pg'
import type { QueryResultRow } from 'pg'
import { DatabaseService } from '../database/database.service.js'

type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>
}

type KnowledgeBaseRow = {
  id: string
  name: string
  description: string
  status: KnowledgeBase['status']
  dify_dataset_id: string | null
  dify_publish_field_id: string | null
  indexing_technique: KnowledgeBase['indexingTechnique']
  embedding_model: string | null
  embedding_model_provider: string | null
  chunk_structure: KnowledgeBase['chunkStructure']
  retrieval_model: KnowledgeBase['retrievalModel']
  process_rule: KnowledgeBase['processRule']
  metadata: Record<string, string>
  document_count: string | number
  published_document_count: string | number
  created_at: Date
  updated_at: Date
}

type DocumentRow = {
  id: string
  knowledge_base_id: string
  dify_document_id: string | null
  dify_batch_id: string | null
  name: string
  source_type: KnowledgeDocument['sourceType']
  mime_type: string | null
  size_bytes: string | number
  status: DocumentLifecycleStatus
  completed_segments: number
  total_segments: number
  error: string | null
  created_at: Date
  updated_at: Date
  published_at: Date | null
}

type TaskRow = {
  id: string
  knowledge_base_id: string
  document_id: string
  kind: IngestionTask['kind']
  status: IngestionTask['status']
  stage: DocumentLifecycleStatus
  completed_segments: number
  total_segments: number
  attempts: number
  error: string | null
  created_at: Date
  updated_at: Date
}

function mapKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    difyDatasetId: row.dify_dataset_id,
    difyPublishFieldId: row.dify_publish_field_id,
    indexingTechnique: row.indexing_technique,
    embeddingModel: row.embedding_model,
    embeddingModelProvider: row.embedding_model_provider,
    chunkStructure: row.chunk_structure,
    retrievalModel: row.retrieval_model,
    processRule: row.process_rule,
    metadata: row.metadata,
    documentCount: Number(row.document_count),
    publishedDocumentCount: Number(row.published_document_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    difyDocumentId: row.dify_document_id,
    difyBatchId: row.dify_batch_id,
    name: row.name,
    sourceType: row.source_type,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    completedSegments: row.completed_segments,
    totalSegments: row.total_segments,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  }
}

function mapTask(row: TaskRow): IngestionTask {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    documentId: row.document_id,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    completedSegments: row.completed_segments,
    totalSegments: row.total_segments,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

@Injectable()
export class KnowledgeRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listKnowledgeBases(keyword = '') {
    const result = await this.database.query<KnowledgeBaseRow>(
      `
      SELECT kb.*,
        COUNT(d.id)::int AS document_count,
        COUNT(d.id) FILTER (WHERE d.status = 'published')::int AS published_document_count
      FROM knowledge_bases kb
      LEFT JOIN documents d ON d.knowledge_base_id = kb.id
      WHERE ($1 = '' OR kb.name ILIKE '%' || $1 || '%')
      GROUP BY kb.id
      ORDER BY kb.updated_at DESC
      `,
      [keyword],
    )
    return result.rows.map(mapKnowledgeBase)
  }

  async findKnowledgeBase(id: string) {
    const result = await this.database.query<KnowledgeBaseRow>(
      `
      SELECT kb.*,
        COUNT(d.id)::int AS document_count,
        COUNT(d.id) FILTER (WHERE d.status = 'published')::int AS published_document_count
      FROM knowledge_bases kb
      LEFT JOIN documents d ON d.knowledge_base_id = kb.id
      WHERE kb.id = $1
      GROUP BY kb.id
      `,
      [id],
    )
    return result.rows[0] ? mapKnowledgeBase(result.rows[0]) : null
  }

  async findKnowledgeBaseByName(name: string) {
    const result = await this.database.query<KnowledgeBaseRow>(
      `
      SELECT kb.*,
        COUNT(d.id)::int AS document_count,
        COUNT(d.id) FILTER (WHERE d.status = 'published')::int AS published_document_count
      FROM knowledge_bases kb
      LEFT JOIN documents d ON d.knowledge_base_id = kb.id
      WHERE kb.name = $1
      GROUP BY kb.id
      `,
      [name],
    )
    return result.rows[0] ? mapKnowledgeBase(result.rows[0]) : null
  }

  async insertProvisioningKnowledgeBase(input: {
    name: string
    description: string
    indexingTechnique: KnowledgeBase['indexingTechnique']
    embeddingModel?: string
    embeddingModelProvider?: string
    chunkStructure: KnowledgeBase['chunkStructure']
    retrievalModel: KnowledgeBase['retrievalModel']
    processRule: KnowledgeBase['processRule']
    metadata: Record<string, string>
  }) {
    const result = await this.database.query<{ id: string }>(
      `
      INSERT INTO knowledge_bases (
        name, description, status, indexing_technique, embedding_model,
        embedding_model_provider, chunk_structure, retrieval_model, process_rule, metadata
      )
      VALUES ($1, $2, 'provisioning', $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        input.name,
        input.description,
        input.indexingTechnique,
        input.embeddingModel ?? null,
        input.embeddingModelProvider ?? null,
        input.chunkStructure,
        JSON.stringify(input.retrievalModel),
        JSON.stringify(input.processRule),
        JSON.stringify(input.metadata),
      ],
    )
    return result.rows[0]!.id
  }

  async markKnowledgeBaseReady(id: string, difyDatasetId: string, publishFieldId: string) {
    await this.database.query(
      `
      UPDATE knowledge_bases
      SET status = 'ready', dify_dataset_id = $2, dify_publish_field_id = $3, updated_at = now()
      WHERE id = $1
      `,
      [id, difyDatasetId, publishFieldId],
    )
  }

  async markKnowledgeBaseFailed(id: string, message: string) {
    await this.database.query(
      `UPDATE knowledge_bases SET status = 'failed', metadata = metadata || $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify({ provisioningError: message })],
    )
  }

  async resetFailedKnowledgeBaseForProvisioning(
    id: string,
    input: {
      name: string
      description: string
      indexingTechnique: KnowledgeBase['indexingTechnique']
      embeddingModel?: string
      embeddingModelProvider?: string
      chunkStructure: KnowledgeBase['chunkStructure']
      retrievalModel: KnowledgeBase['retrievalModel']
      processRule: KnowledgeBase['processRule']
      metadata: Record<string, string>
    },
  ) {
    const result = await this.database.query<{ id: string }>(
      `
      UPDATE knowledge_bases SET
        name = $2,
        description = $3,
        status = 'provisioning',
        indexing_technique = $4,
        embedding_model = $5,
        embedding_model_provider = $6,
        chunk_structure = $7,
        retrieval_model = $8,
        process_rule = $9,
        metadata = (metadata - 'provisioningError') || $10::jsonb,
        updated_at = now()
      WHERE id = $1 AND status = 'failed'
      RETURNING id
      `,
      [
        id,
        input.name,
        input.description,
        input.indexingTechnique,
        input.embeddingModel ?? null,
        input.embeddingModelProvider ?? null,
        input.chunkStructure,
        JSON.stringify(input.retrievalModel),
        JSON.stringify(input.processRule),
        JSON.stringify(input.metadata),
      ],
    )
    return result.rows[0]?.id ?? null
  }

  async deleteKnowledgeBase(id: string) {
    await this.database.query('DELETE FROM knowledge_bases WHERE id = $1', [id])
  }

  async insertDocument(
    client: Queryable,
    input: {
      knowledgeBaseId: string
      difyDocumentId: string | null
      difyBatchId: string | null
      name: string
      sourceType: KnowledgeDocument['sourceType']
      mimeType?: string
      sizeBytes: number
      status: KnowledgeDocument['status']
      sourceConfig: Record<string, unknown>
    },
  ) {
    const result = await client.query<DocumentRow>(
      `
      INSERT INTO documents (
        knowledge_base_id, dify_document_id, dify_batch_id, name, source_type,
        mime_type, size_bytes, status, source_config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        input.knowledgeBaseId,
        input.difyDocumentId,
        input.difyBatchId,
        input.name,
        input.sourceType,
        input.mimeType ?? null,
        input.sizeBytes,
        input.status,
        JSON.stringify(input.sourceConfig),
      ],
    )
    return mapDocument(result.rows[0]!)
  }

  async insertTask(
    client: Queryable,
    input: {
      knowledgeBaseId: string
      documentId: string
      kind: IngestionTask['kind']
    },
  ) {
    const result = await client.query<TaskRow>(
      `
      INSERT INTO ingestion_tasks (knowledge_base_id, document_id, kind, status, stage)
      VALUES ($1, $2, $3, 'queued', 'queued')
      RETURNING *
      `,
      [input.knowledgeBaseId, input.documentId, input.kind],
    )
    return mapTask(result.rows[0]!)
  }

  async listDocuments(knowledgeBaseId: string) {
    const result = await this.database.query<DocumentRow>(
      `SELECT * FROM documents WHERE knowledge_base_id = $1 ORDER BY created_at DESC`,
      [knowledgeBaseId],
    )
    return result.rows.map(mapDocument)
  }

  async findDocument(id: string) {
    const result = await this.database.query<DocumentRow>(
      'SELECT * FROM documents WHERE id = $1',
      [id],
    )
    return result.rows[0] ? mapDocument(result.rows[0]) : null
  }

  async listTasks(knowledgeBaseId: string) {
    const result = await this.database.query<TaskRow>(
      `SELECT * FROM ingestion_tasks WHERE knowledge_base_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [knowledgeBaseId],
    )
    return result.rows.map(mapTask)
  }

  async findTask(id: string) {
    const result = await this.database.query<TaskRow>(
      'SELECT * FROM ingestion_tasks WHERE id = $1',
      [id],
    )
    return result.rows[0] ? mapTask(result.rows[0]) : null
  }

  async incrementTaskAttempt(taskId: string) {
    await this.database.query(
      'UPDATE ingestion_tasks SET attempts = attempts + 1, status = $2, updated_at = now() WHERE id = $1',
      [taskId, 'running'],
    )
  }

  async updateTask(
    taskId: string,
    input: {
      status: IngestionTask['status']
      stage: DocumentLifecycleStatus
      completedSegments: number
      totalSegments: number
      error?: string | null
    },
  ) {
    await this.database.query(
      `
      UPDATE ingestion_tasks
      SET status = $2, stage = $3, completed_segments = $4, total_segments = $5,
          error = $6, updated_at = now()
      WHERE id = $1
      `,
      [
        taskId,
        input.status,
        input.stage,
        input.completedSegments,
        input.totalSegments,
        input.error ?? null,
      ],
    )
  }

  async updateDocumentProgress(
    documentId: string,
    input: {
      status: DocumentLifecycleStatus
      completedSegments: number
      totalSegments: number
      error?: string | null
    },
  ) {
    await this.database.query(
      `
      UPDATE documents
      SET status = $2, completed_segments = $3, total_segments = $4, error = $5, updated_at = now()
      WHERE id = $1
      `,
      [
        documentId,
        input.status,
        input.completedSegments,
        input.totalSegments,
        input.error ?? null,
      ],
    )
  }

  async setDocumentPublished(documentId: string, published: boolean) {
    await this.database.query(
      `
      UPDATE documents
      SET status = $2, published_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1
      `,
      [documentId, published ? 'published' : 'review_required', published],
    )
  }

  async appendEvent(
    taskId: string,
    type: IngestionEvent['type'],
    payload: Record<string, unknown>,
  ) {
    await this.database.query(
      `INSERT INTO ingestion_events (task_id, type, payload) VALUES ($1, $2, $3)`,
      [taskId, type, JSON.stringify(payload)],
    )
  }

  async listEvents(taskId: string, afterId = 0) {
    const result = await this.database.query<{
      id: string
      task_id: string
      type: IngestionEvent['type']
      payload: Record<string, unknown>
      created_at: Date
    }>(
      `
      SELECT * FROM ingestion_events
      WHERE task_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT 500
      `,
      [taskId, afterId],
    )
    return result.rows.map(
      (row): IngestionEvent => ({
        id: Number(row.id),
        taskId: row.task_id,
        type: row.type,
        payload: row.payload,
        createdAt: row.created_at.toISOString(),
      }),
    )
  }
}
