export type Point = {
  x: number;
  y: number;
};

export type GpsCoordinate = {
  lat: number;
  lng: number;
};

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function gpsToWorldPixel(coordinate: GpsCoordinate, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLatitude = Math.sin((coordinate.lat * Math.PI) / 180);

  return {
    x: ((coordinate.lng + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
      scale,
  };
}

export function worldPixelToGps(point: Point, zoom: number): GpsCoordinate {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const mercatorY = Math.PI * (1 - (2 * point.y) / scale);
  const lat =
    (Math.atan(0.5 * (Math.exp(mercatorY) - Math.exp(-mercatorY))) * 180) /
    Math.PI;

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

export function mapPointToGps(
  point: Point,
  mapSize: Point,
  center: GpsCoordinate,
  zoom: number,
): GpsCoordinate {
  const centerWorld = gpsToWorldPixel(center, zoom);
  return worldPixelToGps(
    {
      x: centerWorld.x - mapSize.x / 2 + point.x,
      y: centerWorld.y - mapSize.y / 2 + point.y,
    },
    zoom,
  );
}

export function gpsToMapPoint(
  coordinate: GpsCoordinate,
  mapSize: Point,
  center: GpsCoordinate,
  zoom: number,
): Point {
  const centerWorld = gpsToWorldPixel(center, zoom);
  const coordinateWorld = gpsToWorldPixel(coordinate, zoom);

  return {
    x: mapSize.x / 2 + coordinateWorld.x - centerWorld.x,
    y: mapSize.y / 2 + coordinateWorld.y - centerWorld.y,
  };
}

export function metersPerPixel(latitude: number, zoom: number) {
  return (
    (Math.cos((latitude * Math.PI) / 180) * EARTH_CIRCUMFERENCE_METERS) /
    (TILE_SIZE * 2 ** zoom)
  );
}

export function offsetGpsByMeters(
  coordinate: GpsCoordinate,
  offset: Point,
  zoom: number,
): GpsCoordinate {
  const resolution = metersPerPixel(coordinate.lat, zoom);
  const world = gpsToWorldPixel(coordinate, zoom);

  return worldPixelToGps(
    {
      x: world.x + offset.x / resolution,
      y: world.y - offset.y / resolution,
    },
    zoom,
  );
}

export function rotatePoint(point: Point, center: Point, angleDegrees: number) {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}
