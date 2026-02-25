'use client';
import { PetSpecies, PetMood, PetActivity } from '@/types/pet';
import { getSprite, MOOD_BG } from '@/lib/sprites';

const ANIMATION: Record<PetActivity, string> = {
  idle:     'animate-float',
  eating:   'animate-bounce-soft',
  bathing:  'animate-wiggle',
  walking:  'animate-bounce-soft',
  playing:  'animate-jump',
  sleeping: 'animate-float',
};

interface Props {
  species:  PetSpecies;
  mood:     PetMood;
  activity: PetActivity;
}

export default function PetAvatar({ species, mood, activity }: Props) {
  const sprite = getSprite(species, activity, mood);
  const bg     = MOOD_BG[mood];
  const anim   = ANIMATION[activity];

  return (
    <div className={`rounded-3xl border-2 px-8 py-6 shadow-lg ${bg} flex justify-center`}>
      <pre className={`font-mono text-xl leading-7 text-gray-700 select-none ${anim}`}>
        {sprite}
      </pre>
    </div>
  );
}
