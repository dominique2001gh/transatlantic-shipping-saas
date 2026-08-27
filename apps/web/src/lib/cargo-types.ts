import type { ComponentType } from 'react';
import type { IconProps } from '@/components/icons';
import { IconBarrel, IconBox, IconCar, IconContainer, IconCrate, IconGear, IconHome, IconPallet } from '@/components/icons';

export interface CargoType {
  label: string;
  icon: ComponentType<IconProps>;
}

/** "What We Ship" categories shown on the homepage. */
export const cargoTypes: CargoType[] = [
  { label: 'Boxes', icon: IconBox },
  { label: 'Barrels', icon: IconBarrel },
  { label: 'Pallets', icon: IconPallet },
  { label: 'Crates', icon: IconCrate },
  { label: 'Household Goods', icon: IconHome },
  { label: 'Vehicles', icon: IconCar },
  { label: 'Commercial Cargo', icon: IconContainer },
  { label: 'Machinery', icon: IconGear },
];
