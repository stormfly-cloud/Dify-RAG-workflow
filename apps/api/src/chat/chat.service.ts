import { BadGatewayException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { chatRequestSchema, type ChatRequest } from '@heritage/contracts'
import {
  type DifyChatStreamEvent,
  type DifyKnowledgeClient,
  type DifyRetrievalRecord,
} from '@heritage/dify-client'
import { DIFY_CLIENT } from '../dify/dify.module.js'
import { KnowledgeService } from '../knowledge/knowledge.service.js'
import { ChatRepository } from './chat.repository.js'

export type ChatCitation = {
  index: number
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentId: string
  documentName: string
  segmentId: string
  content: string
  score: number
}

export type ChatStreamChunk =
  | { type: 'meta'; conversationId: string; citations: ChatCitation[] }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      conversationId: string
      messageId: string
      usage: Record<string, unknown> | null
    }
  | { type: 'error'; message: string }

type RankedRecord = {
  record: DifyRetrievalRecord
  knowledgeBaseId: string
  knowledgeBaseName: string
  score: number
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(ChatRepository) private readonly repository: ChatRepository,
    @Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService,
    @Inject(DIFY_CLIENT) private readonly dify: DifyKnowledgeClient,
  ) {}

  listConversations(userId: string) {
    return this.repository.listConversations(userId)
  }

  async getMessages(conversationId: string, userId: string) {
    const conversation = await this.repository.findConversation(conversationId, userId)
    if (!conversation) throw new NotFoundException('Conversation not found')
    return this.repository.listMessages(conversationId)
  }

  async complete(input: ChatRequest) {
    const parsed = chatRequestSchema.parse(input)
    const conversation =
      (parsed.conversation_id
        ? await this.repository.findConversation(parsed.conversation_id, parsed.user_id)
        : null) ?? (await this.repository.createConversation(parsed.user_id, parsed.query))

    await this.repository.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: parsed.query,
    })
    const citations = await this.retrieveCitations(parsed)
    const response = await this.dify.chat({
      query: parsed.query,
      userId: parsed.user_id,
      conversationId: conversation.difyConversationId ?? undefined,
      inputs: this.generationInputs(citations),
    })
    if (response.conversation_id) {
      await this.repository.updateDifyConversation(
        conversation.id,
        response.conversation_id,
      )
    }
    const message = await this.repository.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: response.answer,
      citations,
      difyMessageId: response.message_id,
      usage: response.metadata?.usage as Record<string, unknown> | undefined,
    })
    return {
      conversationId: conversation.id,
      message,
      citations,
      usage: response.metadata?.usage ?? null,
    }
  }

  async *stream(input: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatStreamChunk> {
    const parsed = chatRequestSchema.parse(input)
    const conversation =
      (parsed.conversation_id
        ? await this.repository.findConversation(parsed.conversation_id, parsed.user_id)
        : null) ?? (await this.repository.createConversation(parsed.user_id, parsed.query))

    await this.repository.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: parsed.query,
    })

    const citations = await this.retrieveCitations(parsed)
    yield {
      type: 'meta',
      conversationId: conversation.id,
      citations,
    }

    let answer = ''
    let difyConversationId = conversation.difyConversationId ?? undefined
    let difyMessageId: string | undefined
    let usage: Record<string, unknown> | null = null

    try {
      const stream = await this.dify.streamChat({
        query: parsed.query,
        userId: parsed.user_id,
        conversationId: difyConversationId,
        signal,
        inputs: this.generationInputs(citations),
      })

      for await (const event of stream) {
        if (event.event === 'message' && event.answer) {
          answer += event.answer
          yield { type: 'delta', text: event.answer }
        }
        if (event.event === 'error') {
          throw new BadGatewayException(event.message ?? 'Dify generation failed')
        }
        if (event.event === 'message_end') {
          difyConversationId = event.conversation_id ?? difyConversationId
          difyMessageId = event.message_id
          usage = (event.metadata?.usage as Record<string, unknown> | undefined) ?? null
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成回答失败'
      yield { type: 'error', message }
      return
    }

    if (difyConversationId) {
      await this.repository.updateDifyConversation(conversation.id, difyConversationId)
    }
    const assistant = await this.repository.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: answer,
      citations,
      difyMessageId,
      usage: usage ?? undefined,
    })
    yield {
      type: 'done',
      conversationId: conversation.id,
      messageId: assistant.id,
      usage,
    }
  }

  private async retrieveCitations(parsed: ChatRequest) {
    const responses = await Promise.all(
      parsed.knowledge_base_ids.map(async (knowledgeBaseId) => {
        const knowledgeBase = await this.knowledgeService.get(knowledgeBaseId)
        const result = await this.knowledgeService.retrieve(knowledgeBaseId, {
          query: parsed.query,
          include_drafts: false,
        })
        return {
          knowledgeBase,
          records: result.records,
        }
      }),
    )

    const merged = new Map<string, RankedRecord>()
    for (const response of responses) {
      response.records
        .slice()
        .sort((left, right) => right.score - left.score)
        .forEach((record, rank) => {
          const key = record.segment.id
          const reciprocalRank = 1 / (60 + rank + 1)
          const existing = merged.get(key)
          if (existing) {
            existing.score += reciprocalRank
          } else {
            merged.set(key, {
              record,
              knowledgeBaseId: response.knowledgeBase.id,
              knowledgeBaseName: response.knowledgeBase.name,
              score: reciprocalRank,
            })
          }
        })
    }

    return [...merged.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map(
        (item, index): ChatCitation => ({
          index: index + 1,
          knowledgeBaseId: item.knowledgeBaseId,
          knowledgeBaseName: item.knowledgeBaseName,
          documentId: item.record.segment.document.id,
          documentName: item.record.segment.document.name,
          segmentId: item.record.segment.id,
          content: item.record.child_chunks?.map((chunk) => chunk.content).join('\n') ||
            item.record.segment.content,
          score: item.score,
        }),
      )
  }

  private buildContext(citations: ChatCitation[]) {
    let length = 0
    const blocks: string[] = []
    for (const citation of citations) {
      const block = `[资料${citation.index}] ${citation.documentName}\n${citation.content}`
      if (length + block.length > 12_000) break
      blocks.push(block)
      length += block.length
    }
    return blocks.join('\n\n')
  }

  private generationInputs(citations: ChatCitation[]) {
    return {
      context: this.buildContext(citations),
      citations_json: JSON.stringify(
        citations.map(({ index, knowledgeBaseName, documentName }) => ({
          index,
          knowledge_base: knowledgeBaseName,
          document: documentName,
        })),
      ),
      knowledge_scope: [
        ...new Set(citations.map((item) => item.knowledgeBaseName)),
      ].join('、'),
    }
  }
}
