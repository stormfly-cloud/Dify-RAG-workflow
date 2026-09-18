import { Module } from '@nestjs/common'
import { IngestionProcessor } from './ingestion.processor.js'
import { IngestionQueueService } from './ingestion-queue.service.js'
import { KnowledgeController } from './knowledge.controller.js'
import { KnowledgeRepository } from './knowledge.repository.js'
import { KnowledgeService } from './knowledge.service.js'
import { PublicKnowledgeController } from './public-knowledge.controller.js'

@Module({
  controllers: [KnowledgeController, PublicKnowledgeController],
  providers: [KnowledgeRepository, KnowledgeService, IngestionQueueService, IngestionProcessor],
  exports: [KnowledgeService, KnowledgeRepository],
})
export class KnowledgeModule {}
