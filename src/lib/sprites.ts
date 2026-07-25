import { PetSpecies, PetMood, PetActivity } from '@/types/pet';

const SPRITES: Record<PetSpecies, Record<string, string>> = {
  bunny: {
    idle:     "(\\ /)\n( ._. )\nc( )( )",
    happy:    "(\\ /)\n( ^u^ )\nc( )( )",
    eating:   "(\\ /)\n( o3o )\nc(nom )",
    bathing:  "(\\ /)\n( OwO )\n~( )( )",
    walking:  "(\\ /)\n( >u> )\nc( )( )",
    playing:  "(\\ /)\n( ^o^)/\nc( )( )",
    sleeping: "(\\ /)\n( -.- )\nc( )zzZ",
    sad:      "(\\ /)\n( ;_; )\nc( )( )",
    sick:     "(\\ /)\n( @~@ )\nc( )( )",
  },
  cat: {
    idle:     " /\\_/\\ \n( =^.^=)\n (__|__)",
    happy:    " /\\_/\\ \n( =^w^=)\n (__|__)",
    eating:   " /\\_/\\ \n( =^~^=)\n ( nom )",
    bathing:  " /\\_/\\ \n( =oAo=)\n (~~~~)",
    walking:  " /\\_/\\ \n( =^-^=)\n (_/ \\_)",
    playing:  " /\\_/\\ \n(=^o^=)/\n (__|__)",
    sleeping: " /\\_/\\ \n( =-.-=)\n ( zZz )",
    sad:      " /\\_/\\ \n( =T.T=)\n (__|__)",
    sick:     " /\\_/\\ \n( =@.@=)\n (__|__)",
  },
  dog: {
    idle:     " _____ \n( o.o )\n > ^ < \n/|___|\\",
    happy:    " _____ \n( ^v^ )\n > W < \n/|___|\\",
    eating:   " _____ \n( uwu )\n >nom< \n/|___|\\",
    bathing:  " _____ \n( OvO )\n >~~~< \n/|___|\\",
    walking:  " _____ \n( -v- )\n > > > \n  / \\  ",
    playing:  " _____ \n( *v* )\n > W </\n/|___|\\",
    sleeping: " _____ \n( -.- )\n > zZ< \n/|___|\\",
    sad:      " _____ \n( T.T )\n > v < \n/|___|\\",
    sick:     " _____ \n( @.@ )\n > x < \n/|___|\\",
  },
  hamster: {
    idle:     " (•w•) \n(  U  )\n\\_____/",
    happy:    " (^w^) \n(  U  )\n\\_____/",
    eating:   " (•w•) \n( nom )\n\\_____/",
    bathing:  " (OwO) \n( ~~~ )\n\\_____/",
    walking:  " (•w•) \n(  >> )\n  / \\  ",
    playing:  " (•w•)/\n(  U  )\n\\_____/",
    sleeping: " (-.-) \n( zZz )\n\\_____/",
    sad:      " (;w;) \n(  U  )\n\\_____/",
    sick:     " (@w@) \n(  X  )\n\\_____/",
  },
};

export function getSprite(species: PetSpecies, activity: PetActivity, mood: PetMood): string {
  const map = SPRITES[species] ?? SPRITES.bunny;
  if (activity === 'sleeping') return map.sleeping;
  if (mood === 'sick')         return map.sick;
  if (mood === 'sad')          return map.sad;
  if ((mood === 'happy' || mood === 'excited') && activity === 'idle') return map.happy;
  return map[activity] ?? map.idle;
}

export const MOOD_MSG: Record<PetMood, string> = {
  happy:    '¡Estoy muy feliz! (✿◠‿◠)',
  excited:  '¡¡Estoy súper emocionado!! \\(^o^)/',
  neutral:  'Estoy bien... más o menos (._.).',
  sad:      'Me siento un poco triste... (╥_╥)',
  sick:     'No me siento muy bien... (@_@)',
  sleeping: 'Zzzz... (-.-)zzZ',
};
