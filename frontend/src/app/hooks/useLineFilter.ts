// useLineFilter.ts — Hook for workspace-aware API calls
// Import in any page: import { useLineFilter } from '../hooks/useLineFilter';

import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export function useLineFilter() {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<any>(null);

  // Read from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('selectedLineId');
    if (saved) setSelectedLineId(saved);

    // Listen for line changes from layout
    const handler = (e: any) => {
      setSelectedLineId(e.detail.lineId);
      setSelectedLine(e.detail.line);
    };
    window.addEventListener('lineChanged', handler);
    return () => window.removeEventListener('lineChanged', handler);
  }, []);

  // Build URL with lineId param
  const buildUrl = useCallback((path: string, params?: Record<string, string>) => {
    const url = new URL(`${API_URL}${path}`);
    if (selectedLineId) url.searchParams.set('lineId', selectedLineId);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) url.searchParams.set(k, v);
      });
    }
    return url.toString();
  }, [selectedLineId]);

  // Fetch with auth + lineId
  const fetchWithLine = useCallback(async (path: string, options?: RequestInit & { params?: Record<string, string> }) => {
    const token = localStorage.getItem('token');
    const url = buildUrl(path, options?.params);
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      }
    });
    return res;
  }, [buildUrl]);

  // POST/PUT with lineId in body
  const postWithLine = useCallback(async (path: string, body: any, method = 'POST') => {
    const token = localStorage.getItem('token');
    const url = `${API_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, lineId: selectedLineId })
    });
    return res;
  }, [selectedLineId]);

  return {
    selectedLineId,
    selectedLine,
    buildUrl,
    fetchWithLine,
    postWithLine,
    API_URL
  };
}

export default useLineFilter;
