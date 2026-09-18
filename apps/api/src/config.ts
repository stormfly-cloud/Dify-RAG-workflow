import { config as loadEnvironment } from 'dotenv'
import { fileURLToPath } from 'node:url'

loadEnvironment({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
})

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const appConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 3100),
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'dev-admin-password',
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 43_200),
  databaseUrl: required('DATABASE_URL', 'postgres://heritage:heritage@localhost:5433/heritage'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6380'),
  difyApiBaseUrl: required('DIFY_API_BASE_URL', 'http://localhost/v1'),
  difyKnowledgeApiKey: process.env.DIFY_KNOWLEDGE_API_KEY ?? '',
  difyChatAppApiKey: process.env.DIFY_CHAT_APP_API_KEY ?? '',
  difyRequestTimeoutMs: Number(process.env.DIFY_REQUEST_TIMEOUT_MS ?? 30_000),
  difyIngestionPollIntervalMs: Number(process.env.DIFY_INGESTION_POLL_INTERVAL_MS ?? 2500),
  difyIngestionPollTimeoutMs: Number(process.env.DIFY_INGESTION_POLL_TIMEOUT_MS ?? 900_000),
  adminOrigin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3200',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3300',
  enableIngestionWorker: process.env.ENABLE_INGESTION_WORKER === 'true',
} as const
