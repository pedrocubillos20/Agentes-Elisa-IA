'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6">
      <img src="/bizonne.png" alt="Bizonne CRM" className="w-24 h-24 rounded-3xl animate-pulse shadow-lg" />
      <h1 className="text-3xl font-bold text-white">
        Bizonne<span className="text-[var(--accent-primary)] font-light">CRM</span>
      </h1>
      <div className="loading-spinner" />
    </div>
  );
}
