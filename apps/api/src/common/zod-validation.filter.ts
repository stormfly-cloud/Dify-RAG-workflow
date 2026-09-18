import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { ZodError } from 'zod'

@Catch(ZodError)
export class ZodValidationFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>()
    void response.status(HttpStatus.BAD_REQUEST).send({
      code: 'validation_failed',
      message: 'Request validation failed',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
}
