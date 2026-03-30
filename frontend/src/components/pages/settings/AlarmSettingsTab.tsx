import { Box, Button, CircularProgress, FormControlLabel, Slider, Switch, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import NumberField from '../../ui/NumberField';
import { PRAYER_NAMES, type Settings } from '../../../types';
import { useTranslation } from 'react-i18next';
import { Dialogs } from '@wailsio/runtime';
import {
  checkNativeNotificationPermission,
  getAdhanAudioFormat,
  playAdhan,
  requestNativeNotificationPermission,
  stopAdhan,
  validateAdhanFile,
} from '../../../bindings';
interface AlarmSettingsTabProps {
  local: Settings;
  setNotification: (patch: Partial<Settings['notification']>) => void;
}

type FileStatus = { state: 'idle' | 'validating' | 'ok' | 'error'; message?: string };

export default function AlarmSettingsTab({ local, setNotification }: AlarmSettingsTabProps) {
  const { t } = useTranslation();
  const [nativePermission, setNativePermission] = useState<boolean | null>(null);
  const [nativePermissionError, setNativePermissionError] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [adhanFileStatus, setAdhanFileStatus] = useState<FileStatus>({ state: 'idle' });
  const [adhanFajrFileStatus, setAdhanFajrFileStatus] = useState<FileStatus>({ state: 'idle' });
  const formatFetchedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void checkNativeNotificationPermission()
      .then((allowed) => {
        if (!active) return;
        setNativePermission(allowed);
      })
      .catch((err) => {
        if (!active) return;
        setNativePermission(false);
        setNativePermissionError(String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (formatFetchedRef.current) return;
    formatFetchedRef.current = true;
    void getAdhanAudioFormat()
      .then((fmt) => setAudioFormat(fmt))
      .catch(() => {/* non-critical */ });
  }, []);
  const pickAdhanFile = async (isFajr: boolean) => {
    const path = await Dialogs.OpenFile({
      Title: isFajr ? t('settings.alarms.adhanFajrFileLabel') : t('settings.alarms.adhanFileLabel'),
      Filters: [{ DisplayName: 'WAV Audio', Pattern: '*.wav' }],
    });
    if (!path) return;
    const setStatus = isFajr ? setAdhanFajrFileStatus : setAdhanFileStatus;
    setStatus({ state: 'validating' });
    try {
      await validateAdhanFile(path);
      setStatus({ state: 'ok' });
      setNotification(isFajr ? { adhanFajrFile: path } : { adhanFile: path });
    } catch (e) {
      setStatus({ state: 'error', message: String(e) });
    }
  };
  const resetAdhanFile = (isFajr: boolean) => {
    if (isFajr) {
      setAdhanFajrFileStatus({ state: 'idle' });
      setNotification({ adhanFajrFile: '' });
    } else {
      setAdhanFileStatus({ state: 'idle' });
      setNotification({ adhanFile: '' });
    }
  };

  const playPreview = async (isFajr: boolean) => {
    try {
      await playAdhan(isFajr);
    } catch (e) {
      console.error('Error playing audio');
      console.error(e);
    }
  };

  const stopPreview = async () => {
    try {
      await stopAdhan();
    } catch (e) {
      console.error('Error stopping audio');
      console.error(e);
    }
  };

  const handleNativeNotificationToggle = async (checked: boolean) => {
    if (!checked) {
      setNotification({ useNativeNotification: false });
      return;
    }
    try {
      const allowed = await checkNativeNotificationPermission();
      if (!allowed) {
        const granted = await requestNativeNotificationPermission();
        setNativePermission(granted);
        if (!granted) {
          setNotification({ useNativeNotification: false });
          return;
        }
      } else {
        setNativePermission(true);
      }
      setNotification({ useNativeNotification: true });
    } catch (err) {
      setNativePermission(false);
      setNativePermissionError(String(err));
      setNotification({ useNativeNotification: false });
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="subtitle1">{t('settings.alarms.playAdhan')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('settings.alarms.playAdhanDesc')}
          </Typography>
        </Box>
        <Switch
          checked={local.notification.playAdhan}
          onChange={(event) => setNotification({ playAdhan: event.target.checked })}
        />
      </Box>

      <Box display="flex" flexWrap="wrap" gap={1}>
        <Button variant="outlined" size="small" onClick={() => playPreview(false)}>
          {t('settings.alarms.previewAdhan')}
        </Button>
        <Button variant="outlined" size="small" onClick={() => playPreview(true)}>
          {t('settings.alarms.previewAdhanFajr')}
        </Button>
        <Button variant="outlined" size="small" color="error" onClick={stopPreview}>
          {t('settings.alarms.previewAdhanStop')}
        </Button>
      </Box>

      <Box pb={3} borderBottom="1px solid" borderColor="divider">
        <Box display="flex" justifyContent="space-between" mb={1}>
          <Typography variant="body2" color="text.secondary">
            {t('settings.alarms.adhanVolume')}
          </Typography>
          <Typography variant="body2" color="primary.main" fontWeight={600}>
            {t('settings.alarms.adhanVolumeValue', {
              value: Math.round(local.notification.adhanVolume * 100),
            })}
          </Typography>
        </Box>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={local.notification.adhanVolume}
          onChange={(_, value) => setNotification({ adhanVolume: value as number })}
        />
      </Box>

      <Box pb={3} borderBottom="1px solid" borderColor="divider" display="flex" flexDirection="column" gap={2}>
        <Box>
          <Typography variant="subtitle1">{t('settings.alarms.adhanAudioFiles')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('settings.alarms.adhanAudioFilesDesc')}
          </Typography>
          {audioFormat && (
            <Typography variant="caption" color="text.disabled" display="block" mt={0.5}>
              {t('settings.alarms.adhanFileFormatHint', audioFormat)}
              {' · '}
              <code>{t('settings.alarms.adhanFileFormatCmd', audioFormat)}</code>
            </Typography>
          )}
        </Box>
        {([false, true] as const).map((isFajr) => {
          const label = isFajr ? t('settings.alarms.adhanFajrFileLabel') : t('settings.alarms.adhanFileLabel');
          const currentPath = isFajr ? local.notification.adhanFajrFile : local.notification.adhanFile;
          const status = isFajr ? adhanFajrFileStatus : adhanFileStatus;
          return (
            <Box key={String(isFajr)} display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
                {label}
              </Typography>
              <Box
                flex={1}
                px={1.5}
                py={0.75}
                bgcolor="action.hover"
                borderRadius={0.5}
                sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', color: currentPath ? 'text.primary' : 'text.disabled' }}
              >
                {currentPath || t('settings.alarms.adhanFilePlaceholder')}
              </Box>
              {status.state === 'validating' && <CircularProgress size={18} sx={{ flexShrink: 0 }} />}
              {status.state === 'ok' && (
                <Typography variant="caption" color="success.main" sx={{ flexShrink: 0 }}>
                  {t('settings.alarms.adhanFileValid')}
                </Typography>
              )}
              {status.state === 'error' && (
                <Typography variant="caption" color="error.main" sx={{ flexShrink: 0, maxWidth: 220 }}>
                  {t('settings.alarms.adhanFileError', { message: status.message })}
                </Typography>
              )}
              <Button
                variant="outlined"
                size="small"
                sx={{ flexShrink: 0 }}
                disabled={status.state === 'validating'}
                onClick={() => void pickAdhanFile(isFajr)}
              >
                {t('settings.alarms.adhanFileBrowse')}
              </Button>
              {currentPath && (
                <Button
                  variant="text"
                  size="small"
                  color="error"
                  sx={{ flexShrink: 0 }}
                  onClick={() => resetAdhanFile(isFajr)}
                >
                  {t('settings.alarms.adhanFileReset')}
                </Button>
              )}
            </Box>
          );
        })}
      </Box>

      <Box display={'grid'} gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
        <Box display={'flex'} flexDirection={'column'} gap={3}>
          <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.alwaysOnTop')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.alwaysOnTopDesc')}
              </Typography>
            </Box>
            <Switch
              checked={local.notification.alwaysOnTop}
              disabled={local.notification.useNativeDialog}
              onChange={(event) => setNotification({ alwaysOnTop: event.target.checked })}
            />
          </Box>
          <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.persistent')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.persistentDesc')}
              </Typography>
            </Box>
            <Switch
              checked={local.notification.persistentReminder}
              disabled={local.notification.useNativeDialog}
              onChange={(event) => setNotification({ persistentReminder: event.target.checked })}
            />
          </Box>

          <Box>
            <NumberField
              label={t('settings.alarms.autoDismissSeconds')}
              size="small"
              value={local.notification.autoDismissSeconds}
              min={5}
              disabled={local.notification.persistentReminder || local.notification.useNativeDialog}
              helperText={local.notification.persistentReminder ? t('settings.alarms.autoDismissDisabled') : undefined}
              onValueChange={(value) =>
                setNotification({
                  autoDismissSeconds: Math.max(5, value ?? 5),
                })
              }
            />
          </Box>

          <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.autoDismissAfterAdhan')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.autoDismissAfterAdhanDesc')}
              </Typography>
            </Box>
            <Switch
              checked={local.notification.autoDismissAfterAdhan}
              disabled={
                !local.notification.playAdhan ||
                local.notification.useNativeDialog ||
                local.notification.persistentReminder
              }
              onChange={(event) => setNotification({ autoDismissAfterAdhan: event.target.checked })}
            />
          </Box>
        </Box>
        <Box display={'flex'} flexDirection={'column'} gap={3}>
          <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.useNativeDialog')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.useNativeDialogDesc')}
              </Typography>
              {local.notification.useNativeDialog && (
                <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
                  {t('settings.alarms.useNativeDialogNote')}
                </Typography>
              )}
            </Box>
            <Switch
              checked={local.notification.useNativeDialog}
              onChange={(event) => setNotification({ useNativeDialog: event.target.checked })}
            />
          </Box>

          <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.useNativeNotification')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.useNativeNotificationDesc')}
              </Typography>
              {nativePermission === false && (
                <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
                  {nativePermissionError ? nativePermissionError : t('settings.alarms.nativePermissionDenied')}
                </Typography>
              )}
            </Box>
            <Switch
              checked={local.notification.useNativeNotification}
              onChange={(event) => void handleNativeNotificationToggle(event.target.checked)}
            />
          </Box>

          {/* <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} alignItems="flex-start">
            <Box flex={1}>
              <Typography variant="subtitle1">{t('settings.alarms.nativeSticky')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('settings.alarms.nativeStickyDesc')}
              </Typography>
            </Box>
            <Switch
              checked={local.notification.nativeNotificationSticky}
              disabled={!local.notification.useNativeNotification}
              onChange={(event) => setNotification({ nativeNotificationSticky: event.target.checked })}
            />
          </Box> */}
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2" mb={2}>
          {t('settings.alarms.title')}
        </Typography>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', lg: '1fr 1fr' }} gap={2}>
          {PRAYER_NAMES.map((prayerName) => {
            const key = prayerName.toLowerCase() as keyof typeof local.notification.prayers;
            const alarm = local.notification.prayers[key];

            return (
              <Box
                key={prayerName}
                p={2}
                bgcolor="action.hover"
                borderRadius={0.5}
                display="flex"
                flexDirection="column"
                gap={2}
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={alarm.enabled}
                      onChange={(event) =>
                        setNotification({
                          prayers: {
                            ...local.notification.prayers,
                            [key]: {
                              ...alarm,
                              enabled: event.target.checked,
                            },
                          },
                        })
                      }
                    />
                  }
                  label={<Typography fontWeight={600}>{t(`prayerNames.${key}`)}</Typography>}
                  sx={{
                    m: 0,
                    justifyContent: 'space-between',
                    flexDirection: 'row-reverse',
                  }}
                />

                <Box
                  display="grid"
                  gridTemplateColumns="1fr 1fr"
                  gap={2}
                  sx={{
                    opacity: alarm.enabled ? 1 : 0.4,
                    pointerEvents: alarm.enabled ? 'auto' : 'none',
                  }}
                >
                  <NumberField
                    label={t('settings.alarms.remindBefore')}
                    size="small"
                    value={alarm.beforeMinutes}
                    min={0}
                    onValueChange={(value) =>
                      setNotification({
                        prayers: {
                          ...local.notification.prayers,
                          [key]: {
                            ...alarm,
                            beforeMinutes: value ?? 0,
                          },
                        },
                      })
                    }
                  />
                  <NumberField
                    label={t('settings.alarms.remindAfter')}
                    size="small"
                    value={alarm.afterMinutes}
                    min={1}
                    onValueChange={(value) =>
                      setNotification({
                        prayers: {
                          ...local.notification.prayers,
                          [key]: {
                            ...alarm,
                            afterMinutes: Math.max(1, value ?? 1),
                          },
                        },
                      })
                    }
                  />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
