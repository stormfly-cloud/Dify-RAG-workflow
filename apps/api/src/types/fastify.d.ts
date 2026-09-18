declare module 'fastify' {
  interface FastifyRequest {
    authToken?: string
    adminUser?: {
      id: string
      username: string
      role: 'USER' | 'KB_ADMIN' | 'SUPER_ADMIN'
      sessionId: string
      expiresAt: string
    }
  }
}

export {}
