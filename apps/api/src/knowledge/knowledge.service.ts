import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  createKnowledgeBaseSchema,
  retrievalTestSchema,
  textDocumentSchema,
  updateKnowledgeBaseSchema,
  type CreateKnowledgeBaseInput,
  type DocumentLifecycleStatus,
  type KnowledgeBase,
  type UpdateKnowledgeBaseInput,
} from '@heritage/contracts'
import {
  DifyApiError,
  type DifyKnowledgeClient,
  type RetrievalModel as DifyRetrievalModel,
} from '@heritage/dify-client'
import { DIFY_CLIENT } from '../dify/dify.module.js'
import { DatabaseService } from '../database/database.service.js'
import { mapDifyIndexingStage } from './indexing-stage.js'
import { IngestionQueueService } from './ingestion-queue.service.js'
import { KnowledgeRepository } from './knowledge.repository.js'

const PUBLISH_FIELD_NAME = 'app_publish_state'

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(KnowledgeRepository) private readonly repository: KnowledgeRepository,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IngestionQueueService) private readonly queue: IngestionQueueService,
    @Inject(DIFY_CLIENT) private readonly dify: DifyKnowledgeClient,
  ) {}

  list(keyword?: string) {
    return this.repository.listKnowledgeBases(keyword)
  }

  async get(id: string) {
    const knowledgeBase = await this.repository.findKnowledgeBase(id)
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found')
    return knowledgeBase
  }

  async create(input: CreateKnowledgeBaseInput) {
    const parsed = createKnowledgeBaseSchema.parse(input)
    if (parsed.indexing_technique === 'high_quality' && (!parsed.embedding_model || !parsed.embedding_model_provider)) {
      throw new BadRequestException({
        code: 'embedding_model_required',
        message: 'High quality indexing requires an embedding model.',
      })
    }

    const existing = await this.repository.findKnowledgeBaseByName(parsed.name)
    if (existing) return this.handleExistingKnowledgeBase(existing, parsed)

    const localId = await this.repository.insertProvisioningKnowledgeBase({
      name: parsed.name,
      description: parsed.description,
      indexingTechnique: parsed.indexing_technique,
      embeddingModel: parsed.embedding_model,
      embeddingModelProvider: parsed.embedding_model_provider,
      chunkStructure: parsed.chunk_structure,
      docLanguage: parsed.doc_language,
      retrievalModel: parsed.retrieval_model,
      processRule: parsed.process_rule,
      metadata: parsed.metadata,
    })

    if (!localId) {
      const concurrent = await this.repository.findKnowledgeBaseByName(parsed.name)
      if (!concurrent) {
        throw new ConflictException({
          code: 'knowledge_base_create_conflict',
          message: 'A concurrent knowledge base creation is already in progress.',
        })
      }
      return this.handleExistingKnowledgeBase(concurrent, parsed)
    }

    return this.provisionKnowledgeBase(localId, parsed)
  }

  private async handleExistingKnowledgeBase(
    existing: KnowledgeBase,
    parsed: CreateKnowledgeBaseInput,
  ) {
    if (existing.status === 'ready') {
      throw new ConflictException({
        code: 'knowledge_base_name_exists',
        message: 'A knowledge base with this name already exists.',
      })
    }
    if (existing.status === 'provisioning') return this.recoverProvisioning(existing)
    if (existing.status === 'deleting') {
      throw new ConflictException({
        code: 'knowledge_base_deleting',
        message: 'The knowledge base is being deleted.',
      })
    }
    return this.retryFailedProvisioning(existing, parsed)
  }

  private async provisionKnowledgeBase(localId: string, parsed: CreateKnowledgeBaseInput) {
    try {
      const dataset = await this.dify.createKnowledgeBase({
        name: parsed.name,
        description: parsed.description,
        indexing_technique: parsed.indexing_technique,
        embedding_model: parsed.embedding_model,
        embedding_model_provider: parsed.embedding_model_provider,
        retrieval_model: parsed.retrieval_model as DifyRetrievalModel,
        summary_index_setting: parsed.summary_index_setting,
      })
      const fieldId = await this.ensurePublishMetadataField(dataset.id)
      await this.repository.markKnowledgeBaseReady(localId, dataset.id, fieldId)
      return this.get(localId)
    } catch (error) {
      await this.repository.markKnowledgeBaseFailed(localId, this.errorMessage(error))
      throw error
    }
  }

  async update(id: string, input: UpdateKnowledgeBaseInput) {
    const parsed = updateKnowledgeBaseSchema.parse(input)
    const current = await this.requireReadyKnowledgeBase(id)
    if (current.difyDatasetId) {
      await this.dify.updateKnowledgeBase(current.difyDatasetId, {
        name: parsed.name,
        description: parsed.description,
      })
    }
    await this.database.query(
      `
      UPDATE knowledge_bases SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        updated_at = now()
      WHERE id = $1
      `,
      [id, parsed.name ?? null, parsed.description ?? null],
    )
    return this.get(id)
  }

  async delete(id: string) {
    const knowledgeBase = await this.requireReadyKnowledgeBase(id)
    if (knowledgeBase.difyDatasetId) {
      await this.dify.deleteKnowledgeBase(knowledgeBase.difyDatasetId)
    }
    await this.repository.deleteKnowledgeBase(id)
    return { result: 'success' }
  }

  async listModels(modelType: 'text-embedding' | 'rerank' | 'llm') {
    const response = await this.dify.listModels(modelType)
    return response.data.flatMap((provider) =>
      provider.models
        .filter((model) => model.status === 'active')
        .map((model) => ({
          provider: provider.provider,
          providerLabel: provider.label.zh_Hans ?? provider.label.en_US ?? provider.provider,
          model: model.model,
          modelLabel: model.label?.zh_Hans ?? model.label?.en_US ?? model.model,
          modelType: model.model_type,
          status: model.status,
        })),
    )
  }

  async uploadFile(knowledgeBaseId: string, file: { filename: string; mimeType: string; buffer: Buffer }) {
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const datasetId = knowledgeBase.difyDatasetId!
    const response = await this.dify.createDocumentByFile(
      datasetId,
      file,
      this.documentMutationConfig(knowledgeBase),
    )
    return this.persistUploadedDocument({
      knowledgeBase,
      response,
      name: file.filename,
      sourceType: 'file',
      mimeType: file.mimeType,
      sizeBytes: file.buffer.byteLength,
      sourceConfig: {
        filename: file.filename,
        sizeBytes: file.buffer.byteLength,
      },
    })
  }

  async createTextDocument(knowledgeBaseId: string, input: { name: string; text: string }) {
    const parsed = textDocumentSchema.parse(input)
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const response = await this.dify.createDocumentByText(
      knowledgeBase.difyDatasetId!,
      parsed.name,
      parsed.text,
      this.documentMutationConfig(knowledgeBase),
    )
    return this.persistUploadedDocument({
      knowledgeBase,
      response,
      name: parsed.name,
      sourceType: 'text',
      sizeBytes: Buffer.byteLength(parsed.text, 'utf8'),
      sourceConfig: {
        characterCount: parsed.text.length,
      },
    })
  }

  listDocuments(knowledgeBaseId: string) {
    return this.repository.listDocuments(knowledgeBaseId)
  }

  listTasks(knowledgeBaseId: string) {
    return this.repository.listTasks(knowledgeBaseId)
  }

  async taskEvents(taskId: string, afterId: number) {
    return this.repository.listEvents(taskId, afterId)
  }

  async isTaskTerminal(taskId: string) {
    const task = await this.repository.findTask(taskId)
    return Boolean(task && ['completed', 'failed', 'cancelled'].includes(task.status))
  }

  async retrieve(knowledgeBaseId: string, input: unknown) {
    const parsed = retrievalTestSchema.parse(input)
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const retrievalModel = this.withPublishFilter(
      knowledgeBase.retrievalModel,
      parsed.include_drafts ? undefined : 'published',
      parsed.top_k,
      parsed.score_threshold,
    )
    return this.dify.retrieve(knowledgeBase.difyDatasetId!, parsed.query, retrievalModel)
  }

  async listChunks(knowledgeBaseId: string, documentId: string) {
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const document = await this.repository.findDocument(documentId)
    if (!document || document.knowledgeBaseId !== knowledgeBaseId || !document.difyDocumentId) {
      throw new NotFoundException('Document not found')
    }
    return this.dify.listChunks(knowledgeBase.difyDatasetId!, document.difyDocumentId)
  }

  async updateChunk(
    knowledgeBaseId: string,
    documentId: string,
    chunkId: string,
    input: { content: string; answer?: string; keywords?: string[]; enabled?: boolean },
  ) {
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const document = await this.repository.findDocument(documentId)
    if (!document || document.knowledgeBaseId !== knowledgeBaseId || !document.difyDocumentId) {
      throw new NotFoundException('Document not found')
    }
    if (document.status === 'published') {
      await this.setPublished(knowledgeBase, document.difyDocumentId, false)
      await this.repository.setDocumentPublished(document.id, false)
    }
    return this.dify.updateChunk(
      knowledgeBase.difyDatasetId!,
      document.difyDocumentId,
      chunkId,
      input,
    )
  }

  async publishDocument(knowledgeBaseId: string, documentId: string, published: boolean) {
    const knowledgeBase = await this.requireReadyKnowledgeBase(knowledgeBaseId)
    const document = await this.repository.findDocument(documentId)
    if (!document || document.knowledgeBaseId !== knowledgeBaseId || !document.difyDocumentId) {
      throw new NotFoundException('Document not found')
    }
    if (document.status !== 'review_required' && document.status !== 'published') {
      throw new BadRequestException({
        code: 'document_not_publishable',
        message: 'Only indexed documents awaiting review can be published.',
      })
    }
    await this.setPublished(knowledgeBase, document.difyDocumentId, published)
    await this.repository.setDocumentPublished(documentId, published)
    return this.repository.findDocument(documentId)
  }

  async processTask(taskId: string) {
    const task = await this.repository.findTask(taskId)
    if (!task || task.status === 'completed' || task.status === 'cancelled') return
    await this.repository.incrementTaskAttempt(taskId)

    const document = await this.repository.findDocument(task.documentId)
    if (!document?.difyBatchId) throw new Error('Document batch ID is missing')
    const knowledgeBase = await this.requireReadyKnowledgeBase(task.knowledgeBaseId)
    const start = Date.now()
    let lastStage = ''

    try {
      while (Date.now() - start < 900_000) {
        const response = await this.dify.getIndexingStatus(
          knowledgeBase.difyDatasetId!,
          document.difyBatchId,
        )
        const status = response.data.find((item) => item.id === document.difyDocumentId)
        if (!status) throw new Error('Dify has not returned the uploaded document yet')

        const stage = mapDifyIndexingStage(status.indexing_status)
        if (stage !== lastStage) {
          await this.repository.updateTask(taskId, {
            status: 'running',
            stage,
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          await this.repository.updateDocumentProgress(document.id, {
            status: stage,
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          await this.repository.appendEvent(taskId, 'progress', {
            stage,
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          lastStage = stage
        }

        if (status.indexing_status === 'completed') {
          await this.setPublished(knowledgeBase, document.difyDocumentId!, false)
          await this.repository.updateDocumentProgress(document.id, {
            status: 'review_required',
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          await this.repository.updateTask(taskId, {
            status: 'completed',
            stage: 'review_required',
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          await this.repository.appendEvent(taskId, 'completed', {
            stage: 'review_required',
            completedSegments: status.completed_segments,
            totalSegments: status.total_segments,
          })
          return
        }

        if (status.indexing_status === 'error') {
          throw new Error(status.error || 'Dify failed to index the document')
        }
        await this.sleep(2_500)
      }
      throw new Error('Indexing timed out')
    } catch (error) {
      const message = this.errorMessage(error)
      await this.repository.updateDocumentProgress(document.id, {
        status: 'failed',
        completedSegments: document.completedSegments,
        totalSegments: document.totalSegments,
        error: message,
      })
      await this.repository.updateTask(taskId, {
        status: 'failed',
        stage: 'failed',
        completedSegments: document.completedSegments,
        totalSegments: document.totalSegments,
        error: message,
      })
      await this.repository.appendEvent(taskId, 'error', { message })
      throw error
    }
  }

  private async recoverProvisioning(existing: KnowledgeBase) {
    if (existing.difyDatasetId) return this.get(existing.id)
    const match = await this.findDifyKnowledgeBase(existing.name)
    if (!match) throw new ConflictException('Knowledge base provisioning is already in progress')
    const fieldId = await this.ensurePublishMetadataField(match.id)
    await this.repository.markKnowledgeBaseReady(existing.id, match.id, fieldId)
    return this.get(existing.id)
  }

  private async retryFailedProvisioning(existing: KnowledgeBase, parsed: CreateKnowledgeBaseInput) {
    const match = await this.findDifyKnowledgeBase(existing.name)
    if (match) {
      const fieldId = await this.ensurePublishMetadataField(match.id)
      await this.repository.markKnowledgeBaseReady(existing.id, match.id, fieldId)
      return this.get(existing.id)
    }

    const localId = await this.repository.resetFailedKnowledgeBaseForProvisioning(existing.id, {
      name: parsed.name,
      description: parsed.description,
      indexingTechnique: parsed.indexing_technique,
      embeddingModel: parsed.embedding_model,
      embeddingModelProvider: parsed.embedding_model_provider,
      chunkStructure: parsed.chunk_structure,
      docLanguage: parsed.doc_language,
      retrievalModel: parsed.retrieval_model,
      processRule: parsed.process_rule,
      metadata: parsed.metadata,
    })
    if (!localId) {
      const current = await this.repository.findKnowledgeBase(existing.id)
      if (current?.status === 'provisioning') return this.recoverProvisioning(current)
      throw new ConflictException('Knowledge base provisioning is already in progress')
    }
    return this.provisionKnowledgeBase(localId, parsed)
  }

  private async findDifyKnowledgeBase(name: string) {
    const response = await this.dify.listKnowledgeBases({ keyword: name, limit: 20 })
    return response.data.find((item) => item.name === name)
  }

  private async ensurePublishMetadataField(datasetId: string) {
    try {
      const field = await this.dify.createMetadataField(datasetId, PUBLISH_FIELD_NAME, 'string')
      return field.id
    } catch (error) {
      if (!(error instanceof DifyApiError) || error.status !== 400) throw error
      const fields = await this.dify.listMetadataFields(datasetId)
      const existing = fields.doc_metadata.find((field) => field.name === PUBLISH_FIELD_NAME)
      if (!existing) throw error
      return existing.id
    }
  }

  private async setPublished(
    knowledgeBase: KnowledgeBase,
    difyDocumentId: string,
    published: boolean,
  ) {
    if (!knowledgeBase.difyDatasetId) throw new Error('Dify dataset ID is missing')
    const fieldId =
      knowledgeBase.difyPublishFieldId ??
      (await this.ensurePublishMetadataField(knowledgeBase.difyDatasetId))
    await this.dify.updateDocumentMetadata(
      knowledgeBase.difyDatasetId,
      difyDocumentId,
      fieldId,
      PUBLISH_FIELD_NAME,
      published ? 'published' : 'draft',
    )
  }

  private async persistUploadedDocument(input: {
    knowledgeBase: KnowledgeBase
    response: {
      batch: string
      document?: { id: string }
      documents?: Array<{ id: string }>
    }
    name: string
    sourceType: 'file' | 'text'
    mimeType?: string
    sizeBytes: number
    sourceConfig: Record<string, unknown>
  }) {
    const difyDocument = input.response.document ?? input.response.documents?.[0]
    if (!difyDocument) throw new Error('Dify did not return a document ID')

    const result = await this.database.transaction(async (client) => {
      const document = await this.repository.insertDocument(client, {
        knowledgeBaseId: input.knowledgeBase.id,
        difyDocumentId: difyDocument.id,
        difyBatchId: input.response.batch,
        name: input.name,
        sourceType: input.sourceType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'queued',
        sourceConfig: input.sourceConfig,
      })
      const task = await this.repository.insertTask(client, {
        knowledgeBaseId: input.knowledgeBase.id,
        documentId: document.id,
        kind: input.sourceType === 'file' ? 'file_upload' : 'text_upload',
      })
      await client.query(
        `INSERT INTO ingestion_events (task_id, type, payload) VALUES ($1, 'status', $2)`,
        [task.id, JSON.stringify({ stage: 'queued' })],
      )
      return { document, task }
    })
    await this.queue.enqueue(result.task.id)
    return result
  }

  private documentMutationConfig(knowledgeBase: KnowledgeBase) {
    return {
      indexing_technique: knowledgeBase.indexingTechnique,
      doc_form: knowledgeBase.chunkStructure,
      doc_language: knowledgeBase.docLanguage,
      process_rule: knowledgeBase.processRule,
      retrieval_model: this.withPublishFilter(knowledgeBase.retrievalModel, 'published'),
      embedding_model: knowledgeBase.embeddingModel ?? undefined,
      embedding_model_provider: knowledgeBase.embeddingModelProvider ?? undefined,
    }
  }

  private withPublishFilter(
    retrievalModel: KnowledgeBase['retrievalModel'],
    publishState?: 'published',
    topK?: number,
    scoreThreshold?: number,
  ): DifyRetrievalModel {
    return {
      ...retrievalModel,
      top_k: topK ?? retrievalModel.top_k,
      score_threshold: scoreThreshold ?? retrievalModel.score_threshold,
      metadata_filtering_conditions: publishState
        ? {
            logical_operator: 'and',
            conditions: [
              {
                name: PUBLISH_FIELD_NAME,
                comparison_operator: 'is',
                value: publishState,
              },
            ],
          }
        : undefined,
    }
  }

  private async requireReadyKnowledgeBase(id: string) {
    const knowledgeBase = await this.repository.findKnowledgeBase(id)
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found')
    if (knowledgeBase.status !== 'ready' || !knowledgeBase.difyDatasetId) {
      throw new BadRequestException('Knowledge base is not ready')
    }
    return knowledgeBase
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error'
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
