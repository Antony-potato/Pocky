'use client';
import dynamic from 'next/dynamic';
import { PetSpecies, PetMood, PetActivity } from '@/types/pet';
import { getSprite, MOOD_BG } from '@/lib/sprites';
import playingAnimation from '../../public/pocky-cat/pokyJugando.json';

// Carga Lottie dinámicamente para evitar problemas de SSR
const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

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

  if (activity === 'idle') {
    return (
      <div className={`rounded-3xl border-2 px-8 py-6 shadow-lg flex justify-center items-center overflow-hidden min-h-[160px] ${bg}`}>
         <img 
            src="/pocky-cat/pockyNormal.jpeg" 
            alt="Pocky Normal" 
            className="w-32 h-32 object-contain animate-pulse-soft rounded-lg" 
         />
      </div>
    );
  }

  if (activity === 'playing') {
    return (
      <div className={`rounded-3xl border-2 px-8 py-6 shadow-lg flex justify-center items-center overflow-hidden min-h-[160px] ${bg}`}>
         <Lottie 
            animationData={playingAnimation} 
            loop={true} 
            className="w-32 h-32" 
         />
      </div>
    );
  }

  return (
    <div className={`rounded-3xl border-2 px-8 py-6 shadow-lg flex justify-center min-h-[160px] items-center ${bg}`}>
      <pre className={`font-mono text-xl leading-7 text-gray-700 select-none ${anim}`}>
        {sprite}
      </pre>
    </div>
  );
}
