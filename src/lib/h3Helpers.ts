import { cellToBoundary, getHexagonEdgeLengthAvg } from 'h3-js'

// Convert an h3 cell index to an array of degrees [lon, lat, lon, lat, ...]
// Ensures the polygon is closed by repeating the first coordinate at the end.
export function hexToDegreesArray(h3Index: string): number[] {
  const boundary = cellToBoundary(h3Index) as Array<[number, number]> // [lat, lng]
  const degreesArray: number[] = []
  boundary.forEach(([lat, lng]) => {
    degreesArray.push(lng, lat)
  })
  // close the polygon
  if (boundary.length > 0) {
    const [firstLat, firstLng] = boundary[0]
    degreesArray.push(firstLng, firstLat)
  }
  return degreesArray
}

export type ResMetrics = {
  res: number
  edgeMeters: number
}

// Precompute metrics (edge length) for resolutions 0..maxRes using h3-js
export function computeResMetrics(maxRes = 15): ResMetrics[] {
  const out: ResMetrics[] = []
  for (let r = 0; r <= maxRes; r++) {
    const edgeMeters = getHexagonEdgeLengthAvg(r, 'm')
    out.push({ res: r, edgeMeters })
  }
  return out
}

// Given camera height and frustum parameters, estimate the ground-space view radius (meters)
export function viewRadiusMeters(height: number, fovRadians: number, aspect: number): number {
  const viewHeight = 2 * height * Math.tan(fovRadians / 2)
  const viewWidth = viewHeight * aspect
  // radius of view (half-diagonal)
  return Math.sqrt((viewWidth / 2) ** 2 + (viewHeight / 2) ** 2)
}

export type RenderPlan = {
  res: number
  ring: number
  alpha: number
}

// Compute a render plan for each resolution: number of rings and alpha fade.
// All thresholds are derived from H3 edge lengths and viewport geometry.
export function computeRenderPlan(metrics: ResMetrics[], radiusMeters: number, maxRings = 8): RenderPlan[] {
  // desired number of hex across radius (heuristic)
  const desiredHexAcross = 8

  // compute ideal edge size to have ~desiredHexAcross across radius
  const idealEdge = Math.max(1, radiusMeters / desiredHexAcross)

  // Compute smooth alpha in log-space so fade is continuous as camera zooms.
  // We measure how far each resolution's edge length is from the ideal edge in octaves (log2).
  // Then apply a Gaussian falloff so alpha changes smoothly.
  const sigma = 0.9 // controls falloff width in log2 units (smaller = sharper)

  return metrics.map((m) => {
    const ring = Math.max(1, Math.min(maxRings, Math.ceil(radiusMeters / Math.max(m.edgeMeters, 1))))
    const logDiff = Math.log2(Math.max(m.edgeMeters, 1) / idealEdge)
    // Gaussian falloff centered at 0 (ideal). Use exp(-0.5*(x/sigma)^2)
    const alpha = Math.exp(-0.5 * (logDiff / sigma) ** 2)
    return { res: m.res, ring, alpha }
  })
}
