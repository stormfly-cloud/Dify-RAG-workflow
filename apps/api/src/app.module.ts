import { Module } from '@nestjs/common'
import { DatabaseModule } from './database/database.module.js'
import { DifyModule } from './dify/dify.module.js'
import { HealthController } from './health.controller.js'
import { ChatModule } from './chat/chat.module.js'
import { KnowledgeModule } from './knowledge/knowledge.module.js'
import { AuthModule } from './auth/auth.module.js'

@Module({
  imports: [DatabaseModule, DifyModule, AuthModule, KnowledgeModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
