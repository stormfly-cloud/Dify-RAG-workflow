'use client'

import { App, Button, Form, Input, Spin } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { adminApi, clearAdminToken, getAdminToken } from '@/lib/api'
import { KnowledgeWorkspace } from './knowledge-workspace'

export function AdminGate() {
  const { message } = App.useApp()
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!getAdminToken()) {
      setChecking(false)
      return
    }
    void adminApi
      .me()
      .then(() => setAuthenticated(true))
      .catch(() => clearAdminToken())
      .finally(() => setChecking(false))
  }, [])

  const login = async (values: { username: string; password: string }) => {
    setSubmitting(true)
    try {
      await adminApi.login(values.username, values.password)
      setAuthenticated(true)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div style={{ display: 'grid', minHeight: '100vh', placeItems: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div
        style={{
          display: 'grid',
          minHeight: '100vh',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <section
          style={{
            width: 'min(420px, 100%)',
            padding: 28,
            border: '1px solid #e1e5ea',
            borderRadius: 10,
            background: '#fff',
          }}
        >
          <div className="admin-brand" style={{ height: 'auto', padding: 0, border: 0 }}>
            <span className="admin-brand-mark">遗</span>
            <span>非遗文旅知识运营台</span>
          </div>
          <p style={{ margin: '10px 0 22px', color: '#667085' }}>
            使用超级管理员或知识库管理员账号登录。
          </p>
          <Form
            layout="vertical"
            initialValues={{ username: 'admin' }}
            onFinish={(values) => void login(values)}
          >
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true }]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={submitting}>
              登录
            </Button>
          </Form>
        </section>
      </div>
    )
  }

  return <KnowledgeWorkspace onLogout={() => setAuthenticated(false)} />
}
