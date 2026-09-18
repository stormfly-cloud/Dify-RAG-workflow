import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { appConfig } from '../config.js'

const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(128) NOT NULL UNIQUE,
  password_hash varchar(512),
  role varchar(32) NOT NULL DEFAULT 'USER',
  phone varchar(32) UNIQUE,
  wechat_union_id varchar(128) UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(40) NOT NULL UNIQUE,
  description varchar(400) NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'provisioning',
  dify_dataset_id uuid UNIQUE,
  dify_publish_field_id varchar(64),
  indexing_technique varchar(32) NOT NULL,
  embedding_model varchar(255),
  embedding_model_provider varchar(255),
  chunk_structure varchar(32) NOT NULL,
  doc_language varchar(64) NOT NULL DEFAULT 'Chinese Simplified',
  retrieval_model jsonb NOT NULL,
  process_rule jsonb NOT NULL,
  summary_index_setting jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  dify_document_id uuid,
  dify_batch_id varchar(128),
  name varchar(255) NOT NULL,
  source_type varchar(32) NOT NULL,
  mime_type varchar(255),
  size_bytes bigint NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'uploading',
  completed_segments integer NOT NULL DEFAULT 0,
  total_segments integer NOT NULL DEFAULT 0,
  error text,
  source_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS documents_kb_idx ON documents (knowledge_base_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents (status);

CREATE TABLE IF NOT EXISTS ingestion_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'queued',
  stage varchar(32) NOT NULL DEFAULT 'queued',
  completed_segments integer NOT NULL DEFAULT 0,
  total_segments integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_tasks_document_idx ON ingestion_tasks (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_tasks_status_idx ON ingestion_tasks (status);

CREATE TABLE IF NOT EXISTS ingestion_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ingestion_tasks(id) ON DELETE CASCADE,
  type varchar(32) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_events_task_idx ON ingestion_events (task_id, id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(128) NOT NULL,
  title varchar(255) NOT NULL DEFAULT '新咨询',
  dify_conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL,
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  dify_message_id uuid,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
`

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private readonly pool = new Pool({
    connectionString: appConfig.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
  })

  async onModuleInit() {
    await this.pool.query('SELECT 1')
    await this.pool.query(schemaSql)
    this.logger.log('PostgreSQL schema is ready')
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values)
  }

  async transaction<T>(handler: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await handler(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
