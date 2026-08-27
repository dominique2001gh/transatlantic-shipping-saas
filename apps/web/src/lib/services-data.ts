import type { ComponentType } from 'react';
import { IconCar, IconLayers, IconPlane, IconShip, IconWarehouse } from '@/components/icons';
import type { IconProps } from '@/components/icons';

export interface ServiceStep {
  title: string;
  description: string;
}

export interface ServiceContent {
  slug: string;
  name: string;
  navLabel: string;
  shortDescription: string;
  icon: ComponentType<IconProps>;
  heroKicker: string;
  heroHeadline: string;
  heroDescription: string;
  useCases: string[];
  howItWorks: ServiceStep[];
  benefits: string[];
}

/**
 * Canonical service catalog for the public site. The header's services
 * menu, the /services overview grid, and each /services/[slug] detail
 * page all read from this single list — add a service here and it
 * appears everywhere consistently.
 */
export const services: ServiceContent[] = [
  {
    slug: 'ocean-freight',
    name: 'Ocean Freight',
    navLabel: 'Ocean Freight',
    shortDescription:
      'LCL and FCL ocean freight for cargo of every size, from single pallets to full containers.',
    icon: IconShip,
    heroKicker: 'Ocean Freight',
    heroHeadline: 'Reliable ocean freight, sized to your shipment',
    heroDescription:
      'Whether you are shipping a few boxes or booking a full container, our ocean freight service moves cargo by sea — with the option to consolidate with other shipments (LCL) or book exclusive container space (FCL).',
    useCases: [
      'Businesses shipping commercial inventory internationally',
      'Individuals relocating and shipping household goods',
      'Recurring shippers who need a dependable ocean freight partner',
      'Cargo too large or heavy to move economically by air',
    ],
    howItWorks: [
      {
        title: 'Choose LCL or FCL',
        description:
          'Ship as part of a consolidated load (LCL) or book your own full container (FCL), depending on your cargo volume.',
      },
      {
        title: 'Warehouse receiving',
        description:
          'Your cargo is received, inspected, and measured at our origin warehouse ahead of loading.',
      },
      {
        title: 'Loading and departure',
        description: 'Cargo is loaded into a container and booked onto an ocean vessel for departure.',
      },
      {
        title: 'Destination handling',
        description:
          'On arrival, cargo is processed through customs where applicable and made ready for pickup or delivery.',
      },
    ],
    benefits: [
      'Flexible options for both partial and full container loads',
      'Suited to bulky or heavy cargo that is costly to move by air',
      'Shipment status visibility from warehouse to destination',
      'Consolidation support to help manage shipping costs',
    ],
  },
  {
    slug: 'air-freight',
    name: 'Air Freight',
    navLabel: 'Air Freight',
    shortDescription: 'Faster transit for time-sensitive cargo and smaller high-priority shipments.',
    icon: IconPlane,
    heroKicker: 'Air Freight',
    heroHeadline: 'When speed matters more than size',
    heroDescription:
      'Air freight is built for cargo that needs to move quickly — urgent documents, time-sensitive parts, and smaller shipments where transit time outweighs cost per pound.',
    useCases: [
      'Time-sensitive business shipments',
      'Urgent personal or family shipments',
      'High-value cargo that benefits from a shorter transit window',
      'Smaller shipments where speed matters most',
    ],
    howItWorks: [
      {
        title: 'Drop off or schedule pickup',
        description: 'Get cargo to our origin warehouse for processing ahead of the next available flight.',
      },
      {
        title: 'Documentation and processing',
        description: 'Shipping documents are prepared and cargo is measured and weighed for airway billing.',
      },
      {
        title: 'Flight booking',
        description: 'Cargo is booked onto an available air freight service to the destination market.',
      },
      {
        title: 'Arrival and release',
        description: 'On arrival, cargo is processed for pickup or onward delivery.',
      },
    ],
    benefits: [
      'Significantly shorter transit times than ocean freight',
      'Well suited to urgent or high-priority cargo',
      'Shipment visibility throughout transit',
      'A practical complement to ocean freight for mixed shipping needs',
    ],
  },
  {
    slug: 'lcl',
    name: 'LCL Shipping',
    navLabel: 'LCL Shipping',
    shortDescription: 'Consolidated ocean shipping — pay for the space your cargo uses, not a whole container.',
    icon: IconLayers,
    heroKicker: 'LCL — Less than Container Load',
    heroHeadline: 'Ship only the space you need',
    heroDescription:
      'LCL (less than container load) shipping consolidates your cargo with other shipments heading to the same destination, so you only pay for the container space your goods actually use.',
    useCases: [
      'Shippers with cargo that does not fill a full container',
      'Individuals shipping barrels, boxes, or household goods',
      'Small businesses shipping smaller commercial orders',
      'Anyone looking for a cost-conscious ocean freight option',
    ],
    howItWorks: [
      {
        title: 'Goods received at the warehouse',
        description: 'Your cargo arrives at our origin warehouse and is logged against your shipment.',
      },
      {
        title: 'Measurement and processing',
        description: 'Cargo is measured, weighed, and prepared for consolidation.',
      },
      {
        title: 'Consolidation',
        description:
          'Your shipment is consolidated into a shared container with other LCL cargo heading to the same destination.',
      },
      {
        title: 'Ship, track, and receive',
        description:
          'The consolidated container ships by ocean freight, and your cargo is separated out for pickup or delivery on arrival.',
      },
    ],
    benefits: [
      'A cost-conscious alternative to booking a full container',
      'Practical for smaller and irregular shipment volumes',
      'The same shipment visibility as a full container booking',
      'Works well for both personal and commercial cargo',
    ],
  },
  {
    slug: 'roro',
    name: 'RoRo / Vehicle Shipping',
    navLabel: 'RoRo / Vehicle Shipping',
    shortDescription: 'Roll-on/roll-off vehicle shipping for cars, trucks, and other wheeled vehicles.',
    icon: IconCar,
    heroKicker: 'RoRo Shipping',
    heroHeadline: 'Vehicle shipping, done right',
    heroDescription:
      'RoRo (roll-on/roll-off) shipping is a purpose-built way to move vehicles by ocean freight. Vehicles are driven directly onto a specialized vessel and secured for transit, rather than loaded into a container.',
    useCases: [
      'Individuals shipping a personal vehicle',
      'Dealers and businesses shipping multiple vehicles',
      'Shippers who prefer RoRo over containerized vehicle shipment',
      'Vehicles in drivable condition suited to roll-on/roll-off loading',
    ],
    howItWorks: [
      {
        title: 'Vehicle drop-off',
        description: 'Deliver the vehicle to our origin warehouse ahead of the sailing date.',
      },
      {
        title: 'Inspection and documentation',
        description:
          'The vehicle is inspected, documented, and prepared for RoRo booking, including title status.',
      },
      {
        title: 'Loading',
        description: 'The vehicle is driven onto the RoRo vessel and secured for the voyage.',
      },
      {
        title: 'Arrival and pickup',
        description: 'On arrival, the vehicle is processed through customs where applicable and released for pickup.',
      },
    ],
    benefits: [
      'A purpose-built method for shipping drivable vehicles',
      'Generally a straightforward option for single-vehicle shipments',
      'Shipment status visibility from drop-off to arrival',
      'Works alongside our other freight services for mixed shipping needs',
    ],
  },
  {
    slug: 'warehousing',
    name: 'Warehousing',
    navLabel: 'Warehousing',
    shortDescription: 'Receiving, storage, consolidation, and cross-docking to keep your cargo moving.',
    icon: IconWarehouse,
    heroKicker: 'Warehousing & Consolidation',
    heroHeadline: 'A staging point built for freight, not self-storage',
    heroDescription:
      'Our warehousing service supports the shipping process itself — receiving cargo from multiple sources, holding it briefly, consolidating it with other shipments, and preparing it for the next leg of its journey.',
    useCases: [
      'Consolidating multiple purchases into a single shipment',
      'Businesses that need a receiving point before freight is booked',
      'Cross-docking cargo that is moving straight through to the next carrier',
      'Shippers coordinating drop-to-door delivery after arrival',
    ],
    howItWorks: [
      {
        title: 'Receiving',
        description: 'Cargo arriving from multiple sources is logged in at the warehouse against your account.',
      },
      {
        title: 'Inspection and measurement',
        description: 'Items are checked in, measured, and prepared for the next step in the shipping process.',
      },
      {
        title: 'Consolidation or cross-docking',
        description:
          'Cargo is either held briefly for consolidation with other shipments, or cross-docked straight through to outbound transport.',
      },
      {
        title: 'Ready for freight',
        description: 'Once processed, cargo is staged and booked onto its ocean, air, or RoRo service.',
      },
    ],
    benefits: [
      'A coordinated receiving point ahead of ocean, air, or RoRo shipping',
      'Supports consolidation to help manage shipping costs',
      'Cross-docking available for cargo that needs to move straight through',
      'Works with drop-to-door delivery once cargo arrives at destination',
    ],
  },
];

export function getServiceBySlug(slug: string): ServiceContent | undefined {
  return services.find((service) => service.slug === slug);
}
