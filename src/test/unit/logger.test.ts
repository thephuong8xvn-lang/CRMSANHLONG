import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('logger.warn always calls console.warn', async () => {
    const { logger } = await import('../../lib/logger')
    logger.warn('test warning')
    expect(console.warn).toHaveBeenCalledWith('test warning')
  })

  it('logger.error always calls console.error', async () => {
    const { logger } = await import('../../lib/logger')
    logger.error('test error', new Error('boom'))
    expect(console.error).toHaveBeenCalledWith('test error', expect.any(Error))
  })

  it('logger exposes debug/info/log/warn/error methods', async () => {
    const { logger } = await import('../../lib/logger')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.log).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})
