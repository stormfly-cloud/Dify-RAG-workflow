'use client'

import {
  App,
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Upload,
} from 'antd'
import type { UploadFile } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import type {
  ChunkStructure,
  CreateKnowledgeBaseInput,
  IndexingTechnique,
  RetrievalModel,
} from '@heritage/contracts'
import { adminApi } from '@/lib/api'

type ModelOption = Awaited<ReturnType<typeof adminApi.listModels>>[number]

type WizardValues = {
  name: string
  description: string
  indexing_technique: IndexingTechnique
  embedding_model?: string
  embedding_model_provider?: string
  chunk_structure: ChunkStructure
  doc_language: string
  process_mode: 'automatic' | 'custom'
  separator: string
  max_tokens: number
  chunk_overlap: number
  parent_mode: 'paragraph' | 'full-doc'
  parent_separator: string
  parent_max_tokens: number
  child_separator: string
  child_max_tokens: number
  remove_extra_spaces: boolean
  remove_urls_emails: boolean
  search_method: RetrievalModel['search_method']
  top_k: number
  score_threshold_enabled: boolean
  score_threshold: number
  reranking_mode: 'weighted_score' | 'reranking_model'
  reranking_enable: boolean
  reranking_provider_name?: string
  reranking_model_name?: string
  vector_weight: number
  keyword_weight: number
}

const initialValues: WizardValues = {
  name: '',
  description: '',
  indexing_technique: 'high_quality',
  chunk_structure: 'text_model',
  doc_language: 'Chinese Simplified',
  process_mode: 'automatic',
  separator: '\\n',
  max_tokens: 500,
  chunk_overlap: 50,
  parent_mode: 'paragraph',
  parent_separator: '\\n\\n',
  parent_max_tokens: 1024,
  child_separator: '\\n',
  child_max_tokens: 512,
  remove_extra_spaces: true,
  remove_urls_emails: false,
  search_method: 'hybrid_search',
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0.5,
  reranking_mode: 'weighted_score',
  reranking_enable: false,
  vector_weight: 0.7,
  keyword_weight: 0.3,
}

function clampWeight(value: number | null) {
  if (value === null || Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function complementaryWeight(value: number) {
  return Math.round((1 - value) * 100) / 100
}

function unescapeSeparator(value: string | undefined) {
  if (!value) return ''
  const escapes: Record<string, string> = {
    '0': '\0',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '\\': '\\',
    "'": "'",
    '"': '"',
  }
  return value.replace(/\\([\\'"0bfnrtv])/g, (_, code: string) => escapes[code] ?? code)
}

export function CreateKnowledgeWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (knowledgeBaseId: string) => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<WizardValues>()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<ModelOption[]>([])
  const [rerankModels, setRerankModels] = useState<ModelOption[]>([])
  const values = Form.useWatch([], form)
  const currentValues = values ?? initialValues
  const isHybridSearch = currentValues.search_method === 'hybrid_search'
  const useRerankModel = isHybridSearch
    ? currentValues.reranking_mode === 'reranking_model'
    : currentValues.reranking_enable
  const isHierarchicalChunking = currentValues.chunk_structure === 'hierarchical_model'

  useEffect(() => {
    if (!open) return
    void Promise.all([
      adminApi.listModels('text-embedding'),
      adminApi.listModels('rerank'),
    ]).then(([embedding, rerank]) => {
      setEmbeddingModels(embedding)
      setRerankModels(rerank)
    })
  }, [open])

  const payload = useMemo(() => {
    const current = currentValues
    const preProcessingRules = [
      {
        id: 'remove_extra_spaces' as const,
        enabled: current.remove_extra_spaces,
      },
      {
        id: 'remove_urls_emails' as const,
        enabled: current.remove_urls_emails,
      },
    ]
    const processRule: CreateKnowledgeBaseInput['process_rule'] =
      current.chunk_structure === 'hierarchical_model'
        ? {
            mode: 'hierarchical',
            rules: {
              pre_processing_rules: preProcessingRules,
              segmentation: {
                separator: unescapeSeparator(
                  current.parent_separator ?? initialValues.parent_separator,
                ),
                max_tokens: current.parent_max_tokens,
              },
              parent_mode: current.parent_mode,
              subchunk_segmentation: {
                separator: unescapeSeparator(
                  current.child_separator ?? initialValues.child_separator,
                ),
                max_tokens: current.child_max_tokens,
              },
            },
          }
        : {
            mode: current.process_mode,
            rules:
              current.process_mode === 'custom'
                ? {
                    pre_processing_rules: preProcessingRules,
                    segmentation: {
                      separator: unescapeSeparator(
                        current.separator ?? initialValues.separator,
                      ),
                      max_tokens: current.max_tokens,
                      chunk_overlap: current.chunk_overlap,
                    },
                  }
                : undefined,
          }
    return {
      name: current.name,
      description: current.description,
      indexing_technique: current.indexing_technique,
      embedding_model: current.embedding_model,
      embedding_model_provider: current.embedding_model_provider,
      chunk_structure: current.chunk_structure,
      doc_language: current.doc_language,
      process_rule: processRule,
      retrieval_model: {
        search_method: current.search_method,
        reranking_enable: useRerankModel,
        reranking_mode: isHybridSearch
          ? current.reranking_mode
          : current.reranking_enable
            ? 'reranking_model'
            : null,
        reranking_model:
          useRerankModel &&
          current.reranking_provider_name &&
          current.reranking_model_name
            ? {
                reranking_provider_name: current.reranking_provider_name,
                reranking_model_name: current.reranking_model_name,
              }
            : undefined,
        top_k: current.top_k,
        score_threshold_enabled: current.score_threshold_enabled,
        score_threshold: current.score_threshold_enabled
          ? current.score_threshold
          : null,
        weights:
          isHybridSearch && current.reranking_mode === 'weighted_score'
            ? {
                weight_type: 'customized',
                vector_setting: {
                  vector_weight: current.vector_weight,
                  embedding_model_name: current.embedding_model,
                  embedding_provider_name: current.embedding_model_provider,
                },
                keyword_setting: {
                  keyword_weight: current.keyword_weight,
                },
              }
            : null,
      },
      metadata: {},
    }
  }, [currentValues])

  const next = async () => {
    const fields: Array<keyof WizardValues>[] = [
      ['name'],
      ['indexing_technique', 'embedding_model', 'embedding_model_provider'],
      ['chunk_structure'],
      ['search_method', 'top_k'],
      [],
    ]
    if (step === 2) {
      if (currentValues.chunk_structure === 'hierarchical_model') {
        fields[2]!.push(
          'parent_mode',
          'parent_separator',
          'parent_max_tokens',
          'child_separator',
          'child_max_tokens',
        )
      } else {
        fields[2]!.push('process_mode')
        if (currentValues.process_mode === 'custom') {
          fields[2]!.push('separator', 'max_tokens', 'chunk_overlap')
        }
      }
    }
    if (useRerankModel) fields[3]!.push('reranking_model_name')
    await form.validateFields(fields[step])
    setStep((current) => Math.min(4, current + 1))
  }

  const submit = async () => {
    await form.validateFields()
    setSubmitting(true)
    try {
      const created = await adminApi.createKnowledgeBase(payload)
      for (const file of files) {
        if (file.originFileObj) {
          await adminApi.uploadFile(created.id, file.originFileObj)
        }
      }
      message.success('知识库已创建，文档已进入处理队列')
      form.resetFields()
      setFiles([])
      setStep(0)
      onCreated(created.id)
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="创建知识库"
      width={1040}
      open={open}
      onCancel={onClose}
      destroyOnClose
      footer={
        <Space>
          <Button disabled={step === 0 || submitting} onClick={() => setStep(step - 1)}>
            上一步
          </Button>
          {step < 4 ? (
            <Button type="primary" onClick={() => void next()}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={submitting} onClick={() => void submit()}>
              创建并上传
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        items={[
          { title: '基础信息' },
          { title: '索引模型' },
          { title: '文档分段' },
          { title: '检索设置' },
          { title: '导入数据' },
        ]}
      />

      <div className="wizard-grid" style={{ marginTop: 22 }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onValuesChange={() => undefined}
        >
          <div hidden={step !== 0}>
            <Form.Item
              label="知识库名称"
              name="name"
              rules={[{ required: true, whitespace: true, max: 40 }]}
            >
              <Input maxLength={40} placeholder="例如：国家级非遗代表性项目知识库" />
            </Form.Item>
            <Form.Item label="用途说明" name="description">
              <Input.TextArea
                maxLength={400}
                rows={5}
                placeholder="说明资料范围、维护部门和使用场景"
              />
            </Form.Item>
          </div>

          <div hidden={step !== 1}>
            <Form.Item label="索引方式" name="indexing_technique">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                onChange={(event) => {
                  if (event.target.value === 'economy') {
                    form.setFieldValue('chunk_structure', 'text_model')
                  }
                }}
              >
                <Radio.Button value="high_quality">高质量向量检索</Radio.Button>
                <Radio.Button
                  value="economy"
                  disabled={currentValues.chunk_structure !== 'text_model'}
                >
                  经济关键词检索
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(previous, current) =>
                previous.indexing_technique !== current.indexing_technique
              }
            >
              {({ getFieldValue }) => (
                <Form.Item
                  label="嵌入模型"
                  name="embedding_model"
                  rules={
                    getFieldValue('indexing_technique') === 'high_quality'
                      ? [{ required: true, message: '请选择嵌入模型' }]
                      : []
                  }
                >
                  <Select
                    disabled={getFieldValue('indexing_technique') === 'economy'}
                    placeholder="从 Dify 已配置模型中选择"
                    options={embeddingModels.map((model) => ({
                      value: model.model,
                      label: `${model.providerLabel} / ${model.modelLabel}`,
                    }))}
                    onChange={(value) => {
                      const model = embeddingModels.find((item) => item.model === value)
                      form.setFieldValue(
                        'embedding_model_provider',
                        model?.provider,
                      )
                    }}
                  />
                </Form.Item>
              )}
            </Form.Item>
            <Form.Item name="embedding_model_provider" hidden>
              <Input />
            </Form.Item>
          </div>

          <div hidden={step !== 2}>
            <Form.Item
              label="分段结构"
              name="chunk_structure"
              rules={[{ required: true }]}
            >
              <Radio.Group
                optionType="button"
                onChange={(event) => {
                  if (event.target.value !== 'text_model') {
                    form.setFieldValue('indexing_technique', 'high_quality')
                  }
                }}
              >
                <Radio.Button value="text_model">通用文本</Radio.Button>
                <Radio.Button
                  value="qa_model"
                  disabled={currentValues.indexing_technique === 'economy'}
                >
                  问答对
                </Radio.Button>
                <Radio.Button
                  value="hierarchical_model"
                  disabled={currentValues.indexing_technique === 'economy'}
                >
                  父子分段
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
            {isHierarchicalChunking ? (
              <div className="segmentation-settings-stack">
                <section className="segmentation-settings-section">
                  <div className="segmentation-settings-section-title">父块（用于上下文）</div>
                  <Form.Item label="父块合并模式" name="parent_mode">
                    <Radio.Group optionType="button">
                      <Radio.Button value="paragraph">按段落</Radio.Button>
                      <Radio.Button value="full-doc">完整文档</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                  {currentValues.parent_mode === 'paragraph' && (
                    <Space align="start" wrap>
                      <Form.Item label="父块分隔符" name="parent_separator">
                        <Input style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item label="父块最大 Characters" name="parent_max_tokens">
                        <InputNumber min={1} max={4000} />
                      </Form.Item>
                    </Space>
                  )}
                </section>
                <section className="segmentation-settings-section">
                  <div className="segmentation-settings-section-title">子块（用于检索）</div>
                  <Space align="start" wrap>
                    <Form.Item label="子块分隔符" name="child_separator">
                      <Input style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item label="子块最大 Characters" name="child_max_tokens">
                      <InputNumber min={1} max={4000} />
                    </Form.Item>
                  </Space>
                </section>
                <section className="segmentation-settings-section">
                  <div className="segmentation-settings-section-title">处理规则</div>
                  <Space size="large">
                    <Form.Item
                      label="移除多余空格"
                      name="remove_extra_spaces"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                    <Form.Item
                      label="移除 URL 与邮箱"
                      name="remove_urls_emails"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                  </Space>
                </section>
              </div>
            ) : (
              <div className="segmentation-settings-stack">
                <section className="segmentation-settings-section">
                  <div className="segmentation-settings-section-title">处理模式</div>
                  <Form.Item name="process_mode" noStyle>
                    <Radio.Group optionType="button">
                      <Radio.Button value="automatic">自动</Radio.Button>
                      <Radio.Button value="custom">自定义</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                </section>
                {currentValues.process_mode === 'custom' && (
                  <section className="segmentation-settings-section">
                    <div className="segmentation-settings-section-title">自定义分段</div>
                    <Space align="start" wrap>
                      <Form.Item label="分段标识符" name="separator">
                        <Input style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item label="最大 Characters" name="max_tokens">
                        <InputNumber min={1} max={4000} />
                      </Form.Item>
                      <Form.Item
                        label="重叠 Characters"
                        name="chunk_overlap"
                        rules={[
                          {
                            validator: async (_, value: number) => {
                              if (
                                typeof value === 'number' &&
                                value > form.getFieldValue('max_tokens')
                              ) {
                                throw new Error('重叠 Characters 不能大于最大 Characters')
                              }
                            },
                          },
                        ]}
                      >
                        <InputNumber min={0} max={1000} />
                      </Form.Item>
                    </Space>
                    <Space size="large">
                      <Form.Item
                        label="移除多余空格"
                        name="remove_extra_spaces"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        label="移除 URL 与邮箱"
                        name="remove_urls_emails"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Space>
                  </section>
                )}
              </div>
            )}
          </div>

          <div hidden={step !== 3}>
            <div className="retrieval-settings-stack">
              <section className="retrieval-settings-section">
                <div className="retrieval-settings-section-title">检索方式</div>
                <Form.Item name="search_method" noStyle>
                  <Radio.Group
                    className="retrieval-settings-choice-group"
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="semantic_search">向量检索</Radio.Button>
                    <Radio.Button value="full_text_search">全文检索</Radio.Button>
                    <Radio.Button value="hybrid_search">混合检索（推荐）</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </section>

              <section className="retrieval-settings-section">
                <div className="retrieval-settings-section-title">
                  {isHybridSearch ? '排序策略' : '重排设置'}
                </div>
                {isHybridSearch && (
                  <div className="retrieval-settings-section-description">
                    {currentValues.reranking_mode === 'weighted_score'
                      ? '按语义与关键词权重融合排序结果'
                      : '调用 Rerank 模型对候选结果重新排序'}
                  </div>
                )}
                {isHybridSearch ? (
                  <Form.Item name="reranking_mode" noStyle>
                    <Radio.Group
                      className="retrieval-settings-choice-group"
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="weighted_score">权重设置</Radio.Button>
                      <Radio.Button value="reranking_model">Rerank 模型</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="启用重排模型"
                    name="reranking_enable"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                )}
                {useRerankModel && (
                  <Form.Item
                    className="retrieval-settings-followup"
                    label="重排模型"
                    name="reranking_model_name"
                    rules={[{ required: true, message: '请选择重排模型' }]}
                  >
                    <Select
                      allowClear
                      placeholder="请选择重排模型"
                      options={rerankModels.map((model) => ({
                        value: model.model,
                        label: `${model.providerLabel} / ${model.modelLabel}`,
                      }))}
                      onChange={(value) => {
                        const model = rerankModels.find((item) => item.model === value)
                        form.setFieldValue('reranking_provider_name', model?.provider)
                      }}
                    />
                  </Form.Item>
                )}
                <Form.Item name="reranking_provider_name" hidden>
                  <Input />
                </Form.Item>
                {isHybridSearch && currentValues.reranking_mode === 'weighted_score' && (
                  <Space className="retrieval-settings-followup" align="start" wrap>
                    <Form.Item label="语义权重" name="vector_weight">
                      <InputNumber
                        min={0}
                        max={1}
                        step={0.1}
                        precision={2}
                        onChange={(value) => {
                          const vectorWeight = clampWeight(value)
                          form.setFieldsValue({
                            vector_weight: vectorWeight,
                            keyword_weight: complementaryWeight(vectorWeight),
                          })
                        }}
                      />
                    </Form.Item>
                    <Form.Item label="关键词权重" name="keyword_weight">
                      <InputNumber
                        min={0}
                        max={1}
                        step={0.1}
                        precision={2}
                        onChange={(value) => {
                          const keywordWeight = clampWeight(value)
                          form.setFieldsValue({
                            vector_weight: complementaryWeight(keywordWeight),
                            keyword_weight: keywordWeight,
                          })
                        }}
                      />
                    </Form.Item>
                  </Space>
                )}
              </section>

              <section className="retrieval-settings-section retrieval-settings-results">
                <div className="retrieval-settings-section-title">结果参数</div>
                <div className="retrieval-settings-results-grid">
                  <Form.Item label="Top K" name="top_k">
                    <InputNumber min={1} max={20} />
                  </Form.Item>
                  <Form.Item label="Score 阈值">
                    <div className="score-threshold-control">
                      <Form.Item
                        name="score_threshold_enabled"
                        valuePropName="checked"
                        noStyle
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item name="score_threshold" noStyle>
                        <InputNumber
                          min={0}
                          max={1}
                          step={0.05}
                          disabled={!currentValues.score_threshold_enabled}
                        />
                      </Form.Item>
                    </div>
                  </Form.Item>
                </div>
              </section>
            </div>
          </div>

          <div hidden={step !== 4}>
            <Alert
              type="info"
              showIcon
              message="上传后文档会立即进入 Dify 解析与索引队列，完成后需人工审核发布。"
              style={{ marginBottom: 16 }}
            />
            <Upload.Dragger
              multiple
              fileList={files}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFiles(fileList)}
              accept=".txt,.md,.mdx,.pdf,.docx,.csv,.xlsx,.xls,.pptx,.html,.htm,.json,.epub"
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">选择或拖入知识文档</p>
              <p className="ant-upload-hint">首版支持 PDF、Word、文本、表格和网页文件</p>
            </Upload.Dragger>
          </div>
        </Form>

        <aside className="wizard-preview">
          <strong>配置预览</strong>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </aside>
      </div>
    </Modal>
  )
}
