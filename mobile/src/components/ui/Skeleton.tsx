import { useEffect } from 'react';
import type { DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Raio do canto. Default: 8. */
  radius?: number;
  className?: string;
}

/**
 * Placeholder de carregamento com pulso suave (DS-02).
 * Preferir skeletons a spinners de tela cheia (06_DESIGN_SYSTEM §7).
 */
export function Skeleton({ width = '100%', height = 16, radius = 8, className }: SkeletonProps) {
  const { isDark } = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityRole="none"
      importantForAccessibility="no-hide-descendants"
      className={className}
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: isDark ? '#222222' : '#E4E7EC',
        },
        animatedStyle,
      ]}
    />
  );
}
