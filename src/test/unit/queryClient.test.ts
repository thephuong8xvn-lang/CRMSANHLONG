import { describe, it, expect } from 'vitest'
import { queryClient, qk } from '../../lib/queryClient'

describe('queryClient', () => {
  it('has correct default staleTime', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(60_000)
  })

  it('has refetchOnWindowFocus disabled', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false)
  })

  it('has retry set to 1', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.queries?.retry).toBe(1)
  })
})

describe('qk key factory', () => {
  it('qk.customers.all returns stable key', () => {
    expect(qk.customers.all).toEqual(['customers'])
  })

  it('qk.customers.list includes params', () => {
    const key = qk.customers.list({ page: 1, search: 'abc' })
    expect(key).toEqual(['customers', 'list', { page: 1, search: 'abc' }])
  })

  it('qk.customers.detail includes id', () => {
    const key = qk.customers.detail('uuid-123')
    expect(key[2]).toBe('uuid-123')
  })

  it('qk.products keys are stable', () => {
    expect(qk.products.all).toEqual(['products'])
    expect(qk.products.categories).toEqual(['products', 'categories'])
  })

  it('qk.dashboard.stats is stable', () => {
    expect(qk.dashboard.stats).toEqual(['dashboard', 'stats'])
  })

  it('qk.auth.rolePermissions includes userId', () => {
    const key = qk.auth.rolePermissions('user-abc')
    expect(key).toEqual(['auth', 'role-permissions', 'user-abc'])
  })
})
