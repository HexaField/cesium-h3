import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { latLngToCell, gridDisk } from "h3-js";
import {
  hexToDegreesArray,
  computeResMetrics,
  viewRadiusMeters,
  computeRenderPlan,
} from "../lib/h3Helpers";
import type { RenderPlan } from "../lib/h3Helpers";

export default function CesiumMap() {
  const ref = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  useEffect(() => {
    if (!ref.current) return;

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
    });
    viewerRef.current = viewer;

    // Choose a center lat/lon. We use (0,0) as a neutral, reproducible start.
    // Convert to an H3 index at the chosen resolution instead of hard-coded geometry.
    const centerLat = 0;
    const centerLng = 0;

    // We'll render multiple resolutions dynamically depending on camera
    const maxRes = 8;
    const metrics = computeResMetrics(maxRes);

    // helper that (re)draws hexes according to a render plan

    function drawForPlan(
      centerLat: number,
      centerLng: number,
      plan: RenderPlan[]
    ) {
      // remove previous entities
      viewer.entities.removeAll();

      plan.forEach((p: RenderPlan) => {
        if (p.alpha <= 0) return;
        const h3center = latLngToCell(centerLat, centerLng, p.res);
        const hexes = gridDisk(h3center, p.ring);
        hexes.forEach((h) => {
          if (!h) return;
          const degreesArray = hexToDegreesArray(h);
          viewer.entities.add({
            id: `${p.res}-${h}`,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
              // disable terrain clamping by explicitly setting a fixed height (0 meters)
              // this enables polygon outlines which are unsupported when geometry is clamped
              height: 0,
              // use transparent fill and draw outline only; outline alpha depends on render plan
              material: Cesium.Color.TRANSPARENT,
              outline: true,
              outlineColor: new Cesium.Color(
                30 / 255,
                58 / 255,
                138 / 255,
                0.9 * p.alpha
              ),
              classificationType: Cesium.ClassificationType.BOTH,
            },
          });
        });
      });
    }

    // initial draw based on initial camera
    const camCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
    const fov =
      (viewer.camera.frustum as unknown as { fov?: number }).fov ?? Math.PI / 3;
    const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight || 1;
    const radiusMeters = viewRadiusMeters(camCarto.height, fov, aspect);
    const plan = computeRenderPlan(metrics, radiusMeters, 6);

    // draw initial centered at (0,0)
    drawForPlan(0, 0, plan);

    // update on camera change (debounced)
    let raf = 0;
    function onCameraChanged() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center2 = viewer.camera.pickEllipsoid(
          new Cesium.Cartesian2(
            viewer.canvas.clientWidth / 2,
            viewer.canvas.clientHeight / 2
          )
        );
        let cLat = centerLat;
        let cLng = centerLng;
        if (center2) {
          const carto = Cesium.Cartographic.fromCartesian(center2);
          cLat = (carto.latitude * 180) / Math.PI;
          cLng = (carto.longitude * 180) / Math.PI;
        }
        const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position);
        const fov2 =
          (viewer.camera.frustum as unknown as { fov?: number }).fov ??
          Math.PI / 3;
        const radius = viewRadiusMeters(
          cam.height,
          fov2,
          viewer.canvas.clientWidth / viewer.canvas.clientHeight
        );
        const newPlan = computeRenderPlan(metrics, radius, 6);
        drawForPlan(cLat, cLng, newPlan);
      });
    }

    viewer.camera.changed.addEventListener(onCameraChanged);

    // ensure the Cesium widget and canvas resize with the window
    function onWindowResize() {
      // call viewer.resize if available, otherwise request a render
      if (viewer.resize && typeof viewer.resize === "function") {
        viewer.resize();
      } else if (viewer.scene && viewer.scene.requestRender) {
        viewer.scene.requestRender();
      }
    }

    window.addEventListener("resize", onWindowResize);

    return () => {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      window.removeEventListener("resize", onWindowResize);
      viewer.destroy();
    };
  }, []);

  return (
    <div ref={ref} className="cesium-container fixed inset-0 w-full h-full" />
  );
}
