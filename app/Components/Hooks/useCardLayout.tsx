// hooks/useCardLayout.ts
import { useState } from 'react';
import type { ScryfallCard } from '~/types';

export type LayoutGroup = 'normal' | 'single_sided_split' | 'double_sided' | 'meld';

const DOUBLE_SIDED = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card']);
const SINGLE_SIDED_SPLIT = new Set(['split', 'flip', 'adventure']);

export function getLayoutGroup(layout: string): LayoutGroup {
  if (DOUBLE_SIDED.has(layout)) return 'double_sided';
  if (SINGLE_SIDED_SPLIT.has(layout)) return 'single_sided_split';
  if (layout === 'meld') return 'meld';
  return 'normal';
}

export interface ResolvedFace {
  name: string;
  image_uri: string;
  large_uri: string;
}

// Double-sided cards keep their images on each face; everything else
// (including split/adventure/flip cards that still have card_faces) has one root image.
export function resolveFaces(card: ScryfallCard): ResolvedFace[] {
  const faceImages = (card.card_faces ?? []).filter(f => f.image_uris);
  if (faceImages.length > 1 && !card.image_uris) {
    return faceImages.map(f => ({
      name: f.name,
      image_uri: f.image_uris?.normal ?? '',
      large_uri: f.image_uris?.large ?? '',
    }));
  }
  const images = card.image_uris ?? faceImages[0]?.image_uris;
  return [{
    name: card.name,
    image_uri: images?.normal ?? '',
    large_uri: images?.large ?? '',
  }];
}

// Degrees to rotate a single-image card so its other half reads upright.
function rotationFor(card: ScryfallCard): number {
  if (card.layout === 'flip') return 180;
  if (card.layout === 'split') return card.keywords?.includes('Aftermath') ? -90 : 90;
  return 0;
}

export function useCardLayout(card: ScryfallCard) {
  const [faceIndex, setFaceIndex] = useState(0);
  const [rotated, setRotated] = useState(false);
  const layoutGroup = getLayoutGroup(card.layout ?? 'normal');

  const faces = resolveFaces(card);
  const currentFace = faces[faceIndex] ?? faces[0];
  const canFlip = faces.length > 1;
  const rotation = rotationFor(card);
  const canRotate = !canFlip && rotation !== 0;

  function flip() {
    if (canFlip) setFaceIndex(i => (i + 1) % faces.length);
  }

  function rotate() {
    if (canRotate) setRotated(r => !r);
  }

  return {
    currentFace, faces, canFlip, flip, canRotate, rotate,
    rotation: rotated ? rotation : 0,
    layoutGroup, faceIndex,
  };
}
