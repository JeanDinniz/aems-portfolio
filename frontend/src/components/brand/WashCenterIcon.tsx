interface WashCenterIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function WashCenterIcon({ size = 32, color = '#F5A800', className }: WashCenterIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Arco superior — dois segmentos com gap */}
      <path d="M7 8 A11 11 0 0 1 25 8" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Arco inferior */}
      <path d="M25 24 A11 11 0 0 1 7 24" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Arcos laterais */}
      <path d="M4 12 A13 13 0 0 0 4 20" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M28 20 A13 13 0 0 0 28 12" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Letra A */}
      <path d="M11.5 22 L16 10 L20.5 22" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13.2 18 H18.8" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
