import {
  IconBox,
  IconCar,
  IconCheckCircle,
  IconContainer,
  IconGlobe,
  IconHeadset,
  IconLayers,
  IconMail,
  IconMapPin,
  IconPlane,
  IconRoute,
  IconSearch,
  IconShieldCheck,
  IconShip,
  IconWarehouse,
  type IconProps,
} from '@/components/icons';

export interface FeatureItem {
  title: string;
  description: string;
  icon: (props: IconProps) => JSX.Element;
}

/** Section 3 "FEATURES" of the build brief — one entry per bullet, grouped loosely by area. No invented metrics anywhere in these descriptions. */
export const featureItems: FeatureItem[] = [
  { title: 'Customer Management', description: 'One record per customer across every shipment, invoice, and communication.', icon: IconHeadset },
  { title: 'Shipment Management', description: 'Track each shipment and every individual item inside it, from booking to delivery.', icon: IconShip },
  { title: 'Barcode / QR Labels', description: 'Print scannable labels for every item the moment it enters your system.', icon: IconSearch },
  { title: 'Warehouse Receiving', description: 'Scan items in at origin, with a permanent record of who received what and when.', icon: IconWarehouse },
  { title: 'Processing / Inspection', description: 'Record condition, weight, and dimensions, and flag exceptions before they become problems.', icon: IconShieldCheck },
  { title: 'Container Loading', description: 'Load inspected items into containers with a running manifest of what is inside.', icon: IconContainer },
  { title: 'Destination Receiving', description: 'Confirm arrival and receipt at destination with the same scan-based accuracy as origin.', icon: IconMapPin },
  { title: 'Pickup / Delivery', description: 'Hand off to the customer or dispatch a driver, with a signed record of completion.', icon: IconCar },
  { title: 'Driver Dispatch', description: 'Assign deliveries to drivers and track completion status.', icon: IconRoute },
  { title: 'Container Management', description: 'See every container’s status, contents, and departure/arrival timeline at a glance.', icon: IconContainer },
  { title: 'Manifest Management', description: 'Build, finalize, and submit manifests tied directly to real loaded items.', icon: IconLayers },
  { title: 'Ocean Freight', description: 'Purpose-built workflows for LCL and FCL ocean shipments.', icon: IconShip },
  { title: 'Air Freight', description: 'A parallel workflow for air cargo, without forcing an ocean-container model onto it.', icon: IconPlane },
  { title: 'RoRo', description: 'Vehicle-specific handling, including title and condition tracking.', icon: IconCar },
  { title: 'Cargo Consolidation', description: 'Combine multiple customers’ items into a single container run.', icon: IconLayers },
  { title: 'Public Shipment Tracking', description: 'A branded tracking page your customers can use without logging in.', icon: IconGlobe },
  { title: 'Customer Portal', description: 'Customers see their own shipments, invoices, documents, and notifications.', icon: IconHeadset },
  { title: 'Invoices', description: 'Issue invoices tied to real shipments, with a running balance-due.', icon: IconCheckCircle },
  { title: 'Payments', description: 'Accept online payments via Stripe, or record cash/bank/mobile money manually.', icon: IconShieldCheck },
  { title: 'Documents', description: 'Store and selectively share bills of lading, customs forms, and photos.', icon: IconBox },
  { title: 'Notifications', description: 'Automatic in-app and email updates at key shipment milestones.', icon: IconMail },
  { title: 'Email / In-App Messaging', description: 'Every customer-facing update lands in both channels, by preference.', icon: IconMail },
  { title: 'Analytics / Owner Dashboard', description: 'Revenue, shipment volume, and exceptions, without needing to be on-site.', icon: IconLayers },
  { title: 'User Roles / Permissions', description: 'Give staff exactly the access their job requires — nothing more.', icon: IconShieldCheck },
  { title: 'Multi-location Support', description: 'Run multiple origin and destination warehouses under one account.', icon: IconWarehouse },
  { title: 'Multi-tenant Security', description: 'Your data is isolated from every other company on the platform, by design.', icon: IconShieldCheck },
  { title: 'AI Training & Support Agent', description: 'A built-in assistant that teaches your staff how to use the system.', icon: IconHeadset },
];

export interface SolutionItem {
  title: string;
  description: string;
  icon: (props: IconProps) => JSX.Element;
}

/** Section 3 "SOLUTIONS" of the build brief. */
export const solutionItems: SolutionItem[] = [
  { title: 'Freight Forwarders', description: 'Run booking, consolidation, and documentation for every mode from one system.', icon: IconGlobe },
  { title: 'Ocean Freight Companies', description: 'Container-first workflows for LCL and FCL operations.', icon: IconShip },
  { title: 'Air Freight Companies', description: 'Manifest-first workflows built for air cargo’s faster cycle.', icon: IconPlane },
  { title: 'RoRo Shipping Companies', description: 'Vehicle intake, title tracking, and RoRo-specific handling.', icon: IconCar },
  { title: 'Consolidation Companies', description: 'Combine many customers’ items into shared container runs with full accountability.', icon: IconLayers },
  { title: 'Warehousing Businesses', description: 'Receiving, inspection, and inventory across one or more locations.', icon: IconWarehouse },
  { title: 'Africa-focused Shipping Companies', description: 'Built with the origin/destination realities of Africa-bound freight in mind.', icon: IconMapPin },
  { title: 'Diaspora Logistics Companies', description: 'Serve customers shipping goods home, with the visibility they expect.', icon: IconGlobe },
];

export interface WorkflowStep {
  label: string;
  description: string;
}

/** Section 3 "HOW IT WORKS" of the build brief. */
export const workflowSteps: WorkflowStep[] = [
  { label: 'Receive', description: 'An item arrives at your origin warehouse and is scanned in.' },
  { label: 'Label', description: 'A barcode/QR label is printed and attached to the item.' },
  { label: 'Inspect', description: 'Condition, weight, and dimensions are recorded; exceptions are flagged.' },
  { label: 'Consolidate', description: 'Items headed to the same destination are grouped together.' },
  { label: 'Load', description: 'Items are loaded into a container (or onto a manifest, for air).' },
  { label: 'Manifest', description: 'A manifest is built and finalized for the loaded group.' },
  { label: 'Depart', description: 'The container or shipment departs origin.' },
  { label: 'Arrive', description: 'The container or shipment arrives at destination.' },
  { label: 'Destination Receive', description: 'Each item is scanned in again at the destination warehouse.' },
  { label: 'Pickup/Delivery', description: 'The item reaches the customer, by pickup or dispatched delivery.' },
];

export const serviceTypeOptions = ['Ocean', 'Air', 'RoRo', 'Consolidation', 'Warehousing', 'Local Delivery'];
