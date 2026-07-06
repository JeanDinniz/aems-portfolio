import { WashCenterIcon } from './WashCenterIcon';

interface WashCenterLogoProps {
  size?: number;
  className?: string;
}

export function WashCenterLogo({ size = 32, className }: WashCenterLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <WashCenterIcon size={size} color="#F5A800" />
      <div>
        <div className="font-display font-bold text-base leading-none">
          <span className="text-white">wash</span>
          <span style={{ color: '#F5A800' }}>center</span>
        </div>
        <div className="text-[10px] tracking-widest text-[#555] uppercase mt-0.5">
          estética automotiva
        </div>
      </div>
    </div>
  );
}
