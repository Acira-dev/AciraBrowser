import tokens from '../../design-tokens.json';
export { tokens as designTokens };
export type MaterialElevation = 'field' | 'search' | 'overlay';
export type FormationVariant = 'menu' | 'switcher' | 'assistant' | 'content' | 'page';

export function installDesignVariables() {
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(tokens.color).map(([key, value]) => [`--ed-${key}`, value])),
    ...Object.fromEntries(Object.entries(tokens.geometry).map(([key, value]) => [`--geometry-${key}`, `${value}px`])),
    '--frost-fill': `rgba(255,255,255,${tokens.material.tint})`,
    '--frost-edge': tokens.material.edge,
    '--frost-blur': `${tokens.material.blur}px`,
    '--frost-grain': String(tokens.material.grain),
    '--frost-grain-size': `${tokens.material.grainSize}px`,
    '--frost-shadow': tokens.material.overlayShadow,
    '--field-shadow': tokens.material.fieldShadow,
    '--address-fill': tokens.material.addressFill,
    '--address-focus': tokens.material.addressFocus,
    '--search-shadow': tokens.material.searchShadow,
  };
  for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(key, value);
}
