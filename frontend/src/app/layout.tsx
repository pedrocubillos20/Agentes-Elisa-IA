'use client';

import './globals.css';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Settings, 
  Bot, 
  LogOut,
  Menu,
  X,
  Smartphone,
  Users,
  Calendar,
  Package,
  ChevronRight,
  Bell,
  Search,
  Sparkles
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      setLoading(false);
      if (!isAuthPage) {
        router.push('/login');
      }
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('token');
        if (!isAuthPage) {
          router.push('/login');
        }
      }
    } catch (error) {
      console.error('Error verificando auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    router.push('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Conversaciones', href: '/conversaciones', icon: MessageSquare },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
    { name: 'Asistentes IA', href: '/asistentes', icon: Bot },
    { 
      name: 'CRM', 
      href: '/crm', 
      icon: Users,
      badge: 'Nuevo'
    },
    { 
      name: 'Agenda', 
      href: '/agenda', 
      icon: Calendar,
      badge: 'Nuevo'
    },
    { name: 'Configuración', href: '/configuracion', icon: Settings },
  ];

  if (loading) {
    return (
      <html lang="es">
        <head>
          <title>Elisa IA</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <div className="app-background" />
          <div className="grid-pattern" />
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <div className="loading-spinner mx-auto mb-4" />
              <p className="text-[var(--text-muted)] text-sm">Cargando...</p>
            </div>
          </div>
        </body>
      </html>
    );
  }

  if (isAuthPage) {
    return (
      <html lang="es">
        <head>
          <title>Elisa IA</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <div className="app-background" />
          <div className="grid-pattern" />
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="es">
      <head>
        <title>Elisa IA - Plataforma</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {/* Animated Background */}
        <div className="app-background" />
        <div className="grid-pattern" />

        <div className="min-h-screen flex relative">
          {/* Mobile Overlay */}
          {sidebarOpen && (
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <aside className={`
            fixed lg:sticky top-0 left-0 z-50 h-screen
            ${sidebarCollapsed ? 'w-20' : 'w-72'}
            sidebar flex flex-col
            transform transition-all duration-300 ease-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}>
            {/* Logo */}
            <div className="h-20 flex items-center justify-between px-5 border-b border-[var(--border-primary)]">
              <Link href="/dashboard" className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[var(--accent-gradient)] flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                {!sidebarCollapsed && (
                  <div className="animate-fade-in">
                    <span className="text-xl font-bold text-white">Elisa</span>
                    <span className="text-xl font-light text-[var(--accent-primary)]"> IA</span>
                  </div>
                )}
              </Link>
              <button 
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
              {navigation.map((item, index) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      sidebar-nav-item
                      ${isActive ? 'active' : ''}
                      animate-fade-in
                    `}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-[var(--accent-primary)]' : ''}`} />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1">{item.name}</span>
                        {item.badge && (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-[var(--accent-primary)] text-white rounded-full">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* User Section */}
            <div className="p-4 border-t border-[var(--border-primary)]">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5 animate-fade-in">
                  <div className="avatar">
                    {user?.name?.[0] || user?.email?.[0] || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {user?.name || 'Usuario'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {user?.email}
                    </p>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 
                  text-[var(--text-muted)] hover:text-white 
                  hover:bg-white/5 rounded-xl 
                  transition-all duration-200
                  ${sidebarCollapsed ? 'justify-center' : ''}
                `}
              >
                <LogOut className="w-5 h-5" />
                {!sidebarCollapsed && <span className="font-medium">Cerrar Sesión</span>}
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 flex flex-col min-h-screen">
            {/* Top Header */}
            <header className="sticky top-0 z-30 h-20 px-6 flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
              {/* Mobile Menu Button */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white rounded-lg hover:bg-white/5"
              >
                <Menu className="w-6 h-6" />
              </button>

              {/* Search Bar */}
              <div className="hidden md:flex flex-1 max-w-md mx-4">
                <div className="relative w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    placeholder="Buscar conversaciones, clientes..."
                    className="input pl-11 py-3 bg-white/5 border-transparent focus:bg-[var(--bg-tertiary)]"
                  />
                </div>
              </div>

              {/* Right Actions */}
              <div className="flex items-center gap-3">
                {/* Notifications */}
                <button className="relative p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5 transition-all">
                  <Bell className="w-5 h-5" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--accent-primary)] rounded-full" />
                </button>

                {/* Mobile Logo */}
                <div className="lg:hidden flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-[var(--accent-gradient)] flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-white">Elisa</span>
                </div>
              </div>
            </header>

            {/* Page Content */}
            <div className="flex-1 p-6 lg:p-8 overflow-auto">
              <div className="animate-fade-in">
                {children}
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
