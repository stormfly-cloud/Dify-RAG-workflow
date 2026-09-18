import { Global, Module } from '@nestjs/common'
import { AdminAuthGuard } from './admin-auth.guard.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AdminAuthGuard],
  exports: [AuthService, AdminAuthGuard],
})
export class AuthModule {}
