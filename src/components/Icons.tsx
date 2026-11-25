/** Small stroke icons for the navigation (24×24, currentColor). */
import type { ReactNode } from 'react';

export const CameraIcon = () => (
  <Svg>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </Svg>
);
export const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
  </Svg>
);
export const HashIcon = () => (
  <Svg>
    <path d="M9 4 7.5 20M16.5 4 15 20M4.5 9h15M4 15h15" />
  </Svg>
);
export const CalendarIcon = () => (
  <Svg>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);

/** Driver licence card. */
export const IdCardIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="11" r="2" />
    <path d="M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2" />
    <path d="M14 10h4M14 13.5h4" />
  </Svg>
);

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const TruckIcon = () => (
  <Svg>
    <path d="M3 6h11v10H3z" />
    <path d="M14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
);

export const VestIcon = () => (
  <Svg>
    <path d="M8 3 5 5v15h5v-6h4v6h5V5l-3-2-2 4h-4z" />
    <path d="M5 11h5M14 11h5" />
  </Svg>
);

export const ChartIcon = () => (
  <Svg>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16v-5M12 16V8M16 16v-3" />
  </Svg>
);

export const TableIcon = () => (
  <Svg>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
  </Svg>
);

export const GearIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const KeyIcon = () => (
  <Svg>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.8 12.2 8.7-8.7M16 6l2.5 2.5M14 8l2 2" />
  </Svg>
);

export const LogoutIcon = () => (
  <Svg>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Svg>
);

export const ClockIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const HomeIcon = () => (
  <Svg>
    <path d="m3.5 10.5 8.5-7 8.5 7" />
    <path d="M5.5 9v11h13V9" />
    <path d="M10 20v-6h4v6" />
  </Svg>
);

export const ReportIcon = () => (
  <Svg>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1" />
    <path d="M8.5 16v-3M12 16v-6M15.5 16v-4.5" />
  </Svg>
);

/** Photo / picture (used for "รูปภาพ"). */
export const ImageIcon = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" />
  </Svg>
);

/** shop front (store deliveries) */
export const StoreIcon = () => (
  <Svg>
    <path d="M4 9.5 5.5 4.5h13L20 9.5" />
    <path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5" />
    <path d="M5.5 12v7.5h13V12" />
    <path d="M10 19.5v-4.5h4v4.5" />
  </Svg>
);

/** stopwatch (work clock) */
export const TimerIcon = () => (
  <Svg>
    <circle cx="12" cy="13.5" r="7" />
    <path d="M12 13.5V10M10 3.5h4M18 7l1.5-1.5" />
  </Svg>
);

/* ---- summary-card icons (สถานะรถ / PPE / สรุป) ---- */

/** list of results */
export const ListIcon = () => (
  <Svg>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.5" cy="6.5" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="17.5" r="1.2" />
  </Svg>
);
/** passed */
export const CheckCircleIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8 12.3 2.7 2.7L16.2 9.5" />
  </Svg>
);
/** failed / missing */
export const AlertIcon = () => (
  <Svg>
    <path d="M12 3.5 21 19.5H3z" />
    <path d="M12 9.5v4.5M12 16.8v.2" />
  </Svg>
);
/** waiting */
export const HourglassIcon = () => (
  <Svg>
    <path d="M7 3.5h10M7 20.5h10" />
    <path d="M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5" />
  </Svg>
);
/** rejected */
export const XCircleIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Svg>
);
/** approved */
export const BadgeCheckIcon = () => (
  <Svg>
    <path d="M12 3 14.4 5l3.1-.3.7 3 2.6 1.8-1.3 2.8 1.3 2.8-2.6 1.8-.7 3-3.1-.3L12 21l-2.4-2-3.1.3-.7-3-2.6-1.8 1.3-2.8-1.3-2.8 2.6-1.8.7-3 3.1.3z" />
    <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
  </Svg>
);
/** people to check */
export const UsersIcon = () => (
  <Svg>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.9-3 3.2-4.6 6-4.6s5.1 1.6 6 4.6" />
    <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.9c1.7.6 2.9 2 3.5 4.1" />
  </Svg>
);
/** percentage */
export const PercentIcon = () => (
  <Svg>
    <path d="M18.5 5.5 5.5 18.5" />
    <circle cx="7" cy="7" r="2.3" /><circle cx="17" cy="17" r="2.3" />
  </Svg>
);
/** search */
export const SearchIcon = () => (
  <Svg>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Svg>
);
/** address / location */
export const PinIcon = () => (
  <Svg>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
/** phone */
export const PhoneIcon = () => (
  <Svg>
    <path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
  </Svg>
);
/** goods / carried by hand */
export const BoxIcon = () => (
  <Svg>
    <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
    <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
  </Svg>
);
/** trolley */
export const CartIcon = () => (
  <Svg>
    <path d="M3 4.5h2.5l2 10.5h10.5l2-7.5H6.6" />
    <circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" />
  </Svg>
);
/** one more round */
export const RepeatIcon = () => (
  <Svg>
    <path d="M4.5 11.5a7.5 7.5 0 0 1 13-5l2 2M19.5 12.5a7.5 7.5 0 0 1-13 5l-2-2" />
    <path d="M19.5 4v4.5H15M4.5 20v-4.5H9" />
  </Svg>
);
/** download */
export const DownloadIcon = () => (
  <Svg>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
);
/** refresh */
export const RefreshIcon = () => (
  <Svg>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);
/** filled person silhouette for the signed-in user's avatar (head + shoulders, clipped by the round avatar) */
export const PersonAvatar = () => (
  <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true" focusable="false">
    <circle cx="20" cy="15" r="7" fill="currentColor" />
    <path d="M6.5 37c1.2-7.4 6.6-11.5 13.5-11.5S32.3 29.6 33.5 37z" fill="currentColor" />
  </svg>
);
export const LockIcon = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1" />
  </Svg>
);
export const EyeIcon = () => (
  <Svg>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const EyeOffIcon = () => (
  <Svg>
    <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.3M6.6 7.6C4 9.4 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.2" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Svg>
);
