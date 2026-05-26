import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('does not update before delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('a')
  })

  it('updates value after delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('b')
  })

  it('resets timer on rapid changes (debounce behaviour)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } }
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ value: 'c' })
    act(() => { vi.advanceTimersByTime(200) })
    // only 400ms total since last change — still within window for 'c'
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('c')
  })

  it('works with numeric values', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 100),
      { initialProps: { value: 0 } }
    )
    rerender({ value: 42 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(42)
  })

  it('works with object values', () => {
    const obj = { page: 1, search: 'test' }
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: { page: 0, search: '' } } }
    )
    rerender({ value: obj })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toEqual(obj)
  })
})
