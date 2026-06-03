import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
} from "react";

import { DebugPanel, MissionControls } from "../components/OperatorPanels";
import { TrackMap } from "../components/TrackMap";
import { createLogEntry, writeConsoleLog } from "../lib/logger";
import type { GpsCoordinate, Point } from "../lib/mapMath";
import {
  clamp,
  gpsToMapPoint,
  gpsToWorldPixel,
  mapPointToGps,
  metersPerPixel,
  worldPixelToGps,
} from "../lib/mapMath";
import {
  DEFAULT_ZOOM,
  MAP_SIZE,
  MAX_LOG_ENTRIES,
  MAX_TRACK_SCALE,
  MAX_ZOOM,
  MIN_OBSTACLE_SIZE_PX,
  MIN_TRACK_SCALE,
  MIN_ZOOM,
  OSM_TILE_URL,
  SCHWEINFURT_CENTER,
  SKIDPAD,
  ZOOM_STEP,
  type DevicePosition,
  type ConeWaypoint,
  type DragState,
  type EditorMode,
  type LocationSearchResult,
  type ObstacleBox,
  type TrackPlacement,
} from "../lib/missionTypes";
import { buildRosPayload } from "../lib/rosPayload";
import {
  angleBetween,
  buildConeWaypoints,
  buildMapTiles,
  formatZoom,
  mapRectToObstacleBox,
  normalizeRotation,
  obstacleBoxToMapRect,
  pointsToRect,
  zoomAroundAnchor,
} from "../lib/trackGeometry";
import type { Route } from "./+types/home";

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
  const [trackScale, setTrackScale] = useState(1);
  const [editorMode, setEditorMode] = useState<EditorMode>("navigate");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [coneWaypoints, setConeWaypoints] = useState<ConeWaypoint[]>([]);
  const [obstacleBoxes, setObstacleBoxes] = useState<ObstacleBox[]>([]);
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
      x: (SKIDPAD.boundsWidthMeters * trackScale) / trackResolution,
      y: (SKIDPAD.boundsHeightMeters * trackScale) / trackResolution,
    }),
    [trackResolution, trackScale],
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
      return "Current zoom makes the scaled skidpad larger than the visible map.";
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
    () => buildConeWaypoints(track, trackScale, zoom),
    [track, trackScale, zoom],
  );
  const plannedConeWaypoints =
    coneWaypoints.length > 0
      ? coneWaypoints
      : previewConeWaypoints.slice(0, 10);
  const visibleObstacleBoxes = useMemo(
    () =>
      obstacleBoxes
        .map((obstacle) => ({
          obstacle,
          rect: obstacleBoxToMapRect(obstacle, mapCenter, zoom),
        }))
        .filter(
          ({ rect }) =>
            rect.left + rect.width >= 0 &&
            rect.top + rect.height >= 0 &&
            rect.left <= MAP_SIZE.x &&
            rect.top <= MAP_SIZE.y,
        ),
    [mapCenter, obstacleBoxes, zoom],
  );
  const draftObstacleRect =
    dragState?.type === "obstacle"
      ? pointsToRect(dragState.startPoint, dragState.currentPoint)
      : null;
  const rosPayload = useMemo(
    () => buildRosPayload(track, trackScale, previewConeWaypoints, obstacleBoxes),
    [obstacleBoxes, previewConeWaypoints, track, trackScale],
  );
  const rosPayloadJson = useMemo(
    () => JSON.stringify(rosPayload, null, 2),
    [rosPayload],
  );

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

  const handleTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (editorMode === "obstacle") {
      return;
    }

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

  const handleRotatePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (editorMode === "obstacle") {
      return;
    }

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

  const handleMapPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const point = toMapPoint(event.clientX, event.clientY);

    if (editorMode === "obstacle") {
      setDragState({
        type: "obstacle",
        startPoint: point,
        currentPoint: point,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    setDragState({
      type: "map",
      startPoint: point,
      startCenter: mapCenter,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMapPointerMove = (event: PointerEvent<HTMLDivElement>) => {
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

    if (dragState.type === "obstacle") {
      setDragState({ ...dragState, currentPoint: point });
      return;
    }

    panMap(point, dragState.startPoint, dragState.startCenter);
  };

  const handleMapPointerUp = () => {
    if (!dragState) {
      return;
    }

    if (dragState.type === "obstacle") {
      const rect = pointsToRect(dragState.startPoint, dragState.currentPoint);

      if (rect.width >= MIN_OBSTACLE_SIZE_PX && rect.height >= MIN_OBSTACLE_SIZE_PX) {
        const obstacle = mapRectToObstacleBox(rect, MAP_SIZE, mapCenter, zoom);
        setObstacleBoxes((current) => [...current, obstacle]);
        addLog("info", "Obstacle rectangle added.", obstacle);
      } else {
        addLog("warn", "Obstacle rectangle ignored because it was too small.");
      }
    }

    setDragState(null);
  };

  const handleRotationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rotation = Number(event.target.value);
    setTrack((current) => ({ ...current, rotation }));
    setConeWaypoints([]);
    addLog("info", `Track rotation set to ${rotation} degrees.`);
  };

  const handleTrackScaleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const scale = clamp(
      Number(event.target.value),
      MIN_TRACK_SCALE,
      MAX_TRACK_SCALE,
    );
    setTrackScale(scale);
    setConeWaypoints([]);
    addLog("info", `Track test scale set to ${Math.round(scale * 100)}%.`);
  };

  const handleGenerateRoute = () => {
    const waypoints = buildConeWaypoints(track, trackScale, zoom);
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

  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode);
    setDragState(null);
  };

  const clearObstacles = () => {
    setObstacleBoxes([]);
    addLog("info", "Obstacle map cleared.");
  };

  const removeObstacle = (id: string) => {
    setObstacleBoxes((current) =>
      current.filter((obstacle) => obstacle.id !== id),
    );
    addLog("info", "Obstacle rectangle removed.", { id });
  };

  const copyRosPayload = async () => {
    try {
      await navigator.clipboard.writeText(rosPayloadJson);
      addLog("info", "ROS debug JSON copied to clipboard.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Clipboard copy failed.";
      addLog("warn", message);
    }
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

    setZoom(constrainedZoom);
    setMapCenter(
      zoomAroundAnchor({
        anchor,
        currentCenter: mapCenter,
        currentZoom: zoom,
        nextZoom: constrainedZoom,
        mapSize: MAP_SIZE,
      }),
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

  const handleLocationSearch = async (event: FormEvent) => {
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

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);
    setSearchError(null);
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
        <MissionControls
          coneWaypointsCount={coneWaypoints.length}
          devicePosition={devicePosition}
          editorMode={editorMode}
          isSearching={isSearching}
          mapCenter={mapCenter}
          obstacleCount={obstacleBoxes.length}
          plannedConeWaypoints={plannedConeWaypoints}
          searchError={searchError}
          searchQuery={searchQuery}
          searchResults={searchResults}
          track={track}
          trackScale={trackScale}
          trackWarning={trackWarning}
          onClearObstacles={clearObstacles}
          onEditorModeChange={handleEditorModeChange}
          onGenerateRoute={handleGenerateRoute}
          onRequestDeviceLocation={requestDeviceLocation}
          onResetTrack={resetTrack}
          onRotationChange={handleRotationChange}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchSubmit={handleLocationSearch}
          onSelectLocation={selectLocation}
          onTrackScaleChange={handleTrackScaleChange}
        />

        <TrackMap
          devicePosition={devicePosition}
          draftObstacleRect={draftObstacleRect}
          dragState={dragState}
          editorMode={editorMode}
          mapCenter={mapCenter}
          mapRef={mapRef}
          mapTiles={mapTiles}
          obstacleCount={obstacleBoxes.length}
          track={track}
          trackSize={trackSize}
          trackTopLeft={trackTopLeft}
          visibleObstacleBoxes={visibleObstacleBoxes}
          zoom={zoom}
          onMapPointerDown={handleMapPointerDown}
          onMapPointerMove={handleMapPointerMove}
          onMapPointerUp={handleMapPointerUp}
          onRotatePointerDown={handleRotatePointerDown}
          onTrackPointerDown={handleTrackPointerDown}
          onZoomChange={changeZoom}
        />

        <DebugPanel
          logs={logs}
          obstacleBoxes={obstacleBoxes}
          rosPayloadJson={rosPayloadJson}
          onCopyRosPayload={copyRosPayload}
          onRemoveObstacle={removeObstacle}
        />
      </section>
    </main>
  );
}
