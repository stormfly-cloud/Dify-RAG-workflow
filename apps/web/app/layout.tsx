import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '非遗文旅智能咨询',
  description: '面向非遗与文旅领域的知识问答服务',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
