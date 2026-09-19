import { z } from 'zod'

export const indexingTechniqueSchema = z.enum(['high_quality', 'economy'])
export const chunkStructureSchema = z.enum(['text_model', 'qa_model', 'hierarchical_model'])
export const searchMethodSchema = z.enum([
  'keyword_search',
  'semantic_search',
  'full_text_search',
  'hybrid_search',
])
export const rerankingModeSchema = z.enum(['reranking_model', 'weighted_score'])
export const parentModeSchema = z.enum(['full-doc', 'paragraph'])

export const retrievalModelSchema = z.object({
  search_method: searchMethodSchema,
  reranking_enable: z.boolean(),
  reranking_mode: rerankingModeSchema.nullable().optional(),
  reranking_model: z
    .object({
      reranking_provider_name: z.string(),
      reranking_model_name: z.string(),
    })
    .optional(),
  top_k: z.number().int().min(1).max(20),
  score_threshold_enabled: z.boolean(),
  score_threshold: z.number().min(0).max(1).nullable().optional(),
  weights: z
    .object({
      weight_type: z.enum(['semantic_first', 'keyword_first', 'customized']),
      vector_setting: z
        .object({
          vector_weight: z.number().min(0).max(1),
          embedding_model_name: z.string().optional(),
          embedding_provider_name: z.string().optional(),
        })
        .optional(),
      keyword_setting: z
        .object({
          keyword_weight: z.number().min(0).max(1),
        })
        .optional(),
    })
    .nullable()
    .optional(),
})

export const processRuleSchema = z.object({
  mode: z.enum(['automatic', 'custom', 'hierarchical']),
  rules: z
    .object({
      pre_processing_rules: z.array(
        z.object({
          id: z.enum(['remove_extra_spaces', 'remove_urls_emails']),
          enabled: z.boolean(),
        }),
      ),
      segmentation: z.object({
        separator: z.string().min(1),
        max_tokens: z.number().int().min(1).max(4000),
        chunk_overlap: z.number().int().min(0).max(1000).optional(),
      }),
      parent_mode: parentModeSchema.optional(),
      subchunk_segmentation: z
        .object({
          separator: z.string().min(1),
          max_tokens: z.number().int().min(1).max(4000),
          chunk_overlap: z.number().int().min(0).max(1000).optional(),
        })
        .optional(),
    })
    .optional(),
})

export const summaryIndexSettingSchema = z.object({
  enable: z.boolean(),
  model_name: z.string().optional(),
  model_provider_name: z.string().optional(),
  summary_prompt: z.string().optional(),
})

const createKnowledgeBaseBaseSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(400).default(''),
  indexing_technique: indexingTechniqueSchema.default('high_quality'),
  embedding_model: z.string().optional(),
  embedding_model_provider: z.string().optional(),
  chunk_structure: chunkStructureSchema.default('text_model'),
  doc_language: z.string().default('Chinese Simplified'),
  process_rule: processRuleSchema,
  retrieval_model: retrievalModelSchema,
  summary_index_setting: summaryIndexSettingSchema.optional(),
  metadata: z.record(z.string(), z.string()).default({}),
})

function validateKnowledgeBaseConsistency(
  input: z.infer<typeof createKnowledgeBaseBaseSchema>,
  context: z.RefinementCtx,
) {
  const { indexing_technique, chunk_structure, process_rule, retrieval_model } = input

  if (indexing_technique === 'economy') {
    if (chunk_structure !== 'text_model') {
      context.addIssue({
        code: 'custom',
        path: ['chunk_structure'],
        message: 'Economy indexing only supports text_model chunking.',
      })
    }
    if (retrieval_model.search_method !== 'keyword_search') {
      context.addIssue({
        code: 'custom',
        path: ['retrieval_model', 'search_method'],
        message: 'Economy indexing requires keyword_search retrieval.',
      })
    }
    if (
      retrieval_model.reranking_enable ||
      retrieval_model.reranking_mode ||
      retrieval_model.reranking_model ||
      retrieval_model.weights
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retrieval_model'],
        message: 'Economy indexing does not support reranking or weighted search.',
      })
    }
    if (retrieval_model.score_threshold_enabled) {
      context.addIssue({
        code: 'custom',
        path: ['retrieval_model', 'score_threshold_enabled'],
        message: 'Economy indexing does not support score threshold filtering.',
      })
    }
  }

  if (chunk_structure === 'hierarchical_model') {
    if (process_rule.mode !== 'hierarchical') {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'mode'],
        message: 'Hierarchical chunking requires process_rule.mode=hierarchical.',
      })
    }
    if (!process_rule.rules?.parent_mode) {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'rules', 'parent_mode'],
        message: 'Hierarchical chunking requires parent_mode.',
      })
    }
    if (!process_rule.rules?.segmentation) {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'rules', 'segmentation'],
        message: 'Hierarchical chunking requires parent segmentation.',
      })
    }
    if (!process_rule.rules?.subchunk_segmentation) {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'rules', 'subchunk_segmentation'],
        message: 'Hierarchical chunking requires child segmentation.',
      })
    }
  } else if (process_rule.mode === 'hierarchical') {
    context.addIssue({
      code: 'custom',
      path: ['process_rule', 'mode'],
      message: 'process_rule.mode=hierarchical requires hierarchical_model chunking.',
    })
  } else if (process_rule.mode === 'automatic' && process_rule.rules) {
    context.addIssue({
      code: 'custom',
      path: ['process_rule', 'rules'],
      message: 'Automatic processing must not include custom rules.',
    })
  } else if (process_rule.mode === 'custom') {
    if (!process_rule.rules?.pre_processing_rules) {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'rules', 'pre_processing_rules'],
        message: 'Custom processing requires pre-processing rules.',
      })
    }
    if (!process_rule.rules?.segmentation) {
      context.addIssue({
        code: 'custom',
        path: ['process_rule', 'rules', 'segmentation'],
        message: 'Custom processing requires segmentation rules.',
      })
    }
  }

  if (retrieval_model.search_method === 'hybrid_search') {
    if (retrieval_model.reranking_mode === 'weighted_score') {
      if (retrieval_model.reranking_enable) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'reranking_enable'],
          message: 'Weighted score mode requires reranking_enable=false.',
        })
      }
      const vectorSetting = retrieval_model.weights?.vector_setting
      const keywordSetting = retrieval_model.weights?.keyword_setting
      if (!vectorSetting || !keywordSetting) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'weights'],
          message: 'Weighted score mode requires vector and keyword weights.',
        })
      } else {
        if (!vectorSetting.embedding_model_name || !vectorSetting.embedding_provider_name) {
          context.addIssue({
            code: 'custom',
            path: ['retrieval_model', 'weights', 'vector_setting'],
            message: 'Weighted score mode requires the embedding model and provider.',
          })
        }
        const total = vectorSetting.vector_weight + keywordSetting.keyword_weight
        if (Math.abs(total - 1) > 0.0001) {
          context.addIssue({
            code: 'custom',
            path: ['retrieval_model', 'weights'],
            message: 'Vector and keyword weights must add up to 1.',
          })
        }
      }
      if (retrieval_model.reranking_model) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'reranking_model'],
          message: 'Weighted score mode must not include a reranking model.',
        })
      }
    } else if (retrieval_model.reranking_mode === 'reranking_model') {
      if (!retrieval_model.reranking_enable) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'reranking_enable'],
          message: 'Reranking model mode requires reranking_enable=true.',
        })
      }
      if (
        !retrieval_model.reranking_model?.reranking_provider_name ||
        !retrieval_model.reranking_model.reranking_model_name
      ) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'reranking_model'],
          message: 'Reranking model mode requires a provider and model.',
        })
      }
      if (retrieval_model.weights) {
        context.addIssue({
          code: 'custom',
          path: ['retrieval_model', 'weights'],
          message: 'Reranking model mode must not include weighted score settings.',
        })
      }
    } else {
      context.addIssue({
        code: 'custom',
        path: ['retrieval_model', 'reranking_mode'],
        message: 'Hybrid search requires an explicit reranking_mode.',
      })
    }
  } else if (retrieval_model.weights) {
    context.addIssue({
      code: 'custom',
      path: ['retrieval_model', 'weights'],
      message: 'Weighted score settings are only valid for hybrid search.',
    })
  } else if (
    retrieval_model.reranking_enable &&
    retrieval_model.reranking_mode !== 'reranking_model'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['retrieval_model', 'reranking_mode'],
      message: 'Enabled reranking requires reranking_mode=reranking_model.',
    })
  } else if (
    retrieval_model.reranking_enable &&
    (!retrieval_model.reranking_model?.reranking_provider_name ||
      !retrieval_model.reranking_model.reranking_model_name)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['retrieval_model', 'reranking_model'],
      message: 'Enabled reranking requires a provider and model.',
    })
  }
}

export const createKnowledgeBaseSchema = createKnowledgeBaseBaseSchema.superRefine(
  validateKnowledgeBaseConsistency,
)

export const updateKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(400).optional(),
})

export const textDocumentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  text: z.string().min(1),
})

export const retrievalTestSchema = z.object({
  query: z.string().trim().min(1).max(250),
  include_drafts: z.boolean().default(false),
  top_k: z.number().int().min(1).max(20).optional(),
  score_threshold: z.number().min(0).max(1).optional(),
})

export const publishDocumentSchema = z.object({
  published: z.boolean(),
})

export const chatRequestSchema = z.object({
  query: z.string().trim().min(1).max(4000),
  knowledge_base_ids: z.array(z.string().uuid()).min(1),
  conversation_id: z.string().uuid().optional(),
  user_id: z.string().min(1),
})

export type IndexingTechnique = z.infer<typeof indexingTechniqueSchema>
export type ChunkStructure = z.infer<typeof chunkStructureSchema>
export type SearchMethod = z.infer<typeof searchMethodSchema>
export type RetrievalModel = z.infer<typeof retrievalModelSchema>
export type ProcessRule = z.infer<typeof processRuleSchema>
export type SummaryIndexSetting = z.infer<typeof summaryIndexSettingSchema>
export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>
export type UpdateKnowledgeBaseInput = z.infer<typeof updateKnowledgeBaseSchema>
export type TextDocumentInput = z.infer<typeof textDocumentSchema>
export type RetrievalTestInput = z.infer<typeof retrievalTestSchema>
export type PublishDocumentInput = z.infer<typeof publishDocumentSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>

export const documentIndexingStatuses = [
  'uploading',
  'waiting',
  'parsing',
  'cleaning',
  'splitting',
  'indexing',
  'completed',
  'error',
  'paused',
] as const

export const documentLifecycleStatuses = [
  'uploading',
  'queued',
  'parsing',
  'cleaning',
  'splitting',
  'indexing',
  'review_required',
  'published',
  'failed',
  'paused',
  'archived',
  'disabled',
] as const

export type DocumentIndexingStatus = (typeof documentIndexingStatuses)[number]
export type DocumentLifecycleStatus = (typeof documentLifecycleStatuses)[number]

export type KnowledgeBase = {
  id: string
  name: string
  description: string
  status: 'provisioning' | 'ready' | 'failed' | 'deleting'
  difyDatasetId: string | null
  difyPublishFieldId: string | null
  indexingTechnique: IndexingTechnique
  embeddingModel: string | null
  embeddingModelProvider: string | null
  chunkStructure: ChunkStructure
  docLanguage: string
  retrievalModel: RetrievalModel
  processRule: ProcessRule
  metadata: Record<string, string>
  documentCount: number
  publishedDocumentCount: number
  createdAt: string
  updatedAt: string
}

export type KnowledgeDocument = {
  id: string
  knowledgeBaseId: string
  difyDocumentId: string | null
  difyBatchId: string | null
  name: string
  sourceType: 'file' | 'text' | 'qa'
  mimeType: string | null
  sizeBytes: number
  status: DocumentLifecycleStatus
  completedSegments: number
  totalSegments: number
  error: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export type IngestionTask = {
  id: string
  knowledgeBaseId: string
  documentId: string
  kind: 'file_upload' | 'text_upload' | 'reindex' | 'metadata_publish'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: DocumentLifecycleStatus
  completedSegments: number
  totalSegments: number
  attempts: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export type IngestionEvent = {
  id: number
  taskId: string
  type: 'status' | 'progress' | 'error' | 'completed'
  payload: Record<string, unknown>
  createdAt: string
}

export type DifyModel = {
  provider: string
  providerLabel: string
  model: string
  modelLabel: string
  modelType: string
  status: string
}
