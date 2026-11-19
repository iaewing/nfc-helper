import * as Location from 'expo-location';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  Habit,
  HabitPayload,
  ScheduleType,
  VerificationType,
} from '../api/types';

const ICON_PRESETS = ['✅', '💧', '☕', '🏋️', '💊', '📖', '🧘', '🏃', '🧹', '🌙'];

const VERIFICATION_OPTIONS: {
  value: VerificationType;
  label: string;
  description: string;
}[] = [
  {
    value: 'tap',
    label: 'Tap Only',
    description: 'Single background tap completes instantly.',
  },
  {
    value: 'tap_photo',
    label: 'Tap + Live Photo',
    description: 'Requires capturing a live photo via camera.',
  },
  {
    value: 'tap_location',
    label: 'Tap + Location',
    description: 'Verifies GPS coordinates inside your geofence.',
  },
  {
    value: 'tap_photo_location',
    label: 'Tap + Photo + Location',
    description: 'Requires both a live photo and geofence match.',
  },
];

const WEEKDAYS: { iso: number; short: string }[] = [
  { iso: 1, short: 'Mon' },
  { iso: 2, short: 'Tue' },
  { iso: 3, short: 'Wed' },
  { iso: 4, short: 'Thu' },
  { iso: 5, short: 'Fri' },
  { iso: 6, short: 'Sat' },
  { iso: 7, short: 'Sun' },
];

const COOLDOWN_PRESETS = [
  { label: 'None', minutes: 0 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function formatVerificationLabel(type: VerificationType): string {
  switch (type) {
    case 'tap':
      return 'Tap proof';
    case 'tap_photo':
      return 'Tap + Live photo';
    case 'tap_location':
      return 'Tap + Location';
    case 'tap_photo_location':
      return 'Tap + Photo + Location';
  }
}

interface HabitFormProps {
  initialHabit?: Habit | null;
  submitLabel: string;
  showActiveToggle?: boolean;
  onSubmit: (payload: HabitPayload) => Promise<void>;
}

export function HabitForm({
  initialHabit,
  submitLabel,
  showActiveToggle = false,
  onSubmit,
}: HabitFormProps) {
  const [name, setName] = useState(initialHabit?.name ?? '');
  const [description, setDescription] = useState(initialHabit?.description ?? '');
  const [icon, setIcon] = useState(initialHabit?.icon ?? '✅');
  const [verificationType, setVerificationType] = useState<VerificationType>(
    initialHabit?.verification_type ?? 'tap',
  );
  const [requireHardwareUid, setRequireHardwareUid] = useState(
    initialHabit?.require_hardware_uid ?? false,
  );
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    initialHabit?.schedule_type ?? 'daily',
  );
  const [scheduleDays, setScheduleDays] = useState<number[]>(
    initialHabit?.schedule_days ?? [1, 2, 3, 4, 5],
  );
  const [useTimeWindow, setUseTimeWindow] = useState(
    Boolean(initialHabit?.window_start && initialHabit?.window_end),
  );
  const [windowStart, setWindowStart] = useState(initialHabit?.window_start ?? '06:00');
  const [windowEnd, setWindowEnd] = useState(initialHabit?.window_end ?? '10:00');
  const [cooldownMinutes, setCooldownMinutes] = useState(
    String(initialHabit?.cooldown_minutes ?? 60),
  );

  const [geofenceLat, setGeofenceLat] = useState(
    initialHabit?.geofence_lat != null ? String(initialHabit.geofence_lat) : '',
  );
  const [geofenceLng, setGeofenceLng] = useState(
    initialHabit?.geofence_lng != null ? String(initialHabit.geofence_lng) : '',
  );
  const [geofenceRadius, setGeofenceRadius] = useState(
    initialHabit?.geofence_radius_m != null ? String(initialHabit.geofence_radius_m) : '150',
  );
  const [isActive, setIsActive] = useState(initialHabit?.is_active ?? true);

  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresLocation =
    verificationType === 'tap_location' || verificationType === 'tap_photo_location';

  const toggleDay = (iso: number) => {
    setScheduleDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort((a, b) => a - b),
    );
  };

  const handleCaptureLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Location permission is required to capture your current coordinates.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setGeofenceLat(position.coords.latitude.toFixed(6));
      setGeofenceLng(position.coords.longitude.toFixed(6));
      if (!geofenceRadius.trim()) {
        setGeofenceRadius('150');
      }
    } catch {
      setError('Unable to fetch current GPS location. Please try again.');
    } finally {
      setLocating(false);
    }
  };

  const handleClearGeofence = () => {
    setGeofenceLat('');
    setGeofenceLng('');
  };

  const handlePressSubmit = async () => {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a name for this habit.');
      return;
    }

    if (scheduleType === 'custom_days' && scheduleDays.length === 0) {
      setError('Select at least one weekday for a custom schedule.');
      return;
    }

    let normalizedStart: string | null = null;
    let normalizedEnd: string | null = null;
    if (useTimeWindow) {
      normalizedStart = windowStart.trim();
      normalizedEnd = windowEnd.trim();
      if (!TIME_REGEX.test(normalizedStart) || !TIME_REGEX.test(normalizedEnd)) {
        setError('Time window must use 24-hour HH:MM format (e.g. 06:00 and 10:00).');
        return;
      }
      if (normalizedStart === normalizedEnd) {
        setError('Window end time must differ from window start time.');
        return;
      }
    }

    const parsedCooldown = Number.parseInt(cooldownMinutes.trim() || '0', 10);
    if (!Number.isFinite(parsedCooldown) || parsedCooldown < 0 || parsedCooldown > 10080) {
      setError('Cooldown must be between 0 and 10,080 minutes.');
      return;
    }

    const hasLatText = geofenceLat.trim().length > 0;
    const hasLngText = geofenceLng.trim().length > 0;
    const hasGeofence = hasLatText || hasLngText;

    let parsedLat: number | null = null;
    let parsedLng: number | null = null;
    let parsedRadius: number | null = null;

    if (requiresLocation || hasGeofence) {
      parsedLat = Number.parseFloat(geofenceLat.trim());
      parsedLng = Number.parseFloat(geofenceLng.trim());
      parsedRadius = Number.parseInt(geofenceRadius.trim(), 10);

      if (
        !Number.isFinite(parsedLat) ||
        parsedLat < -90 ||
        parsedLat > 90 ||
        !Number.isFinite(parsedLng) ||
        parsedLng < -180 ||
        parsedLng > 180
      ) {
        setError('Provide valid geofence latitude (-90..90) and longitude (-180..180).');
        return;
      }

      if (!Number.isFinite(parsedRadius) || parsedRadius < 10 || parsedRadius > 50000) {
        setError('Geofence radius must be between 10 and 50,000 meters.');
        return;
      }
    }

    const payload: HabitPayload = {
      name: trimmedName,
      description: description.trim() ? description.trim() : null,
      icon: icon.trim() ? icon.trim() : null,
      verification_type: verificationType,
      require_hardware_uid: requireHardwareUid,
      schedule_type: scheduleType,
      schedule_days: scheduleType === 'custom_days' ? scheduleDays : null,
      window_start: normalizedStart,
      window_end: normalizedEnd,
      cooldown_minutes: parsedCooldown,
      geofence_lat: parsedLat,
      geofence_lng: parsedLng,
      geofence_radius_m: parsedRadius,
      is_active: isActive,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save habit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form}>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>Habit Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Drink Water, Gym Arrival"
          placeholderTextColor="#64748B"
          value={name}
          onChangeText={setName}
          maxLength={120}
        />

        <Text style={styles.label}>Description (Optional)</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          placeholder="Notes or instructions shown when checking in"
          placeholderTextColor="#64748B"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
        />

        <Text style={styles.label}>Icon</Text>
        <View style={styles.iconRow}>
          {ICON_PRESETS.map((preset) => {
            const selected = icon === preset;
            return (
              <Pressable
                key={preset}
                style={[styles.iconChip, selected && styles.iconChipSelected]}
                onPress={() => setIcon(preset)}
              >
                <Text style={styles.iconText}>{preset}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verification Mode</Text>
        {VERIFICATION_OPTIONS.map((option) => {
          const selected = verificationType === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.optionCard, selected && styles.optionCardSelected]}
              onPress={() => setVerificationType(option.value)}
            >
              <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                {option.label}
              </Text>
              <Text style={styles.optionDesc}>{option.description}</Text>
            </Pressable>
          );
        })}

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>Require Hardware UID Scan</Text>
            <Text style={styles.switchSubtitle}>
              High-security mode: verifies the physical 7-byte NTAG213/215 chip on every check-in.
            </Text>
          </View>
          <Switch
            value={requireHardwareUid}
            onValueChange={setRequireHardwareUid}
            trackColor={{ false: '#334155', true: '#0284C7' }}
            thumbColor={requireHardwareUid ? '#38BDF8' : '#CBD5E1'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Schedule & Cooldown</Text>
        <View style={styles.segmentRow}>
          <Pressable
            style={[
              styles.segmentButton,
              scheduleType === 'daily' && styles.segmentButtonSelected,
            ]}
            onPress={() => setScheduleType('daily')}
          >
            <Text
              style={[
                styles.segmentText,
                scheduleType === 'daily' && styles.segmentTextSelected,
              ]}
            >
              Daily
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.segmentButton,
              scheduleType === 'custom_days' && styles.segmentButtonSelected,
            ]}
            onPress={() => setScheduleType('custom_days')}
          >
            <Text
              style={[
                styles.segmentText,
                scheduleType === 'custom_days' && styles.segmentTextSelected,
              ]}
            >
              Custom Days
            </Text>
          </Pressable>
        </View>

        {scheduleType === 'custom_days' ? (
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((day) => {
              const selected = scheduleDays.includes(day.iso);
              return (
                <Pressable
                  key={day.iso}
                  style={[styles.dayChip, selected && styles.dayChipSelected]}
                  onPress={() => toggleDay(day.iso)}
                >
                  <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>
                    {day.short}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>Restrict to Time Window</Text>
            <Text style={styles.switchSubtitle}>
              Supports same-day (06:00–10:00) and overnight (22:00–02:00) windows.
            </Text>
          </View>
          <Switch
            value={useTimeWindow}
            onValueChange={setUseTimeWindow}
            trackColor={{ false: '#334155', true: '#0284C7' }}
            thumbColor={useTimeWindow ? '#38BDF8' : '#CBD5E1'}
          />
        </View>

        {useTimeWindow ? (
          <View style={styles.twoColRow}>
            <View style={styles.col}>
              <Text style={styles.label}>Start (HH:MM)</Text>
              <TextInput
                style={styles.input}
                placeholder="06:00"
                placeholderTextColor="#64748B"
                value={windowStart}
                onChangeText={setWindowStart}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>End (HH:MM)</Text>
              <TextInput
                style={styles.input}
                placeholder="10:00"
                placeholderTextColor="#64748B"
                value={windowEnd}
                onChangeText={setWindowEnd}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>Cooldown (minutes)</Text>
        <TextInput
          style={styles.input}
          placeholder="60"
          placeholderTextColor="#64748B"
          value={cooldownMinutes}
          onChangeText={setCooldownMinutes}
          keyboardType="number-pad"
        />
        <View style={styles.presetRow}>
          {COOLDOWN_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              style={[
                styles.presetChip,
                cooldownMinutes === String(preset.minutes) && styles.presetChipSelected,
              ]}
              onPress={() => setCooldownMinutes(String(preset.minutes))}
            >
              <Text
                style={[
                  styles.presetChipText,
                  cooldownMinutes === String(preset.minutes) && styles.presetChipTextSelected,
                ]}
              >
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            Geofence {requiresLocation ? '(Required)' : '(Optional)'}
          </Text>
          {!requiresLocation && (geofenceLat || geofenceLng) ? (
            <Pressable onPress={handleClearGeofence}>
              <Text style={styles.clearLink}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={styles.locationButton}
          onPress={handleCaptureLocation}
          disabled={locating}
        >
          {locating ? (
            <ActivityIndicator size="small" color="#38BDF8" />
          ) : (
            <Text style={styles.locationButtonText}>Use Current Location</Text>
          )}
        </Pressable>

        <View style={styles.twoColRow}>
          <View style={styles.col}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              placeholder="40.712800"
              placeholderTextColor="#64748B"
              value={geofenceLat}
              onChangeText={setGeofenceLat}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              placeholder="-74.006000"
              placeholderTextColor="#64748B"
              value={geofenceLng}
              onChangeText={setGeofenceLng}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <Text style={styles.label}>Allowed Radius (meters)</Text>
        <TextInput
          style={styles.input}
          placeholder="150"
          placeholderTextColor="#64748B"
          value={geofenceRadius}
          onChangeText={setGeofenceRadius}
          keyboardType="number-pad"
        />
      </View>

      {showActiveToggle ? (
        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>Habit Active</Text>
              <Text style={styles.switchSubtitle}>
                Paused habits block check-ins without losing your history.
              </Text>
            </View>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              trackColor={{ false: '#334155', true: '#0284C7' }}
              thumbColor={isActive ? '#38BDF8' : '#CBD5E1'}
            />
          </View>
        </View>
      ) : null}

      <Pressable
        style={[styles.submitButton, submitting && styles.buttonDisabled]}
        onPress={handlePressSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#082F49" />
        ) : (
          <Text style={styles.submitButtonText}>{submitLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 16,
  },
  errorBox: {
    backgroundColor: '#450A0A',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#FECACA',
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  clearLink: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#F8FAFC',
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconChip: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  iconText: {
    fontSize: 20,
  },
  optionCard: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
  },
  optionCardSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  optionTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  optionTitleSelected: {
    color: '#F8FAFC',
  },
  optionDesc: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 3,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  switchTextWrap: {
    flex: 1,
  },
  switchTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  switchSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentButtonSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  segmentText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextSelected: {
    color: '#F8FAFC',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  dayChip: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dayChipSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  dayChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  dayChipTextSelected: {
    color: '#F8FAFC',
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
  },
  col: {
    flex: 1,
    gap: 6,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetChipSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  presetChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  presetChipTextSelected: {
    color: '#F8FAFC',
  },
  locationButton: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  locationButtonText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#082F49',
    fontSize: 16,
    fontWeight: '700',
  },
});
