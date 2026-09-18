import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AdminAuthGuard } from '../auth/admin-auth.guard.js'
import { KnowledgeService } from './knowledge.service.js'

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  @Get('knowledge-bases')
  list(@Query('keyword') keyword?: string) {
    return this.knowledgeService.list(keyword)
  }

  @Post('knowledge-bases')
  create(@Body() body: unknown) {
    return this.knowledgeService.create(body as never)
  }

  @Get('knowledge-bases/:id')
  get(@Param('id') id: string) {
    return this.knowledgeService.get(id)
  }

  @Patch('knowledge-bases/:id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.knowledgeService.update(id, body as never)
  }

  @Delete('knowledge-bases/:id')
  remove(@Param('id') id: string) {
    return this.knowledgeService.delete(id)
  }

  @Get('models')
  models(@Query('type') type: 'text-embedding' | 'rerank' | 'llm' = 'text-embedding') {
    return this.knowledgeService.listModels(type)
  }

  @Get('knowledge-bases/:id/documents')
  documents(@Param('id') id: string) {
    return this.knowledgeService.listDocuments(id)
  }

  @Post('knowledge-bases/:id/documents/upload')
  async upload(@Param('id') id: string, @Req() request: FastifyRequest) {
    const file = await request.file()
    if (!file) {
      throw new Error('A file is required')
    }
    if (!file.filename) throw new Error('A filename is required')
    return this.knowledgeService.uploadFile(id, {
      filename: file.filename,
      mimeType: file.mimetype,
      buffer: await file.toBuffer(),
    })
  }

  @Post('knowledge-bases/:id/documents/text')
  createText(@Param('id') id: string, @Body() body: unknown) {
    return this.knowledgeService.createTextDocument(id, body as never)
  }

  @Get('knowledge-bases/:id/tasks')
  tasks(@Param('id') id: string) {
    return this.knowledgeService.listTasks(id)
  }

  @Post('knowledge-bases/:id/retrieval-test')
  retrievalTest(@Param('id') id: string, @Body() body: unknown) {
    return this.knowledgeService.retrieve(id, body)
  }

  @Get('knowledge-bases/:id/documents/:documentId/chunks')
  chunks(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.knowledgeService.listChunks(id, documentId)
  }

  @Patch('knowledge-bases/:id/documents/:documentId/chunks/:chunkId')
  updateChunk(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Param('chunkId') chunkId: string,
    @Body() body: unknown,
  ) {
    return this.knowledgeService.updateChunk(id, documentId, chunkId, body as never)
  }

  @Post('knowledge-bases/:id/documents/:documentId/publish')
  publish(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() body: { published?: boolean },
  ) {
    return this.knowledgeService.publishDocument(id, documentId, body.published ?? true)
  }

  @Get('ingestion-tasks/:taskId/events')
  async events(
    @Param('taskId') taskId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const header = request.headers['last-event-id']
    let lastId = typeof header === 'string' ? Number(header) : 0
    reply.hijack()
    const response = reply.raw
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write(': connected\n\n')

    let closed = false
    request.raw.on('close', () => {
      closed = true
    })

    while (!closed) {
      const events = await this.knowledgeService.taskEvents(taskId, lastId)
      for (const event of events) {
        lastId = event.id
        response.write(`id: ${event.id}\n`)
        response.write(`event: ${event.type}\n`)
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      if (!events.length) response.write(': heartbeat\n\n')
      if (await this.knowledgeService.isTaskTerminal(taskId)) {
        response.end()
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
}
