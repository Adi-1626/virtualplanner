import React, { useEffect, useState } from 'react';
import { getVisualStyle, onVisualStyleChange, setVisualStyle, type VisualStyle } from '../engine/rendering/visualStyle';
import { getQualityTier, onQualityTierChange, setQualityTier, wasAutoDropped, type QualityTier } from '../engine/rendering/qualityTier';

function useQualityTier(): QualityTier {
  const [tier, setTier] = useState<QualityTier>(getQualityTier);
  useEffect(() => onQualityTierChange(t => setTier(t)), []);
  return tier;
}

const TIERS: { id: QualityTier; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Lit colours, no textures (weak graphics)' },
  { id: 'medium', label: 'Medium', hint: 'Surface textures, smoothed edges (default)' },
  { id: 'high', label: 'High', hint: 'Surface textures, 4× multisampling' },
];

export function useVisualStyle(): VisualStyle {
  const [style, setStyle] = useState<VisualStyle>(getVisualStyle);
  useEffect(() => onVisualStyleChange(setStyle), []);
  return style;
}

const OPTIONS: { id: VisualStyle; label: string; hint: string }[] = [
  { id: 'realistic', label: 'Realistic', hint: 'Lit materials, standard markings and structures' },
  { id: 'schematic', label: 'Schematic', hint: 'Flat legend colours (clearer for printing and traffic colours)' },
];

/** Realistic / Schematic switch for drawn and proposed objects (BUILD_VISUALS_AND_TOOLS_PLAN §A3.1). */
export const VisualStyleControl: React.FC = () => {
  const style = useVisualStyle();
  const tier = useQualityTier();
  return (
    <section aria-label="Visual style" data-testid="visual-style">
      <h4 className="text-meta font-semibold uppercase tracking-wide text-text-3 mb-0.5">Visual style</h4>
      <div role="radiogroup" aria-label="Visual style" className="flex gap-1">
        {OPTIONS.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={style === o.id} title={o.hint}
            data-testid={`visual-style-${o.id}`} onClick={() => setVisualStyle(o.id)}
            className={`flex-1 rounded-md border px-2 h-8 text-label ${style === o.id ? 'border-accent bg-surface-2 text-text-1' : 'border-border text-text-2 hover:text-text-1'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {style === 'realistic' && (
        <div role="radiogroup" aria-label="Rendering quality" className="flex gap-1 mt-1" data-testid="quality-tier">
          {TIERS.map(t => (
            <button key={t.id} type="button" role="radio" aria-checked={tier === t.id} title={t.hint}
              data-testid={`quality-${t.id}`} onClick={() => setQualityTier(t.id)}
              className={`flex-1 rounded-md border px-1.5 h-6 text-meta ${tier === t.id ? 'border-accent bg-surface-2 text-text-1' : 'border-border text-text-3 hover:text-text-1'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {style === 'realistic' && tier === 'low' && wasAutoDropped() && (
        <p className="text-meta text-text-3 mt-1" data-testid="quality-auto-note">Switched to Low automatically: rendering was under 30 frames a second.</p>
      )}
      <p className="text-meta text-text-3 mt-1">Dimensions marked “assumed” in the inspector are drawn but not from a source.</p>
    </section>
  );
};
