import type { GpsCoordinate, Point } from "./mapMath";

export const MAP_SIZE: Point = { x: 1000, y: 680 };
export const TILE_SIZE = 256;
export const DEFAULT_ZOOM = 18;
export const MIN_ZOOM = 16;
export const MAX_ZOOM = 20;
export const ZOOM_STEP = 0.5;
export const MAX_OSM_TILE_ZOOM = 19;
export const MAX_LOG_ENTRIES = 8;
export const OSM_TILE_URL = "https://tile.openstreetmap.org";
export const SCHWEINFURT_CENTER: GpsCoordinate = {
  lat: 50.04937,
  lng: 10.22175,
};
export const MIN_TRACK_SCALE = 0.1;
export const MAX_TRACK_SCALE = 1;
export const MIN_OBSTACLE_SIZE_PX = 8;

export const SKIDPAD = {
  outerDiameterMeters: 25,
  innerDiameterMeters: 15,
  centerDistanceMeters: 25,
  boundsWidthMeters: 56,
  boundsHeightMeters: 62,
};

export type TrackPlacement = {
  center: GpsCoordinate;
  rotation: number;
};

export type DragState =
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
    }
  | {
      type: "obstacle";
      startPoint: Point;
      currentPoint: Point;
    };

export type EditorMode = "navigate" | "obstacle";

export type DevicePosition = {
  coordinate: GpsCoordinate;
  accuracyMeters: number | null;
  acquiredAt: string;
};

export type Cone = {
  id: string;
  point: Point;
  color: "blue" | "yellow" | "orange";
};

export type ConeWaypoint = {
  id: string;
  color: Cone["color"];
  coordinate: GpsCoordinate;
};

export type ObstacleBox = {
  id: string;
  lat_min: number;
  lon_min: number;
  lat_max: number;
  lon_max: number;
};

export type MapRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type VisibleObstacleBox = {
  obstacle: ObstacleBox;
  rect: MapRect;
};

export type RosPayload = {
  generated_at: string;
  track: {
    center: GpsCoordinate;
    rotation_degrees: number;
    scale: number;
    dimensions_meters: {
      width: number;
      height: number;
      outer_diameter: number;
      inner_diameter: number;
    };
  };
  points_to_mark: Array<{
    id: string;
    color: Cone["color"];
    lat: number;
    lon: number;
  }>;
  obstacle_map: Array<{
    id: string;
    lat_min: number;
    lon_min: number;
    lat_max: number;
    lon_max: number;
    corners: {
      northwest: GpsCoordinate;
      northeast: GpsCoordinate;
      southeast: GpsCoordinate;
      southwest: GpsCoordinate;
    };
  }>;
  obstacle_boxes_ros: Array<{
    lat_min: number;
    lon_min: number;
    lat_max: number;
    lon_max: number;
  }>;
};

export type MapTile = {
  id: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

export type LocationSearchResult = {
  id: string;
  label: string;
  coordinate: GpsCoordinate;
};
