import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { gridDisk, latLngToCell } from 'h3-js'
import { useEffect, useRef } from 'react'
import type { RenderPlan } from '../lib/h3Helpers'
import { computeRenderPlan, computeResMetrics, hexToDegreesArray, viewRadiusMeters } from '../lib/h3Helpers'

export default function CesiumMap() {
  const ref = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)

  useEffect(() => {
    if (!ref.current) return

    // Create Cesium viewer with a minimal UI
    const viewer = new Cesium.Viewer(ref.current, {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      sceneModePicker: false,
      homeButton: false,
      infoBox: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      // request antialiasing from the WebGL context
      contextOptions: {
        webgl: {
          antialias: true
        }
      }
    })
    viewerRef.current = viewer

    // enable FXAA post-process anti-aliasing if available
    try {
      if (viewer.scene && viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = true
      }
    } catch {
      // ignore if not available
    }

    // Choose a center lat/lon. We use (0,0) as a neutral, reproducible start.
    // Convert to an H3 index at the chosen resolution instead of hard-coded geometry.
    const centerLat = 0
    const centerLng = 0

    // We'll render multiple resolutions dynamically depending on camera
    const maxRes = 8
    const metrics = computeResMetrics(maxRes)

    // maintain previous per-resolution alpha for smooth interpolation
    const prevAlphaRef = new Map<number, number>()
    const alphaSmoothing = 0.22 // how quickly alpha approaches target each frame (0..1)

    // per-resolution polyline collections and lookup maps for diffing
    const polylineCollections = new Map<number, Cesium.PolylineCollection>()
    const polylineMaps = new Map<number, Map<string, Cesium.Polyline>>() // res -> (id -> polyline)

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

    // helper that (re)draws hex outlines according to a render plan using polyline instancing + diff
    function drawForPlan(centerLat: number, centerLng: number, plan: RenderPlan[]) {
      // track desired ids per resolution
      const desiredByRes = new Map<number, Set<string>>()

      plan.forEach((p: RenderPlan) => {
        const targetAlpha = p.alpha
        if (targetAlpha <= 0) {
          // ensure stored alpha decays to zero
          prevAlphaRef.set(p.res, 0)
          return
        }

        // smooth alpha interpolation per resolution
        const prev = prevAlphaRef.get(p.res) ?? targetAlpha
        const displayed = prev + (targetAlpha - prev) * alphaSmoothing
        prevAlphaRef.set(p.res, displayed)

        const h3center = latLngToCell(centerLat, centerLng, p.res)
        const hexes = gridDisk(h3center, p.ring)

        const collection = ensureCollection(p.res)
        const mapForRes = polylineMaps.get(p.res) as Map<string, Cesium.Polyline>
        const desired = new Set<string>()

        hexes.forEach((h) => {
          if (!h) return
          const id = `${p.res}-${h}`
          desired.add(id)
          const degreesArray = hexToDegreesArray(h)
          const positions = Cesium.Cartesian3.fromDegreesArray(degreesArray)

          if (mapForRes.has(id)) {
            // update existing polyline positions and color
            const poly = mapForRes.get(id)!
            poly.positions = positions
            poly.width = 2
            const alpha = 0.9 * (prevAlphaRef.get(p.res) ?? targetAlpha)
            const color = Cesium.Color.fromBytes(102, 179, 224).withAlpha(alpha)
            try {
              // create a proper Material so Cesium can destroy it safely later
              ;(poly as unknown as { material: unknown }).material = Cesium.Material.fromType('Color', { color })
            } catch {
              // ensure a no-op destroy exists on the color fallback
              ;(color as unknown as { destroy?: () => void }).destroy = () => {}
              ;(poly as unknown as { material: unknown }).material = color as unknown
            }
          } else {
            // add new polyline instance
            const alpha = 0.9 * (prevAlphaRef.get(p.res) ?? targetAlpha)
            const color = Cesium.Color.fromBytes(102, 179, 224).withAlpha(alpha)
            let material: Cesium.Material | Cesium.Color = color
            try {
              material = Cesium.Material.fromType('Color', { color })
            } catch {
              // fallback to color if Material API not available
              // ensure a no-op destroy method exists so Cesium can safely call destroy()
              ;(color as unknown as { destroy?: () => void }).destroy = () => {}
              material = color
            }
            const poly = collection.add({
              positions,
              width: 2,
              material
            })
            mapForRes.set(id, poly)
          }
        })

        desiredByRes.set(p.res, desired)
      })

      // remove lines that are no longer desired
      polylineMaps.forEach((mapForRes, res) => {
        const desired = desiredByRes.get(res) || new Set()
        const collection = polylineCollections.get(res)!
        mapForRes.forEach((poly: Cesium.Polyline, id: string) => {
          if (!desired.has(id)) {
            try {
              collection.remove(poly)
            } catch {
              // ignore
            }
            mapForRes.delete(id)
          }
        })
      })
    }

    // initial draw based on initial camera
    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position)
    const fov = (viewer.camera.frustum as unknown as { fov?: number }).fov ?? Math.PI / 3
    const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight || 1
    const radiusMeters = viewRadiusMeters(camCarto.height, fov, aspect)
    const plan = computeRenderPlan(metrics, radiusMeters, 6)

    // draw initial centered at (0,0)
    drawForPlan(0, 0, plan)

    // update on camera change (debounced)
    let raf = 0
    function onCameraChanged() {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const center2 = viewer.camera.pickEllipsoid(
          new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2)
        )
        let cLat = centerLat
        let cLng = centerLng
        if (center2) {
          const carto = Cesium.Cartographic.fromCartesian(center2)
          cLat = (carto.latitude * 180) / Math.PI
          cLng = (carto.longitude * 180) / Math.PI
        }
        const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
        const fov2 = (viewer.camera.frustum as unknown as { fov?: number }).fov ?? Math.PI / 3
        const radius = viewRadiusMeters(cam.height, fov2, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
        const newPlan = computeRenderPlan(metrics, radius, 6)
        drawForPlan(cLat, cLng, newPlan)
      })
    }

    viewer.camera.changed.addEventListener(onCameraChanged)

    // pointer-follow: update grid center to pointer's intersection with globe (debounced)
    let pointerRaf = 0
    function onPointerMove(e: PointerEvent) {
      if (!viewer.canvas) return
      const rect = viewer.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (pointerRaf) cancelAnimationFrame(pointerRaf)
      pointerRaf = requestAnimationFrame(() => {
        const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y))
        let pLat = centerLat
        let pLng = centerLng
        if (pick) {
          const carto = Cesium.Cartographic.fromCartesian(pick)
          pLat = (carto.latitude * 180) / Math.PI
          pLng = (carto.longitude * 180) / Math.PI
        }

        // scaling still follows camera
        const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
        const fov2 = (viewer.camera.frustum as unknown as { fov?: number }).fov ?? Math.PI / 3
        const radius = viewRadiusMeters(cam.height, fov2, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
        const newPlan = computeRenderPlan(metrics, radius, 6)
        drawForPlan(pLat, pLng, newPlan)
      })
    }

    viewer.canvas.addEventListener('pointermove', onPointerMove)

    // ensure the Cesium widget and canvas resize with the window
    function onWindowResize() {
      // call viewer.resize if available, otherwise request a render
      if (viewer.resize && typeof viewer.resize === 'function') {
        viewer.resize()
      } else if (viewer.scene && viewer.scene.requestRender) {
        viewer.scene.requestRender()
      }
    }

    window.addEventListener('resize', onWindowResize)

    return () => {
      viewer.camera.changed.removeEventListener(onCameraChanged)
      if (viewer.canvas) viewer.canvas.removeEventListener('pointermove', onPointerMove)
      if (pointerRaf) cancelAnimationFrame(pointerRaf)
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onWindowResize)
      viewer.destroy()
    }
  }, [])

  return <div ref={ref} className="cesium-container fixed inset-0 w-full h-full" />
}
