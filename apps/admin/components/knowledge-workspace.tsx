'use client'

import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  IngestionEvent,
  IngestionTask,
  KnowledgeBase,
  KnowledgeDocument,
} from '@heritage/contracts'
import { adminApi, subscribeToTaskEvents } from '@/lib/api'
import { CreateKnowledgeWizard } from './create-knowledge-wizard'

const phaseOrder = [
  'queued',
  'parsing',
  'cleaning',
  'splitting',
  'indexing',
  'review_required',
] as const

const phaseNames: Record<string, string> = {
  queued: '排队',
  parsing: '解析',
  cleaning: '清洗',
  splitting: '分段',
  indexing: '向量索引',
  review_required: '等待审核',
  published: '已发布',
  failed: '失败',
}

function statusTag(status: string) {
  const config: Record<string, { color: string; label: string }> = {
    ready: { color: 'green', label: '可管理' },
    provisioning: { color: 'blue', label: '创建中' },
    failed: { color: 'red', label: '异常' },
    queued: { color: 'default', label: '排队' },
    parsing: { color: 'processing', label: '解析' },
    cleaning: { color: 'processing', label: '清洗' },
    splitting: { color: 'processing', label: '分段' },
    indexing: { color: 'processing', label: '索引' },
    review_required: { color: 'gold', label: '待审核' },
    published: { color: 'green', label: '已发布' },
    disabled: { color: 'default', label: '已停用' },
    archived: { color: 'default', label: '已归档' },
  }
  const item = config[status] ?? { color: 'default', label: status }
  return <Tag color={item.color}>{item.label}</Tag>
}

export function KnowledgeWorkspace({ onLogout }: { onLogout: () => void }) {
  const { message, modal } = App.useApp()
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [tasks, setTasks] = useState<IngestionTask[]>([])
  const [events, setEvents] = useState<IngestionEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [retrievalQuery, setRetrievalQuery] = useState('')
  const [retrievalResults, setRetrievalResults] = useState<
    Awaited<ReturnType<typeof adminApi.retrievalTest>>['records']
  >([])
  const [chunks, setChunks] = useState<
    Awaited<ReturnType<typeof adminApi.listChunks>>['data']
  >([])
  const [chunkDrawerOpen, setChunkDrawerOpen] = useState(false)
  const [chunkDocument, setChunkDocument] = useState<KnowledgeDocument>()
  const [chunkLoading, setChunkLoading] = useState(false)

  const loadKnowledgeBases = useCallback(async (preferredId?: string) => {
    setLoading(true)
    try {
      const result = await adminApi.listKnowledgeBases(keyword)
      setKnowledgeBases(result)
      const nextId = preferredId ?? activeId ?? result[0]?.id
      setActiveId(nextId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载知识库失败')
    } finally {
      setLoading(false)
    }
  }, [activeId, keyword, message])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const [base, docs, taskList] = await Promise.all([
        adminApi.getKnowledgeBase(id),
        adminApi.listDocuments(id),
        adminApi.listTasks(id),
      ])
      setKnowledgeBase(base)
      setDocuments(docs)
      setTasks(taskList)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载知识库详情失败')
    } finally {
      setDetailLoading(false)
    }
  }, [message])

  useEffect(() => {
    void loadKnowledgeBases()
  }, [loadKnowledgeBases])

  useEffect(() => {
    if (activeId) void loadDetail(activeId)
  }, [activeId, loadDetail])

  const activeTask = useMemo(
    () =>
      tasks.find((task) => ['queued', 'running'].includes(task.status)) ??
      tasks[0],
    [tasks],
  )

  useEffect(() => {
    if (!activeTask || !['queued', 'running'].includes(activeTask.status)) return
    const controller = new AbortController()
    setEvents([])
    void subscribeToTaskEvents(
      activeTask.id,
      (event) => {
        setEvents((current) => [
          ...current.filter((item) => item.id !== event.id),
          event as IngestionEvent,
        ])
        if (['completed', 'error'].includes(event.type) && activeId) {
          void loadDetail(activeId)
        }
      },
      controller.signal,
    ).catch((error) => {
      if (!controller.signal.aborted) {
        message.error(error instanceof Error ? error.message : '订阅进度失败')
      }
    })
    return () => controller.abort()
  }, [activeId, activeTask, loadDetail, message])

  useEffect(() => {
    if (!activeId) return
    const interval = setInterval(() => {
      void adminApi.listDocuments(activeId).then(setDocuments).catch(() => undefined)
      void adminApi.listTasks(activeId).then(setTasks).catch(() => undefined)
    }, 4_000)
    return () => clearInterval(interval)
  }, [activeId])

  const openChunks = async (document: KnowledgeDocument) => {
    if (!activeId || !document.difyDocumentId) return
    setChunkDocument(document)
    setChunkDrawerOpen(true)
    setChunkLoading(true)
    try {
      const result = await adminApi.listChunks(activeId, document.id)
      setChunks(result.data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载分段失败')
    } finally {
      setChunkLoading(false)
    }
  }

  const publish = async (document: KnowledgeDocument, published: boolean) => {
    if (!activeId) return
    try {
      await adminApi.publishDocument(activeId, document.id, published)
      message.success(published ? '文档已发布' : '文档已撤回')
      await Promise.all([loadDetail(activeId), loadKnowledgeBases(activeId)])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发布操作失败')
    }
  }

  const runRetrieval = async () => {
    if (!activeId || !retrievalQuery.trim()) return
    try {
      const result = await adminApi.retrievalTest(activeId, {
        query: retrievalQuery.trim(),
        include_drafts: true,
      })
      setRetrievalResults(result.records)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '召回测试失败')
    }
  }

  const columns: ColumnsType<KnowledgeDocument> = [
    {
      title: '文档',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, record) => (
        <Space>
          <FileSearchOutlined />
          <span>{name}</span>
          {record.sourceType === 'text' && <Tag>文本</Tag>}
          {record.sourceType === 'qa' && <Tag>FAQ</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: statusTag,
    },
    {
      title: '索引进度',
      key: 'progress',
      width: 220,
      render: (_, record) => {
        const percent =
          record.totalSegments > 0
            ? Math.round((record.completedSegments / record.totalSegments) * 100)
            : record.status === 'review_required' || record.status === 'published'
              ? 100
              : 0
        return (
          <Tooltip
            title={`${record.completedSegments} / ${record.totalSegments} 个分段`}
          >
            <Progress
              percent={percent}
              size="small"
              status={record.status === 'failed' ? 'exception' : 'active'}
            />
          </Tooltip>
        )
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 210,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => void openChunks(record)}>
            分段
          </Button>
          {record.status === 'review_required' && (
            <Button
              size="small"
              type="primary"
              onClick={() => void publish(record, true)}
            >
              发布
            </Button>
          )}
          {record.status === 'published' && (
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() => void publish(record, false)}
            >
              撤回
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const phaseProgress = useMemo(() => {
    const currentIndex = phaseOrder.indexOf(
      (activeTask?.stage ?? 'queued') as (typeof phaseOrder)[number],
    )
    return phaseOrder.map((phase, index) => ({
      phase,
      done: currentIndex > index,
      active: currentIndex === index,
      percent:
        activeTask?.stage === phase && activeTask.totalSegments > 0
          ? Math.round(
              (activeTask.completedSegments / activeTask.totalSegments) * 100,
            )
          : currentIndex > index
            ? 100
            : 0,
    }))
  }, [activeTask])

  return (
    <main className="admin-shell">
      <div className="admin-sider admin-sidebar-tools" style={{ width: 300, float: 'left', height: '100vh', overflow: 'auto', background: '#fff' }}>
        <div className="admin-brand">
          <span className="admin-brand-mark">遗</span>
          <span>非遗文旅知识运营台</span>
        </div>
        <div style={{ paddingTop: 14 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={keyword}
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索知识库"
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => void loadKnowledgeBases()}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadKnowledgeBases()}
            />
          </Space.Compact>
          <Button
            block
            type="primary"
            icon={<PlusOutlined />}
            style={{ margin: '12px 0' }}
            onClick={() => setWizardOpen(true)}
          >
            新建知识库
          </Button>
          <Spin spinning={loading}>
            {knowledgeBases.map((item) => (
              <div
                key={item.id}
                className="knowledge-list-item"
                data-active={item.id === activeId}
                onClick={() => setActiveId(item.id)}
              >
                <div className="knowledge-list-name">
                  <span>{item.name}</span>
                  {statusTag(item.status)}
                </div>
                <div className="knowledge-list-meta">
                  {item.documentCount} 个文档 · {item.publishedDocumentCount} 个已发布
                </div>
              </div>
            ))}
          </Spin>
        </div>
      </div>

      <section style={{ marginLeft: 300, minHeight: '100vh' }}>
        <header className="admin-header">
          <div>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            <strong>知识库运营</strong>
          </div>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => activeId && void loadDetail(activeId)}
            >
              刷新
            </Button>
            <Button
              onClick={async () => {
                await adminApi.logout()
                onLogout()
              }}
            >
              退出
            </Button>
          </Space>
        </header>
        <div className="admin-content">
          {!knowledgeBase ? (
            <div className="empty-workspace">
              <Empty
                description="选择或创建一个知识库"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Button type="primary" onClick={() => setWizardOpen(true)}>
                  新建知识库
                </Button>
              </Empty>
            </div>
          ) : (
            <Spin spinning={detailLoading}>
              <div className="workspace-header">
                <div>
                  <h1 className="workspace-title">{knowledgeBase.name}</h1>
                  <p className="workspace-description">
                    {knowledgeBase.description || '暂未填写知识库说明'}
                  </p>
                </div>
                <Space>
                  {statusTag(knowledgeBase.status)}
                  <Tag>{knowledgeBase.indexingTechnique === 'high_quality' ? '高质量' : '经济'}</Tag>
                  <Tag>{knowledgeBase.chunkStructure}</Tag>
                </Space>
              </div>

              <div className="metric-strip">
                <div className="metric-cell">
                  <div className="metric-label">文档总数</div>
                  <div className="metric-value">{knowledgeBase.documentCount}</div>
                </div>
                <div className="metric-cell">
                  <div className="metric-label">已发布</div>
                  <div className="metric-value">
                    {knowledgeBase.publishedDocumentCount}
                  </div>
                </div>
                <div className="metric-cell">
                  <div className="metric-label">当前阶段</div>
                  <div className="metric-value" style={{ fontSize: 18 }}>
                    {phaseNames[activeTask?.stage ?? 'queued'] ?? '空闲'}
                  </div>
                </div>
                <div className="metric-cell">
                  <div className="metric-label">Dify Dataset</div>
                  <div
                    className="metric-value"
                    style={{ fontSize: 12, wordBreak: 'break-all' }}
                  >
                    {knowledgeBase.difyDatasetId ?? '-'}
                  </div>
                </div>
              </div>

              <div className="wizard-grid">
                <section style={{ border: '1px solid #e1e5ea', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #edf0f2' }}>
                    <strong>文档索引</strong>
                    <Space>
                      <Button
                        icon={<CloudUploadOutlined />}
                        onClick={() => {
                          modal.info({
                            title: '上传文档',
                            content: '请先关闭本提示，使用系统文件选择器上传。',
                          })
                          const input = document.createElement('input')
                          input.type = 'file'
                          input.accept = '.txt,.md,.mdx,.pdf,.docx,.csv,.xlsx,.xls,.pptx,.html,.htm,.json,.epub'
                          input.onchange = async () => {
                            const file = input.files?.[0]
                            if (!file || !activeId) return
                            try {
                              await adminApi.uploadFile(activeId, file)
                              message.success('文件已上传并进入处理队列')
                              await loadDetail(activeId)
                            } catch (error) {
                              message.error(
                                error instanceof Error ? error.message : '上传失败',
                              )
                            }
                          }
                          input.click()
                        }}
                      >
                        上传文档
                      </Button>
                    </Space>
                  </div>
                  <Table
                    rowKey="id"
                    columns={columns}
                    dataSource={documents}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    scroll={{ x: 860 }}
                  />
                </section>

                <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                  <section style={{ padding: 16, border: '1px solid #e1e5ea', borderRadius: 8, background: '#fff' }}>
                    <strong>构建进度</strong>
                    <div style={{ marginTop: 14 }}>
                      {phaseProgress.map((phase) => (
                        <div className="progress-phase" key={phase.phase}>
                          <div className="progress-phase-label">
                            {phaseText(phase.phase)}
                          </div>
                          <Progress
                            percent={phase.percent}
                            size="small"
                            status={
                              phase.active
                                ? 'active'
                                : phase.done
                                  ? 'success'
                                  : 'normal'
                            }
                          />
                          <div className="progress-phase-meta">
                            {phase.active ? '进行中' : phase.done ? '完成' : '等待'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Timeline
                      className="task-timeline"
                      style={{ marginTop: 16 }}
                      items={events.slice(-8).map((event) => ({
                        color: event.type === 'error' ? 'red' : 'blue',
                        children: (
                          <div>
                            <div>{phaseNames[String(event.payload.stage)] ?? event.type}</div>
                            <small>
                              {String(event.payload.completedSegments ?? 0)}/
                              {String(event.payload.totalSegments ?? 0)} 分段 ·{' '}
                              {new Date(event.createdAt).toLocaleTimeString('zh-CN')}
                            </small>
                          </div>
                        ),
                      }))}
                    />
                  </section>

                  <section style={{ padding: 16, border: '1px solid #e1e5ea', borderRadius: 8, background: '#fff' }}>
                    <strong>召回测试</strong>
                    <Space.Compact style={{ width: '100%', marginTop: 12 }}>
                      <Input
                        value={retrievalQuery}
                        placeholder="输入一个真实咨询问题"
                        onChange={(event) => setRetrievalQuery(event.target.value)}
                        onPressEnter={() => void runRetrieval()}
                      />
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={() => void runRetrieval()}
                      >
                        测试
                      </Button>
                    </Space.Compact>
                    <List
                      style={{ marginTop: 12 }}
                      size="small"
                      locale={{ emptyText: '暂无测试结果' }}
                      dataSource={retrievalResults.slice(0, 5)}
                      renderItem={(record) => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <Space>
                                <Tag color="blue">{record.score.toFixed(3)}</Tag>
                                {record.segment.document.name}
                              </Space>
                            }
                            description={
                              <span
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {record.segment.content}
                              </span>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </section>

                  <section style={{ padding: 16, border: '1px solid #e1e5ea', borderRadius: 8, background: '#fff' }}>
                    <strong>配置摘要</strong>
                    <Descriptions
                      size="small"
                      column={1}
                      style={{ marginTop: 12 }}
                      items={[
                        {
                          key: 'embedding',
                          label: '嵌入模型',
                          children: knowledgeBase.embeddingModel ?? '未配置',
                        },
                        {
                          key: 'search',
                          label: '召回方式',
                          children: knowledgeBase.retrievalModel.search_method,
                        },
                        {
                          key: 'topK',
                          label: 'Top K',
                          children: knowledgeBase.retrievalModel.top_k,
                        },
                      ]}
                    />
                  </section>
                </aside>
              </div>
            </Spin>
          )}
        </div>
      </section>

      <CreateKnowledgeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={async (id) => {
          await loadKnowledgeBases(id)
          setActiveId(id)
        }}
      />

      <Drawer
        width={720}
        title={chunkDocument?.name ?? '文档分段'}
        open={chunkDrawerOpen}
        onClose={() => setChunkDrawerOpen(false)}
      >
        <Spin spinning={chunkLoading}>
          <List
            dataSource={chunks}
            renderItem={(chunk) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag>#{chunk.position}</Tag>
                      {statusTag(chunk.status)}
                      {chunk.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
                    </Space>
                  }
                  description={<div style={{ whiteSpace: 'pre-wrap' }}>{chunk.content}</div>}
                />
              </List.Item>
            )}
          />
        </Spin>
      </Drawer>
    </main>
  )
}

function phaseText(phase: string) {
  return phaseNames[phase] ?? phase
}
