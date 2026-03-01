// ============================================
// PARCHE PARA layout.tsx - Agregar "Llamadas IA"
// ============================================

// PASO 1: Agregar import de ícono Phone
// En la línea de imports de lucide-react, agregar "Phone":
// import { ..., Phone, ... } from 'lucide-react';

// PASO 2: Agregar item en allNavigation
// Buscar el array allNavigation y agregar después de "Asistentes IA":

{ name: 'Llamadas IA', href: '/llamadas', icon: Phone, perm: 'assistants', featureKey: 'assistants', color: 'from-violet-500/20 to-violet-600/10 text-violet-400' },

// Ejemplo de cómo queda:
/*
  const allNavigation = [
    { name: 'Dashboard', href: '/dashboard', ... },
    { name: 'Conversaciones', href: '/conversaciones', ... },
    { name: 'WhatsApp', href: '/whatsapp', ... },
    { name: 'Asistentes IA', href: '/asistentes', ... },
    { name: 'Llamadas IA', href: '/llamadas', icon: Phone, perm: 'assistants', featureKey: 'assistants', color: 'from-violet-500/20 to-violet-600/10 text-violet-400' },  // ← NUEVO
    { name: 'CRM', href: '/crm', ... },
    ...
  ];
*/
