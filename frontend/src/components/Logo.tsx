import React from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'watermark';
  showWordmark?: boolean;
}

export const LogoIsotype: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="alloxentric-grad" x1="2" y1="4" x2="38" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#14B8A6" />
        </linearGradient>
        <linearGradient id="node-glow" x1="14" y1="12" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#99F6E4" />
        </linearGradient>
      </defs>

      {/* Main chat bubble silhouette with modern geometric contour */}
      <path
        d="M6 18C6 11.3726 11.3726 6 18 6H22C28.6274 6 34 11.3726 34 18V21C34 27.6274 28.6274 33 22 33H14L7.5 35.8C6.6 36.2 5.8 35.4 6 34.4L6.8 30.5C6.3 29.1 6 27.6 6 26V18Z"
        fill="url(#alloxentric-grad)"
      />

      {/* Neural network / circuit interconnected nodes inside chat bubble */}
      {/* Circuit track lines */}
      <path
        d="M14 16L20 13L26 17L21 24L14 16Z"
        stroke="#FFFFFF"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 13V23M26 17L17 21"
        stroke="#FFFFFF"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="1.5 1.5"
      />

      {/* Network Nodes / Neurons */}
      <circle cx="14" cy="16" r="2.2" fill="#FFFFFF" />
      <circle cx="20" cy="13" r="2.5" fill="url(#node-glow)" />
      <circle cx="26" cy="17" r="2.2" fill="#FFFFFF" />
      <circle cx="21" cy="24" r="2.6" fill="url(#node-glow)" />
      <circle cx="15.5" cy="23.5" r="1.5" fill="#E0E7FF" fillOpacity="0.9" />

      {/* Subtle pulse ring around primary processing node */}
      <circle cx="20" cy="13" r="4.2" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="0.8" />
    </svg>
  );
};

export const Logo: React.FC<LogoProps> = ({
  className = '',
  size = 'md',
  showWordmark = true,
}) => {
  const iconSize = size === 'sm' ? 26 : size === 'lg' ? 44 : size === 'watermark' ? 180 : 32;

  if (size === 'watermark') {
    return (
      <div className={`pointer-events-none select-none opacity-[0.035] ${className}`}>
        <LogoIsotype size={iconSize} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoIsotype size={iconSize} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[17px] tracking-tight text-[#1E1B4B]">
              Alloxentric
            </span>
            <span className="font-bold text-[17px] tracking-tight bg-gradient-to-r from-[#4F46E5] to-[#14B8A6] bg-clip-text text-transparent">
              SupportHub
            </span>
          </div>
          <span className="text-[10px] font-medium tracking-wider text-[#64748B] uppercase mt-0.5">
            Corestream AI Platform
          </span>
        </div>
      )}
    </div>
  );
};
