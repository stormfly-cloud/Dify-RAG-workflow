import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { AppModule } from './app.module.js'
import { appConfig } from './config.js'
import { DifyErrorFilter } from './common/dify-error.filter.js'
import { ZodValidationFilter } from './common/zod-validation.filter.js'

async function bootstrap() {
  const adapter = new FastifyAdapter({ trustProxy: true, bodyLimit: 20 * 1024 * 1024 })
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  })

  await app.register(cors, {
    origin: [appConfig.adminOrigin, appConfig.webOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    exposedHeaders: ['Content-Disposition'],
  })
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 1,
    },
  })

  app.setGlobalPrefix('api')
  app.useGlobalFilters(new ZodValidationFilter(), new DifyErrorFilter())
  await app.listen(appConfig.port, '0.0.0.0')
  Logger.log(`API listening on http://0.0.0.0:${appConfig.port}`, 'Bootstrap')
}

void bootstrap()
