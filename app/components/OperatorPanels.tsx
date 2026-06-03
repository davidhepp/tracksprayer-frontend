import type { ChangeEvent, FormEvent } from "react";

import type { LogEntry } from "../lib/logger";
import type { GpsCoordinate } from "../lib/mapMath";
import {
  MAX_TRACK_SCALE,
  MIN_TRACK_SCALE,
  SKIDPAD,
  type ConeWaypoint,
  type DevicePosition,
  type EditorMode,
  type LocationSearchResult,
  type ObstacleBox,
  type TrackPlacement,
} from "../lib/missionTypes";
import { formatAccuracy } from "../lib/trackGeometry";

type MissionControlsProps = {
  mapCenter: GpsCoordinate;
  devicePosition: DevicePosition | null;
  searchQuery: string;
  searchResults: LocationSearchResult[];
  searchError: string | null;
  isSearching: boolean;
  track: TrackPlacement;
  trackScale: number;
  trackWarning: string | null;
  editorMode: EditorMode;
  obstacleCount: number;
  coneWaypointsCount: number;
  plannedConeWaypoints: ConeWaypoint[];
  onSearchSubmit: (event: FormEvent) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectLocation: (result: LocationSearchResult) => void;
  onRequestDeviceLocation: () => void;
  onRotationChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTrackScaleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onResetTrack: () => void;
  onGenerateRoute: () => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onClearObstacles: () => void;
};

type DebugPanelProps = {
  logs: LogEntry[];
  obstacleBoxes: ObstacleBox[];
  rosPayloadJson: string;
  onRemoveObstacle: (id: string) => void;
  onCopyRosPayload: () => void;
};

export function MissionControls({
  mapCenter,
  devicePosition,
  searchQuery,
  searchResults,
  searchError,
  isSearching,
  track,
  trackScale,
  trackWarning,
  editorMode,
  obstacleCount,
  coneWaypointsCount,
  plannedConeWaypoints,
  onSearchSubmit,
  onSearchQueryChange,
  onSelectLocation,
  onRequestDeviceLocation,
  onRotationChange,
  onTrackScaleChange,
  onResetTrack,
  onGenerateRoute,
  onEditorModeChange,
  onClearObstacles,
}: MissionControlsProps) {
  return (
    <aside className="control-panel" aria-label="Mission controls">
      <LocationPanel
        devicePosition={devicePosition}
        isSearching={isSearching}
        mapCenter={mapCenter}
        searchError={searchError}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onRequestDeviceLocation={onRequestDeviceLocation}
        onSearchQueryChange={onSearchQueryChange}
        onSearchSubmit={onSearchSubmit}
        onSelectLocation={onSelectLocation}
      />
      <TrackSetupPanel
        track={track}
        trackScale={trackScale}
        trackWarning={trackWarning}
        onGenerateRoute={onGenerateRoute}
        onResetTrack={onResetTrack}
        onRotationChange={onRotationChange}
        onTrackScaleChange={onTrackScaleChange}
      />
      <ObstacleEditorPanel
        editorMode={editorMode}
        obstacleCount={obstacleCount}
        onClearObstacles={onClearObstacles}
        onEditorModeChange={onEditorModeChange}
      />
      <section className="panel-section">
        <div className="section-heading">
          <p className="eyebrow">Output preview</p>
          <h2>Cone spray points</h2>
        </div>
        <CoordinateList
          committed={coneWaypointsCount > 0}
          waypoints={plannedConeWaypoints}
        />
      </section>
    </aside>
  );
}

export function DebugPanel({
  logs,
  obstacleBoxes,
  rosPayloadJson,
  onRemoveObstacle,
  onCopyRosPayload,
}: DebugPanelProps) {
  return (
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
        <ObstacleList obstacles={obstacleBoxes} onRemove={onRemoveObstacle} />
      </section>

      <section className="panel-section">
        <div className="section-heading export-heading">
          <div>
            <p className="eyebrow">Debug export</p>
            <h2>ROS JSON</h2>
          </div>
          <button
            type="button"
            className="secondary-button small-button"
            onClick={onCopyRosPayload}
          >
            Copy
          </button>
        </div>
        <pre className="json-output">{rosPayloadJson}</pre>
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
  );
}

function LocationPanel({
  mapCenter,
  devicePosition,
  searchQuery,
  searchResults,
  searchError,
  isSearching,
  onSearchSubmit,
  onSearchQueryChange,
  onSelectLocation,
  onRequestDeviceLocation,
}: {
  mapCenter: GpsCoordinate;
  devicePosition: DevicePosition | null;
  searchQuery: string;
  searchResults: LocationSearchResult[];
  searchError: string | null;
  isSearching: boolean;
  onSearchSubmit: (event: FormEvent) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectLocation: (result: LocationSearchResult) => void;
  onRequestDeviceLocation: () => void;
}) {
  return (
    <section className="panel-section">
      <div className="section-heading">
        <p className="eyebrow">Real map source</p>
        <h2>Location</h2>
      </div>
      <form className="location-search" onSubmit={onSearchSubmit}>
        <label htmlFor="location-search">Search location</label>
        <div>
          <input
            id="location-search"
            name="location-search"
            placeholder="Schweinfurt, Germany"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
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
              <button type="button" onClick={() => onSelectLocation(result)}>
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
        onClick={onRequestDeviceLocation}
      >
        Use device GPS
      </button>
    </section>
  );
}

function TrackSetupPanel({
  track,
  trackScale,
  trackWarning,
  onRotationChange,
  onTrackScaleChange,
  onResetTrack,
  onGenerateRoute,
}: {
  track: TrackPlacement;
  trackScale: number;
  trackWarning: string | null;
  onRotationChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTrackScaleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onResetTrack: () => void;
  onGenerateRoute: () => void;
}) {
  return (
    <section className="panel-section">
      <div className="section-heading">
        <p className="eyebrow">Track overlay</p>
        <h2>Skidpad setup</h2>
      </div>
      <div className="dimension-list">
        <span>Scale: {Math.round(trackScale * 100)}%</span>
        <span>
          Size: {(SKIDPAD.boundsWidthMeters * trackScale).toFixed(1)} x{" "}
          {(SKIDPAD.boundsHeightMeters * trackScale).toFixed(1)} m
        </span>
        <span>
          Outer circle: {(SKIDPAD.outerDiameterMeters * trackScale).toFixed(1)} m
        </span>
      </div>
      <label className="range-control">
        <span>Rotation</span>
        <input
          min="-180"
          max="180"
          step="1"
          type="range"
          value={track.rotation}
          onChange={onRotationChange}
        />
        <strong>{track.rotation} deg</strong>
      </label>
      <label className="range-control">
        <span>Scale</span>
        <input
          min={MIN_TRACK_SCALE}
          max={MAX_TRACK_SCALE}
          step="0.05"
          type="range"
          value={trackScale}
          onChange={onTrackScaleChange}
        />
        <strong>{Math.round(trackScale * 100)}%</strong>
      </label>
      {trackWarning && (
        <p className="warning-banner" role="status">
          {trackWarning}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={onResetTrack}>
          Reset
        </button>
        <button type="button" className="primary-button" onClick={onGenerateRoute}>
          Go
        </button>
      </div>
    </section>
  );
}

function ObstacleEditorPanel({
  editorMode,
  obstacleCount,
  onEditorModeChange,
  onClearObstacles,
}: {
  editorMode: EditorMode;
  obstacleCount: number;
  onEditorModeChange: (mode: EditorMode) => void;
  onClearObstacles: () => void;
}) {
  return (
    <section className="panel-section">
      <div className="section-heading compact-heading">
        <p className="eyebrow">Obstacle editor</p>
        <h2>Rectangle boxes</h2>
      </div>
      <div className="mode-toggle" role="group" aria-label="Map interaction mode">
        <button
          type="button"
          className={editorMode === "navigate" ? "is-active" : ""}
          onClick={() => onEditorModeChange("navigate")}
        >
          Move map
        </button>
        <button
          type="button"
          className={editorMode === "obstacle" ? "is-active" : ""}
          onClick={() => onEditorModeChange("obstacle")}
        >
          Draw obstacle
        </button>
      </div>
      <div className="button-row compact-buttons">
        <button
          type="button"
          className="secondary-button"
          disabled={obstacleCount === 0}
          onClick={onClearObstacles}
        >
          Clear boxes
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onEditorModeChange("navigate")}
        >
          Done
        </button>
      </div>
      <p className="helper-text">
        {editorMode === "obstacle"
          ? "Drag on the map to create an obstacle rectangle."
          : `${obstacleCount} obstacle box(es) in the ROS export.`}
      </p>
    </section>
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

function ObstacleList({
  obstacles,
  onRemove,
}: {
  obstacles: ObstacleBox[];
  onRemove: (id: string) => void;
}) {
  if (obstacles.length === 0) {
    return (
      <p className="empty-state">
        Draw a rectangle on the map to create ROS obstacle boxes.
      </p>
    );
  }

  return (
    <ol className="obstacle-list">
      {obstacles.map((obstacle, index) => (
        <li key={obstacle.id}>
          <div>
            <span>Obstacle {index + 1}</span>
            <code>
              lat {obstacle.lat_min.toFixed(7)} to {obstacle.lat_max.toFixed(7)}
              <br />
              lon {obstacle.lon_min.toFixed(7)} to {obstacle.lon_max.toFixed(7)}
            </code>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => onRemove(obstacle.id)}
            aria-label={`Remove obstacle ${index + 1}`}
          >
            x
          </button>
        </li>
      ))}
    </ol>
  );
}
