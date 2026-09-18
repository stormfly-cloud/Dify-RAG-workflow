import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Worker } from 'bullmq'
import { appConfig } from '../config.js'
import { KnowledgeService } from './knowledge.service.js'
import { KNOWLEDGE_INGESTION_QUEUE } from './ingestion-queue.service.js'

@Injectable()
export class IngestionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionProcessor.name)
  private worker?: Worker

  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  onModuleInit() {
    if (!appConfig.enableIngestionWorker) return
    this.worker = new Worker(
      KNOWLEDGE_INGESTION_QUEUE,
      async (job) => {
        const taskId = (job.data as { taskId?: string }).taskId
        if (!taskId) throw new Error('Task ID is missing from ingestion job')
        await this.knowledgeService.processTask(taskId)
      },
      {
        connection: { url: appConfig.redisUrl },
        concurrency: 3,
      },
    )
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Ingestion job ${job?.id ?? 'unknown'} failed: ${error.message}`)
    })
    this.logger.log('Knowledge ingestion worker started')
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }
}
