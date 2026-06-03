import type { GpsCoordinate, Point } from "./mapMath";
import {
  gpsToMapPoint,
  gpsToWorldPixel,
  mapPointToGps,
  offsetGpsByMeters,
  rotatePoint,
  worldPixelToGps,
} from "./mapMath";
import {
  MAP_SIZE,
  MAX_OSM_TILE_ZOOM,
  OSM_TILE_URL,
  SKIDPAD,
  TILE_SIZE,
  type Cone,
  type ConeWaypoint,
  type MapRect,
  type MapTile,
  type ObstacleBox,
  type TrackPlacement,
} from "./missionTypes";

export function buildConeWaypoints(
  track: TrackPlacement,
  trackScale: number,
  zoom: number,
): ConeWaypoint[] {
  return buildConePositionsMeters().map((cone) => {
    const scaledPoint = {
      x: cone.point.x * trackScale,
      y: cone.point.y * trackScale,
    };
    const rotatedPoint = rotatePoint(scaledPoint, { x: 0, y: 0 }, track.rotation);

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

export function buildConePositionsMeters(): Cone[] {
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

export function pointsToRect(startPoint: Point, endPoint: Point): MapRect {
  return {
    left: Math.min(startPoint.x, endPoint.x),
    top: Math.min(startPoint.y, endPoint.y),
    width: Math.abs(endPoint.x - startPoint.x),
    height: Math.abs(endPoint.y - startPoint.y),
  };
}

export function mapRectToObstacleBox(
  rect: MapRect,
  mapSize: Point,
  mapCenter: GpsCoordinate,
  zoom: number,
): ObstacleBox {
  const northwest = mapPointToGps(
    { x: rect.left, y: rect.top },
    mapSize,
    mapCenter,
    zoom,
  );
  const southeast = mapPointToGps(
    { x: rect.left + rect.width, y: rect.top + rect.height },
    mapSize,
    mapCenter,
    zoom,
  );

  return {
    id: `obstacle-${Date.now()}-${Math.round(rect.left)}-${Math.round(rect.top)}`,
    lat_min: roundGps(Math.min(northwest.lat, southeast.lat)),
    lon_min: roundGps(Math.min(northwest.lng, southeast.lng)),
    lat_max: roundGps(Math.max(northwest.lat, southeast.lat)),
    lon_max: roundGps(Math.max(northwest.lng, southeast.lng)),
  };
}

export function obstacleBoxToMapRect(
  obstacle: ObstacleBox,
  mapCenter: GpsCoordinate,
  zoom: number,
) {
  const northwest = gpsToMapPoint(
    { lat: obstacle.lat_max, lng: obstacle.lon_min },
    MAP_SIZE,
    mapCenter,
    zoom,
  );
  const southeast = gpsToMapPoint(
    { lat: obstacle.lat_min, lng: obstacle.lon_max },
    MAP_SIZE,
    mapCenter,
    zoom,
  );

  return pointsToRect(northwest, southeast);
}

export function buildMapTiles(
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

export function zoomAroundAnchor({
  anchor,
  currentCenter,
  currentZoom,
  nextZoom,
  mapSize,
}: {
  anchor: Point;
  currentCenter: GpsCoordinate;
  currentZoom: number;
  nextZoom: number;
  mapSize: Point;
}) {
  const anchorGps = mapPointToGps(anchor, mapSize, currentCenter, currentZoom);
  const anchorWorldAtNextZoom = gpsToWorldPixel(anchorGps, nextZoom);

  return worldPixelToGps(
    {
      x: anchorWorldAtNextZoom.x + mapSize.x / 2 - anchor.x,
      y: anchorWorldAtNextZoom.y + mapSize.y / 2 - anchor.y,
    },
    nextZoom,
  );
}

export function formatZoom(zoom: number) {
  return Number.isInteger(zoom) ? String(zoom) : zoom.toFixed(1);
}

export function angleBetween(center: Point, point: Point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function normalizeRotation(rotation: number) {
  const normalized = ((rotation + 180) % 360) - 180;
  return Number(normalized.toFixed(1));
}

export function roundGps(value: number) {
  return Number(value.toFixed(7));
}

export function roundMeasurement(value: number) {
  return Number(value.toFixed(2));
}

export function formatAccuracy(accuracyMeters: number | null) {
  if (accuracyMeters === null) {
    return "accuracy unknown";
  }

  return `accuracy +/-${accuracyMeters} m`;
}
