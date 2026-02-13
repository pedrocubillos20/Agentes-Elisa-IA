'use client';

import './globals.css';
import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, MessageSquare, Settings, Bot, LogOut, Menu, X,
  Smartphone, Users, Calendar, Bell, Search, ChevronRight, Shield, CreditCard,
  ChevronDown, Wifi, Phone, Plus, Check, BookOpen, HelpCircle, Sparkles, Rocket,
  ExternalLink, Code
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const SUPPORT_WHATSAPP = '573123538300';

// ===== GLOBAL LINE CONTEXT =====
const LineContext = createContext<{
  selectedLine: any | null;
  lines: any[];
  switchLine: (line: any) => void;
  refreshLines: () => void;
}>({ selectedLine: null, lines: [], switchLine: () => {}, refreshLines: () => {} });

export const useSelectedLine = () => useContext(LineContext);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lines, setLines] = useState<any[]>([]);
  const [selectedLine, setSelectedLine] = useState<any>(null);
  const [lineDropdownOpen, setLineDropdownOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname === '/forgot-password';
  const globalPages = ['/whatsapp', '/configuracion', '/subscription', '/equipo', '/guia', '/integraciones'];
  const isGlobalPage = globalPages.some(p => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => { checkAuth(); }, [pathname]);
  useEffect(() => { if (user && !isAuthPage) fetchLines(); }, [user]);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); if (!isAuthPage) router.push('/login'); return; }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        // Show welcome modal for first-time users
        const welcomed = localStorage.getItem('bizonne_welcomed');
        if (!welcomed) {
          setShowWelcome(true);
          localStorage.setItem('bizonne_welcomed', 'true');
        }
      } else {
        localStorage.removeItem('token');
        if (!isAuthPage) router.push('/login');
      }
    } catch (error) { console.error('Auth error:', error); }
    finally { setLoading(false); }
  };

  const fetchLines = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/whatsapp/lines`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        const fetchedLines = data.lines || [];
        setLines(fetchedLines);
        const savedLineId = localStorage.getItem('selectedLineId');
        const saved = fetchedLines.find((l: any) => l.id === savedLineId);
        if (saved) {
          setSelectedLine(saved);
        } else if (fetchedLines.length > 0) {
          setSelectedLine(fetchedLines[0]);
          localStorage.setItem('selectedLineId', fetchedLines[0].id);
        }
      }
    } catch (e) { console.error('Error fetching lines:', e); }
  };

  const switchLine = (line: any) => {
    setSelectedLine(line);
    localStorage.setItem('selectedLineId', line.id);
    setLineDropdownOpen(false);
    window.dispatchEvent(new CustomEvent('lineChanged', { detail: { lineId: line.id, line } }));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('selectedLineId');
    setUser(null);
    router.push('/login');
  };

  const perms = user?.permissions || {};
  const isAdmin = !user?.parentUserId;
  const hasPerm = (p: string) => isAdmin || perms[p] === true;

  const allNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, perm: 'dashboard' },
    { name: 'Conversaciones', href: '/conversaciones', icon: MessageSquare, perm: 'conversations' },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone, perm: 'whatsapp' },
    { name: 'Asistentes IA', href: '/asistentes', icon: Bot, perm: 'assistants' },
    { name: 'CRM', href: '/crm', icon: Users, perm: 'crm', badge: 'Nuevo' },
    { name: 'Agenda', href: '/agenda', icon: Calendar, perm: 'agenda', badge: 'Nuevo' },
    { name: 'Programados', href: '/programados', icon: Bell, perm: 'conversations', badge: 'Nuevo' },
    { name: 'Equipo', href: '/equipo', icon: Shield, perm: 'team', badge: 'Nuevo' },
    { name: 'Configuración', href: '/configuracion', icon: Settings, perm: 'config' },
    { name: 'Suscripción', href: '/subscription', icon: CreditCard, perm: 'config' },
    { name: 'Integraciones', href: '/integraciones', icon: Code, perm: 'config', badge: 'Nuevo' },
    { name: 'Guía', href: '/guia', icon: BookOpen, perm: 'dashboard' },
  ];

  const navigation = allNavigation.filter(item => {
    if ((item as any).adminOnly && !isAdmin) return false;
    return hasPerm(item.perm);
  });

  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'manager' ? 'Gerente' : user?.role === 'agent' ? 'Vendedor' : user?.role === 'support' ? 'Soporte' : 'Observador';
  const planLabel = user?.plan === 'business' ? 'PLAN BUSINESS' : user?.plan === 'starter' ? 'PLAN STARTER' : user?.plan === 'trial' ? 'TRIAL' : 'PLAN';

  if (loading) {
    return (
      <html lang="es">
        <head><title>Bizonne CRM</title><link rel="icon" href="/bizonne.png" /></head>
        <body>
          <div className="app-background" />
          <div className="grid-pattern" />
          <div className="min-h-screen flex flex-col items-center justify-center gap-6">
            <img src="/bizonne.png" alt="Bizonne" className="w-20 h-20 rounded-2xl animate-pulse" />
            <h1 className="text-2xl font-bold">Bizonne<span className="text-[var(--accent-primary)] font-light">CRM</span></h1>
            <div className="loading-spinner" />
          </div>
        </body>
      </html>
    );
  }

  if (isAuthPage) {
    return (
      <html lang="es">
        <head><title>Bizonne CRM</title><link rel="icon" href="/bizonne.png" /></head>
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
      <head><title>{selectedLine ? `${selectedLine.label} — Bizonne` : 'Bizonne CRM'}</title><link rel="icon" href="/bizonne.png" /></head>
      <body>
        <div className="app-background" />
        <div className="grid-pattern" />

        <LineContext.Provider value={{ selectedLine, lines, switchLine, refreshLines: fetchLines }}>
          <div className="min-h-screen flex">
            {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

            {/* Sidebar */}
            <aside className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-72 sidebar flex flex-col transform transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
              
              {/* Logo */}
              <div className="h-16 flex items-center justify-between px-5 border-b border-[var(--border-primary)]">
                <Link href="/dashboard" className="flex items-center gap-3">
                  <img src="/bizonne.png" alt="Bizonne" className="logo-img" />
                  <div className="text-xl font-bold">
                    <span className="text-white">Bizonne</span>
                    <span className="text-[var(--accent-primary)] font-light">CRM</span>
                  </div>
                </Link>
                <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* ===== WORKSPACE LINE SELECTOR ===== */}
              {lines.length > 0 && (
                <div className="px-3 py-3 border-b border-[var(--border-primary)]">
                  <div className="relative">
                    <button
                      onClick={() => setLineDropdownOpen(!lineDropdownOpen)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-[var(--border-primary)] transition-all"
                    >
                      <div className={`relative flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        selectedLine?.status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        <Phone className="w-4 h-4" />
                        {selectedLine?.status === 'connected' && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[var(--bg-secondary)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-semibold text-white truncate">{selectedLine?.label || 'Seleccionar línea'}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{selectedLine?.phone ? `+${selectedLine.phone}` : 'Sin número'}</p>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${lineDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {lineDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-50" onClick={() => setLineDropdownOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl overflow-hidden animate-fade-in">
                          <div className="p-2 border-b border-[var(--border-primary)]">
                            <p className="px-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Workspace</p>
                          </div>
                          <div className="max-h-64 overflow-y-auto p-1.5">
                            {lines.map((line: any) => (
                              <button key={line.id} onClick={() => switchLine(line)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                                  selectedLine?.id === line.id ? 'bg-[var(--accent-primary)]/15 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white'
                                }`}>
                                <div className={`w-7 h-7 rounded-md flex items-center justify-center ${
                                  line.status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  <Wifi className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                  <p className="text-sm font-medium truncate">{line.label}</p>
                                  <p className="text-[10px] text-[var(--text-muted)]">{line.phone ? `+${line.phone}` : 'Sin número'}</p>
                                </div>
                                {selectedLine?.id === line.id && <Check className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0" />}
                              </button>
                            ))}
                          </div>
                          <div className="p-2 border-t border-[var(--border-primary)]">
                            <Link href="/whatsapp" onClick={() => { setLineDropdownOpen(false); setSidebarOpen(false); }}
                              className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-lg transition-all">
                              <Plus className="w-3.5 h-3.5" />
                              <span>Gestionar líneas</span>
                            </Link>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Plan badge */}
              {user?.plan && (
                <div className="px-4 pt-3">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide ${
                    user.plan === 'business' ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                    : user.plan === 'starter' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  }`}>
                    <span>👑</span><span>{planLabel}</span>
                  </div>
                </div>
              )}

              {/* Nav */}
              <nav className="flex-1 p-4 space-y-1 overflow-y-auto sidebar-scroll">
                {navigation.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link key={item.name} href={item.href} onClick={() => setSidebarOpen(false)} className={`nav-item ${isActive ? 'active' : ''}`}>
                      <item.icon className={`w-5 h-5 ${isActive ? 'text-[var(--accent-primary)]' : ''}`} />
                      <span className="flex-1">{item.name}</span>
                      {item.badge && <span className="badge-new">{item.badge}</span>}
                      {isActive && <ChevronRight className="w-4 h-4 text-[var(--accent-primary)]" />}
                    </Link>
                  );
                })}
              </nav>

              {/* User */}
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
                  <LogOut className="w-5 h-5" /><span className="font-medium">Cerrar Sesión</span>
                </button>
              </div>

              <div className="px-4 pb-4">
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20">
                  <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
                  <span className="text-xs text-[var(--accent-primary)] font-medium">Powered by Bizonne</span>
                </div>
              </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col min-h-screen">
              <header className="sticky top-0 z-30 h-16 px-6 flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white">
                    <Menu className="w-6 h-6" />
                  </button>
                  {selectedLine && !isGlobalPage && (
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-[var(--border-primary)]">
                      <div className={`w-2 h-2 rounded-full ${selectedLine.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="text-xs text-[var(--text-secondary)] font-medium">{selectedLine.label}</span>
                      {selectedLine.phone && <span className="text-[10px] text-[var(--text-muted)]">+{selectedLine.phone}</span>}
                    </div>
                  )}
                </div>
                <div className="hidden md:flex flex-1 max-w-md mx-4">
                  <div className="relative w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    <input type="text" placeholder="Buscar..." className="input pl-11 py-2.5 bg-white/5 border-transparent text-sm" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {user?.isSubUser && <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full hidden md:inline">{roleLabel}</span>}
                  <button className="relative p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--accent-primary)] rounded-full animate-pulse" />
                  </button>
                  <div className="lg:hidden flex items-center gap-2">
                    <img src="/bizonne.png" alt="Bizonne" className="w-9 h-9 rounded-lg" />
                  </div>
                </div>
              </header>
              <div className="flex-1 p-6 lg:p-8 overflow-auto">
                <div className="animate-fade-in">{children}</div>
              </div>
            </main>
          </div>
        </LineContext.Provider>

        {/* ===== WELCOME MODAL ===== */}
        {showWelcome && (
          <>
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowWelcome(false)}>
              <div className="w-full max-w-lg bg-[#0d0d15] border border-emerald-500/20 rounded-3xl shadow-2xl shadow-emerald-500/10 overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                {/* Header con gradiente */}
                <div className="relative bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-purple-500/10 p-8 text-center">
                  <div className="absolute inset-0 bg-[url('/bizonne.png')] bg-center bg-no-repeat opacity-5 bg-contain" />
                  <div className="relative">
                    <div className="w-20 h-20 bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 rounded-3xl mx-auto mb-4 flex items-center justify-center border border-emerald-500/30 shadow-lg shadow-emerald-500/20">
                      <Sparkles className="w-10 h-10 text-emerald-400" />
                    </div>
                    <h2 className="text-3xl font-black text-white mb-2">
                      ¡Bienvenido a <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Bizonne</span>! 🎉
                    </h2>
                    <p className="text-gray-400 text-sm">
                      Gracias por elegirnos. Estás a punto de transformar tu negocio con inteligencia artificial.
                    </p>
                  </div>
                </div>
                
                {/* Contenido */}
                <div className="p-6 space-y-4">
                  <p className="text-gray-300 text-sm text-center leading-relaxed">
                    Tu cuenta está lista. Sigue estos pasos para activar tu asistente de IA por WhatsApp:
                  </p>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-black text-emerald-400">1</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Conecta WhatsApp</p>
                        <p className="text-[11px] text-gray-500">Escanea el QR para vincular tu número</p>
                      </div>
                      <Smartphone className="w-5 h-5 text-emerald-400 ml-auto flex-shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-black text-blue-400">2</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Configura tu Asistente</p>
                        <p className="text-[11px] text-gray-500">Escribe la info de tu negocio y productos</p>
                      </div>
                      <Bot className="w-5 h-5 text-blue-400 ml-auto flex-shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-black text-purple-400">3</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">¡Listo! Empieza a vender</p>
                        <p className="text-[11px] text-gray-500">Tu bot responde 24/7 automáticamente</p>
                      </div>
                      <Rocket className="w-5 h-5 text-purple-400 ml-auto flex-shrink-0" />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Link href="/guia" onClick={() => setShowWelcome(false)}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-emerald-500/30 transition-all hover:scale-[1.02] text-sm">
                      <BookOpen className="w-4 h-4" /> Ver Tutorial Paso a Paso
                    </Link>
                    <button onClick={() => setShowWelcome(false)}
                      className="px-5 py-3.5 bg-white/5 text-gray-400 rounded-xl text-sm font-medium hover:bg-white/10 transition border border-white/10">
                      Cerrar
                    </button>
                  </div>

                  <p className="text-center text-gray-600 text-[11px]">
                    ¿Necesitas ayuda? Escríbenos a nuestro{' '}
                    <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hola! Acabo de registrarme en Bizonne y necesito ayuda para configurar mi cuenta 🤖')}`}
                      target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                      soporte por WhatsApp
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== FLOATING SUPPORT BUTTON ===== */}
        {user && !isAuthPage && (
          <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hola! Necesito ayuda con mi cuenta de Bizonne 🤖')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all hover:scale-105"
              title="Soporte WhatsApp">
              <HelpCircle className="w-5 h-5" />
              <span className="text-sm font-semibold hidden group-hover:inline transition-all">Soporte</span>
            </a>
          </div>
        )}
      </body>
    </html>
  );
}
