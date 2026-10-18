import { useQuery } from "@tanstack/solid-query"

export type ServerQueryCache = "lookup" | "collection" | "detail"

export type ServerQueryKey = readonly [string, ...(readonly unknown[])]

export interface ServerQueryOptions<TData> {
  readonly tenantId: string
  readonly key: ServerQueryKey
  readonly load: (context: {
    readonly signal: AbortSignal
    readonly tenantId: string
  }) => Promise<TData>
  readonly cache?: ServerQueryCache
  readonly throwOnError?: boolean
}

const cachePolicy: Record<
  ServerQueryCache,
  { readonly staleTime: number; readonly gcTime: number }
> = {
  lookup: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  collection: { staleTime: 30_000, gcTime: 10 * 60_000 },
  detail: { staleTime: 60_000, gcTime: 10 * 60_000 },
}

/**
 * Cross-feature server-state policy boundary, not a renamed `useQuery`.
 *
 * It owns the rules that must stay consistent across features: tenant-scoped cache identity,
 * namespaced keys, bounded cache profiles, and a loader that receives the request abort signal.
 * Deliberately do not add raw TanStack options here; feature-local behavior belongs in the feature
 * query module, while new shared options need a documented RITSEI policy first.
 */
export function createServerQuery<TData, TError = unknown>(options: ServerQueryOptions<TData>) {
  const queryKey = serverQueryKey(options.tenantId, options.key)
  const policy = cachePolicy[options.cache ?? "collection"]
  return useQuery<TData, TError>(() => ({
    queryKey,
    queryFn: ({ signal }) => options.load({ signal, tenantId: options.tenantId }),
    staleTime: policy.staleTime,
    gcTime: policy.gcTime,
    throwOnError: options.throwOnError ?? true,
  }))
}

export function serverQueryKey(tenantId: string, key: ServerQueryKey) {
  return ["tenant", tenantId, ...key] as const
}
