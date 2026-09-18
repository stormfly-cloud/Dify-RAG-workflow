import { Button, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'

type Scope = {
  id: string
  name: string
  description: string
  documentCount: number
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Array<{
    index: number
    documentName: string
    content: string
  }>
}

const apiBaseUrl =
  process.env.TARO_APP_API_BASE_URL ?? 'http://localhost:3100/api'

function getUserId() {
  const existing = Taro.getStorageSync<string>('heritage-user-id')
  if (existing) return existing
  const id = `wx-${Date.now()}-${Math.random().toString(36).slice(2)}`
  Taro.setStorageSync('heritage-user-id', id)
  return id
}

export default function IndexPage() {
  const [scopes, setScopes] = useState<Scope[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  useDidShow(() => {
    void Taro.request<Scope[]>({
      url: `${apiBaseUrl}/public/knowledge-bases`,
      method: 'GET',
    }).then((response) => {
      setScopes(response.data)
      setSelectedId((current) => current || response.data[0]?.id || '')
    })
  })

  const send = async () => {
    const text = query.trim()
    if (!text || !selectedId || loading) return
    setQuery('')
    setLoading(true)
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: 'user', content: text },
    ])
    try {
      const response = await Taro.request<{
        conversationId: string
        message: {
          content: string
          citations: Message['citations']
        }
      }>({
        url: `${apiBaseUrl}/chat/complete`,
        method: 'POST',
        data: {
          query: text,
          knowledge_base_ids: [selectedId],
          user_id: getUserId(),
        },
        header: {
          'content-type': 'application/json',
        },
      })
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: response.data.message.content,
          citations: response.data.message.citations,
        },
      ])
    } catch {
      Taro.showToast({ title: '咨询失败，请重试', icon: 'none' })
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: '当前服务暂时不可用，请稍后重试。',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className="page">
      <View className="scopeBar">
        <ScrollView scrollX enhanced showScrollbar={false}>
          <View className="scopeRow">
            {scopes.map((scope) => (
              <View
                key={scope.id}
                className={`scopeChip ${selectedId === scope.id ? 'active' : ''}`}
                onClick={() => setSelectedId(scope.id)}
              >
                <Text>{scope.name}</Text>
                <Text className="scopeCount">{scope.documentCount} 份资料</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView className="messages" scrollY enhanced>
        {!messages.length && (
          <View className="empty">
            <Text className="emptyMark">问</Text>
            <Text className="emptyTitle">你想了解哪项非遗或文旅信息？</Text>
            <Text className="emptyHint">回答将优先使用已发布的权威资料，并附来源。</Text>
          </View>
        )}
        {messages.map((message) => (
          <View key={message.id} className={`message ${message.role}`}>
            <Text>{message.content}</Text>
            {message.citations?.map((citation) => (
              <View className="citation" key={`${message.id}-${citation.index}`}>
                <Text className="citationTitle">
                  [{citation.index}] {citation.documentName}
                </Text>
                <Text className="citationText">{citation.content.slice(0, 160)}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <View className="composer">
        <Textarea
          value={query}
          maxlength={1000}
          autoHeight
          placeholder="输入咨询问题"
          onInput={(event) => setQuery(event.detail.value)}
        />
        <Button
          className="send"
          loading={loading}
          disabled={!query.trim() || !selectedId}
          onClick={() => void send()}
        >
          发送
        </Button>
      </View>
    </View>
  )
}
