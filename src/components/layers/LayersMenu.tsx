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
                type="checkbox"
                checked={holonsEnabled}
                onChange={(e) => setHolonsEnabled(e.target.checked)}
                className="toggle-checkbox"
                aria-label="Toggle Holons layer"
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
