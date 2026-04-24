/**
 * 🤖 AI PROVIDER — Módulo unificado OpenAI + Groq
 * 
 * Groq usa exactamente el mismo formato de API que OpenAI.
 * La única diferencia es la URL base y el API key.
 * 
 * Ventajas de Groq:
 * - 10-20x más rápido que OpenAI (LPU hardware)
 * - Más económico
 * - Modelos: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768
 * 
 * Uso:
 *   import { callAI, AI_MODELS } from '../lib/ai';
 *   const reply = await callAI({ provider: 'groq', apiKey, model, messages });
 */

import logger from './logger';

// ===== MODELOS DISPONIBLES =====
export const AI_MODELS = {
  openai: [
    { id: 'gpt-4o-mini',          name: 'GPT-4o Mini',          desc: 'Rápido y económico — recomendado',  speed: 'fast',   cost: '$' },
    { id: 'gpt-4o',               name: 'GPT-4o',               desc: 'El más inteligente de OpenAI',       speed: 'medium', cost: '$$$' },
    { id: 'gpt-4-turbo-preview',  name: 'GPT-4 Turbo',          desc: 'Potente y versátil',                 speed: 'medium', cost: '$$' },
    { id: 'gpt-3.5-turbo',        name: 'GPT-3.5 Turbo',        desc: 'Económico, bueno para ventas',       speed: 'fast',   cost: '$' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B',     desc: 'Ultra rápido — mejor para ventas',  speed: 'ultra',  cost: '$' },
    { id: 'llama-3.1-8b-instant',    name: 'Llama 3.1 8B',      desc: 'El más rápido — ideal para soporte',speed: 'ultra',  cost: '$' },
    { id: 'mixtral-8x7b-32768',      name: 'Mixtral 8x7B',      desc: 'Excelente en español',               speed: 'fast',   cost: '$' },
    { id: 'gemma2-9b-it',            name: 'Gemma 2 9B',        desc: 'Preciso y eficiente',                speed: 'fast',   cost: '$' },
    { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B',     desc: 'Gran capacidad de razonamiento',    speed: 'fast',   cost: '$' },
  ],
};

// Modelos por defecto por proveedor
export const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  groq:   'llama-3.3-70b-versatile',
};

// URLs base
const API_URLS = {
  openai: 'https://api.openai.com/v1',
  groq:   'https://api.groq.com/openai/v1',
};

export type AIProvider = 'openai' | 'groq';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallAIOptions {
  provider:    AIProvider;
  apiKey:      string;
  model:       string;
  messages:    AIMessage[];
  temperature?: number;
  maxTokens?:  number;
  timeoutMs?:  number;
}

export interface CallAIResult {
  content:  string;
  provider: AIProvider;
  model:    string;
  tokens?:  { prompt: number; completion: number; total: number };
}

/**
 * Llama a OpenAI o Groq según el proveedor configurado.
 * Mismo formato para ambos — solo cambia URL y key.
 */
export const callAI = async (opts: CallAIOptions): Promise<CallAIResult> => {
  const {
    provider,
    apiKey,
    model,
    messages,
    temperature = 0.7,
    maxTokens   = 1000,
    timeoutMs   = 35000,
  } = opts;

  const baseUrl = API_URLS[provider];
  if (!baseUrl) throw new Error(`Proveedor desconocido: ${provider}`);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    logger.debug(`callAI → ${provider}/${model} (${messages.length} msgs)`);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      logger.warn(`callAI error ${provider}`, { status: res.status, error: err.slice(0, 200) });

      // Clasificar el error para el cache de errores del sistema
      if (res.status === 401) throw Object.assign(new Error('API Key inválida'), { code: 'invalid_key', status: 401 });
      if (res.status === 429) throw Object.assign(new Error('Límite de velocidad o créditos agotados'), { code: 'rate_limit', status: 429 });
      if (res.status === 402) throw Object.assign(new Error('Sin créditos en la cuenta'), { code: 'no_credits', status: 402 });
      throw new Error(`${provider} error ${res.status}: ${err.slice(0, 100)}`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) throw new Error(`${provider} no retornó contenido`);

    return {
      content,
      provider,
      model,
      tokens: data.usage
        ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
        : undefined,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw Object.assign(new Error(`${provider} timeout después de ${timeoutMs}ms`), { code: 'timeout' });
    throw err;
  }
};

/**
 * Valida que una API key sea válida haciendo una llamada de prueba mínima.
 * Funciona para OpenAI y Groq.
 */
export const validateApiKey = async (provider: AIProvider, apiKey: string): Promise<{ valid: boolean; message: string }> => {
  try {
    const baseUrl = API_URLS[provider];
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);

    // Para validar, listamos los modelos disponibles (endpoint ligero)
    const res = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });

    if (res.status === 200) return { valid: true, message: `API Key de ${provider} válida ✓` };
    if (res.status === 401) return { valid: false, message: 'API Key inválida — verifica que sea correcta' };
    if (res.status === 429) return { valid: true,  message: 'Válida (límite de velocidad activo)' };

    return { valid: false, message: `Error al validar: HTTP ${res.status}` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { valid: false, message: 'Timeout al validar la clave' };
    return { valid: false, message: `Error de conexión: ${err.message}` };
  }
};

/**
 * Retorna el proveedor y key correctos para un usuario/asistente.
 * Prioriza la configuración del asistente sobre el usuario.
 */
export const resolveAIConfig = (opts: {
  assistantProvider?: string;
  assistantModel?:    string;
  userOpenAiKey?:     string | null;
  userGroqKey?:       string | null;
}): { provider: AIProvider; apiKey: string; model: string } | null => {
  const provider = (opts.assistantProvider || 'openai') as AIProvider;
  const model    = opts.assistantModel || DEFAULT_MODELS[provider];

  if (provider === 'groq') {
    if (!opts.userGroqKey) return null;
    return { provider: 'groq', apiKey: opts.userGroqKey, model };
  }

  // Default: openai
  if (!opts.userOpenAiKey) return null;
  return { provider: 'openai', apiKey: opts.userOpenAiKey, model };
};
