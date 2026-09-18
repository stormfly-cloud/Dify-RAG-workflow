import {
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { appConfig } from '../config.js'
import { DatabaseService } from '../database/database.service.js'

const scrypt = promisify(scryptCallback)

type UserRow = {
  id: string
  username: string
  password_hash: string | null
  role: 'USER' | 'KB_ADMIN' | 'SUPER_ADMIN'
  status: string
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async onModuleInit() {
    const existing = await this.database.query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1`,
      [appConfig.adminUsername],
    )
    if (existing.rows[0]) return
    const passwordHash = await this.hashPassword(appConfig.adminPassword)
    await this.database.query(
      `
      INSERT INTO users (username, password_hash, role)
      VALUES ($1, $2, 'SUPER_ADMIN')
      ON CONFLICT (username) DO NOTHING
      `,
      [appConfig.adminUsername, passwordHash],
    )
  }

  async loginAdmin(username: string, password: string) {
    const result = await this.database.query<UserRow>(
      `
      SELECT id, username, password_hash, role, status
      FROM users
      WHERE username = $1 AND role IN ('SUPER_ADMIN', 'KB_ADMIN')
      LIMIT 1
      `,
      [username.trim()],
    )
    const user = result.rows[0]
    if (!user || user.status !== 'active' || !(await this.verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: '用户名或密码错误',
      })
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = this.hashToken(token)
    const expiresAt = new Date(Date.now() + appConfig.sessionTtlSeconds * 1000)
    await this.database.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    )
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    }
  }

  async validateAdminToken(token: string) {
    const tokenHash = this.hashToken(token)
    const result = await this.database.query<
      UserRow & { session_id: string; expires_at: Date }
    >(
      `
      SELECT u.id, u.username, u.password_hash, u.role, u.status,
             s.id AS session_id, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.status = 'active'
        AND u.role IN ('SUPER_ADMIN', 'KB_ADMIN')
      LIMIT 1
      `,
      [tokenHash],
    )
    const user = result.rows[0]
    if (!user) return null
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      sessionId: user.session_id,
      expiresAt: user.expires_at.toISOString(),
    }
  }

  async logout(token: string) {
    await this.database.query('DELETE FROM sessions WHERE token_hash = $1', [
      this.hashToken(token),
    ])
    return { result: 'success' }
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex')
    const derived = (await scrypt(password, salt, 64)) as Buffer
    return `scrypt$${salt}$${derived.toString('hex')}`
  }

  private async verifyPassword(password: string, encoded: string | null) {
    if (!encoded) return false
    const [algorithm, salt, expectedHex] = encoded.split('$')
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false
    const derived = (await scrypt(password, salt, 64)) as Buffer
    const expected = Buffer.from(expectedHex, 'hex')
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }
}
