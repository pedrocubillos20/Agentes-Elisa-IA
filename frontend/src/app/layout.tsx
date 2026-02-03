'use client';

import './globals.css';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, MessageSquare, Settings, Bot, LogOut, Menu, X,
  Smartphone, Users, Calendar, Bell, Search, ChevronRight, Shield, CreditCard
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => { checkAuth(); }, [pathname]);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); if (!isAuthPage) router.push('/login'); return; }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('token');
        if (!isAuthPage) router.push('/login');
      }
    } catch (error) { console.error('Auth error:', error); }
    finally { setLoading(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    router.push('/login');
  };

  // Permisos del usuario (admin tiene todo, sub-usuarios según sus permisos)
  const perms = user?.permissions || {};
  const isAdmin = !user?.parentUserId;
  const hasPerm = (p: string) => isAdmin || perms[p] === true;

  // Navegación dinámica según permisos
  const allNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, perm: 'dashboard' },
    { name: 'Conversaciones', href: '/conversaciones', icon: MessageSquare, perm: 'conversations' },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone, perm: 'whatsapp' },
    { name: 'Asistentes IA', href: '/asistentes', icon: Bot, perm: 'assistants' },
    { name: 'CRM', href: '/crm', icon: Users, perm: 'crm', badge: 'Nuevo' },
    { name: 'Agenda', href: '/agenda', icon: Calendar, perm: 'agenda', badge: 'Nuevo' },
    { name: 'Equipo', href: '/equipo', icon: Shield, perm: 'team', badge: 'Nuevo' },
    { name: 'Configuración', href: '/configuracion', icon: Settings, perm: 'config' },
    { name: 'Suscripción', href: '/subscription', icon: CreditCard, perm: 'config' },
  ];

  const navigation = allNavigation.filter(item => hasPerm(item.perm));

  // Rol label
  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'manager' ? 'Gerente' : user?.role === 'agent' ? 'Vendedor' : user?.role === 'support' ? 'Soporte' : 'Observador';

  if (loading) {
    return (
      <html lang="es">
        <head><title>Elisa IA</title><link rel="icon" href="/elisa.png" /></head>
        <body>
          <div className="app-background" />
          <div className="grid-pattern" />
          <div className="min-h-screen flex flex-col items-center justify-center gap-6">
            <img src="/elisa.png" alt="Elisa IA" className="w-20 h-20 rounded-2xl animate-pulse" />
            <h1 className="text-2xl font-bold">Elisa <span className="text-[var(--accent-primary)] font-light">IA</span></h1>
            <div className="loading-spinner" />
          </div>
        </body>
      </html>
    );
  }

  if (isAuthPage) {
    return (
      <html lang="es">
        <head><title>Elisa IA</title><link rel="icon" href="/elisa.png" /></head>
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
      <head><title>Elisa IA</title><link rel="icon" href="/elisa.png" /></head>
      <body>
        <div className="app-background" />
        <div className="grid-pattern" />

        <div className="min-h-screen flex">
          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          {/* Sidebar */}
          <aside className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-72 sidebar flex flex-col transform transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
            
            <div className="h-20 flex items-center justify-between px-5 border-b border-[var(--border-primary)]">
              <Link href="/dashboard" className="flex items-center gap-3">
                <img src="/elisa.png" alt="Elisa IA" className="logo-img" />
                <div className="text-xl font-bold">
                  <span className="text-white">Elisa</span>
                  <span className="text-[var(--accent-primary)] font-light"> IA</span>
                </div>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
              {navigation.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link key={item.name} href={item.href} onClick={() => setSidebarOpen(false)}
                    className={`nav-item ${isActive ? 'active' : ''}`}>
                    <item.icon className={`w-5 h-5 ${isActive ? 'text-[var(--accent-primary)]' : ''}`} />
                    <span className="flex-1">{item.name}</span>
                    {item.badge && <span className="badge-new">{item.badge}</span>}
                    {isActive && <ChevronRight className="w-4 h-4 text-[var(--accent-primary)]" />}
                  </Link>
                );
              })}
            </nav>

            {/* User Section */}
            <div className="p-4 border-t border-[var(--border-primary)]">
              <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5">
                <div className="avatar">{user?.name?.[0] || 'U'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user?.name || 'Usuario'}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                    <p className="text-xs text-[var(--text-muted)] truncate">{roleLabel}</p>
                  </div>
                </div>
              </div>
              
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 text-[var(--text-muted)] hover:text-white hover:bg-white/5 rounded-xl transition-all">
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Cerrar Sesión</span>
              </button>
            </div>

            <div className="px-4 pb-4">
              <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20">
                <img src="/elisa.png" alt="Elisa" className="w-5 h-5 rounded" />
                <span className="text-xs text-[var(--accent-primary)] font-medium">Powered by Elisa IA</span>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 flex flex-col min-h-screen">
            <header className="sticky top-0 z-30 h-20 px-6 flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
              <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white">
                <Menu className="w-6 h-6" />
              </button>

              <div className="hidden md:flex flex-1 max-w-md mx-4">
                <div className="relative w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                  <input type="text" placeholder="Buscar..." className="input pl-11 py-3 bg-white/5 border-transparent" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                {user?.isSubUser && (
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full hidden md:inline">
                    {roleLabel}
                  </span>
                )}
                <button className="relative p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5">
                  <Bell className="w-5 h-5" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--accent-primary)] rounded-full animate-pulse" />
                </button>
                <div className="lg:hidden flex items-center gap-2">
                  <img src="/elisa.png" alt="Elisa IA" className="w-9 h-9 rounded-lg" />
                </div>
              </div>
            </header>

            <div className="flex-1 p-6 lg:p-8 overflow-auto">
              <div className="animate-fade-in">{children}</div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
