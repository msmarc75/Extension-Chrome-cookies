/*
 * Axeptio — widespread on French SMEs.
 *
 * No documented refusal call this project is willing to rely on: guessing at an
 * undocumented method risks a refusal that silently does nothing, which is the
 * worst possible failure for an audit. Detection is by global and by markup;
 * the refusal goes through the button, and the report says which route was
 * taken.
 */

export const axeptio = {
  id: 'axeptio',
  name: 'Axeptio',
  globals: ['axeptioSDK', '_axcb'],
  tcfCmpIds: [],
  markers: [/axeptio/i],
  frameHosts: [/(^|\.)axept\.io$/i, /(^|\.)axeptio\.eu$/i],
};
