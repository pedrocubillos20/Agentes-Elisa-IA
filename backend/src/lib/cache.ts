/**
 * ⚡ UNIFIED CACHE MODULE — BizonneCRM
 * 
 * ANTES: 16 Maps dispersos sin límite en 12 archivos
 *   - 9 copias de ownerIdCache (una por ruta)
 *   - subscriptionCache, lidPhoneCache, numberExistsCache, apiKeyErrors...
 *   - Sin límite de tamaño → memory leaks → Railway mata el proceso
 * 
 * AHORA: Un solo módulo con LRU (Least Recently Used)
 *   - Límite máximo de entries por cache
 *   - Limpieza automática de entries expirados
 *   - Estadísticas de hit/miss para debugging
 *   - Una sola fuente de verdad
 */

class LRUCache<T> {
  private cache = new Map<string, { value: T; ts: number }>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 500, ttlMs: number = 300_000) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() - entry.ts > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete first to update position
    this.cache.delete(key);
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, ts: Date.now() });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.ts > this.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  get size(): number { return this.cache.size; }

  clear(): void { this.cache.clear(); }

  // Stats for debugging
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 
        ? Math.round((this.hits / (this.hits + this.misses)) * 100) 
        : 0
    };
  }

  // Cleanup expired entries
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.ts > this.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// ===== CACHE INSTANCES (single source of truth) =====

// Owner resolution: userId → ownerId (5 min TTL, max 500 users)
export const ownerIdCache = new LRUCache<string>(500, 300_000);

// Subscription check cache (60s TTL, max 500)
export const subscriptionCache = new LRUCache<any>(500, 60_000);

// LID → phone resolution (24hr TTL, max 2000)
export const lidPhoneCache = new LRUCache<string>(2000, 86_400_000);

// WhatsApp number exists check (5 min TTL, max 1000)
export const numberExistsCache = new LRUCache<boolean>(1000, 300_000);

// OpenAI API key errors (10 min TTL, max 100)
export const apiKeyErrorCache = new LRUCache<{ type: string; message: string }>(100, 600_000);

// WhatsApp Message ID → content (24hr TTL, max 1000 mensajes)
// Permite lookup exacto de quoted messages sin necesitar columna en DB
export const wamidCache = new LRUCache<string>(1000, 86_400_000);

// ⚡ EGRESS: API keys del usuario (60s TTL, max 1000)
// El webhook hace prisma.user.findUnique({ select: { apiKey, groqApiKey } })
// en CADA mensaje entrante (decenas/seg). La key casi nunca cambia →
// cachearla 60s elimina ~95% de esas queries. Se invalida al actualizarla.
export const userApiKeyCache = new LRUCache<{ apiKey: string | null; groqApiKey: string | null }>(1000, 60_000);

// ⚡ EGRESS: Respuesta completa del dashboard (60s TTL, max 300)
// El dashboard dispara ~26 queries (counts + raw SQL) por carga. Cachear la
// respuesta 60s evita recomputar en refresh/múltiples pestañas/navegación.
// Key: `${ownerId}|${lineId}|${period}|${dateFrom}|${dateTo}`
export const dashboardCache = new LRUCache<any>(300, 60_000);

// ===== DEDUP SETS with auto-cleanup =====
class TimedSet {
  private set = new Map<string, number>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(ttlMs: number = 30_000, maxSize: number = 5000) {
    this.ttl = ttlMs;
    this.maxSize = maxSize;
  }

  add(key: string): void {
    if (this.set.size >= this.maxSize) {
      // Remove oldest 20%
      const toRemove = Math.floor(this.maxSize * 0.2);
      let removed = 0;
      for (const k of this.set.keys()) {
        if (removed >= toRemove) break;
        this.set.delete(k);
        removed++;
      }
    }
    this.set.set(key, Date.now());
  }

  has(key: string): boolean {
    const ts = this.set.get(key);
    if (!ts) return false;
    if (Date.now() - ts > this.ttl) {
      this.set.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.set.delete(key);
  }

  get size(): number { return this.set.size; }

  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, ts] of this.set) {
      if (now - ts > this.ttl) {
        this.set.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Dedup sets for webhook processing
export const recentlyProcessed = new TimedSet(60_000, 5000);       // 60s TTL
export const recentlySentFromPlatform = new TimedSet(30_000, 5000); // 30s TTL
export const processingLock = new TimedSet(120_000, 1000);          // 2 min TTL (auto-unlock)

// ===== GLOBAL CLEANUP (every 5 minutes) =====
setInterval(() => {
  let total = 0;
  total += ownerIdCache.cleanup();
  total += subscriptionCache.cleanup();
  total += lidPhoneCache.cleanup();
  total += numberExistsCache.cleanup();
  total += apiKeyErrorCache.cleanup();
  total += wamidCache.cleanup();
  total += userApiKeyCache.cleanup();
  total += dashboardCache.cleanup();
  total += recentlyProcessed.cleanup();
  total += recentlySentFromPlatform.cleanup();
  total += processingLock.cleanup();
  
  if (total > 0 && process.env.NODE_ENV !== 'production') {
    console.log(`🧹 Cache cleanup: ${total} expired entries removed`);
  }
}, 300_000);

// ===== STATS ENDPOINT DATA =====
export const getCacheStats = () => ({
  ownerIdCache: ownerIdCache.stats(),
  subscriptionCache: subscriptionCache.stats(),
  lidPhoneCache: lidPhoneCache.stats(),
  numberExistsCache: numberExistsCache.stats(),
  apiKeyErrorCache: apiKeyErrorCache.stats(),
  wamidCache: wamidCache.stats(),
  userApiKeyCache: userApiKeyCache.stats(),
  dashboardCache: dashboardCache.stats(),
  recentlyProcessed: recentlyProcessed.size,
  recentlySentFromPlatform: recentlySentFromPlatform.size,
  processingLock: processingLock.size,
});

export { LRUCache, TimedSet };
