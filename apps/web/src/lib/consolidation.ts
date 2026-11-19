import type {
  DimensionUnit,
  ShipmentItemType,
  ShipmentMode,
  ShipmentSummary,
  WeightUnit,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';
import type { RecipientInput } from './shipments';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export interface ConsolidationAllocationInput {
  receivingRecordId: string;
  quantity: number;
}

export interface ConsolidationBoxInput {
  itemType: ShipmentItemType;
  description?: string;
  quantity?: number;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: DimensionUnit;
  weight?: number;
  weightUnit?: WeightUnit;
  declaredValue?: number;
  allocations: ConsolidationAllocationInput[];
}

export interface ConsolidateInput extends RecipientInput {
  customerId: string;
  shipmentMode: ShipmentMode;
  destinationCountry: string;
  destinationLocation?: string;
  originWarehouseId: string;
  destinationWarehouseId?: string;
  description?: string;
  boxes: ConsolidationBoxInput[];
}

export function consolidate(input: ConsolidateInput): Promise<ShipmentSummary> {
  return apiFetch<ShipmentSummary>('/consolidation', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}
