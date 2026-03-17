'use client';
import dynamic from 'next/dynamic';
import { PetSpecies, PetMood, PetActivity } from '@/types/pet';
import { getSprite } from '@/lib/sprites';
import playingAnimation from '../../public/pocky-cat/pockyJugando.json';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

const ANIMATION: Record<PetActivity, string> = {
  idle: 'animate-float',
  eating: 'animate-bounce-soft',
  bathing: 'animate-wiggle',
  walking: 'animate-bounce-soft',
  playing: 'animate-jump',
  sleeping: 'animate-float',
};

interface Props {
  species: PetSpecies;
  mood: PetMood;
  activity: PetActivity;
}

export default function PetAvatar({ species, mood, activity }: Props) {
  const sprite = getSprite(species, activity, mood);
  const anim = ANIMATION[activity];

  // Idle: Imagen grande sin recuadro
  if (activity === 'idle') {
    return (
      <div className="flex justify-center items-center">
        <img
          src="/pocky-cat/pockyNormal.png"
          alt="Pocky Normal"
          className="w-48 h-48 object-contain animate-pulse-soft rounded-3xl drop-shadow-xl pointer-events-none"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }

  // Playing: Lottie grande sin recuadro
  if (activity === 'playing') {
    return (
      <div className="flex justify-center items-center">
        <Lottie
          animationData={playingAnimation}
          loop={true}
          className="w-48 h-48 drop-shadow-xl"
        />
      </div>
    );
  }

  // Otros: ASCII art grande sin recuadro
  return (
    <div className="flex justify-center items-center">
      <pre className={`font-mono text-2xl leading-8 text-gray-700 select-none drop-shadow-md ${anim}`}>
        {sprite}
      </pre>
    </div>
  );
}
