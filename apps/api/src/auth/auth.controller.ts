import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { AdminAuthGuard } from './admin-auth.guard.js'
import { AuthService } from './auth.service.js'

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('admin/login')
  login(@Body() body: { username?: string; password?: string }) {
    return this.authService.loginAdmin(body.username ?? '', body.password ?? '')
  }

  @Get('admin/me')
  @UseGuards(AdminAuthGuard)
  me(@Req() request: FastifyRequest) {
    return request.adminUser
  }

  @Post('admin/logout')
  @UseGuards(AdminAuthGuard)
  logout(@Req() request: FastifyRequest) {
    return this.authService.logout(request.authToken!)
  }
}
