/**
 * Returns background CSS classes based on current hour.
 * Morning (6-12):   warm sunrise gradient
 * Afternoon (12-18): golden warm gradient
 * Evening (18-21):  sunset gradient
 * Night (21-6):     deep blue/indigo gradient with stars
 */
export function getTimeBackground(hour: number): {
  bgClass: string;
  bgStyle: React.CSSProperties;
  isNight: boolean;
} {
  if (hour >= 6 && hour < 12) {
    // Morning
    return {
      bgClass: '',
      bgStyle: { background: 'linear-gradient(180deg, #FFF5E4 0%, #FFE8CC 40%, #FFDDB5 100%)' },
      isNight: false,
    };
  }
  if (hour >= 12 && hour < 18) {
    // Afternoon
    return {
      bgClass: '',
      bgStyle: { background: 'linear-gradient(180deg, #FFF5E4 0%, #FFECD2 50%, #FFD4A0 100%)' },
      isNight: false,
    };
  }
  if (hour >= 18 && hour < 21) {
    // Evening
    return {
      bgClass: '',
      bgStyle: { background: 'linear-gradient(180deg, #FFD4A0 0%, #FFB088 30%, #C4A0E8 70%, #8B7FCF 100%)' },
      isNight: false,
    };
  }
  // Night (21-6)
  return {
    bgClass: '',
    bgStyle: { background: 'linear-gradient(180deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)' },
    isNight: true,
  };
}
