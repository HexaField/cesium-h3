import * as Cesium from 'cesium'
import { gridDisk, latLngToCell } from 'h3-js'
import { useEffect, useRef } from 'react'
import type { RenderPlan } from '../lib/h3Helpers'
import { computeRenderPlan, computeResMetrics, hexToDegreesArray, viewRadiusMeters } from '../lib/h3Helpers'

type Props = {
  viewer: Cesium.Viewer
  enabled: boolean
  selectedCell: string | null
  setSelectedCell: (id: string | null) => void
}

export default function H3Layer({ viewer, enabled, selectedCell, setSelectedCell }: Props) {
  const selectedCellRef = useRef<string | null>(null)
  useEffect(() => {
    selectedCellRef.current = selectedCell
  }, [selectedCell])

  useEffect(() => {
    if (!enabled) return

    // We'll render multiple resolutions dynamically depending on camera
    const maxRes = 8
    const metrics = computeResMetrics(maxRes)

    const prevAlphaRef = new Map<number, number>()
    const alphaSmoothing = 0.22

    let hoverCellId: string | null = null
    let hoverAlpha = 0
    let hoverTargetAlpha = 0
    const hoverSmoothing = 0.28
    let highlightPrimitive: Cesium.Primitive | null = null

    const polylineCollections = new Map<number, Cesium.PolylineCollection>()
    const polylineMaps = new Map<number, Map<string, Cesium.Polyline>>()

    function ensureCollection(res: number) {
      let c = polylineCollections.get(res)
      if (!c) {
        c = new Cesium.PolylineCollection()
        viewer.scene.primitives.add(c)
        polylineCollections.set(res, c)
        polylineMaps.set(res, new Map())
      }
      return c
    }

    function drawForPlan(centerLat: number, centerLng: number, plan: RenderPlan[]) {
      const desiredByRes = new Map<number, Set<string>>()

      for (const p of plan) {
        const targetAlpha = p.alpha
        if (targetAlpha <= 0) {
          prevAlphaRef.set(p.res, 0)
          continue
        }

        const prev = prevAlphaRef.get(p.res) ?? targetAlpha
        const displayed = prev + (targetAlpha - prev) * alphaSmoothing
        prevAlphaRef.set(p.res, displayed)

        const h3center = latLngToCell(centerLat, centerLng, p.res)
        const hexes = gridDisk(h3center, p.ring)

        const collection = ensureCollection(p.res)
        const mapForRes = polylineMaps.get(p.res) as Map<string, Cesium.Polyline>
        const desired = new Set<string>()

        for (const h of hexes) {
          if (!h) continue
          const id = `${p.res}-${h}`
          desired.add(id)
          const degreesArray = hexToDegreesArray(h)
          const positions = Cesium.Cartesian3.fromDegreesArray(degreesArray)
          const alpha = 0.9 * displayed
          const color = Cesium.Color.fromBytes(102, 179, 224).withAlpha(alpha)

          if (mapForRes.has(id)) {
            const poly = mapForRes.get(id)!
            poly.positions = positions
            poly.width = 2
            poly.material = Cesium.Material.fromType('Color', { color }) as Cesium.Material
          } else {
            const material = Cesium.Material.fromType('Color', { color }) as Cesium.Material
            const poly = collection.add({ positions, width: 2, material })
            mapForRes.set(id, poly)
          }
        }

        desiredByRes.set(p.res, desired)
      }

      polylineMaps.forEach((mapForRes, res) => {
        const desired = desiredByRes.get(res) || new Set()
        const collection = polylineCollections.get(res)!
        mapForRes.forEach((poly: Cesium.Polyline, id: string) => {
          if (!desired.has(id)) {
            if (collection && typeof collection.remove === 'function') {
              collection.remove(poly)
            }
            mapForRes.delete(id)
          }
        })
      })

      hoverAlpha = hoverAlpha + (hoverTargetAlpha - hoverAlpha) * hoverSmoothing

      const h3ToUse = hoverCellId ? hoverCellId : null

      if (h3ToUse) {
        const [, ...rest] = h3ToUse.split('-')
        const h = rest.join('-')
        if (h) {
          const degrees = hexToDegreesArray(h)
          const positions = Cesium.Cartesian3.fromDegreesArray(degrees)
          const color =
            selectedCellRef.current === hoverCellId
              ? Cesium.Color.fromBytes(255, 165, 0).withAlpha(0.45)
              : Cesium.Color.fromBytes(102, 179, 224).withAlpha(Math.max(0, Math.min(0.999, hoverAlpha)))

          if (
            highlightPrimitive &&
            viewer.scene &&
            viewer.scene.primitives &&
            typeof viewer.scene.primitives.remove === 'function'
          ) {
            viewer.scene.primitives.remove(highlightPrimitive)
            highlightPrimitive = null
          }

          const polyHierarchy = new Cesium.PolygonHierarchy(positions)
          const geometry = new Cesium.PolygonGeometry({ polygonHierarchy: polyHierarchy, height: 1 })
          const instance = new Cesium.GeometryInstance({
            geometry,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
            }
          })

          const primitive = new Cesium.Primitive({
            geometryInstances: instance,
            appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
            asynchronous: false
          })

          viewer.scene.primitives.add(primitive)
          highlightPrimitive = primitive
          if (viewer.scene && typeof viewer.scene.requestRender === 'function') viewer.scene.requestRender()
        }
      } else if (highlightPrimitive) {
        if (hoverAlpha < 0.01) {
          if (
            highlightPrimitive &&
            viewer.scene &&
            viewer.scene.primitives &&
            typeof viewer.scene.primitives.remove === 'function'
          ) {
            viewer.scene.primitives.remove(highlightPrimitive)
          }
          highlightPrimitive = null
        }
      }
    }

    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position)
    const fov = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
    const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight || 1
    const radiusMeters = viewRadiusMeters(camCarto.height, fov, aspect)
    const initialPlan = computeRenderPlan(metrics, radiusMeters, 6)
    drawForPlan(0, 0, initialPlan)

    let raf = 0
    let lastPointer: { x: number; y: number; inside: boolean } | null = null
    let pointerDownPos: { x: number; y: number } | null = null
    let isDragging = false

    function onPointerMoveSimple(e: PointerEvent) {
      if (!viewer.canvas) return
      const rect = viewer.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (pointerDownPos) {
        const dx = x - pointerDownPos.x
        const dy = y - pointerDownPos.y
        const distSq = dx * dx + dy * dy
        const THRESH = 5
        if (distSq > THRESH * THRESH) isDragging = true
      }
      lastPointer = { x, y, inside: true }
    }

    viewer.canvas.addEventListener('pointermove', onPointerMoveSimple)

    function onPointerDown(e: PointerEvent) {
      if (!viewer.canvas) return
      const rect = viewer.canvas.getBoundingClientRect()
      pointerDownPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      isDragging = false
    }

    function onPointerUp() {
      pointerDownPos = null
    }

    viewer.canvas.addEventListener('pointerdown', onPointerDown)
    viewer.canvas.addEventListener('pointerup', onPointerUp)

    function onPointerLeave() {
      lastPointer = null
    }
    viewer.canvas.addEventListener('pointerleave', onPointerLeave)

    function centroidFromDegreesArray(degrees: number[]) {
      let lonSum = 0
      let latSum = 0
      let count = 0
      for (let i = 0; i + 1 < degrees.length; i += 2) {
        const lon = degrees[i]
        const lat = degrees[i + 1]
        lonSum += lon
        latSum += lat
        count++
      }
      if (count === 0) return { lat: 0, lon: 0 }
      return { lat: latSum / count, lon: lonSum / count }
    }

    function animate() {
      raf = requestAnimationFrame(animate)

      let cLat = 0
      let cLng = 0
      const sel = selectedCellRef.current
      if (sel) {
        const [, ...rest] = sel.split('-')
        const h = rest.join('-')
        if (h) {
          const degrees = hexToDegreesArray(h)
          const cent = centroidFromDegreesArray(degrees)
          cLat = cent.lat
          cLng = cent.lon
        }
      } else if (lastPointer && lastPointer.inside) {
        const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(lastPointer.x, lastPointer.y))
        if (pick) {
          const carto = Cesium.Cartographic.fromCartesian(pick)
          cLat = (carto.latitude * 180) / Math.PI
          cLng = (carto.longitude * 180) / Math.PI
        }
      } else {
        const center2 = viewer.camera.pickEllipsoid(
          new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2)
        )
        if (center2) {
          const carto = Cesium.Cartographic.fromCartesian(center2)
          cLat = (carto.latitude * 180) / Math.PI
          cLng = (carto.longitude * 180) / Math.PI
        }
      }

      const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
      const fov2 = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
      const radius = viewRadiusMeters(cam.height, fov2, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
      const plan = computeRenderPlan(metrics, radius, 6)

      if (!selectedCellRef.current && lastPointer) {
        const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(lastPointer.x, lastPointer.y))
        if (pick) {
          const carto = Cesium.Cartographic.fromCartesian(pick)
          const pLat = (carto.latitude * 180) / Math.PI
          const pLng = (carto.longitude * 180) / Math.PI
          const primary = plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res
          const h3idx = latLngToCell(pLat, pLng, primary)
          hoverCellId = `${primary}-${h3idx}`
          hoverTargetAlpha = 0.4
        } else {
          hoverCellId = null
          hoverTargetAlpha = 0
        }
      }

      drawForPlan(cLat, cLng, plan)
    }

    raf = requestAnimationFrame(animate)

    function onClick(e: MouseEvent) {
      if (!viewer.canvas) return
      if (isDragging) {
        isDragging = false
        return
      }
      const rect = viewer.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (selectedCellRef.current) {
        selectedCellRef.current = null
        setSelectedCell(null)
        hoverCellId = null
        hoverTargetAlpha = 0
        return
      }

      const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
      const fov = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
      const radius = viewRadiusMeters(cam.height, fov, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
      const plan = computeRenderPlan(metrics, radius, 6)
      const primary = plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res

      const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y))
      if (pick) {
        const carto = Cesium.Cartographic.fromCartesian(pick)
        const pLat = (carto.latitude * 180) / Math.PI
        const pLng = (carto.longitude * 180) / Math.PI
        const h3idx = latLngToCell(pLat, pLng, primary)
        const selId = `${primary}-${h3idx}`
        selectedCellRef.current = selId
        setSelectedCell(selId)
        hoverCellId = selId
        hoverTargetAlpha = 0.65
      }
    }

    viewer.canvas.addEventListener('click', onClick)

    function onWindowResize() {
      if (viewer.resize && typeof viewer.resize === 'function') {
        viewer.resize()
      } else if (viewer.scene && viewer.scene.requestRender) {
        viewer.scene.requestRender()
      }
    }

    window.addEventListener('resize', onWindowResize)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (viewer.canvas) viewer.canvas.removeEventListener('pointermove', onPointerMoveSimple)
      if (viewer.canvas) viewer.canvas.removeEventListener('pointerdown', onPointerDown)
      if (viewer.canvas) viewer.canvas.removeEventListener('pointerup', onPointerUp)
      if (viewer.canvas) viewer.canvas.removeEventListener('click', onClick)
      window.removeEventListener('resize', onWindowResize)
      if (
        highlightPrimitive &&
        viewer.scene &&
        viewer.scene.primitives &&
        typeof viewer.scene.primitives.remove === 'function'
      ) {
        viewer.scene.primitives.remove(highlightPrimitive)
        highlightPrimitive = null
      }
      viewer.canvas.removeEventListener('pointerleave', onPointerLeave)

      // remove any polyline collections
      polylineCollections.forEach((collection) => {
        try {
          if (viewer.scene && viewer.scene.primitives && typeof viewer.scene.primitives.remove === 'function') {
            viewer.scene.primitives.remove(collection)
          }
        } catch {
          // ignore
        }
      })
    }
  }, [viewer, enabled, setSelectedCell])

  return null
}
