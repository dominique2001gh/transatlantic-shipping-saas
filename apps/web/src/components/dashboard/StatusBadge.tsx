import { Badge } from '@/components/ui/Badge';
import { humanizeEnumValue, statusBadgeVariant } from '@/lib/format';

/** Renders any ShipmentStatus/ShipmentItemStatus/etc. value as a labeled, color-coded badge. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusBadgeVariant(status)}>{humanizeEnumValue(status)}</Badge>;
}
