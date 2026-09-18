import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common'
import { DifyApiError } from '@heritage/dify-client'
import type { FastifyReply } from 'fastify'

@Catch(DifyApiError)
export class DifyErrorFilter implements ExceptionFilter {
  catch(error: DifyApiError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>()
    const status =
      error.status >= 400 && error.status <= 599 ? error.status : HttpStatus.BAD_GATEWAY
    void response.status(status).send({
      code: error.code,
      message: error.message,
    })
  }
}
