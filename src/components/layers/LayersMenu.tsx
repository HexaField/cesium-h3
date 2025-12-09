type Props = {
  holonsEnabled: boolean
  setHolonsEnabled: (v: boolean) => void
}

export default function LayersMenu({ holonsEnabled, setHolonsEnabled }: Props) {
  return (
    <div className="fixed right-4 top-4 z-50 text-sm">
      <div className="bg-white border border-gray-300 rounded-md px-3 py-2 shadow-sm w-44">
        <div className="text-xs text-gray-600 mb-2">Layers</div>
        <div className="p-0">
          <label className="flex items-center justify-between w-full">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Holons</span>
              <span className="text-xs text-gray-500">H3 grid</span>
            </div>
            <div>
              <input
                id="holons-toggle"
                type="checkbox"
                checked={holonsEnabled}
                onChange={(e) => setHolonsEnabled(e.target.checked)}
                className="sr-only peer"
                aria-label="Toggle Holons layer"
              />

              <div className="w-12 h-6 bg-gray-200 rounded-full relative transition-colors duration-200 peer-checked:bg-sky-500">
                <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 peer-checked:translate-x-6" />
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
