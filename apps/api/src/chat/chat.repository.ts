import { Inject, Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'

export type StoredConversation = {
  id: string
  userId: string
  title: string
  difyConversationId: string | null
  createdAt: string
  updatedAt: string
}

export type StoredMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  citations: unknown[]
  usage: Record<string, unknown> | null
  createdAt: string
}

type ConversationRow = {
  id: string
  user_id: string
  title: string
  dify_conversation_id: string | null
  created_at: Date
  updated_at: Date
}

type MessageRow = {
  id: string
  conversation_id: string
  role: StoredMessage['role']
  content: string
  citations: unknown[]
  usage: Record<string, unknown> | null
  created_at: Date
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findConversation(id: string, userId: string) {
    const result = await this.database.query<ConversationRow>(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ? this.mapConversation(result.rows[0]) : null
  }

  async createConversation(userId: string, title: string) {
    const result = await this.database.query<ConversationRow>(
      `
      INSERT INTO conversations (user_id, title)
      VALUES ($1, $2)
      RETURNING *
      `,
      [userId, title.slice(0, 255)],
    )
    return this.mapConversation(result.rows[0]!)
  }

  async updateDifyConversation(id: string, difyConversationId: string) {
    await this.database.query(
      `UPDATE conversations SET dify_conversation_id = $2, updated_at = now() WHERE id = $1`,
      [id, difyConversationId],
    )
  }

  async addMessage(input: {
    conversationId: string
    role: StoredMessage['role']
    content: string
    citations?: unknown[]
    difyMessageId?: string
    usage?: Record<string, unknown>
  }) {
    const result = await this.database.query<MessageRow>(
      `
      INSERT INTO messages (
        conversation_id, role, content, citations, dify_message_id, usage
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        input.conversationId,
        input.role,
        input.content,
        JSON.stringify(input.citations ?? []),
        input.difyMessageId ?? null,
        input.usage ? JSON.stringify(input.usage) : null,
      ],
    )
    await this.database.query(
      `UPDATE conversations SET updated_at = now() WHERE id = $1`,
      [input.conversationId],
    )
    return this.mapMessage(result.rows[0]!)
  }

  async listConversations(userId: string) {
    const result = await this.database.query<ConversationRow>(
      `SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    )
    return result.rows.map((row) => this.mapConversation(row))
  }

  async listMessages(conversationId: string) {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    )
    return result.rows.map((row) => this.mapMessage(row))
  }

  private mapConversation(row: ConversationRow): StoredConversation {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      difyConversationId: row.dify_conversation_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  private mapMessage(row: MessageRow): StoredMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      citations: row.citations,
      usage: row.usage,
      createdAt: row.created_at.toISOString(),
    }
  }
}
