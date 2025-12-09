import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useEffect, useRef, useState } from 'react'

type Props = {
  onViewerReady?: (viewer: Cesium.Viewer) => void
}

export default function CesiumGlobe({ onViewerReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!ref.current) return

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
      contextOptions: {
        webgl: { antialias: true }
      }
    })
    viewerRef.current = viewer

    function handleTileLoadProgress(queuedTileCount: number) {
      if (queuedTileCount > 0) return
      viewer.scene.globe.tileLoadProgressEvent.removeEventListener(handleTileLoadProgress)
      setLoaded(true)
      if (onViewerReady) onViewerReady(viewer)
    }

    viewer.scene.globe.tileLoadProgressEvent.addEventListener(handleTileLoadProgress)
    if (viewer.scene?.postProcessStages?.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = true
    }

    return () => {
      viewer.scene.globe.tileLoadProgressEvent.removeEventListener(handleTileLoadProgress)
      viewer.destroy()
      viewerRef.current = null
      setLoaded(false)
    }
  }, [onViewerReady])

  return (
    <>
      <div ref={ref} className="cesium-container fixed inset-0 w-full h-full" />
      {!loaded && (
        <div className="fixed inset-0 flex items-center justify-center z-10">
          <div className="text-gray-500">Loading globe...</div>
        </div>
      )}
    </>
  )
}
