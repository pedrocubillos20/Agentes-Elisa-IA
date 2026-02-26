'use client';

import './globals.css';
import { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, MessageSquare, Settings, Bot, LogOut, Menu, X,
  Smartphone, Users, Calendar, Bell, Search, ChevronRight, Shield, CreditCard,
  ChevronDown, Wifi, Phone, Plus, Check, BookOpen, HelpCircle, Sparkles, Rocket,
  ExternalLink, Code, Lock, Zap, Clock, AlertTriangle, Key, Paintbrush, Download
} from 'lucide-react';
import Paywall from '../components/Paywall';
import LiveChat from '../components/LiveChat';
import WallpaperPicker, { applyWallpaper, loadSavedWallpaper } from '../components/WallpaperPicker';
import InstallApp from '../components/InstallApp';
import { NotificationProvider, NotificationBellBadge } from '../components/NotificationSounds';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const SUPPORT_WHATSAPP = '573213815105';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lines, setLines] = useState<any[]>([]);
  const [selectedLine, setSelectedLine] = useState<any>(null);
  const [lineDropdownOpen, setLineDropdownOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<any>(null);
  const [showApiKeyGuide, setShowApiKeyGuide] = useState(false);
  const [showWallpaper, setShowWallpaper] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<any[]>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // 🎨 Aplicar fondo guardado al montar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTimeout(() => applyWallpaper(loadSavedWallpaper()), 100);
      // Load sidebar state
      try { const sc = localStorage.getItem('bizonne_sidebar_collapsed'); if (sc === 'true') setSidebarCollapsed(true); } catch {}
      // 📱 Registrar Service Worker para PWA
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }
  }, [loading]);

  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/privacy' || pathname === '/checkout' || pathname === '/payment-result';
  const globalPages = ['/whatsapp', '/configuracion', '/subscription', '/equipo', '/guia', '/integraciones', '/ai-config'];
  const isGlobalPage = globalPages.some(p => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => { checkAuth(); }, [pathname]);
  useEffect(() => { if (user && !isAuthPage) fetchLines(); }, [user]);
  
  // 🔑 Verificar errores de API Key cada 30s
  useEffect(() => {
    if (!user || isAuthPage) return;
    const checkApiKeyError = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/whatsapp/api-key-error`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          if (data.hasError) {
            setApiKeyError(data);
          } else if (!user.apiKeyConnected && user.plan !== 'trial') {
            // API key no conectada en general
            setApiKeyError({ type: 'not_connected', message: 'API Key de OpenAI no conectada' });
          } else {
            setApiKeyError(null);
          }
        }
      } catch {}
    };
    checkApiKeyError();
    const interval = setInterval(checkApiKeyError, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); if (!isAuthPage) router.push('/login'); return; }
    
    // ⚡ INSTANT: Show cached user immediately (skip loading)
    try {
      const cachedUser = localStorage.getItem('bizonne_user_cache');
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser);
        if (parsed?.id) { setUser(parsed); setLoading(false); }
      }
    } catch {}

    // Validate token + refresh user data in background
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        try { localStorage.setItem('bizonne_user_cache', JSON.stringify(data.user)); } catch {}
        // Show welcome modal for first-time users
        const welcomed = localStorage.getItem('bizonne_welcomed');
        if (!welcomed) {
          setShowWelcome(true);
          localStorage.setItem('bizonne_welcomed', 'true');
        }
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('bizonne_user_cache');
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
          // Si el usuario solo tiene acceso a 1 línea, auto-seleccionarla
          setSelectedLine(fetchedLines[0]);
          localStorage.setItem('selectedLineId', fetchedLines[0].id);
        }
        // Si solo tiene 1 línea, cerrar dropdown automáticamente
        if (fetchedLines.length <= 1) setLineDropdownOpen(false);
      }
    } catch (e) { console.error('Error fetching lines:', e); }
  };

  const switchLine = (line: any) => {
    setSelectedLine(line);
    localStorage.setItem('selectedLineId', line.id);
    setLineDropdownOpen(false);
    window.dispatchEvent(new CustomEvent('lineChanged', { detail: { lineId: line.id, line } }));
  };

  // 🔍 Global search
  const handleGlobalSearch = async (query: string) => {
    setGlobalSearch(query);
    if (query.length < 2) { setGlobalResults([]); setGlobalSearchOpen(false); return; }
    setSearchLoading(true);
    setGlobalSearchOpen(true);
    try {
      const token = localStorage.getItem('token');
      const lineId = selectedLine?.id || '';
      const [convsRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/api/conversations?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/clients?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/products?lineId=${lineId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      const q = query.toLowerCase();
      const results: any[] = [];
      if (convsRes.ok) {
        const convs = (await convsRes.json()).conversations || [];
        convs.filter((c: any) => 
          c.recipientName?.toLowerCase().includes(q) || c.recipientId?.includes(q) || c.lastMessage?.toLowerCase().includes(q) ||
          (c.contextData && JSON.stringify(c.contextData).toLowerCase().includes(q))
        ).slice(0, 5).forEach((c: any) => results.push({ type: 'conversation', id: c.id, name: c.recipientName || c.recipientId, sub: c.lastMessage?.slice(0, 50) || c.stage, href: `/conversaciones?id=${c.id}`, icon: '💬' }));
      }
      if (clientsRes.ok) {
        const clients = (await clientsRes.json()).clients || [];
        clients.filter((c: any) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q))
          .slice(0, 3).forEach((c: any) => results.push({ type: 'client', id: c.id, name: c.name, sub: c.phone, href: '/crm', icon: '👤' }));
      }
      if (productsRes.ok) {
        const prods = (await productsRes.json()).products || [];
        prods.filter((p: any) => p.name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q))
          .slice(0, 3).forEach((p: any) => results.push({ type: 'product', id: p.id, name: p.name, sub: `$${p.price?.toLocaleString()} · ${p.category || 'Sin categoría'}`, href: '/crm', icon: '📦' }));
      }
      setGlobalResults(results);
    } catch { setGlobalResults([]); }
    setSearchLoading(false);
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
  const hasImplementation = user?.hasImplementation || false;
  const planFeatures = user?.planFeatures || {};

  // 🔒 Páginas bloqueadas para addon de implementación (solo implementadores configuran)
  const implementationLocked = ['assistants', 'config', 'integrations'];

  const allNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, perm: 'dashboard', color: 'from-emerald-500/20 to-emerald-600/10 text-emerald-400' },
    { name: 'Conversaciones', href: '/conversaciones', icon: MessageSquare, perm: 'conversations', color: 'from-cyan-500/20 to-cyan-600/10 text-cyan-400' },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone, perm: 'whatsapp', color: 'from-green-500/20 to-green-600/10 text-green-400' },
    { name: 'Asistentes IA', href: '/asistentes', icon: Bot, perm: 'assistants', featureKey: 'assistants', color: 'from-violet-500/20 to-violet-600/10 text-violet-400' },
    { name: 'CRM', href: '/crm', icon: Users, perm: 'crm', color: 'from-amber-500/20 to-amber-600/10 text-amber-400' },
    { name: 'Agenda', href: '/agenda', icon: Calendar, perm: 'agenda', color: 'from-rose-500/20 to-rose-600/10 text-rose-400' },
    { name: 'Programados', href: '/programados', icon: Bell, perm: 'conversations', color: 'from-orange-500/20 to-orange-600/10 text-orange-400' },
    { name: 'Equipo', href: '/equipo', icon: Shield, perm: 'team', featureKey: 'team', color: 'from-blue-500/20 to-blue-600/10 text-blue-400' },
    { name: 'Configuración', href: '/configuracion', icon: Settings, perm: 'config', featureKey: 'config', color: 'from-gray-500/20 to-gray-600/10 text-gray-400' },
    { name: 'Suscripción', href: '/subscription', icon: CreditCard, perm: 'config', color: 'from-yellow-500/20 to-yellow-600/10 text-yellow-400' },
    { name: 'Integraciones', href: '/integraciones', icon: Code, perm: 'config', featureKey: 'integrations', color: 'from-pink-500/20 to-pink-600/10 text-pink-400' },
    { name: 'Guía', href: '/guia', icon: BookOpen, perm: 'dashboard', color: 'from-teal-500/20 to-teal-600/10 text-teal-400' },
  ];

  const navigation = allNavigation.filter(item => {
    if ((item as any).adminOnly && !isAdmin) return false;
    if (!hasPerm(item.perm)) return false;
    // 🔒 Ocultar si el plan no incluye la feature
    if (item.featureKey && planFeatures[item.featureKey] === false) return false;
    return true;
  }).map(item => ({
    ...item,
    locked: hasImplementation && item.featureKey && implementationLocked.includes(item.featureKey)
  }));

  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'manager' ? 'Gerente' : user?.role === 'agent' ? 'Vendedor' : user?.role === 'support' ? 'Soporte' : 'Observador';
  const planLabel = user?.plan === 'business' ? 'PLAN BUSINESS' : user?.plan === 'starter' ? 'PLAN STARTER' : user?.plan === 'trial' ? 'TRIAL' : 'PLAN';

  if (loading) {
    return (
      <html lang="es">
        <head><title>Bizonne CRM</title><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" /><link rel="icon" href="/bizonne.png" /></head>
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
        <head><title>Bizonne CRM</title><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" /><link rel="icon" href="/bizonne.png" /></head>
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
        <title>{selectedLine ? `${selectedLine.label} — Bizonne` : 'Bizonne CRM'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <link rel="icon" href="/bizonne.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#10b981" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="BizonneCRM" />
        <link rel="apple-touch-icon" href="/bizonne.png" />
      </head>
      <body>
        <div className="app-background" />
        <div className="grid-pattern" />

        <NotificationProvider userId={user?.id}>
        <LineContext.Provider value={{ selectedLine, lines, switchLine, refreshLines: fetchLines }}>
          <div id="bizonne-wrapper" className="min-h-screen flex">
            {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

            {/* Sidebar */}
            <aside className={`fixed lg:sticky top-0 left-0 z-50 h-screen sidebar flex flex-col transform transition-all duration-300 ${sidebarCollapsed ? 'w-[68px]' : 'w-72'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
              
              {/* Logo */}
              <div className="h-16 flex items-center justify-between px-3 border-b border-[var(--border-primary)]">
                {!sidebarCollapsed ? (
                  <Link href="/dashboard" className="flex items-center gap-3 px-2">
                    <img src="/bizonne.png" alt="Bizonne" className="logo-img" />
                    <div className="text-xl font-bold">
                      <span className="text-white">Bizonne</span>
                      <span className="text-[var(--accent-primary)] font-light">CRM</span>
                    </div>
                  </Link>
                ) : (
                  <Link href="/dashboard" className="mx-auto">
                    <img src="/bizonne.png" alt="Bizonne" className="logo-img" />
                  </Link>
                )}
                <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-2 text-[var(--text-muted)] hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* ===== WORKSPACE LINE SELECTOR ===== */}
              {lines.length > 0 && !sidebarCollapsed && (
                <div className="px-3 py-3 border-b border-[var(--border-primary)]">
                  <div className="relative">
                    <button
                      onClick={() => lines.length > 1 && setLineDropdownOpen(!lineDropdownOpen)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-[var(--border-primary)] transition-all ${lines.length <= 1 ? 'cursor-default' : 'cursor-pointer'}`}
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
                      {lines.length > 1 && <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${lineDropdownOpen ? 'rotate-180' : ''}`} />}
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

              {/* Collapsed line indicator */}
              {lines.length > 0 && sidebarCollapsed && (
                <div className="px-2 py-3 border-b border-[var(--border-primary)] flex justify-center">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    selectedLine?.status === 'connected' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    <Phone className="w-5 h-5" />
                  </div>
                </div>
              )}

              {/* Plan badge */}
              {user?.plan && !sidebarCollapsed && (
                <div className="px-4 pt-3">
                  {user.isBlocked ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide bg-red-500/15 text-red-400 border border-red-500/30">
                        <Lock className="w-3 h-3" /><span>EXPIRADO</span>
                      </div>
                      <Link href="/subscription" className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/80 transition-all animate-pulse">
                        <Zap className="w-3 h-3" />Activar Plan
                      </Link>
                    </div>
                  ) : user.daysRemaining !== undefined && user.daysRemaining <= 3 && user.daysRemaining > 0 ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <Clock className="w-3 h-3" /><span>{user.daysRemaining}d restantes</span>
                      </div>
                      <Link href="/subscription" className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all">
                        <Zap className="w-3 h-3" />Renovar ahora
                      </Link>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide ${
                      user.plan === 'business' ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                      : user.plan === 'starter' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}>
                      <span>👑</span><span>{planLabel}</span>
                      {hasImplementation && <span className="text-orange-400 text-[9px]">+🛠️</span>}
                      {user.daysRemaining !== undefined && user.daysRemaining > 0 && user.daysRemaining <= 7 && (
                        <span className="text-[9px] opacity-60">({user.daysRemaining}d)</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Nav */}
              <nav className={`flex-1 ${sidebarCollapsed ? 'px-2 py-4' : 'p-4'} space-y-1 overflow-y-auto sidebar-scroll`}>
                {navigation.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  if (item.locked) {
                    return (
                      <div key={item.name} className={`nav-item opacity-40 cursor-not-allowed ${sidebarCollapsed ? 'justify-center px-0' : ''}`} title={sidebarCollapsed ? item.name : "Configurado por el equipo de implementación"}>
                        <div className={`flex items-center justify-center rounded-xl bg-gradient-to-br ${item.color} ${sidebarCollapsed ? 'w-10 h-10' : 'w-8 h-8'}`}>
                          <item.icon className={`${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
                        </div>
                        {!sidebarCollapsed && <span className="flex-1">{item.name}</span>}
                        {!sidebarCollapsed && <Lock className="w-3.5 h-3.5 text-amber-400/70" />}
                      </div>
                    );
                  }
                  return (
                    <Link key={item.name} href={item.href} onClick={() => setSidebarOpen(false)} className={`nav-item ${isActive ? 'active' : ''} ${sidebarCollapsed ? 'justify-center px-0' : ''}`} title={sidebarCollapsed ? item.name : ''}>
                      <div className={`flex items-center justify-center rounded-xl bg-gradient-to-br ${isActive ? item.color : 'from-white/5 to-white/[0.02] text-[var(--text-muted)]'} ${sidebarCollapsed ? 'w-10 h-10' : 'w-8 h-8'} transition-all group-hover:scale-105`}>
                        <item.icon className={`${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
                      </div>
                      {!sidebarCollapsed && <span className="flex-1">{item.name}</span>}
                      {!sidebarCollapsed && isActive && <ChevronRight className="w-4 h-4 text-[var(--accent-primary)]" />}
                    </Link>
                  );
                })}
              </nav>

              {/* User */}
              <div className={`${sidebarCollapsed ? 'px-2 py-3' : 'p-4'} border-t border-[var(--border-primary)]`}>
                {sidebarCollapsed ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="avatar w-10 h-10 text-sm font-bold">{user?.name?.[0] || 'U'}</div>
                    <button onClick={handleLogout} className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-600/5 text-red-400 hover:from-red-500/25 hover:to-red-600/15 transition-all" title="Cerrar sesión">
                      <LogOut className="w-4.5 h-4.5" />
                    </button>
                  </div>
                ) : (
                  <>
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
                      <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-red-500/15 to-red-600/5 text-red-400">
                        <LogOut className="w-4 h-4" />
                      </div>
                      <span className="font-medium">Cerrar Sesión</span>
                    </button>
                  </>
                )}
              </div>

              {/* Soporte WhatsApp para addon de implementación */}
              {hasImplementation && !sidebarCollapsed && (
                <div className="px-4 pb-2">
                  <a href="https://wa.me/573118083993?text=Hola%2C%20necesito%20soporte%20con%20mi%20implementación" target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/15 border border-green-500/25 hover:bg-green-500/25 transition-all cursor-pointer">
                    <Phone className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-green-400 font-semibold">Soporte Prioritario</span>
                  </a>
                </div>
              )}

              {!sidebarCollapsed && (
                <div className="px-4 pb-2">
                  <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20">
                    <img src="/bizonne.png" alt="Bizonne" className="w-5 h-5 rounded" />
                    <span className="text-xs text-[var(--accent-primary)] font-medium">Powered by Bizonne</span>
                  </div>
                </div>
              )}

              {/* 📌 Toggle collapse button */}
              <div className={`${sidebarCollapsed ? 'px-2' : 'px-4'} pb-4`}>
                <button 
                  onClick={() => {
                    const next = !sidebarCollapsed;
                    setSidebarCollapsed(next);
                    try { localStorage.setItem('bizonne_sidebar_collapsed', String(next)); } catch {}
                  }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all ${
                    sidebarCollapsed 
                      ? 'bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/25 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25' 
                      : 'bg-white/5 hover:bg-white/10 border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-white'
                  }`}
                  title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="w-5 h-5" />
                  ) : (
                    <>
                      <Menu className="w-4 h-4" />
                      <span className="text-xs font-medium">Ocultar menú</span>
                    </>
                  )}
                </button>
              </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
              <header className="sticky top-0 z-30 h-14 md:h-16 px-3 md:px-6 flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
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
                    <input 
                      type="text" 
                      placeholder="Buscar conversaciones, clientes, productos..." 
                      value={globalSearch}
                      onChange={(e) => handleGlobalSearch(e.target.value)}
                      onFocus={() => globalResults.length > 0 && setGlobalSearchOpen(true)}
                      className="input pl-11 py-2.5 bg-white/5 border-transparent text-sm w-full" 
                    />
                    {searchLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--accent-primary)]/30 border-t-[var(--accent-primary)] rounded-full animate-spin" />
                    )}
                    {/* Search Results Dropdown */}
                    {globalSearchOpen && globalResults.length > 0 && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setGlobalSearchOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl overflow-hidden animate-fade-in max-h-80 overflow-y-auto">
                          <div className="p-2 border-b border-[var(--border-primary)]">
                            <p className="px-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{globalResults.length} resultados</p>
                          </div>
                          {globalResults.map((r, i) => (
                            <a key={i} href={r.href} onClick={() => { setGlobalSearchOpen(false); setGlobalSearch(''); }}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all border-b border-[var(--border-primary)]/50 last:border-0">
                              <span className="text-lg">{r.icon}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">{r.name}</p>
                                <p className="text-[10px] text-[var(--text-muted)] truncate">{r.sub}</p>
                              </div>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                                r.type === 'conversation' ? 'bg-emerald-500/20 text-emerald-400' : r.type === 'client' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-purple-500/20 text-purple-400'
                              }`}>{r.type === 'conversation' ? 'Chat' : r.type === 'client' ? 'Cliente' : 'Producto'}</span>
                            </a>
                          ))}
                        </div>
                      </>
                    )}
                    {globalSearchOpen && globalSearch.length >= 2 && globalResults.length === 0 && !searchLoading && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setGlobalSearchOpen(false)} />
                        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl p-6 text-center">
                          <p className="text-sm text-[var(--text-muted)]">Sin resultados para "{globalSearch}"</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {user?.isSubUser && <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full hidden md:inline">{roleLabel}</span>}
                  <button 
                    onClick={() => setShowWallpaper(true)} 
                    className="p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5 hidden md:block"
                    title="Cambiar fondo"
                  >
                    <Paintbrush className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setShowInstall(true)} 
                    className="p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5"
                    title="Instalar App"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button className="relative p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5">
                    <Bell className="w-5 h-5" />
                    <NotificationBellBadge />
                  </button>
                  <div className="lg:hidden flex items-center gap-2">
                    <img src="/bizonne.png" alt="Bizonne" className="w-9 h-9 rounded-lg" />
                  </div>
                </div>
              </header>
              <div className="flex-1 p-3 md:p-6 lg:p-8 overflow-y-auto overflow-x-hidden">
                {/* 🔑 BANNER DE ERROR API KEY */}
                {apiKeyError && pathname !== '/configuracion' && (
                  <div className="mb-6 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                          <Key className="w-4 h-4" />
                          {apiKeyError.type === 'invalid_key' ? '⚠️ API Key de OpenAI inválida' : 
                           apiKeyError.type === 'no_credits' ? '💰 Sin créditos en OpenAI' : 
                           apiKeyError.type === 'not_connected' ? '🔑 API Key no conectada' : 
                           '⚠️ Error con OpenAI'}
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {apiKeyError.type === 'invalid_key' 
                            ? 'Tu API Key es incorrecta o fue revocada. Tu asistente IA NO puede responder mensajes de WhatsApp.' 
                            : apiKeyError.type === 'no_credits'
                            ? 'Tu cuenta de OpenAI no tiene créditos. Recarga desde $3 USD para que tu asistente siga funcionando.'
                            : 'Conecta tu API Key de OpenAI para que el asistente IA pueda responder automáticamente.'}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <a 
                            href="/configuracion" 
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-medium hover:bg-amber-500/30 transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            {apiKeyError.type === 'not_connected' ? 'Conectar API Key' : 'Actualizar API Key'}
                          </a>
                          <a 
                            href="https://auth.openai.com/log-in" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)] text-xs font-medium hover:bg-white/10 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Ir a OpenAI
                          </a>
                          <button 
                            onClick={() => setShowApiKeyGuide(!showApiKeyGuide)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)] text-xs font-medium hover:bg-white/10 transition-colors"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                            {showApiKeyGuide ? 'Ocultar guía' : 'Ver paso a paso'}
                          </button>
                        </div>
                        
                        {/* GUÍA PASO A PASO */}
                        {showApiKeyGuide && (
                          <div className="mt-4 p-4 rounded-lg bg-black/30 border border-white/5 space-y-3">
                            <h4 className="text-xs font-semibold text-white">📋 Cómo recargar OpenAI (5 minutos)</h4>
                            
                            <div className="space-y-2.5">
                              <div className="flex gap-2.5">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">1</span>
                                <div>
                                  <p className="text-xs text-white">Ingresa a <a href="https://auth.openai.com/log-in" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">auth.openai.com/log-in</a></p>
                                  <p className="text-[10px] text-[var(--text-muted)]">Inicia sesión con tu cuenta de OpenAI (o crea una gratis)</p>
                                </div>
                              </div>
                              
                              <div className="flex gap-2.5">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">2</span>
                                <div>
                                  <p className="text-xs text-white">Ve a <strong>Settings → Billing → Add payment method</strong></p>
                                  <p className="text-[10px] text-[var(--text-muted)]">Agrega tu tarjeta de crédito o débito</p>
                                </div>
                              </div>
                              
                              <div className="flex gap-2.5">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">3</span>
                                <div>
                                  <p className="text-xs text-white">Recarga créditos: <strong>desde $5 USD</strong></p>
                                  <p className="text-[10px] text-[var(--text-muted)]">💡 Con $5 USD puedes atender aproximadamente <strong>+5,000 mensajes</strong>. El gasto es mínimo.</p>
                                </div>
                              </div>
                              
                              <div className="flex gap-2.5">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">4</span>
                                <div>
                                  <p className="text-xs text-white">Copia tu API Key desde <strong>API Keys → Create new secret key</strong></p>
                                  <p className="text-[10px] text-[var(--text-muted)]">Ve a <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">platform.openai.com/api-keys</a></p>
                                </div>
                              </div>
                              
                              <div className="flex gap-2.5">
                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center">5</span>
                                <div>
                                  <p className="text-xs text-white">Pega tu API Key en <a href="/configuracion" className="text-cyan-400 underline">Configuración</a> de Bizonne</p>
                                  <p className="text-[10px] text-[var(--text-muted)]">¡Listo! Tu asistente IA empezará a responder automáticamente 🚀</p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                              <p className="text-[10px] text-emerald-400">
                                💰 <strong>¿Cuánto cuesta?</strong> El modelo GPT-4o-mini que usamos es extremadamente económico. 
                                Con $5 USD puedes atender miles de conversaciones. La mayoría de negocios gastan menos de $3 USD al mes.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Botón cerrar */}
                      <button 
                        onClick={() => {
                          setApiKeyError(null);
                          // Limpiar error en backend
                          const token = localStorage.getItem('token');
                          fetch(`${API_URL}/api/whatsapp/api-key-error/clear`, { 
                            method: 'PUT', 
                            headers: { 'Authorization': `Bearer ${token}` } 
                          }).catch(() => {});
                        }}
                        className="flex-shrink-0 p-1 text-[var(--text-muted)] hover:text-white rounded-lg hover:bg-white/5"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="animate-fade-in">{children}</div>
              </div>

              {/* 🔒 PAYWALL — Bloquear acceso cuando suscripción expiró */}
              {user?.isBlocked && pathname !== '/subscription' && (
                <Paywall plan={user.plan || 'trial'} />
              )}
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

                  {/* 🚀 BANNER IMPLEMENTACIÓN */}
                  <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center flex-shrink-0 border border-amber-500/20">
                        <Sparkles className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-white mb-0.5">¿No tienes tiempo para configurar?</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed mb-2.5">
                          Nuestro equipo lo hace por ti. Configuramos todo tu asistente IA, 
                          embudo de ventas y multimedia. Agenda una <strong className="text-amber-300">videollamada gratis</strong> para conocer el servicio.
                        </p>
                        <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('¡Hola! Acabo de registrarme en Bizonne y me interesa el servicio de implementación. Quiero agendar una videollamada 🚀')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-lg text-xs hover:brightness-110 transition-all hover:scale-[1.02]">
                          <Phone className="w-3.5 h-3.5" /> Agendar Videollamada
                        </a>
                      </div>
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

        {/* ===== WALLPAPER PICKER ===== */}
        <WallpaperPicker isOpen={showWallpaper} onClose={() => setShowWallpaper(false)} />
        <InstallApp isOpen={showInstall} onClose={() => setShowInstall(false)} />

        {/* ===== LIVE CHAT SUPPORT ===== */}
        {user && !isAuthPage && (
          <LiveChat user={user} />
        )}
        </NotificationProvider>
      </body>
    </html>
  );
}
