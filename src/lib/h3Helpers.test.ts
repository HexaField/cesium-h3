import { describe, expect, it, vi } from 'vitest'

// Mock the h3-js module so tests don't rely on actual H3 logic here
vi.mock('h3-js', () => ({
  cellToBoundary: (h3Index: string) => {
    // Return a simple triangle boundary as [lat, lng] pairs
    return [
      [10, 20],
      [11, 21],
      [10.5, 20.5]
    ]
  }
}))

import { computeRenderPlan, hexToDegreesArray } from './h3Helpers'

describe('hexToDegreesArray', () => {
  it('converts boundary lat,lng pairs to lon,lat degrees array and closes polygon', () => {
    const result = hexToDegreesArray('fake-h3')
    // expected: [lng1, lat1, lng2, lat2, lng3, lat3, lng1, lat1]
    expect(result).toEqual([20, 10, 21, 11, 20.5, 10.5, 20, 10])
  })
})

describe('render plan helpers', () => {
  it('computes metrics and a render plan', () => {
    // mock getHexagonEdgeLengthAvg indirectly is not mocked here; we test computeRenderPlan directly
    const metrics = [
      { res: 0, edgeMeters: 1000000 },
      { res: 1, edgeMeters: 500000 },
      { res: 2, edgeMeters: 200000 },
      { res: 3, edgeMeters: 80000 }
    ]
    const radius = 500000 // meters
    const plan = computeRenderPlan(metrics, radius, 6)
    expect(plan.length).toBe(metrics.length)
    // plans should have ring >=1 and alpha between 0 and 1
    plan.forEach((p) => {
      expect(p.ring).toBeGreaterThanOrEqual(1)
      expect(p.alpha).toBeGreaterThanOrEqual(0)
      expect(p.alpha).toBeLessThanOrEqual(1)
    })
  })
})
