import type { Viewer } from 'cesium'
import { useState } from 'react'
import CesiumGlobe from './CesiumGlobe'
import H3Layer from './H3Layer'
import LayersMenu from './layers/LayersMenu'

export default function CesiumMap() {
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [holonsEnabled, setHolonsEnabled] = useState(true)

  return (
    <>
      {/* Must pass ref in directly */}
      <CesiumGlobe onViewerReady={setViewer} />

      {/* Layers menu top-right (always visible) */}
      <LayersMenu holonsEnabled={holonsEnabled} setHolonsEnabled={setHolonsEnabled} />

      {/* H3 layer (render only when viewer ready) */}
      {viewer && (
        <H3Layer
          viewer={viewer}
          enabled={holonsEnabled}
          selectedCell={selectedCell}
          setSelectedCell={setSelectedCell}
        />
      )}

      {/* Left-side sliding modal for selected cell */}
      <div
        className={`fixed left-4 top-4 bottom-4 z-50 transform transition-all duration-200 ease-out ${
          selectedCell ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'
        }`}
        aria-hidden={!selectedCell}
      >
        <div className="bg-white border border-gray-300 rounded-md shadow-md p-4 w-64 h-full overflow-y-auto">
          <div className="text-sm text-gray-500 mb-1">Selected Cell</div>
          <div className="text-sm font-mono text-gray-900 break-words">{selectedCell ?? ''}</div>
        </div>
      </div>
    </>
  )
}
