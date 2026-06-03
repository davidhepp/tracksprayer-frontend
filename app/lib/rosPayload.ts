import {
  SKIDPAD,
  type ConeWaypoint,
  type ObstacleBox,
  type RosPayload,
  type TrackPlacement,
} from "./missionTypes";
import { roundGps, roundMeasurement } from "./trackGeometry";

export function buildRosPayload(
  track: TrackPlacement,
  trackScale: number,
  waypoints: ConeWaypoint[],
  obstacles: ObstacleBox[],
): RosPayload {
  return {
    generated_at: new Date().toISOString(),
    track: {
      center: {
        lat: roundGps(track.center.lat),
        lng: roundGps(track.center.lng),
      },
      rotation_degrees: track.rotation,
      scale: Number(trackScale.toFixed(2)),
      dimensions_meters: {
        width: roundMeasurement(SKIDPAD.boundsWidthMeters * trackScale),
        height: roundMeasurement(SKIDPAD.boundsHeightMeters * trackScale),
        outer_diameter: roundMeasurement(SKIDPAD.outerDiameterMeters * trackScale),
        inner_diameter: roundMeasurement(SKIDPAD.innerDiameterMeters * trackScale),
      },
    },
    points_to_mark: waypoints.map((waypoint) => ({
      id: waypoint.id,
      color: waypoint.color,
      lat: roundGps(waypoint.coordinate.lat),
      lon: roundGps(waypoint.coordinate.lng),
    })),
    obstacle_map: obstacles.map((obstacle) => ({
      id: obstacle.id,
      lat_min: obstacle.lat_min,
      lon_min: obstacle.lon_min,
      lat_max: obstacle.lat_max,
      lon_max: obstacle.lon_max,
      corners: {
        northwest: {
          lat: obstacle.lat_max,
          lng: obstacle.lon_min,
        },
        northeast: {
          lat: obstacle.lat_max,
          lng: obstacle.lon_max,
        },
        southeast: {
          lat: obstacle.lat_min,
          lng: obstacle.lon_max,
        },
        southwest: {
          lat: obstacle.lat_min,
          lng: obstacle.lon_min,
        },
      },
    })),
    obstacle_boxes_ros: obstacles.map((obstacle) => ({
      lat_min: obstacle.lat_min,
      lon_min: obstacle.lon_min,
      lat_max: obstacle.lat_max,
      lon_max: obstacle.lon_max,
    })),
  };
}
