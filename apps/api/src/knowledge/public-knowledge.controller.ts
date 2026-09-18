import { Controller, Get, Inject } from '@nestjs/common'
import { KnowledgeService } from './knowledge.service.js'

@Controller('public/knowledge-bases')
export class PublicKnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async list() {
    const knowledgeBases = await this.knowledgeService.list()
    return knowledgeBases
      .filter(
        (knowledgeBase) =>
          knowledgeBase.status === 'ready' &&
          knowledgeBase.publishedDocumentCount > 0,
      )
      .map((knowledgeBase) => ({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        documentCount: knowledgeBase.publishedDocumentCount,
      }))
  }
}
