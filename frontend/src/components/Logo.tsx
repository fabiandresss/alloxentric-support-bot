import React from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'watermark';
  showWordmark?: boolean;
}

/** Icono de marca: burbuja de chat cherry con un destello de IA centrado en el cuerpo de la burbuja. Es el favicon. */
export const LogoIsotype: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="alloxentric"
    className={`shrink-0 ${className}`}
  >
    <path d="M8 2h16a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H14l-7 5v-5.3A6 6 0 0 1 2 19V8a6 6 0 0 1 6-6Z" fill="#D20A2E" />
    <path d="M16 6Q17.300 12.200 23.500 13.500Q17.300 14.800 16 21Q14.700 14.800 8.500 13.500Q14.700 12.200 16 6Z" fill="#F2F0EF" />
  </svg>
);

/** Logo completo: "alloxentric." en minúsculas, con la x y el punto en cherry. */
export const Wordmark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`font-medium tracking-[-0.04em] text-[color:var(--c-ink)] leading-none select-none ${className}`}>
    allo<span className="text-[#D20A2E]">x</span>entric<span className="text-[#D20A2E]">.</span>
  </span>
);

export const Logo: React.FC<LogoProps> = ({
  className = '',
  size = 'md',
  showWordmark = true,
}) => {
  if (size === 'watermark') {
    return (
      <div className={`pointer-events-none select-none opacity-[0.04] ${className}`}>
        <LogoIsotype size={180} />
      </div>
    );
  }

  const textSize = size === 'sm' ? 'text-[19px]' : size === 'lg' ? 'text-[34px]' : 'text-[23px]';
  const iconSize = size === 'sm' ? 22 : size === 'lg' ? 40 : 28;

  if (!showWordmark) return <LogoIsotype size={iconSize} className={className} />;
  return <Wordmark className={`${textSize} ${className}`} />;
};
