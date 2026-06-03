import type { PointerEvent, RefObject } from "react";

import type { GpsCoordinate, Point } from "../lib/mapMath";
import { gpsToMapPoint } from "../lib/mapMath";
import {
  MAP_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  SKIDPAD,
  ZOOM_STEP,
  type DevicePosition,
  type DragState,
  type EditorMode,
  type MapRect,
  type MapTile,
  type TrackPlacement,
  type VisibleObstacleBox,
} from "../lib/missionTypes";
import { buildConePositionsMeters, formatZoom } from "../lib/trackGeometry";

type TrackMapProps = {
  mapRef: RefObject<HTMLDivElement | null>;
  mapTiles: MapTile[];
  dragState: DragState | null;
  editorMode: EditorMode;
  zoom: number;
  mapCenter: GpsCoordinate;
  devicePosition: DevicePosition | null;
  visibleObstacleBoxes: VisibleObstacleBox[];
  draftObstacleRect: MapRect | null;
  obstacleCount: number;
  track: TrackPlacement;
  trackTopLeft: Point;
  trackSize: Point;
  onMapPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onMapPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onMapPointerUp: () => void;
  onTrackPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onRotatePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onZoomChange: (zoom: number) => void;
};

export function TrackMap({
  mapRef,
  mapTiles,
  dragState,
  editorMode,
  zoom,
  mapCenter,
  devicePosition,
  visibleObstacleBoxes,
  draftObstacleRect,
  obstacleCount,
  track,
  trackTopLeft,
  trackSize,
  onMapPointerDown,
  onMapPointerMove,
  onMapPointerUp,
  onTrackPointerDown,
  onRotatePointerDown,
  onZoomChange,
}: TrackMapProps) {
  return (
    <section className="map-section" aria-label="Map and track editor">
      <div
        ref={mapRef}
        className={`map-viewport ${dragState?.type === "map" ? "is-panning" : ""} ${
          editorMode === "obstacle" ? "is-drawing-obstacle" : ""
        }`}
        onPointerDown={onMapPointerDown}
        onPointerMove={onMapPointerMove}
        onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerUp}
      >
        <MapTiles tiles={mapTiles} />
        <div className="map-layer map-grid" />
        <div className="map-label north">N</div>
        <div className="map-label scale">OSM z{formatZoom(zoom)}</div>
        <div
          className="zoom-controls"
          aria-label="Map zoom controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => onZoomChange(zoom + ZOOM_STEP)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => onZoomChange(zoom - ZOOM_STEP)}
            aria-label="Zoom out"
          >
            -
          </button>
        </div>
        {devicePosition && (
          <RobotMarker
            coordinate={devicePosition.coordinate}
            mapCenter={mapCenter}
            zoom={zoom}
          />
        )}
        <ObstacleLayer
          draftObstacleRect={draftObstacleRect}
          visibleObstacleBoxes={visibleObstacleBoxes}
        />
        <div
          className={`track-overlay ${
            editorMode === "obstacle" ? "is-obstacle-mode" : ""
          }`}
          style={{
            left: `${(trackTopLeft.x / MAP_SIZE.x) * 100}%`,
            top: `${(trackTopLeft.y / MAP_SIZE.y) * 100}%`,
            width: `${(trackSize.x / MAP_SIZE.x) * 100}%`,
            height: `${(trackSize.y / MAP_SIZE.y) * 100}%`,
            transform: `rotate(${track.rotation}deg)`,
          }}
          onPointerDown={onTrackPointerDown}
          role="button"
          tabIndex={0}
          aria-label="Draggable skidpad track overlay"
        >
          <button
            type="button"
            className="rotation-handle"
            onPointerDown={onRotatePointerDown}
            aria-label="Rotate skidpad overlay"
          />
          <SkidpadOverlay />
        </div>
        <a
          className="osm-attribution"
          href="https://www.openstreetmap.org/copyright"
          rel="noreferrer"
          target="_blank"
        >
          © OpenStreetMap contributors
        </a>
      </div>
      <div className="map-footer">
        <MapLegend
          hasDevicePosition={Boolean(devicePosition)}
          hasObstacles={obstacleCount > 0}
        />
        <div className="gps-readout">
          <span>{devicePosition ? "Device GPS" : "Map center"}</span>
          <strong>
            {(devicePosition?.coordinate ?? mapCenter).lat.toFixed(6)},{" "}
            {(devicePosition?.coordinate ?? mapCenter).lng.toFixed(6)}
          </strong>
        </div>
      </div>
    </section>
  );
}

function MapTiles({ tiles }: { tiles: MapTile[] }) {
  return (
    <div className="map-layer map-tiles" aria-hidden="true">
      {tiles.map((tile) => (
        <img
          key={tile.id}
          alt=""
          draggable={false}
          src={tile.url}
          style={{
            left: `${(tile.left / MAP_SIZE.x) * 100}%`,
            top: `${(tile.top / MAP_SIZE.y) * 100}%`,
            width: `${(tile.size / MAP_SIZE.x) * 100}%`,
            height: `${(tile.size / MAP_SIZE.y) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function ObstacleLayer({
  draftObstacleRect,
  visibleObstacleBoxes,
}: {
  draftObstacleRect: MapRect | null;
  visibleObstacleBoxes: VisibleObstacleBox[];
}) {
  return (
    <div className="map-layer obstacle-layer" aria-hidden="true">
      {visibleObstacleBoxes.map(({ obstacle, rect }, index) => (
        <div
          key={obstacle.id}
          className="obstacle-rect"
          style={{
            left: `${(rect.left / MAP_SIZE.x) * 100}%`,
            top: `${(rect.top / MAP_SIZE.y) * 100}%`,
            width: `${(rect.width / MAP_SIZE.x) * 100}%`,
            height: `${(rect.height / MAP_SIZE.y) * 100}%`,
          }}
        >
          <span>{index + 1}</span>
        </div>
      ))}
      {draftObstacleRect && (
        <div
          className="obstacle-rect is-draft"
          style={{
            left: `${(draftObstacleRect.left / MAP_SIZE.x) * 100}%`,
            top: `${(draftObstacleRect.top / MAP_SIZE.y) * 100}%`,
            width: `${(draftObstacleRect.width / MAP_SIZE.x) * 100}%`,
            height: `${(draftObstacleRect.height / MAP_SIZE.y) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

function RobotMarker({
  coordinate,
  mapCenter,
  zoom,
}: {
  coordinate: GpsCoordinate;
  mapCenter: GpsCoordinate;
  zoom: number;
}) {
  const point = gpsToMapPoint(coordinate, MAP_SIZE, mapCenter, zoom);
  const isVisible =
    point.x >= 0 && point.x <= MAP_SIZE.x && point.y >= 0 && point.y <= MAP_SIZE.y;

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="robot-marker"
      style={{
        left: `${(point.x / MAP_SIZE.x) * 100}%`,
        top: `${(point.y / MAP_SIZE.y) * 100}%`,
      }}
      title={`${coordinate.lat}, ${coordinate.lng}`}
    >
      <span />
    </div>
  );
}

function SkidpadOverlay() {
  return (
    <svg
      viewBox={`-${SKIDPAD.boundsWidthMeters / 2} -${SKIDPAD.boundsHeightMeters / 2} ${SKIDPAD.boundsWidthMeters} ${SKIDPAD.boundsHeightMeters}`}
      aria-hidden="true"
    >
      <rect
        x={-SKIDPAD.boundsWidthMeters / 2}
        y={-SKIDPAD.boundsHeightMeters / 2}
        width={SKIDPAD.boundsWidthMeters}
        height={SKIDPAD.boundsHeightMeters}
        rx="1.6"
      />
      <circle cx={-12.5} cy="0" r={SKIDPAD.outerDiameterMeters / 2} />
      <circle cx={12.5} cy="0" r={SKIDPAD.outerDiameterMeters / 2} />
      <circle className="inner-limit" cx={-12.5} cy="0" r={SKIDPAD.innerDiameterMeters / 2} />
      <circle className="inner-limit" cx={12.5} cy="0" r={SKIDPAD.innerDiameterMeters / 2} />
      <path className="start-lane" d="M-1 -30 V-13 M1 -30 V-13 M-1 13 V30 M1 13 V30" />
      {buildConePositionsMeters().map((cone) => (
        <g key={cone.id} className={`cone ${cone.color}`}>
          <circle cx={cone.point.x} cy={cone.point.y} r="0.42" />
          <path
            d={`M${cone.point.x - 0.45} ${cone.point.y + 0.65} L${cone.point.x} ${
              cone.point.y - 0.65
            } L${cone.point.x + 0.45} ${cone.point.y + 0.65} Z`}
          />
        </g>
      ))}
    </svg>
  );
}

function MapLegend({
  hasDevicePosition,
  hasObstacles,
}: {
  hasDevicePosition: boolean;
  hasObstacles: boolean;
}) {
  return (
    <div className="legend" aria-label="Map legend">
      {hasDevicePosition && (
        <span>
          <i className="legend-current" /> Device GPS
        </span>
      )}
      <span>
        <i className="legend-cone" /> Cone spray point
      </span>
      {hasObstacles && (
        <span>
          <i className="legend-obstacle" /> Obstacle
        </span>
      )}
    </div>
  );
}
