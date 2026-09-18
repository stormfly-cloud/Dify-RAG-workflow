import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { ChatRequest } from '@heritage/contracts'
import { appConfig } from '../config.js'
import { ChatService } from './chat.service.js'

@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chatService: ChatService) {}

  @Get('conversations')
  conversations(@Query('user_id') userId: string) {
    return this.chatService.listConversations(userId)
  }

  @Get('conversations/:id/messages')
  messages(@Param('id') id: string, @Query('user_id') userId: string) {
    return this.chatService.getMessages(id, userId)
  }

  @Post('stream')
  async stream(
    @Body() body: ChatRequest,
    @Req()
    request: {
      headers: { origin?: string }
      raw: { on: (event: string, handler: () => void) => void }
    },
    @Res() reply: FastifyReply,
  ) {
    const controller = new AbortController()
    request.raw.on('close', () => controller.abort())

    reply.hijack()
    const response = reply.raw
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
    const origin = request.headers.origin
    if (origin && [appConfig.adminOrigin, appConfig.webOrigin].includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Credentials'] = 'true'
      headers.Vary = 'Origin'
    }
    response.writeHead(200, headers)

    try {
      for await (const chunk of this.chatService.stream(body, controller.signal)) {
        response.write(`event: ${chunk.type}\n`)
        response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
    } catch (error) {
      response.write('event: error\n')
      response.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : '请求失败',
        })}\n\n`,
      )
    } finally {
      response.end()
    }
  }

  @Post('complete')
  complete(@Body() body: ChatRequest) {
    return this.chatService.complete(body)
  }
}
