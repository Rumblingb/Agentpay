/**
 * Minimal type stub for react-native-maps 1.18.0.
 * Replaced by the real types once `npm install` runs post-EAS-setup.
 */
declare module 'react-native-maps' {
  import React from 'react';
  import { ViewProps } from 'react-native';

  export const PROVIDER_GOOGLE: 'google';

  export interface LatLng {
    latitude: number;
    longitude: number;
  }

  export interface Region extends LatLng {
    latitudeDelta: number;
    longitudeDelta: number;
  }

  export interface MapViewProps extends ViewProps {
    provider?: string;
    customMapStyle?: object[];
    showsUserLocation?: boolean;
    showsMyLocationButton?: boolean;
    showsCompass?: boolean;
    toolbarEnabled?: boolean;
    onRegionChangeComplete?: (region: Region) => void;
  }

  export interface PolylineProps extends ViewProps {
    coordinates: LatLng[];
    strokeColor?: string;
    strokeWidth?: number;
  }

  export interface MarkerProps extends ViewProps {
    coordinate: LatLng;
    title?: string;
    description?: string;
    pinColor?: string;
  }

  export default class MapView extends React.Component<MapViewProps> {
    animateToRegion(region: Region, duration?: number): void;
  }

  export class Polyline extends React.Component<PolylineProps> {}
  export class Marker  extends React.Component<MarkerProps>  {}
}
