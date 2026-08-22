/*
 * tarteaucitron.js — open-source, French, and the one the CNIL itself runs.
 *
 * Worth an adapter because it is what a great many French public-sector and
 * association sites use, and because a tool auditing French compliance that
 * cannot name the regulator's own banner would be an odd thing.
 *
 * Its API exposes no single refusal call this project is willing to depend on
 * across versions, so refusal goes through the button.
 */

export const tarteaucitron = {
  id: 'tarteaucitron',
  name: 'tarteaucitron.js',
  globals: ['tarteaucitron'],
  tcfCmpIds: [],
  markers: [/tarteaucitron/i],
  frameHosts: [],
};
