import 'imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js';

import routingPointPin from 'assets/images/routing/pin.png';

import WS from 'store/websocket';
import { IsPointInRectangle } from 'utils/misc';
import _ from 'lodash';
import { drawImage, drawRoutingPointArrow, disposeMesh } from 'utils/draw';

export default class RoutingEditor {
  constructor() {
    this.routePoints = [];
    this.parkingInfo = null;
    this.inEditingMode = false;
    this.pointId = 0;
    this.parkingSpaceInfo = [];
    this.arrows = [];
  }

  isInEditingMode() {
    return this.inEditingMode;
  }

  enableEditingMode(camera, adc) {
    this.inEditingMode = true;

    const pov = 'Map';
    camera.fov = PARAMETERS.camera[pov].fov;
    camera.near = PARAMETERS.camera[pov].near;
    camera.far = PARAMETERS.camera[pov].far;

    camera.updateProjectionMatrix();
    WS.requestMapElementIdsByRadius(PARAMETERS.routingEditor.radiusOfMapRequest);
  }

  disableEditingMode(scene) {
    this.inEditingMode = false;
    this.removeAllRoutePoints(scene);
    this.parkingInfo = null;
    this.pointId = 0;
  }

  // defaultRouting
  // true: point comes from default routing should draw arrow based point heading info
  // false: generated by the user on routing editor, the arrow has been drawn
  // only need to bind the heading information
  addRoutingPoint(point, coordinates, scene, defaultRouting = false) {
    const offsetPoint = coordinates.applyOffset({ x: point.x, y: point.y });
    const selectedParkingSpaceIndex = this.isPointInParkingSpace(offsetPoint);
    if (selectedParkingSpaceIndex !== -1) {
      this.parkingSpaceInfo[selectedParkingSpaceIndex].selectedCounts++;
    }
    const pointMesh = drawImage(routingPointPin, 3.5, 3.5, offsetPoint.x, offsetPoint.y, 0.3);
    pointMesh.pointId = this.pointId;
    point.id = this.pointId;
    this.pointId += 1;
    if (defaultRouting && _.isNumber(point.heading)) {
      this.drawRoutingPointArrowWithHeading(point.heading, offsetPoint, scene, 0xff0000);
      pointMesh.arrowMesh = this.arrows.pop();
    }
    if (!defaultRouting) {
      pointMesh.arrowMesh = this.arrows.pop();
      if (pointMesh.arrowMesh) {
        point.heading = pointMesh.arrowMesh.heading;
      }
    }
    this.routePoints.push(pointMesh);
    scene.add(pointMesh);
    WS.checkRoutingPoint(point);
    return selectedParkingSpaceIndex;
  }

  drawRoutingPointArrowWithHeading(heading, origin, scene, hex = 0xff0000) {
    const arrowMesh = drawRoutingPointArrow(origin, hex, heading, 3);
    arrowMesh.heading = heading;
    this.arrows.push(arrowMesh);
    scene.add(arrowMesh);
  }

  drawRoutingPointArrow(currTarget, origin, coordinates, scene, notFirst, hex = 0xff0000) {
    // remove arrows generated during drag and drop
    if (notFirst) {
      const lastArrow = this.arrows.pop();
      disposeMesh(lastArrow);
      scene.remove(lastArrow);
    }
    const offsetOrigin = coordinates.applyOffset(origin);
    const offsetTarget = coordinates.applyOffset(currTarget);
    const heading = Math.atan2(
      offsetTarget.y - offsetOrigin.y, offsetTarget.x - offsetOrigin.x,
    );
    this.drawRoutingPointArrowWithHeading(heading, offsetOrigin, scene, hex);
  }

  setParkingInfo(info) {
    this.parkingInfo = info;
  }

  setParkingSpaceInfo(parkingSpaceInfo, coordinates) {
    this.parkingSpaceInfo = parkingSpaceInfo;
    this.parkingSpaceInfo.forEach((item) => {
      const offsetPoints = item.polygon.point.map(point =>
        coordinates.applyOffset({ x: point.x, y: point.y })
      );
      item.polygon.point = offsetPoints;
      // keep this property to decide change parking space color
      item.selectedCounts = 0;
    });
  }

  removeInvalidRoutingPoint(pointId, msg, scene) {
    let index = -1;
    alert(msg);
    if (pointId) {
      this.routePoints = this.routePoints.filter((point) => {
        if (point.pointId === pointId) {
          index = this.removeRoutingPoint(scene, point);
          return false;
        }
        return true;
      });
    }
    return index;
  }

  removeLastRoutingPoint(scene) {
    const lastPoint = this.routePoints.pop();
    let index = -1;
    if (lastPoint) {
      index = this.removeRoutingPoint(scene, lastPoint);
    }
    return index;
  }

  removeAllRoutePoints(scene) {
    let index = -1;
    const indexArr = [];
    this.routePoints.forEach((object) => {
      index = this.removeRoutingPoint(scene, object);
      if (index !== -1) {
        indexArr.push(index);
      }
    });
    this.routePoints = [];
    this.arrows = [];
    return indexArr;
  }

  removeRoutingPoint(scene, object) {
    let index = this.isPointInParkingSpace(_.get(object, 'position'));
    if (index !== -1) {
      if (--this.parkingSpaceInfo[index].selectedCounts > 0) {
        index = -1;
      }
    }
    if (object.arrowMesh) {
      scene.remove(object.arrowMesh);
      disposeMesh(object.arrowMesh);
    }
    scene.remove(object);
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      object.material.dispose();
    }
    return index;
  }

  // handle object.position or point
  handleRoutingPointObject(object, coordinates, path = null) {
    const point = path ? object[path] : object;
    point.z = 0;
    const offsetPoint = coordinates.applyOffset(point, true);
    const heading = path ? _.get(object, 'arrowMesh.heading', null) : point.heading;
    if (_.isNumber(heading)) {
      offsetPoint.heading = heading;
    }
    return offsetPoint;
  }

  sendRoutingRequest(carOffsetPosition, carHeading, coordinates, routingPoints) {
    // point from routingPoints no need to apply offset
    // parking routing request vs common routing request
    // add dead end junction routing request when select three points
    // and the second point is in dead end junction.
    if (this.routePoints.length === 0 && routingPoints.length === 0) {
      alert('Please provide at least an end point.');
      return false;
    }

    const index = _.isEmpty(this.routePoints) ?
      -1 : this.isPointInParkingSpace(this.routePoints[this.routePoints.length - 1].position);
    const points = _.isEmpty(routingPoints) ?
      this.routePoints.map((object) => {
        object.position.z = 0;
        return coordinates.applyOffset(object.position, true);
      }) : routingPoints.map((point) => {
        point.z = 0;
        return _.pick(point, ['x', 'y', 'z', 'heading']);
      });
    const parkingRoutingRequest = (index !== -1);
    const start = (points.length > 1) ? points[0]
      : coordinates.applyOffset(carOffsetPosition, true);
    // If the starting point comes from routePoints
    // not the location of the car, if there is heading information,
    // it will bring its own heading information, no need to pass start_heading
    const start_heading = (points.length > 1) ? null : carHeading;
    const end = points[points.length - 1];
    const waypoint = (points.length > 1) ? points.slice(1, -1) : [];
    if (parkingRoutingRequest) {
      const { id } = this.parkingSpaceInfo[index];
      const parkingInfo = {
        parkingSpaceId: _.get(id, 'id'),
      };

      WS.sendParkingRequest(
        start, start_heading, waypoint, end, parkingInfo);
    } else {
      WS.requestRoute(start, start_heading, waypoint, end, this.parkingInfo);
    }
    return true;
  }

  sendCycleRoutingRequest(routingName, cycleRoutingPoints, cycleNumber,
    carOffsetPosition, carHeading, coordinates) {
    const points = cycleRoutingPoints.map((point) => {
      point.z = 0;
      const offsetPoint = _.pick(point, ['x', 'y', 'z', 'heading']);
      return offsetPoint;
    });
    const start = coordinates.applyOffset(carOffsetPosition, true);
    const start_heading = carHeading;
    const end = points[points.length - 1];
    const waypoint = (points.length > 1) ? points.slice(0, -1) : [];
    WS.requestDefaultCycleRouting(start, start_heading, waypoint, end, cycleNumber);
    return true;
  }

  addDefaultRouting(routingName, coordinates) {
    if (this.routePoints.length < 1) {
      alert('Please provide at least one end point.');
      return false;
    }

    const points = this.routePoints.map((object) => {
      const point = coordinates.applyOffset(object.position, true);
      const heading = _.get(object, 'arrowMesh.heading', null);
      // the coordinates of default routing are consistent with poi
      if (_.isNumber(heading)) {
        point.heading = heading;
      }
      return point;
    });
    WS.saveDefaultRouting(routingName, points);
  }

  checkCycleRoutingAvailable(cycleRoutingPoints, carPosition, threshold) {
    const start = carPosition;
    const end = cycleRoutingPoints[cycleRoutingPoints.length - 1];
    if (_.isEmpty(start) || _.isEmpty(end)) {
      return false;
    }
    const distance =
      Math.sqrt(Math.pow((end.x - start.x), 2) + Math.pow((end.y - start.y), 2));
    return distance > threshold;
  }

  isPointInParkingSpace(offsetPoint) {
    let index = -1;
    if (!_.isEmpty(this.parkingSpaceInfo) && !_.isEmpty(offsetPoint)) {
      index = _.findIndex(this.parkingSpaceInfo, item =>
        IsPointInRectangle(item.polygon.point, offsetPoint));
    }
    return index;
  }
}