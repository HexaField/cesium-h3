import { cellToBoundary, cellToChildren, cellToLatLng, latLngToCell } from 'h3-js'
import { describe, expect, it } from 'vitest'

// Simple point-in-polygon for lat/lng arrays (winding number / ray casting)
function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [py, px] = point // note: polygon is [lat,lng]
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    const intersect = xi > px !== xj > px && py < ((yj - yi) * (px - xi)) / (xj - xi) + yi
    if (intersect) inside = !inside
  }
  return inside
}

describe('H3 parent/child alignment', () => {
  it('child centers lie within parent boundary for a sample cell', () => {
    // Choose a sample coordinate and a parent resolution
    const lat = 37.7749
    const lng = -122.4194
    const parentRes = 3
    const childRes = 4

    const parent = latLngToCell(lat, lng, parentRes)
    const parentBoundary = cellToBoundary(parent) // returns [ [lat,lng], ... ]

    // get children via cellToChildren if available, else compute by querying nearby cells
    const children = cellToChildren(parent, childRes)
    expect(children.length).toBeGreaterThan(0)

    // For each child, check that its center is within parent boundary
    children.forEach((c) => {
      const center = cellToLatLng(c) // [lat, lng]
      const isInside = pointInPolygon(center as [number, number], parentBoundary as Array<[number, number]>)
      expect(isInside).toBe(true)
    })
  })
})
