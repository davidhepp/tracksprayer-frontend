import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Route } from "./+types/home";
import { createLogEntry, writeConsoleLog } from "../lib/logger";
import type { GpsCoordinate, Point } from "../lib/mapMath";
import {
  clamp,
  gpsToMapPoint,
  gpsToWorldPixel,
  mapPointToGps,
  metersPerPixel,
  offsetGpsByMeters,
  rotatePoint,
  worldPixelToGps,
} from "../lib/mapMath";

const MAP_SIZE: Point = { x: 1000, y: 680 };
const TILE_SIZE = 256;
const DEFAULT_ZOOM = 18;
const MIN_ZOOM = 16;
const MAX_ZOOM = 20;
const ZOOM_STEP = 0.5;
const MAX_OSM_TILE_ZOOM = 19;
const MAX_LOG_ENTRIES = 8;
const OSM_TILE_URL = "https://tile.openstreetmap.org";
const SCHWEINFURT_CENTER: GpsCoordinate = { lat: 50.04937, lng: 10.22175 };
const SKIDPAD = {
  outerDiameterMeters: 25,
  innerDiameterMeters: 15,
  centerDistanceMeters: 25,
  boundsWidthMeters: 56,
  boundsHeightMeters: 62,
};

type TrackPlacement = {
  center: GpsCoordinate;
  rotation: number;
};

type DragState =
  | {
      type: "map";
      startPoint: Point;
      startCenter: GpsCoordinate;
    }
  | {
      type: "track";
      pointerOffset: Point;
    }
  | {
      type: "rotate";
      centerPoint: Point;
      startAngle: number;
      startRotation: number;
    };

type DevicePosition = {
  coordinate: GpsCoordinate;
  accuracyMeters: number | null;
  acquiredAt: string;
};

type Cone = {
  id: string;
  point: Point;
  color: "blue" | "yellow" | "orange";
};

type ConeWaypoint = {
  id: string;
  color: Cone["color"];
  coordinate: GpsCoordinate;
};

type MapTile = {
  id: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

type LocationSearchResult = {
  id: string;
  label: string;
  coordinate: GpsCoordinate;
};

const initialTrack = {
  center: SCHWEINFURT_CENTER,
  rotation: 0,
} satisfies TrackPlacement;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "TrackSprayer Operator" },
    {
      name: "description",
      content: "Frontend for configuring track spray missions with real GPS coordinates.",
    },
  ];
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapCenter, setMapCenter] = useState<GpsCoordinate>(SCHWEINFURT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [devicePosition, setDevicePosition] = useState<DevicePosition | null>(
    null,
  );
  const [track, setTrack] = useState<TrackPlacement>(initialTrack);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [coneWaypoints, setConeWaypoints] = useState<ConeWaypoint[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [logs, setLogs] = useState([
    createLogEntry("info", "Map initialized at Schweinfurt, Germany.", 1),
  ]);

  const addLog = useCallback(
    (
      level: "info" | "warn" | "error",
      message: string,
      details?: unknown,
    ) => {
      writeConsoleLog("TrackSprayer UI", level, message, details);
      setLogs((current) => [
        createLogEntry(level, message),
        ...current.slice(0, MAX_LOG_ENTRIES - 1),
      ]);
    },
    [],
  );

  useEffect(() => {
    writeConsoleLog("TrackSprayer UI", "info", "Frontend initialized.", {
      mapCenter: SCHWEINFURT_CENTER,
      mapZoom: DEFAULT_ZOOM,
      tileProvider: OSM_TILE_URL,
    });
  }, []);

  const mapTiles = useMemo(
    () => buildMapTiles(mapCenter, zoom, MAP_SIZE),
    [mapCenter, zoom],
  );
  const trackResolution = metersPerPixel(mapCenter.lat, zoom);
  const trackSize = useMemo(
    () => ({
      x: SKIDPAD.boundsWidthMeters / trackResolution,
      y: SKIDPAD.boundsHeightMeters / trackResolution,
    }),
    [trackResolution],
  );
  const trackCenterPoint = useMemo(
    () => gpsToMapPoint(track.center, MAP_SIZE, mapCenter, zoom),
    [mapCenter, track.center, zoom],
  );
  const trackTopLeft = useMemo(
    () => ({
      x: trackCenterPoint.x - trackSize.x / 2,
      y: trackCenterPoint.y - trackSize.y / 2,
    }),
    [trackCenterPoint, trackSize],
  );
  const trackWarning = useMemo(() => {
    if (trackSize.x > MAP_SIZE.x * 0.9 || trackSize.y > MAP_SIZE.y * 0.9) {
      return "Current zoom makes the fixed-size skidpad larger than the visible map.";
    }

    if (
      trackTopLeft.x + trackSize.x < 0 ||
      trackTopLeft.y + trackSize.y < 0 ||
      trackTopLeft.x > MAP_SIZE.x ||
      trackTopLeft.y > MAP_SIZE.y
    ) {
      return "Skidpad overlay is outside the visible map area.";
    }

    return null;
  }, [trackSize, trackTopLeft]);
  const previewConeWaypoints = useMemo(
    () => buildConeWaypoints(track, zoom),
    [track, zoom],
  );
  const plannedConeWaypoints =
    coneWaypoints.length > 0
      ? coneWaypoints
      : previewConeWaypoints.slice(0, 10);

  const toMapPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = mapRef.current?.getBoundingClientRect();

      if (!rect || rect.width === 0 || rect.height === 0) {
        addLog("error", "Map viewport is unavailable for pointer conversion.");
        return { x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 };
      }

      return {
        x: clamp(
          ((clientX - rect.left) / rect.width) * MAP_SIZE.x,
          0,
          MAP_SIZE.x,
        ),
        y: clamp(
          ((clientY - rect.top) / rect.height) * MAP_SIZE.y,
          0,
          MAP_SIZE.y,
        ),
      };
    },
    [addLog],
  );

  const moveTrack = useCallback(
    (point: Point, pointerOffset: Point) => {
      const maxX = Math.max(MAP_SIZE.x - trackSize.x, 0);
      const maxY = Math.max(MAP_SIZE.y - trackSize.y, 0);
      const nextTopLeft = {
        x: clamp(point.x - pointerOffset.x, 0, maxX),
        y: clamp(point.y - pointerOffset.y, 0, maxY),
      };
      const nextCenterPoint = {
        x: nextTopLeft.x + trackSize.x / 2,
        y: nextTopLeft.y + trackSize.y / 2,
      };

      setTrack((current) => ({
        ...current,
        center: mapPointToGps(nextCenterPoint, MAP_SIZE, mapCenter, zoom),
      }));
      setConeWaypoints([]);
    },
    [mapCenter, trackSize, zoom],
  );

  const panMap = useCallback(
    (point: Point, startPoint: Point, startCenter: GpsCoordinate) => {
      const startWorld = gpsToWorldPixel(startCenter, zoom);
      const delta = {
        x: startPoint.x - point.x,
        y: startPoint.y - point.y,
      };

      setMapCenter(
        worldPixelToGps(
          {
            x: startWorld.x + delta.x,
            y: startWorld.y + delta.y,
          },
          zoom,
        ),
      );
      setConeWaypoints([]);
    },
    [zoom],
  );

  const handleTrackPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const point = toMapPoint(event.clientX, event.clientY);
    setDragState({
      type: "track",
      pointerOffset: {
        x: point.x - trackTopLeft.x,
        y: point.y - trackTopLeft.y,
      },
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const handleRotatePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const point = toMapPoint(event.clientX, event.clientY);
    const centerPoint = {
      x: trackTopLeft.x + trackSize.x / 2,
      y: trackTopLeft.y + trackSize.y / 2,
    };

    setDragState({
      type: "rotate",
      centerPoint,
      startAngle: angleBetween(centerPoint, point),
      startRotation: track.rotation,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const handleMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = toMapPoint(event.clientX, event.clientY);
    setDragState({
      type: "map",
      startPoint: point,
      startCenter: mapCenter,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMapPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!dragState) {
      return;
    }

    const point = toMapPoint(event.clientX, event.clientY);

    if (dragState.type === "track") {
      moveTrack(point, dragState.pointerOffset);
      return;
    }

    if (dragState.type === "rotate") {
      const delta = angleBetween(dragState.centerPoint, point) - dragState.startAngle;
      setTrack((current) => ({
        ...current,
        rotation: normalizeRotation(dragState.startRotation + delta),
      }));
      setConeWaypoints([]);
      return;
    }

    panMap(point, dragState.startPoint, dragState.startCenter);
  };

  const handleMapPointerUp = () => {
    if (!dragState) {
      return;
    }

    setDragState(null);
  };

  const handleRotationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rotation = Number(event.target.value);
    setTrack((current) => ({ ...current, rotation }));
    setConeWaypoints([]);
    addLog("info", `Track rotation set to ${rotation} degrees.`);
  };

  const handleGenerateRoute = () => {
    const waypoints = buildConeWaypoints(track, zoom);
    setConeWaypoints(waypoints);
    addLog("info", `Generated ${waypoints.length} cone spray points.`, {
      first: waypoints[0],
      last: waypoints.at(-1),
    });
  };

  const resetTrack = () => {
    setTrack({
      center: mapCenter,
      rotation: 0,
    });
    setConeWaypoints([]);
    addLog("info", "Skidpad overlay reset to the current map center.");
  };

  const changeZoom = (
    nextZoom: number,
    anchor = { x: MAP_SIZE.x / 2, y: MAP_SIZE.y / 2 },
  ) => {
    const steppedZoom = Math.round(nextZoom / ZOOM_STEP) * ZOOM_STEP;
    const constrainedZoom = clamp(steppedZoom, MIN_ZOOM, MAX_ZOOM);

    if (constrainedZoom === zoom) {
      return;
    }

    const anchorGps = mapPointToGps(anchor, MAP_SIZE, mapCenter, zoom);
    const anchorWorldAtNextZoom = gpsToWorldPixel(anchorGps, constrainedZoom);

    setZoom(constrainedZoom);
    setMapCenter(
      worldPixelToGps(
        {
          x: anchorWorldAtNextZoom.x + MAP_SIZE.x / 2 - anchor.x,
          y: anchorWorldAtNextZoom.y + MAP_SIZE.y / 2 - anchor.y,
        },
        constrainedZoom,
      ),
    );
    setConeWaypoints([]);
    addLog("info", `Map zoom set to z${formatZoom(constrainedZoom)}.`);
  };

  const requestDeviceLocation = () => {
    if (!("geolocation" in navigator)) {
      addLog("warn", "Browser geolocation is not available.");
      return;
    }

    addLog("info", "Requesting browser geolocation.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate = {
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
        };
        const acquiredAt = new Date(position.timestamp).toLocaleTimeString(
          "en-GB",
          {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          },
        );

        setDevicePosition({
          coordinate,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
          acquiredAt,
        });
        setMapCenter(coordinate);
        setTrack((current) => ({ ...current, center: coordinate }));
        setConeWaypoints([]);
        addLog("info", "Browser geolocation received and map recentered.", {
          coordinate,
          accuracyMeters: position.coords.accuracy,
        });
      },
      (error) => {
        addLog("warn", `Browser geolocation failed: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 10_000,
      },
    );
  };

  const handleLocationSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();

    if (query.length < 3) {
      setSearchError("Enter at least 3 characters.");
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: "5",
        addressdetails: "0",
      });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}.`);
      }

      const results = (await response.json()) as Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
      }>;
      const parsedResults = results
        .map((result) => ({
          id: String(result.place_id),
          label: result.display_name,
          coordinate: {
            lat: Number(Number(result.lat).toFixed(7)),
            lng: Number(Number(result.lon).toFixed(7)),
          },
        }))
        .filter(
          (result) =>
            Number.isFinite(result.coordinate.lat) &&
            Number.isFinite(result.coordinate.lng),
        );

      setSearchResults(parsedResults);

      if (parsedResults.length === 0) {
        setSearchError("No matching location found.");
      }

      addLog("info", `Location search returned ${parsedResults.length} result(s).`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Location search failed.";
      setSearchError(message);
      addLog("warn", message);
    } finally {
      setIsSearching(false);
    }
  };

  const selectLocation = (result: LocationSearchResult) => {
    setMapCenter(result.coordinate);
    setTrack((current) => ({ ...current, center: result.coordinate }));
    setConeWaypoints([]);
    setSearchResults([]);
    setSearchQuery(result.label);
    addLog("info", "Map recentered to searched location.", {
      label: result.label,
      coordinate: result.coordinate,
    });
  };

  return (
    <main className="operator-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Formula Student ROS frontend</p>
          <h1>TrackSprayer Operator</h1>
        </div>
      </header>

      <section className="workspace" aria-label="Track configuration workspace">
        <aside className="control-panel" aria-label="Mission controls">
          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Real map source</p>
              <h2>Location</h2>
            </div>
            <form className="location-search" onSubmit={handleLocationSearch}>
              <label htmlFor="location-search">Search location</label>
              <div>
                <input
                  id="location-search"
                  name="location-search"
                  placeholder="Schweinfurt, Germany"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchError(null);
                  }}
                />
                <button type="submit" disabled={isSearching}>
                  {isSearching ? "..." : "Search"}
                </button>
              </div>
              {searchError && <p role="status">{searchError}</p>}
            </form>
            {searchResults.length > 0 && (
              <ol className="search-results">
                {searchResults.map((result) => (
                  <li key={result.id}>
                    <button type="button" onClick={() => selectLocation(result)}>
                      <span>{result.label}</span>
                      <small>
                        {result.coordinate.lat.toFixed(6)},{" "}
                        {result.coordinate.lng.toFixed(6)}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <CoordinateCard
              label="Current map center"
              coordinate={mapCenter}
              detail={
                devicePosition
                  ? `Device GPS, ${formatAccuracy(devicePosition.accuracyMeters)}`
                  : "Default: Schweinfurt, Germany"
              }
            />
            <button
              type="button"
              className="primary-button full-width-button"
              onClick={requestDeviceLocation}
            >
              Use device GPS
            </button>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Track overlay</p>
              <h2>Skidpad setup</h2>
            </div>
            <div className="dimension-list">
              <span>Outer circle: {SKIDPAD.outerDiameterMeters} m</span>
              <span>Inner circle: {SKIDPAD.innerDiameterMeters} m</span>
              <span>Track width: 5 m</span>
            </div>
            <label className="range-control">
              <span>Rotation</span>
              <input
                min="-180"
                max="180"
                step="1"
                type="range"
                value={track.rotation}
                onChange={handleRotationChange}
              />
              <strong>{track.rotation} deg</strong>
            </label>
            {trackWarning && (
              <p className="warning-banner" role="status">
                {trackWarning}
              </p>
            )}
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={resetTrack}>
                Reset
              </button>
              <button type="button" className="primary-button" onClick={handleGenerateRoute}>
                Go
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Output preview</p>
              <h2>Cone spray points</h2>
            </div>
            <CoordinateList
              committed={coneWaypoints.length > 0}
              waypoints={plannedConeWaypoints}
            />
          </section>
        </aside>

        <section className="map-section" aria-label="Map and track editor">
          <div
            ref={mapRef}
            className={`map-viewport ${dragState?.type === "map" ? "is-panning" : ""}`}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={handleMapPointerUp}
            onPointerCancel={handleMapPointerUp}
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
                onClick={() => changeZoom(zoom + ZOOM_STEP)}
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => changeZoom(zoom - ZOOM_STEP)}
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
            <div
              className="track-overlay"
              style={{
                left: `${(trackTopLeft.x / MAP_SIZE.x) * 100}%`,
                top: `${(trackTopLeft.y / MAP_SIZE.y) * 100}%`,
                width: `${(trackSize.x / MAP_SIZE.x) * 100}%`,
                height: `${(trackSize.y / MAP_SIZE.y) * 100}%`,
                transform: `rotate(${track.rotation}deg)`,
              }}
              onPointerDown={handleTrackPointerDown}
              role="button"
              tabIndex={0}
              aria-label="Draggable skidpad track overlay"
            >
              <button
                type="button"
                className="rotation-handle"
                onPointerDown={handleRotatePointerDown}
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
            <MapLegend hasDevicePosition={Boolean(devicePosition)} />
            <div className="gps-readout">
              <span>{devicePosition ? "Device GPS" : "Map center"}</span>
              <strong>
                {(devicePosition?.coordinate ?? mapCenter).lat.toFixed(6)},{" "}
                {(devicePosition?.coordinate ?? mapCenter).lng.toFixed(6)}
              </strong>
            </div>
          </div>
        </section>

        <aside className="control-panel right-panel" aria-label="Available data and logs">
          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Robot state</p>
              <h2>ROS data</h2>
            </div>
            <UnavailableData label="Battery" />
            <UnavailableData label="Spray can" />
            <UnavailableData label="ROS bridge" />
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Obstacle map</p>
              <h2>ROS coordinates</h2>
            </div>
            <p className="empty-state">
              No obstacle coordinates are available in the frontend yet.
            </p>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Diagnostics</p>
              <h2>Event log</h2>
            </div>
            <ol className="event-log">
              {logs.map((entry) => (
                <li key={entry.id} className={entry.level}>
                  <time>{entry.timestamp}</time>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </section>
    </main>
  );
}

function CoordinateCard({
  label,
  coordinate,
  detail,
}: {
  label: string;
  coordinate: GpsCoordinate;
  detail: string;
}) {
  return (
    <div className="coordinate-card">
      <span>{label}</span>
      <strong>
        {coordinate.lat.toFixed(6)}, {coordinate.lng.toFixed(6)}
      </strong>
      <small>{detail}</small>
    </div>
  );
}

function UnavailableData({ label }: { label: string }) {
  return (
    <div className="unavailable-row">
      <span>{label}</span>
      <strong>Not connected</strong>
    </div>
  );
}

function CoordinateList({
  committed,
  waypoints,
}: {
  committed: boolean;
  waypoints: ConeWaypoint[];
}) {
  return (
    <div className="coordinate-box">
      <div className="coordinate-state">
        <span>{committed ? "Generated points" : "Live preview"}</span>
        <strong>{waypoints.length} pts</strong>
      </div>
      <ol>
        {waypoints.slice(0, 10).map((waypoint, index) => (
          <li key={waypoint.id}>
            <span className={`cone-index ${waypoint.color}`}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <code>
              {waypoint.coordinate.lat.toFixed(7)},{" "}
              {waypoint.coordinate.lng.toFixed(7)}
            </code>
          </li>
        ))}
      </ol>
    </div>
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

function MapLegend({ hasDevicePosition }: { hasDevicePosition: boolean }) {
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
    </div>
  );
}

function buildConeWaypoints(
  track: TrackPlacement,
  zoom: number,
): ConeWaypoint[] {
  return buildConePositionsMeters().map((cone) => {
    const rotatedPoint = rotatePoint(cone.point, { x: 0, y: 0 }, track.rotation);

    return {
      id: cone.id,
      color: cone.color,
      coordinate: offsetGpsByMeters(
        track.center,
        { x: rotatedPoint.x, y: -rotatedPoint.y },
        zoom,
      ),
    };
  });
}

function buildConePositionsMeters(): Cone[] {
  const conePoints: Cone[] = [];
  const coneRadius = SKIDPAD.outerDiameterMeters / 2;
  const innerConeRadius = SKIDPAD.innerDiameterMeters / 2;
  const coneAngles = [-90, -60, -30, 0, 30, 60, 90, 120, 150, 180, 210, 240];

  for (const angle of coneAngles) {
    const radians = (angle * Math.PI) / 180;
    conePoints.push({
      id: `left-outer-${angle}`,
      color: "blue",
      point: {
        x: -12.5 + Math.cos(radians) * coneRadius,
        y: Math.sin(radians) * coneRadius,
      },
    });
    conePoints.push({
      id: `right-inner-${angle}`,
      color: "yellow",
      point: {
        x: 12.5 + Math.cos(radians) * innerConeRadius,
        y: Math.sin(radians) * innerConeRadius,
      },
    });
  }

  for (const y of [-25, -18, 18, 25]) {
    conePoints.push({
      id: `start-left-${y}`,
      color: "orange",
      point: { x: -1.6, y },
    });
    conePoints.push({
      id: `start-right-${y}`,
      color: "orange",
      point: { x: 1.6, y },
    });
  }

  return conePoints;
}

function buildMapTiles(
  center: GpsCoordinate,
  zoom: number,
  mapSize: Point,
): MapTile[] {
  const tileZoom = Math.min(Math.floor(zoom), MAX_OSM_TILE_ZOOM);
  const tileScale = 2 ** (zoom - tileZoom);
  const centerWorld = gpsToWorldPixel(center, zoom);
  const topLeft = {
    x: centerWorld.x - mapSize.x / 2,
    y: centerWorld.y - mapSize.y / 2,
  };
  const visibleTileSize = TILE_SIZE * tileScale;
  const firstX = Math.floor(topLeft.x / visibleTileSize);
  const lastX = Math.floor((topLeft.x + mapSize.x) / visibleTileSize);
  const firstY = Math.floor(topLeft.y / visibleTileSize);
  const lastY = Math.floor((topLeft.y + mapSize.y) / visibleTileSize);
  const tilesPerAxis = 2 ** tileZoom;
  const tiles: MapTile[] = [];

  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= tilesPerAxis) {
        continue;
      }

      const wrappedX = ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      tiles.push({
        id: `${formatZoom(zoom)}-${tileZoom}-${wrappedX}-${y}`,
        url: `${OSM_TILE_URL}/${tileZoom}/${wrappedX}/${y}.png`,
        left: x * visibleTileSize - topLeft.x,
        top: y * visibleTileSize - topLeft.y,
        size: visibleTileSize,
      });
    }
  }

  return tiles;
}

function formatZoom(zoom: number) {
  return Number.isInteger(zoom) ? String(zoom) : zoom.toFixed(1);
}

function angleBetween(center: Point, point: Point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function normalizeRotation(rotation: number) {
  const normalized = ((rotation + 180) % 360) - 180;
  return Number(normalized.toFixed(1));
}

function formatAccuracy(accuracyMeters: number | null) {
  if (accuracyMeters === null) {
    return "accuracy unknown";
  }

  return `accuracy ±${accuracyMeters} m`;
}
