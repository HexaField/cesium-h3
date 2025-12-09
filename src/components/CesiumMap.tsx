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
    if (viewer.scene?.postProcessStages?.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = true
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

    // hover / selection state
    let hoverCellId: string | null = null
    let selectedCellId: string | null = null
    let hoverAlpha = 0
    let hoverTargetAlpha = 0
    const hoverSmoothing = 0.28
    let highlightPrimitive: Cesium.Primitive | null = null

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
      // remember last hovered H3 for fade-out
      // smooth alpha interpolation per resolution and create/update polyline collections
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

      // remove lines that are no longer desired
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

      // Update hover/selection highlight smoothing and geometry.
      hoverAlpha = hoverAlpha + (hoverTargetAlpha - hoverAlpha) * hoverSmoothing

      // Determine which H3 to highlight (use lastHover for fade-out)
      // We'll maintain lastHoverH3/lastHoverRes in outer scope via hoverCellId/selectedCellId
      const h3ToUse = hoverCellId ? hoverCellId : null

      if (h3ToUse) {
        const [, ...rest] = h3ToUse.split('-')
        const h = rest.join('-')
        if (h) {
          const degrees = hexToDegreesArray(h)
          const positions = Cesium.Cartesian3.fromDegreesArray(degrees)
          const color =
            selectedCellId === hoverCellId
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

    // initial draw based on initial camera
    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position)
    const fov = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
    const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight || 1
    const radiusMeters = viewRadiusMeters(camCarto.height, fov, aspect)
    const plan = computeRenderPlan(metrics, radiusMeters, 6)

    // draw initial centered at (0,0)
    drawForPlan(0, 0, plan)

    // We'll run a continuous animation loop to update the grid every frame.
    let raf = 0
    let lastPointer: { x: number; y: number; inside: boolean } | null = null
    let pointerDownPos: { x: number; y: number } | null = null
    let isDragging = false

    function onPointerMoveSimple(e: PointerEvent) {
      if (!viewer.canvas) return
      const rect = viewer.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // detect simple dragging: if pointer was down and moved more than threshold
      if (pointerDownPos) {
        const dx = x - pointerDownPos.x
        const dy = y - pointerDownPos.y
        const distSq = dx * dx + dy * dy
        const THRESH = 5 // pixels
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
      // keep isDragging value until click; we'll clear it after click handling
    }

    viewer.canvas.addEventListener('pointerdown', onPointerDown)
    viewer.canvas.addEventListener('pointerup', onPointerUp)
    // handle pointer leaving the canvas
    function onPointerLeave() {
      lastPointer = null
    }
    viewer.canvas.addEventListener('pointerleave', onPointerLeave)

    // compute centroid (lon, lat) from degrees array [lon,lat,...]
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

      // Decide grid center: if a cell is selected, center on that cell; else prefer pointer position, then camera center
      let cLat = centerLat
      let cLng = centerLng
      if (selectedCellId) {
        // center on the selected H3 cell
        const [, ...rest] = selectedCellId.split('-')
        const h = rest.join('-')
        if (h) {
          const degrees = hexToDegreesArray(h)
          const cent = centroidFromDegreesArray(degrees)
          cLat = cent.lat
          cLng = cent.lon
        }
      } else if (lastPointer && lastPointer.inside) {
        // prefer pointer position
        const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(lastPointer.x, lastPointer.y))
        if (pick) {
          const carto = Cesium.Cartographic.fromCartesian(pick)
          cLat = (carto.latitude * 180) / Math.PI
          cLng = (carto.longitude * 180) / Math.PI
        }
      } else {
        // fallback to camera center
        const center2 = viewer.camera.pickEllipsoid(
          new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2)
        )
        if (center2) {
          const carto = Cesium.Cartographic.fromCartesian(center2)
          cLat = (carto.latitude * 180) / Math.PI
          cLng = (carto.longitude * 180) / Math.PI
        }
      }

      // camera-driven scale
      const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
      const fov2 = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
      const radius = viewRadiusMeters(cam.height, fov2, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
      const plan = computeRenderPlan(metrics, radius, 6)

      // pointer-based hover (only if not selected)
      if (!selectedCellId && lastPointer) {
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

      // Always draw the plan (diffing will minimize actual geometry changes)
      drawForPlan(cLat, cLng, plan)
    }

    // start animation
    raf = requestAnimationFrame(animate)

    // click to select/deselect a cell
    function onClick(e: MouseEvent) {
      if (!viewer.canvas) return
      // ignore clicks that are part of a drag
      if (isDragging) {
        // reset dragging state and ignore this click
        isDragging = false
        return
      }
      const rect = viewer.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // if already selected, clicking anywhere deselects
      if (selectedCellId) {
        selectedCellId = null
        hoverCellId = null
        hoverTargetAlpha = 0
        // highlight removal handled by drawForPlan fade
        return
      }

      // compute camera-driven plan to find primary resolution
      const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position)
      const fov = (viewer.camera.frustum as Cesium.PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3
      const radius = viewRadiusMeters(cam.height, fov, viewer.canvas.clientWidth / viewer.canvas.clientHeight)
      const plan = computeRenderPlan(metrics, radius, 6)
      // find primary resolution (max alpha)
      const primary = plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res

      const pick = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x, y))
      if (pick) {
        const carto = Cesium.Cartographic.fromCartesian(pick)
        const pLat = (carto.latitude * 180) / Math.PI
        const pLng = (carto.longitude * 180) / Math.PI
        const h3idx = latLngToCell(pLat, pLng, primary)
        selectedCellId = `${primary}-${h3idx}`
        hoverCellId = selectedCellId
        hoverTargetAlpha = 0.65
      }
    }

    viewer.canvas.addEventListener('click', onClick)

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
      // stop the RAF loop
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
      viewer.destroy()
    }
  }, [])

  return <div ref={ref} className="cesium-container fixed inset-0 w-full h-full" />
}
