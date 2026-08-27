import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

/**
 * Minimal hand-rolled icon set — no icon library dependency. Every icon
 * shares the same stroke/viewBox conventions so they drop in consistently
 * anywhere in the app (nav, cards, forms, footer).
 */
function IconBase({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconShip(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 16.5l1.4 4.2a2 2 0 0 0 1.9 1.3h11.4a2 2 0 0 0 1.9-1.3l1.4-4.2" />
      <path d="M5 16.5V9.8l3-1.4V5h2v2.6L12 6.9l2 .7V5h2v3.4l3 1.4v6.7" />
      <path d="M2 16.5h20" />
    </IconBase>
  );
}

export function IconPlane(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </IconBase>
  );
}

export function IconBox(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </IconBase>
  );
}

export function IconBarrel(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="12" cy="5.5" rx="6" ry="2.5" />
      <path d="M6 5.5v13a6 2.5 0 0 0 12 0v-13" />
      <path d="M6 12a6 2.5 0 0 0 12 0" />
    </IconBase>
  );
}

export function IconPallet(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <path d="M3 14h18M3 18h18" />
      <path d="M6 10v8M12 10v8M18 10v8" />
    </IconBase>
  );
}

export function IconCrate(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 3l18 18M21 3L3 21M12 3v18M3 12h18" />
    </IconBase>
  );
}

export function IconCar(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" />
      <rect x="2" y="13" width="20" height="5" rx="1.5" />
      <circle cx="7" cy="18.5" r="1.75" />
      <circle cx="17" cy="18.5" r="1.75" />
    </IconBase>
  );
}

export function IconWarehouse(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
    </IconBase>
  );
}

export function IconTruck(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="1" y="8" width="13" height="8" rx="1" />
      <path d="M14 11h4l3 3v2h-7z" />
      <circle cx="6" cy="18.5" r="1.75" />
      <circle cx="17" cy="18.5" r="1.75" />
    </IconBase>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </IconBase>
  );
}

export function IconRoute(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M5 8.2V13a4 4 0 0 0 4 4h6" />
    </IconBase>
  );
}

export function IconMapPin(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </IconBase>
  );
}

export function IconClock(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </IconBase>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}

export function IconHeadset(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a3 3 0 0 1-3 3h-2" />
    </IconBase>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 5-5" />
    </IconBase>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </IconBase>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9l6 6 6-6" />
    </IconBase>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconBase>
  );
}

export function IconClose(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </IconBase>
  );
}

export function IconMail(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </IconBase>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2C10.5 21 3 13.5 3 6a2 2 0 0 1 2-2z" />
    </IconBase>
  );
}

export function IconGear(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </IconBase>
  );
}

export function IconHome(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-6h4v6" />
    </IconBase>
  );
}

export function IconContainer(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M7 6v12M11 6v12M15 6v12M19 6v12" />
    </IconBase>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </IconBase>
  );
}
