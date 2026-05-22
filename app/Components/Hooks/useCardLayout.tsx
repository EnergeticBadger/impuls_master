// hooks/useCardLayout.ts
import { useState } from 'react';

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
}

export function useCardLayout(card: any) {
  const [faceIndex, setFaceIndex] = useState(0);
  const layoutGroup = getLayoutGroup(card.layout ?? 'normal');

  const faces: ResolvedFace[] = (() => {
    switch (layoutGroup) {
      case 'double_sided':
        return (card.card_faces ?? []).map((f: any) => ({
          name: f.name,
          image_uri: f.image_uris?.large ?? '',
        }));
      case 'single_sided_split':
        // Both faces render on the same image; root has image_uris
        return [{
          name: card.name,
          image_uri: card.image_uris?.large ?? '',
        }];
      default:
        return [{
          name: card.name,
          image_uri: card.image_uris?.large ?? '',
        }];
    }
  })();

  const currentFace = faces[faceIndex] ?? faces[0];
  const canFlip = layoutGroup === 'double_sided' && faces.length > 1;

  function flip() {
    if (canFlip) setFaceIndex(i => (i + 1) % faces.length);
  }

  return { currentFace, faces, canFlip, flip, layoutGroup, faceIndex };
}