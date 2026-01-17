import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Elisa IA - Asistentes Inteligentes para tu Negocio',
  description: 'Plataforma de asistentes de IA para automatizar la atención al cliente de tu negocio',
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
