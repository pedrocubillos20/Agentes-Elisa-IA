'use client';

import './globals.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, MessageSquare, Settings, Bot, LogOut, Menu, X,
  Smartphone, Users, Calendar, Bell, Search, ChevronRight, Shield,
  Volume2, VolumeX
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Notification {
  id: string;
  type: 'new_message' | 'new_conversation' | 'ai_paused' | 'new_client';
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  conversationId?: string;
  senderName?: string;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notification state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastConvCount, setLastConvCount] = useState<number>(0);
  const [lastMsgIds, setLastMsgIds] = useState<Set<string>>(new Set());
  const notifRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isFirstLoad = useRef(true);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  // Initialize notification sound
  useEffect(() => {
    if (typeof window !== 'undefined') {
      audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczPliR0telezhTgLXk5JhcNTxhhs/W3cBzS0Beg6u/z9DOwrqtnH5fRz9TaX+OmaCmoqGbjHhkUUZBQUhSYHCBk6KssLCqn5KEdGhdUktJTlhkdIaVpK60tK6kl4l7bWBVTktPWGV2iJqqtry6sq2jloh6bF5TTE1TWmh6i52ru8HBurOsnpCCc2RXUExOVl9th5qrucPFwbm0q56Ug3VlWFBMT1dib4mcrLvDxcK7ta2hk4Z3aFtTTlBYY3GMn6+9xcfDvbawpJeJe21gV1JRWGRyjqGwvsXHxMC6tKmcj4F0Z11YV1xmeJKkssDBwcC+u7arnpGEd2xkX11haoGVprS+wcLCwb+7sq2gl4uAd3FtbnJ9j6GyvcHBwMC/u7WuopqRiYN/foCGkJ2rv8PCwcC+urWwqqOckpCMi42QmKW0v8PDw8LBvrmzraeinpqXlZWXnKSuuMHDw8LCwLy3sq2opqOhoKCjqK61vcPExMPBwLy4s66rqainpqaoq6+1u8HExMPCwL23s66rqKempaWnqq+1u8HExMPCwL24tK+sqainpqaoqq+0usDDxMTDwb65tK+sqKempaWmqa60u8HExMPCwb+6trKurKmpqKipq6+0usDDxMPDwb+7t7Kvrauqqqmqq66zuL7CxMTDwr+7t7OxsK6trKuqrK6zuL7CxMTDwr+7t7OxsK6trKyrrK6yt7zBxMTDwr+8uLSxr66trKyrrK6yt7zBxMTDwr+8uLW0');
    }
  }, []);

  const playNotifSound = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [soundEnabled]);

  const sendBrowserNotif = useCallback((title: string, body: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/elisa.png' });
    }
  }, []);

  // Request notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ===== POLL FOR NEW MESSAGES =====
  useEffect(() => {
    if (!user || isAuthPage) return;

    const pollNotifications = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const res = await fetch(`${API_URL}/api/conversations`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const convs = data.conversations || [];

        // Skip first load
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          setLastConvCount(convs.length);
          const ids = new Set<string>();
          convs.forEach((c: any) => {
            ids.add(`${c.id}-${c.lastMessage}-${c.updatedAt}`);
          });
          setLastMsgIds(ids);
          return;
        }

        // New conversations
        if (convs.length > lastConvCount && lastConvCount > 0) {
          const diff = convs.length - lastConvCount;
          for (let i = 0; i < Math.min(diff, 5); i++) {
            const c = convs[i];
            const notif: Notification = {
              id: `conv-${c.id}-${Date.now()}-${i}`,
              type: 'new_conversation',
              title: '💬 Nueva conversación',
              body: `${c.recipientName || c.recipientId} te ha escrito`,
              timestamp: new Date(),
              read: false,
              conversationId: c.id,
              senderName: c.recipientName || c.recipientId,
            };
            setNotifications(prev => [notif, ...prev].slice(0, 50));
            playNotifSound();
            sendBrowserNotif(notif.title, notif.body);
          }
        }
        setLastConvCount(convs.length);

        // New messages in existing conversations
        const newIds = new Set<string>();
        convs.forEach((c: any) => {
          const key = `${c.id}-${c.lastMessage}-${c.updatedAt}`;
          newIds.add(key);

          if (!lastMsgIds.has(key) && c.lastMessage && lastMsgIds.size > 0) {
            const notif: Notification = {
              id: `msg-${c.id}-${Date.now()}`,
              type: 'new_message',
              title: c.recipientName || c.recipientId,
              body: c.lastMessage?.substring(0, 80) || 'Nuevo mensaje',
              timestamp: new Date(),
              read: false,
              conversationId: c.id,
              senderName: c.recipientName || c.recipientId,
            };
            setNotifications(prev => {
              if (prev.some(n => n.conversationId === c.id && n.body === notif.body)) return prev;
              return [notif, ...prev].slice(0, 50);
            });
            playNotifSound();
            sendBrowserNotif(notif.title, notif.body);
          }
        });
        setLastMsgIds(newIds);
      } catch (err) {
        console.error('Notification poll error:', err);
      }
    };

    pollNotifications();
    const interval = setInterval(pollNotifications, 8000);
    return () => clearInterval(interval);
  }, [user, isAuthPage, lastConvCount, lastMsgIds, playNotifSound, sendBrowserNotif]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleNotifClick = (notif: Notification) => {
    markAsRead(notif.id);
    setShowNotifications(false);
    if (notif.conversationId) {
      router.push('/conversaciones');
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'ahora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'new_message': return '💬';
      case 'new_conversation': return '🆕';
      case 'ai_paused': return '⏸️';
      case 'new_client': return '👤';
      default: return '🔔';
    }
  };

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
    { name: 'Equipo', href: '/equipo', icon: Shield, perm: 'team', badge: 'Nuevo' },
    { name: 'Configuración', href: '/configuracion', icon: Settings, perm: 'config' },
  ];

  const navigation = allNavigation.filter(item => hasPerm(item.perm));

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

              {/* Search bar - FIXED icon overlap */}
              <div className="hidden md:flex flex-1 max-w-md mx-4">
                <div className="relative w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none z-10" />
                  <input type="text" placeholder="Buscar..." className="input py-3 bg-white/5 border-transparent" style={{paddingLeft: '2.75rem'}} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                {user?.isSubUser && (
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full hidden md:inline">
                    {roleLabel}
                  </span>
                )}

                {/* ===== NOTIFICATION BELL WITH DROPDOWN ===== */}
                <div ref={notifRef} className="relative">
                  <button 
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative p-2.5 text-[var(--text-muted)] hover:text-white rounded-xl hover:bg-white/5 transition-all"
                  >
                    <Bell className={`w-5 h-5 ${unreadCount > 0 ? 'text-white' : ''}`} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 flex items-center justify-center px-1 bg-red-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifications && (
                    <div className="absolute right-0 top-full mt-2 w-96 max-h-[500px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl overflow-hidden z-50"
                      style={{boxShadow: '0 25px 60px rgba(0,0,0,0.5)'}}>
                      
                      {/* Header */}
                      <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-white text-base">Notificaciones</h3>
                          {unreadCount > 0 && (
                            <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setSoundEnabled(!soundEnabled)}
                            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-muted)] hover:text-white transition-all"
                            title={soundEnabled ? 'Silenciar' : 'Activar sonido'}
                          >
                            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                          </button>
                          {unreadCount > 0 && (
                            <button onClick={markAllRead}
                              className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] font-medium">
                              Marcar leídas
                            </button>
                          )}
                          {notifications.length > 0 && (
                            <button onClick={clearNotifications}
                              className="text-xs text-[var(--text-muted)] hover:text-red-400 font-medium">
                              Limpiar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* List */}
                      <div className="overflow-y-auto max-h-[400px]">
                        {notifications.length === 0 ? (
                          <div className="py-12 text-center">
                            <Bell className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
                            <p className="text-[var(--text-muted)] text-sm">Sin notificaciones</p>
                            <p className="text-xs mt-1" style={{color: 'var(--text-muted)', opacity: 0.5}}>Las nuevas aparecerán aquí</p>
                          </div>
                        ) : (
                          notifications.map((notif) => (
                            <div
                              key={notif.id}
                              onClick={() => handleNotifClick(notif)}
                              className={`px-5 py-3.5 border-b border-[var(--border-primary)] cursor-pointer transition-all hover:bg-white/5 flex items-start gap-3 ${
                                !notif.read ? 'bg-[var(--accent-primary)]/5' : ''
                              }`}
                            >
                              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center text-lg">
                                {getNotifIcon(notif.type)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`text-sm font-semibold truncate ${!notif.read ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                                    {notif.title}
                                  </p>
                                  {!notif.read && (
                                    <span className="flex-shrink-0 w-2 h-2 bg-[var(--accent-primary)] rounded-full" />
                                  )}
                                </div>
                                <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{notif.body}</p>
                              </div>
                              <span className="flex-shrink-0 text-[10px] mt-0.5" style={{color: 'var(--text-muted)', opacity: 0.6}}>
                                {getTimeAgo(notif.timestamp)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      {notifications.length > 0 && (
                        <div className="px-5 py-3 border-t border-[var(--border-primary)]" style={{background: 'rgba(10,10,15,0.5)'}}>
                          <button 
                            onClick={() => { setShowNotifications(false); router.push('/conversaciones'); }}
                            className="w-full text-center text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] font-medium">
                            Ver todas las conversaciones →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
