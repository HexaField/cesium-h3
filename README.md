# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    ## Cesium + H3 MVP

    This workspace contains a minimal CesiumJS + H3 example using React, TypeScript, Vite and Tailwind.

    Quick start:

    ```bash
    # install deps
    npm install

    # start dev server
    npm run dev
    ```

    Notes:
    - The project uses `vite-plugin-cesium` to surface Cesium static assets. If your environment doesn't handle it automatically, copy `node_modules/cesium/Build/Cesium` into `public/cesium`.
    - The map component derives hexagons from `h3-js` (using `geoToH3`, `kRing`, and `h3ToGeoBoundary`) and draws them as Cesium entities.

    If you want adjustments (different center, resolution, or dynamic generation based on camera), tell me which behavior you prefer and I'll implement it.
