import React from 'react';
import claude from '../assets/providers/claude-color.svg';
import openaiSvg from '../assets/providers/openai.svg?raw';
import nova from '../assets/providers/nova-color.svg';
import deepseek from '../assets/providers/deepseek-color.svg';
import qwen from '../assets/providers/qwen-color.svg';

/** Logo de la empresa que creó el modelo. Archivos locales (src/assets/providers): no se carga nada desde internet. */
const COLOR: Record<string, string> = { anthropic: claude, amazon: nova, deepseek, qwen };
const NAME: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', amazon: 'Amazon', deepseek: 'DeepSeek', qwen: 'Qwen' };

export const ProviderLogo: React.FC<{ provider: string; size?: number; className?: string }> = ({ provider, size = 22, className = '' }) => {
  const label = NAME[provider] ?? provider;
  // El logo de OpenAI es de un solo color: va en línea (archivo local, confiable) y toma el color del texto, para claro y oscuro
  if (provider === 'openai') {
    return (
      <span
        role="img"
        aria-label={label}
        className={`inline-flex shrink-0 text-[color:var(--c-ink)] [&>svg]:w-full [&>svg]:h-full ${className}`}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: openaiSvg }}
      />
    );
  }
  const src = COLOR[provider];
  if (!src) return <span className={`inline-flex items-center justify-center rounded-md bg-[color:var(--c-soft)] text-[10px] font-bold text-[color:var(--c-muted)] ${className}`} style={{ width: size, height: size }}>{label.slice(0, 2)}</span>;
  return <img src={src} alt={label} width={size} height={size} className={`shrink-0 ${className}`} draggable={false} />;
};
