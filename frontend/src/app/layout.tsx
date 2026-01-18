import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Elisa IA - Chatbots de WhatsApp con IA',
  description: 'Crea chatbots inteligentes para WhatsApp Business',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
