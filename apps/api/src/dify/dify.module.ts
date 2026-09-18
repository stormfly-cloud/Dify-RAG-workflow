import { Global, Module } from '@nestjs/common'
import { DifyKnowledgeClient } from '@heritage/dify-client'
import { appConfig } from '../config.js'

export const DIFY_CLIENT = Symbol('DIFY_CLIENT')

@Global()
@Module({
  providers: [
    {
      provide: DIFY_CLIENT,
      useFactory: () =>
        new DifyKnowledgeClient({
          baseUrl: appConfig.difyApiBaseUrl,
          knowledgeApiKey: appConfig.difyKnowledgeApiKey,
          chatAppApiKey: appConfig.difyChatAppApiKey,
          timeoutMs: appConfig.difyRequestTimeoutMs,
        }),
    },
  ],
  exports: [DIFY_CLIENT],
})
export class DifyModule {}
