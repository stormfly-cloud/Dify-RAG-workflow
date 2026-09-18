process.env.ENABLE_INGESTION_WORKER = 'true'

const { NestFactory } = await import('@nestjs/core')
const { Logger } = await import('@nestjs/common')
const { AppModule } = await import('./app.module.js')

const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true })
Logger.log('Knowledge worker is running', 'Worker')

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
