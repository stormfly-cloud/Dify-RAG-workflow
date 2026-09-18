import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { AuthService } from './auth.service.js'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    const user = token ? await this.authService.validateAdminToken(token) : null
    if (!token || !user) {
      throw new UnauthorizedException({
        code: 'unauthorized',
        message: '管理员登录已失效，请重新登录。',
      })
    }
    request.authToken = token
    request.adminUser = user
    return true
  }
}
