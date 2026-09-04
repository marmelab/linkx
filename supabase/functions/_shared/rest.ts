/**
 * Accès PostgREST des fonctions d'ordonnancement, avec la clé de service.
 *
 * Transport et rien d'autre : ce module ne décide de rien, il construit des
 * requêtes et rend des lignes. Le `fetch` est injecté, comme dans `botClient.ts`,
 * pour que les fonctions edge restent essayables sans base.
 *
 * Le code d'erreur SQL est conservé tel quel : c'est lui qui distingue « une
 * autre invocation a déjà ouvert la vague » (`23505`) d'une vraie panne.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type RestConfig = {
  /** Racine du projet, sans barre finale : `https://xxx.supabase.co`. */
  url: string
  serviceKey: string
  fetch?: FetchLike
}

export class RestError extends Error {
  readonly status: number
  /** `SQLSTATE` rendu par PostgREST, quand il en donne un. */
  readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'RestError'
    this.status = status
    this.code = code
  }
}

export const UNIQUE_VIOLATION = '23505'

export type InsertOptions = {
  /** Colonnes rendues ; sans elle, l'insertion ne rend rien. */
  returning?: string
  /** Colonne de conflit, à donner avec `ignoreDuplicates`. */
  onConflict?: string
  ignoreDuplicates?: boolean
}

export type Rest = {
  select<T>(path: string): Promise<T[]>
  insert<T>(table: string, rows: readonly unknown[], options?: InsertOptions): Promise<T[]>
  update<T>(table: string, filter: string, patch: object, returning?: string): Promise<T[]>
  rpc<T>(name: string, args?: object): Promise<T>
}

export function createRest(config: RestConfig): Rest {
  const call = config.fetch ?? fetch
  const base = `${config.url.replace(/\/+$/, '')}/rest/v1`
  const headers = {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    'content-type': 'application/json',
  }

  async function request(path: string, init: RequestInit): Promise<unknown> {
    const response = await call(`${base}/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    })
    const text = await response.text()
    if (!response.ok) {
      const parsed = (() => {
        try {
          return JSON.parse(text) as { code?: unknown; message?: unknown }
        } catch {
          return null
        }
      })()
      throw new RestError(
        typeof parsed?.message === 'string' ? parsed.message : text.slice(0, 200),
        response.status,
        typeof parsed?.code === 'string' ? parsed.code : null,
      )
    }
    return text === '' ? null : JSON.parse(text)
  }

  return {
    async select<T>(path: string): Promise<T[]> {
      return ((await request(path, { method: 'GET' })) ?? []) as T[]
    },

    async insert<T>(
      table: string,
      rows: readonly unknown[],
      options: InsertOptions = {},
    ): Promise<T[]> {
      if (rows.length === 0) return []
      const prefer = [
        options.returning ? 'return=representation' : 'return=minimal',
        ...(options.ignoreDuplicates ? ['resolution=ignore-duplicates'] : []),
      ].join(',')
      const query = [
        options.returning ? `select=${options.returning}` : '',
        options.onConflict ? `on_conflict=${options.onConflict}` : '',
      ].filter((part) => part !== '').join('&')
      const path = query === '' ? table : `${table}?${query}`
      const body = await request(path, {
        method: 'POST',
        headers: { prefer },
        body: JSON.stringify(rows),
      })
      return (body ?? []) as T[]
    },

    async update<T>(
      table: string,
      filter: string,
      patch: object,
      returning?: string,
    ): Promise<T[]> {
      const query = returning ? `${filter}&select=${returning}` : filter
      const body = await request(`${table}?${query}`, {
        method: 'PATCH',
        headers: { prefer: returning ? 'return=representation' : 'return=minimal' },
        body: JSON.stringify(patch),
      })
      return (body ?? []) as T[]
    },

    async rpc<T>(name: string, args: object = {}): Promise<T> {
      return (await request(`rpc/${name}`, {
        method: 'POST',
        body: JSON.stringify(args),
      })) as T
    },
  }
}
