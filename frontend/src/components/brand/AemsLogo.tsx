import { AemsIcon } from './AemsIcon';

interface AemsLogoProps {
  size?: number;
  className?: string;
}

export function AemsLogo({ size = 32, className }: AemsLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <AemsIcon size={size} color="#F5A800" />
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
