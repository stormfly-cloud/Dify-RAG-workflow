import {
  createKnowledgeBaseSchema,
  updateKnowledgeBaseSchema,
} from '@heritage/contracts'
import { describe, expect, it } from 'vitest'

const baseInput = {
  name: '测试知识库',
  description: '',
  indexing_technique: 'high_quality' as const,
  embedding_model: 'text-embedding-v4',
  embedding_model_provider: 'langgenius/tongyi/tongyi',
  chunk_structure: 'text_model' as const,
  doc_language: 'Chinese Simplified',
  process_rule: { mode: 'automatic' as const },
  retrieval_model: {
    search_method: 'semantic_search' as const,
    reranking_enable: false,
    top_k: 4,
    score_threshold_enabled: false,
  },
  metadata: {},
}

describe('createKnowledgeBaseSchema', () => {
  it('accepts a valid high-quality semantic configuration', () => {
    expect(createKnowledgeBaseSchema.safeParse(baseInput).success).toBe(true)
  })

  it('accepts a valid economy keyword configuration', () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...baseInput,
      indexing_technique: 'economy',
      embedding_model: undefined,
      embedding_model_provider: undefined,
      retrieval_model: {
        search_method: 'keyword_search',
        reranking_enable: false,
        top_k: 4,
        score_threshold_enabled: false,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts hierarchical process rules for parent-child chunking', () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...baseInput,
      chunk_structure: 'hierarchical_model',
      process_rule: {
        mode: 'hierarchical',
        rules: {
          pre_processing_rules: [
            { id: 'remove_extra_spaces', enabled: true },
            { id: 'remove_urls_emails', enabled: false },
          ],
          segmentation: { separator: '\n\n', max_tokens: 1024 },
          parent_mode: 'paragraph',
          subchunk_segmentation: { separator: '\n', max_tokens: 512 },
        },
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts hybrid weighted score only when weights add up to 1', () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...baseInput,
      retrieval_model: {
        search_method: 'hybrid_search',
        reranking_enable: false,
        reranking_mode: 'weighted_score',
        top_k: 4,
        score_threshold_enabled: false,
        weights: {
          weight_type: 'customized',
          vector_setting: {
            vector_weight: 0.7,
            embedding_model_name: 'text-embedding-v4',
            embedding_provider_name: 'langgenius/tongyi/tongyi',
          },
          keyword_setting: { keyword_weight: 0.3 },
        },
      },
    })

    expect(result.success).toBe(true)
  })

  it.each([
    [
      'economy with semantic search',
      {
        ...baseInput,
        indexing_technique: 'economy' as const,
        retrieval_model: {
          ...baseInput.retrieval_model,
          search_method: 'semantic_search' as const,
        },
      },
    ],
    [
      'economy with qa chunking',
      {
        ...baseInput,
        indexing_technique: 'economy' as const,
        chunk_structure: 'qa_model' as const,
        retrieval_model: {
          search_method: 'keyword_search' as const,
          reranking_enable: false,
          top_k: 4,
          score_threshold_enabled: false,
        },
      },
    ],
    [
      'hierarchical chunking with custom mode',
      {
        ...baseInput,
        chunk_structure: 'hierarchical_model' as const,
        process_rule: { mode: 'custom' as const },
      },
    ],
    [
      'custom mode without rules',
      {
        ...baseInput,
        process_rule: { mode: 'custom' as const },
      },
    ],
    [
      'hybrid weights that do not total 1',
      {
        ...baseInput,
        retrieval_model: {
          search_method: 'hybrid_search' as const,
          reranking_enable: false,
          reranking_mode: 'weighted_score' as const,
          top_k: 4,
          score_threshold_enabled: false,
          weights: {
            weight_type: 'customized' as const,
            vector_setting: {
              vector_weight: 0.7,
              embedding_model_name: 'text-embedding-v4',
              embedding_provider_name: 'langgenius/tongyi/tongyi',
            },
            keyword_setting: { keyword_weight: 0.5 },
          },
        },
      },
    ],
    [
      'reranking model mode without a model',
      {
        ...baseInput,
        retrieval_model: {
          search_method: 'hybrid_search' as const,
          reranking_enable: true,
          reranking_mode: 'reranking_model' as const,
          top_k: 4,
          score_threshold_enabled: false,
        },
      },
    ],
    [
      'automatic mode with custom rules',
      {
        ...baseInput,
        process_rule: {
          mode: 'automatic' as const,
          rules: {
            pre_processing_rules: [],
            segmentation: { separator: '\n', max_tokens: 500 },
          },
        },
      },
    ],
  ])('rejects %s', (_name, input) => {
    expect(createKnowledgeBaseSchema.safeParse(input).success).toBe(false)
  })
})

describe('updateKnowledgeBaseSchema', () => {
  it('parses only editable name and description fields without create defaults', () => {
    const result = updateKnowledgeBaseSchema.safeParse({
      name: 'Updated knowledge base',
      description: 'Updated description',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        name: 'Updated knowledge base',
        description: 'Updated description',
      })
      expect(result.data).not.toHaveProperty('indexing_technique')
      expect(result.data).not.toHaveProperty('retrieval_model')
    }
  })
})
