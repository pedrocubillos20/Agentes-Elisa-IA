'use client';

import './globals.css';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, MessageSquare, Settings, Bot, LogOut, Menu, X,
  Smartphone, Users, Calendar, Bell, Search, ChevronRight, Shield, CreditCard,
  Lock, Crown, AlertTriangle, Sparkles, Clock
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ===== FEATURES BLOQUEADAS POR PLAN =====
// Define qué features requieren Business para mostrar candado en Starter
const BUSINESS_ONLY_ROUTES: Record<string, string> = {
  '/crm': 'crm',
  '/agenda': 'agenda',
  '/equipo': 'team',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [blockedFeature, setBlockedFeature] = useState('');

  const isAuthPage = pathname === '/login' || pathname === '/register';
  const isSubscriptionPage = pathname === '/subscription';

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

  // Plan info
  const plan = user?.plan || 'trial';
  const features = user?.planFeatures || {};
  const isBlocked = user?.isBlocked === true;
  const isTrial = plan === 'trial';
  const isStarter = plan === 'starter';
  const isBusiness = plan === 'business';
  const daysRemaining = user?.daysRemaining || 0;

  // Check if a route is locked for current plan
  const isRouteLocked = (href: string): boolean => {
    if (isTrial && !isBlocked) return false; // Trial activo = acceso total
    if (isBusiness) return false; // Business = acceso total
    // Starter: check specific features
    const featureKey = BUSINESS_ONLY_ROUTES[href];
    if (featureKey && !features[featureKey]) return true;
    return false;
  };

  // Handle clicking on locked route
  const handleLockedClick = (e: React.MouseEvent, featureName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setBlockedFeature(featureName);
    setShowUpgradeModal(true);
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
    { name: 'CRM', href: '/crm', icon: Users, perm: 'crm', badge: 'Nuevo', businessOnly: true },
    { name: 'Agenda', href: '/agenda', icon: Calendar, perm: 'agenda', badge: 'Nuevo', businessOnly: true },
    { name: 'Equipo', href: '/equipo', icon: Shield, perm: 'team', badge: 'Nuevo', businessOnly: true },
    { name: 'Configuración', href: '/configuracion', icon: Settings, perm: 'config' },
    { name: 'Suscripción', href: '/subscription', icon: CreditCard, perm: 'config' },
  ];

  const navigation = allNavigation.filter(item => {
    if ((item as any).adminOnly && !isAdmin) return false;
    return hasPerm(item.perm);
  });

  // Rol label
  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'manager' ? 'Gerente' : user?.role === 'agent' ? 'Vendedor' : user?.role === 'support' ? 'Soporte' : 'Observador';

  // Plan label
  const planLabel = isBusiness ? 'Business' : isStarter ? 'Starter' : isTrial ? (isBlocked ? 'Trial expirado' : `Trial · ${daysRemaining}d`) : 'Sin plan';
  const planColor = isBusiness ? 'text-emerald-400' : isStarter ? 'text-indigo-400' : isBlocked ? 'text-red-400' : 'text-amber-400';

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

        {/* ===== OVERLAY DE BLOQUEO — Trial expirado ===== */}
        {isBlocked && !isSubscriptionPage && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-lg w-full bg-[#0d0d15] border border-red-500/30 rounded-3xl p-8 text-center shadow-2xl shadow-red-500/10">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-400" />
              </div>
              <h2 className="text-2xl font-black text-white mb-3">Tu período de prueba terminó</h2>
              <p className="text-gray-400 mb-2">
                Los 7 días de prueba gratuita han finalizado.
              </p>
              <p className="text-gray-500 text-sm mb-8">
                No perderás tus datos ni configuraciones. Elige un plan para seguir usando Elisa IA.
              </p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => router.push('/subscription')}
                  className="w-full py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2"
                >
                  <Crown className="w-5 h-5" /> Ver Planes y Precios
                </button>
                <button 
                  onClick={handleLogout}
                  className="w-full py-3 rounded-xl text-gray-500 hover:text-gray-300 text-sm transition-colors"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== MODAL DE UPGRADE — Feature bloqueada ===== */}
        {showUpgradeModal && (
          <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowUpgradeModal(false)}>
            <div className="max-w-md w-full bg-[#0d0d15] border border-emerald-500/30 rounded-3xl p-8 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                <Lock className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-xl font-black text-white mb-2">
                Función exclusiva de <span className="text-emerald-400">Business</span>
              </h3>
              <p className="text-gray-400 text-sm mb-2">
                <strong className="text-white">{blockedFeature}</strong> no está disponible en tu plan actual.
              </p>
              <p className="text-gray-500 text-xs mb-6">
                Actualiza a Elisa Business para desbloquear CRM, Agenda, Equipo y todas las herramientas avanzadas.
              </p>
              
              <div className="space-y-3 text-left mb-6 p-4 bg-white/5 rounded-xl">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" /> CRM completo con base de datos
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" /> Agenda de citas integrada
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" /> Equipo multi-usuario
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" /> Líneas WhatsApp ilimitadas
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setShowUpgradeModal(false)} className="flex-1 py-3 rounded-xl text-gray-400 border border-white/10 hover:bg-white/5 transition-all text-sm font-medium">
                  Cerrar
                </button>
                <button onClick={() => { setShowUpgradeModal(false); router.push('/subscription'); }} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold text-sm hover:shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-1">
                  <Crown className="w-4 h-4" /> Actualizar
                </button>
              </div>
            </div>
          </div>
        )}

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

            {/* Trial / Plan Banner in sidebar */}
            {isTrial && !isBlocked && daysRemaining > 0 && (
              <div className="mx-4 mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400">PRUEBA GRATIS</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{daysRemaining} días restantes</span>
                  <Link href="/subscription" className="text-[10px] text-emerald-400 font-bold hover:underline">
                    Ver planes →
                  </Link>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all"
                    style={{ width: `${Math.max(5, ((7 - daysRemaining) / 7) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {isStarter && (
              <div className="mx-4 mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-indigo-400">PLAN STARTER</span>
                </div>
                <Link href="/subscription" className="text-[10px] text-emerald-400 font-bold hover:underline">
                  Upgrade a Business →
                </Link>
              </div>
            )}

            {isBusiness && (
              <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400">PLAN BUSINESS</span>
                </div>
              </div>
            )}

            <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
              {navigation.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const locked = isRouteLocked(item.href);
                
                if (locked) {
                  // ===== ITEM CON CANDADO =====
                  return (
                    <button
                      key={item.name}
                      onClick={(e) => handleLockedClick(e, item.name)}
                      className="nav-item w-full opacity-50 hover:opacity-70 cursor-pointer group relative"
                    >
                      <item.icon className="w-5 h-5 text-gray-600" />
                      <span className="flex-1 text-left">{item.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full hidden group-hover:inline">
                          Upgrade
                        </span>
                        <Lock className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition-colors" />
                      </div>
                    </button>
                  );
                }

                return (
                  <Link key={item.name} href={item.href} onClick={() => setSidebarOpen(false)}
                    className={`nav-item ${isActive ? 'active' : ''}`}>
                    <item.icon className={`w-5 h-5 ${isActive ? 'text-[var(--accent-primary)]' : ''}`} />
                    <span className="flex-1">{item.name}</span>
                    {item.badge && !locked && <span className="badge-new">{item.badge}</span>}
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
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${isBusiness ? 'bg-emerald-400' : isStarter ? 'bg-indigo-400' : isAdmin ? 'bg-amber-400' : 'bg-blue-400'}`} />
                    <p className={`text-xs truncate ${planColor}`}>{planLabel}</p>
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
                {/* Plan badge in header */}
                {isStarter && (
                  <Link href="/subscription" className="hidden md:flex items-center gap-1.5 text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
                    <Crown className="w-3 h-3" /> Upgrade
                  </Link>
                )}
                {isTrial && !isBlocked && (
                  <Link href="/subscription" className="hidden md:flex items-center gap-1.5 text-xs bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-full border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
                    <Clock className="w-3 h-3" /> {daysRemaining}d trial
                  </Link>
                )}
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
