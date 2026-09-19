import { ConflictException } from '@nestjs/common'
import type { CreateKnowledgeBaseInput, KnowledgeBase } from '@heritage/contracts'
import { describe, expect, it, vi } from 'vitest'
import { KnowledgeService } from '../src/knowledge/knowledge.service.js'

const input: CreateKnowledgeBaseInput = {
  name: '火山方舟多模态模型',
  description: '多模态知识库',
  indexing_technique: 'economy',
  chunk_structure: 'text_model',
  doc_language: 'Chinese Simplified',
  process_rule: { mode: 'automatic' },
  retrieval_model: {
    search_method: 'keyword_search',
    reranking_enable: false,
    top_k: 5,
    score_threshold_enabled: false,
  },
  metadata: {},
}

function knowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-1',
    name: input.name,
    description: input.description,
    status: 'failed',
    difyDatasetId: null,
    difyPublishFieldId: null,
    indexingTechnique: input.indexing_technique,
    embeddingModel: null,
    embeddingModelProvider: null,
    chunkStructure: input.chunk_structure,
    docLanguage: input.doc_language,
    retrievalModel: input.retrieval_model,
    processRule: input.process_rule,
    metadata: { provisioningError: 'previous failure' },
    documentCount: 0,
    publishedDocumentCount: 0,
    createdAt: '2026-09-18T12:15:07.873Z',
    updatedAt: '2026-09-18T12:15:07.921Z',
    ...overrides,
  }
}

function setup(existing: KnowledgeBase) {
  const repository = {
    findKnowledgeBaseByName: vi.fn().mockResolvedValue(existing),
    findKnowledgeBase: vi.fn().mockResolvedValue(existing),
    insertProvisioningKnowledgeBase: vi.fn(),
    resetFailedKnowledgeBaseForProvisioning: vi.fn(),
    markKnowledgeBaseReady: vi.fn().mockResolvedValue(undefined),
    markKnowledgeBaseFailed: vi.fn().mockResolvedValue(undefined),
  }
  const dify = {
    listKnowledgeBases: vi.fn().mockResolvedValue({ data: [] }),
    createKnowledgeBase: vi.fn().mockResolvedValue({ id: 'dataset-new' }),
    createMetadataField: vi.fn().mockResolvedValue({ id: 'field-1' }),
  }
  const service = new KnowledgeService(
    repository as never,
    {} as never,
    {} as never,
    dify as never,
  )
  return { service, repository, dify }
}

describe('KnowledgeService.create', () => {
  it('retries a failed local record instead of inserting a duplicate name', async () => {
    const failed = knowledgeBase()
    const ready = knowledgeBase({
      status: 'ready',
      difyDatasetId: 'dataset-new',
      difyPublishFieldId: 'field-1',
      metadata: {},
    })
    const { service, repository, dify } = setup(failed)
    repository.resetFailedKnowledgeBaseForProvisioning.mockResolvedValue(failed.id)
    repository.findKnowledgeBase.mockResolvedValue(ready)

    await expect(service.create(input)).resolves.toEqual(ready)

    expect(repository.insertProvisioningKnowledgeBase).not.toHaveBeenCalled()
    expect(repository.resetFailedKnowledgeBaseForProvisioning).toHaveBeenCalledWith(
      failed.id,
      expect.objectContaining({
        name: input.name,
        indexingTechnique: input.indexing_technique,
        retrievalModel: input.retrieval_model,
      }),
    )
    expect(dify.createKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ name: input.name }),
    )
    expect(repository.markKnowledgeBaseReady).toHaveBeenCalledWith(
      failed.id,
      'dataset-new',
      'field-1',
    )
  })

  it('recovers a failed record when Dify already has the matching dataset', async () => {
    const failed = knowledgeBase()
    const ready = knowledgeBase({
      status: 'ready',
      difyDatasetId: 'dataset-existing',
      difyPublishFieldId: 'field-1',
      metadata: {},
    })
    const { service, repository, dify } = setup(failed)
    dify.listKnowledgeBases.mockResolvedValue({
      data: [{ id: 'dataset-existing', name: input.name }],
    })
    repository.findKnowledgeBase.mockResolvedValue(ready)

    await expect(service.create(input)).resolves.toEqual(ready)

    expect(repository.resetFailedKnowledgeBaseForProvisioning).not.toHaveBeenCalled()
    expect(dify.createKnowledgeBase).not.toHaveBeenCalled()
    expect(repository.markKnowledgeBaseReady).toHaveBeenCalledWith(
      failed.id,
      'dataset-existing',
      'field-1',
    )
  })

  it('rejects creation while the matching knowledge base is being deleted', async () => {
    const { service, repository } = setup(knowledgeBase({ status: 'deleting' }))

    await expect(service.create(input)).rejects.toBeInstanceOf(ConflictException)
    expect(repository.insertProvisioningKnowledgeBase).not.toHaveBeenCalled()
  })

  it('handles a concurrent insert conflict without leaking a database error', async () => {
    const ready = knowledgeBase({ status: 'ready', difyDatasetId: 'dataset-ready' })
    const { service, repository } = setup(ready)
    repository.findKnowledgeBaseByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ready)
    repository.insertProvisioningKnowledgeBase.mockResolvedValue(null)

    await expect(service.create(input)).rejects.toMatchObject({
      response: {
        code: 'knowledge_base_name_exists',
      },
    })
  })
})

describe('KnowledgeService.update', () => {
  it('updates only the name and description without sending indexing defaults to Dify', async () => {
    const ready = knowledgeBase({
      status: 'ready',
      difyDatasetId: 'dataset-ready',
      difyPublishFieldId: 'field-ready',
    })
    const repository = {
      findKnowledgeBase: vi.fn().mockResolvedValue(ready),
    }
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    const dify = {
      updateKnowledgeBase: vi.fn().mockResolvedValue({ id: 'dataset-ready' }),
    }
    const service = new KnowledgeService(
      repository as never,
      database as never,
      {} as never,
      dify as never,
    )

    await service.update('kb-1', {
      name: 'Updated knowledge base',
      description: 'Updated description',
    })

    expect(dify.updateKnowledgeBase).toHaveBeenCalledWith('dataset-ready', {
      name: 'Updated knowledge base',
      description: 'Updated description',
    })
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE knowledge_bases SET'),
      ['kb-1', 'Updated knowledge base', 'Updated description'],
    )
    expect(database.query.mock.calls[0]?.[0]).not.toContain('indexing_technique')
  })
})
