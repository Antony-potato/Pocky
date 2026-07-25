'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { PetSpecies, PetMood, PetActivity } from '@/types/pet';
import { getSprite } from '@/lib/sprites';

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
  species: PetSpecies;
  mood: PetMood;
  activity: PetActivity;
}

export default function PetAvatar({ species, mood, activity }: Props) {
  // El JSON de la animación pesa lo suyo y solo se usa durante los 3 s de
  // "jugando": se carga bajo demanda en vez de entrar en el bundle principal.
  const [playingAnimation, setPlayingAnimation] = useState<object | null>(null);

  useEffect(() => {
    if (activity !== 'playing' || playingAnimation) return;
    let cancelled = false;
    void import('../../public/pocky-cat/pockyJugando.json')
      .then((m) => { if (!cancelled) setPlayingAnimation(m.default as object); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activity, playingAnimation]);

  if (activity === 'idle') {
    return (
      <div className="flex justify-center items-center">
        <Image
          src="/pocky-cat/pockyNormal.png"
          alt="Pocky"
          width={192}
          height={192}
          priority
          className="w-48 h-48 object-contain animate-pulse-soft rounded-3xl drop-shadow-xl select-none"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }

  if (activity === 'playing' && playingAnimation) {
    return (
      <div className="flex justify-center items-center">
        <Lottie animationData={playingAnimation} loop className="w-48 h-48 drop-shadow-xl" />
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center">
      <pre className={`font-mono text-2xl leading-8 text-gray-700 select-none drop-shadow-md ${ANIMATION[activity]}`}>
        {getSprite(species, activity, mood)}
      </pre>
    </div>
  );
}
