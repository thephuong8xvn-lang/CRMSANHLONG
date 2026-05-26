import { vi } from 'vitest'

export const mockSupabaseData = <T>(data: T) => ({
  data,
  error: null,
  count: null,
  status: 200,
  statusText: 'OK',
})

export const mockSupabaseError = (message: string) => ({
  data: null,
  error: { message, code: 'MOCK_ERROR' },
  count: null,
  status: 400,
  statusText: 'Bad Request',
})

export const createMockQueryBuilder = <T>(result: { data: T; error: null } | { data: null; error: { message: string } }) => {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn().mockReturnValue(builder)
  builder.insert = vi.fn().mockReturnValue(builder)
  builder.update = vi.fn().mockReturnValue(builder)
  builder.delete = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockReturnValue(builder)
  builder.neq = vi.fn().mockReturnValue(builder)
  builder.ilike = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
  builder.range = vi.fn().mockReturnValue(builder)
  builder.limit = vi.fn().mockReturnValue(builder)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = vi.fn((resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve))
  return builder
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue(createMockQueryBuilder(mockSupabaseData([]))),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}))
