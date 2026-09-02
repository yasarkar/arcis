import { useState, useEffect, useCallback } from 'react';
import { PrivacyLevel, PrivacySettings } from '../types/privacy';
import { privacyService } from '../services/privacyService';

export function usePrivacy() {
  const [settings, setSettings] = useState<PrivacySettings>(() =>
    privacyService.getPrivacySettings()
  );

  useEffect(() => {
    const handlePrivacyChange = (event: Event) => {
      const customEvent = event as CustomEvent<PrivacySettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      }
    };

    window.addEventListener('arcis_privacy_changed', handlePrivacyChange);
    return () => {
      window.removeEventListener('arcis_privacy_changed', handlePrivacyChange);
    };
  }, []);

  const updateSettings = useCallback((newSettings: Partial<PrivacySettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    privacyService.setPrivacySettings(updated);
  }, [settings]);

  const setPrivacyLevel = useCallback((level: PrivacyLevel) => {
    updateSettings({ level });
  }, [updateSettings]);

  const toggleHiddenChain = useCallback((chainId: string) => {
    const hidden = new Set(settings.hiddenChains);
    if (hidden.has(chainId)) {
      hidden.delete(chainId);
    } else {
      hidden.add(chainId);
    }
    updateSettings({ hiddenChains: Array.from(hidden) });
  }, [settings.hiddenChains, updateSettings]);

  return {
    settings,
    level: settings.level,
    isPrivate: settings.level === 'private',
    isSelective: settings.level === 'selective',
    isPublic: settings.level === 'public',
    setPrivacyLevel,
    toggleHiddenChain,
    updateSettings,
    formatBalance: (amount: string | number, symbol: string = 'USDC') =>
      privacyService.formatBalance(amount, settings.level, symbol)
  };
}
