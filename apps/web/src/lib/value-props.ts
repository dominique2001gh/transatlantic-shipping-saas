import type { ComponentType } from 'react';
import type { IconProps } from '@/components/icons';
import { IconGlobe, IconHeadset, IconLayers, IconRoute, IconWarehouse } from '@/components/icons';

export interface ValueProp {
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
}

/** "Why Trans Atlantic" value propositions — qualitative only, no invented metrics. */
export const valueProps: ValueProp[] = [
  {
    title: 'Multiple Freight Options',
    description: 'Ocean, air, and RoRo freight under one account, so you can choose the right option for each shipment.',
    icon: IconGlobe,
  },
  {
    title: 'Shipment Visibility',
    description: 'Status updates from warehouse receipt through to final delivery, not just a single tracking event.',
    icon: IconRoute,
  },
  {
    title: 'Warehousing & Consolidation',
    description: 'A dedicated origin warehouse for receiving, processing, and consolidating cargo before it ships.',
    icon: IconWarehouse,
  },
  {
    title: 'Flexible Shipping Solutions',
    description: 'From a single barrel to commercial freight, our services are built to flex around what you are shipping.',
    icon: IconLayers,
  },
  {
    title: 'Customer-Focused Support',
    description: 'A logistics team that helps you understand your options and keeps you informed along the way.',
    icon: IconHeadset,
  },
];
