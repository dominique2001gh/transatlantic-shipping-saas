import type { ComponentType } from 'react';
import type { IconProps } from '@/components/icons';
import {
  IconCheckCircle,
  IconContainer,
  IconLayers,
  IconMapPin,
  IconRoute,
  IconShieldCheck,
  IconShip,
  IconTruck,
  IconWarehouse,
} from '@/components/icons';

export interface ProcessStep {
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
}

/** Condensed 7-step version shown on the homepage. */
export const homeProcessSteps: ProcessStep[] = [
  {
    title: 'Arrange Shipment',
    description: 'Request a quote and let us know what you are shipping and where it is going.',
    icon: IconCheckCircle,
  },
  {
    title: 'Goods Received',
    description: 'Your cargo arrives at our origin warehouse and is logged against your shipment.',
    icon: IconWarehouse,
  },
  {
    title: 'Prepare & Consolidate',
    description: 'Items are measured, processed, and consolidated where applicable.',
    icon: IconLayers,
  },
  {
    title: 'Ship',
    description: 'Your shipment is booked and moves by ocean, air, or RoRo freight.',
    icon: IconShip,
  },
  {
    title: 'Track',
    description: 'Follow shipment status from departure through to arrival.',
    icon: IconRoute,
  },
  {
    title: 'Arrival',
    description: 'Cargo arrives at destination and is processed for release.',
    icon: IconMapPin,
  },
  {
    title: 'Pickup / Delivery',
    description: 'Collect your shipment, or arrange drop-to-door delivery.',
    icon: IconTruck,
  },
];

/** Full 11-step version shown on /how-it-works, detailed enough to map onto the real shipment workflow later. */
export const fullProcessSteps: ProcessStep[] = [
  {
    title: 'Create / Request Shipment',
    description: 'Tell us what you are shipping, and where it is coming from and going to.',
    icon: IconCheckCircle,
  },
  {
    title: 'Goods Delivered to Warehouse',
    description: 'Bring or send your cargo to our origin warehouse ahead of shipping.',
    icon: IconWarehouse,
  },
  {
    title: 'Warehouse Receiving',
    description: 'Cargo is checked in and logged against your shipment record.',
    icon: IconWarehouse,
  },
  {
    title: 'Measurement / Processing',
    description: 'Items are measured, weighed, and prepared for the next step.',
    icon: IconLayers,
  },
  {
    title: 'Consolidation',
    description: 'Where applicable, cargo is consolidated with other shipments heading to the same destination.',
    icon: IconLayers,
  },
  {
    title: 'Booking / Loading',
    description: 'Your shipment is booked onto its ocean, air, or RoRo service and loaded for departure.',
    icon: IconContainer,
  },
  {
    title: 'Departure',
    description: 'The vessel, aircraft, or vehicle carrying your shipment departs origin.',
    icon: IconShip,
  },
  {
    title: 'Tracking',
    description: 'Shipment status is updated as your cargo moves toward its destination.',
    icon: IconRoute,
  },
  {
    title: 'Destination Arrival',
    description: 'Your shipment arrives in the destination country or port.',
    icon: IconMapPin,
  },
  {
    title: 'Customs (Where Applicable)',
    description: 'Cargo is processed through destination customs procedures where required.',
    icon: IconShieldCheck,
  },
  {
    title: 'Pickup / Delivery',
    description: 'Collect your shipment, or arrange drop-to-door delivery to its final destination.',
    icon: IconTruck,
  },
];
