import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { appConfig } from '../config.js'

export const KNOWLEDGE_INGESTION_QUEUE = 'knowledge-ingestion'

@Injectable()
export class IngestionQueueService implements OnModuleDestroy {
  private readonly queue = new Queue(KNOWLEDGE_INGESTION_QUEUE, {
    connection: { url: appConfig.redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  })

  async enqueue(taskId: string) {
    await this.queue.add('poll-indexing', { taskId }, { jobId: taskId })
  }

  async onModuleDestroy() {
    await this.queue.close()
  }
}
