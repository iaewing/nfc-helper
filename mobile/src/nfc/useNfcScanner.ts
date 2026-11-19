import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import NfcManager, {
  Ndef,
  NfcError,
  NfcErrorIOS,
  NfcTech,
  type NdefRecord,
  type TagEvent,
} from 'react-native-nfc-manager';

export type NfcScanErrorCode =
  | 'NFC_UNSUPPORTED'
  | 'NFC_DISABLED'
  | 'USER_CANCELLED'
  | 'INVALID_TAG_PAYLOAD'
  | 'MISSING_HARDWARE_UID'
  | 'SCAN_FAILED';

export class NfcScanError extends Error {
  public readonly code: NfcScanErrorCode;

  constructor(code: NfcScanErrorCode, message: string) {
    super(message);
    this.name = 'NfcScanError';
    this.code = code;
  }
}

export interface NfcScanResult {
  uuid: string;
  hardwareUid: string;
  rawUri: string;
}

export interface ScanTagOptions {
  alertMessage?: string;
}

const STICKER_UUID_REGEX =
  /\/t\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

const SEVEN_BYTE_HEX_REGEX = /^[0-9A-F]{14}$/;

let nfcStartPromise: Promise<void> | null = null;

async function ensureNfcStarted(): Promise<void> {
  if (!nfcStartPromise) {
    nfcStartPromise = NfcManager.start().catch((error) => {
      nfcStartPromise = null;
      throw error;
    });
  }
  await nfcStartPromise;
}

export function normalizeHardwareUid(rawId: string): string {
  return rawId.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

export function isValidSevenByteUid(normalizedUid: string): boolean {
  return SEVEN_BYTE_HEX_REGEX.test(normalizedUid);
}

export function extractStickerUuidFromUri(uri: string): string | null {
  const match = uri.match(STICKER_UUID_REGEX);
  return match ? match[1].toLowerCase() : null;
}

function decodeUriRecord(record: NdefRecord): string | null {
  if (!Array.isArray(record.payload) || record.payload.length === 0) {
    return null;
  }

  try {
    if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
      return Ndef.uri.decodePayload(new Uint8Array(record.payload));
    }

    if (record.tnf === Ndef.TNF_ABSOLUTE_URI) {
      return Ndef.util.bytesToString(record.payload);
    }
  } catch {
    return null;
  }

  return null;
}

function extractStickerFromTag(tag: TagEvent): { uuid: string; rawUri: string } | null {
  const records = tag.ndefMessage ?? [];
  for (const record of records) {
    const uri = decodeUriRecord(record);
    if (!uri) continue;

    const uuid = extractStickerUuidFromUri(uri);
    if (uuid) {
      return { uuid, rawUri: uri };
    }
  }

  return null;
}

function classifyNfcError(error: unknown): NfcScanError {
  if (error instanceof NfcScanError) {
    return error;
  }

  if (error instanceof NfcError.UserCancel) {
    return new NfcScanError('USER_CANCELLED', 'NFC scan was cancelled.');
  }

  if (error instanceof NfcError.RadioDisabled) {
    return new NfcScanError(
      'NFC_DISABLED',
      'NFC is turned off on this device. Enable NFC in system settings and try again.',
    );
  }

  if (error instanceof NfcError.UnsupportedFeature) {
    return new NfcScanError(
      'NFC_UNSUPPORTED',
      'This device does not support NFC tag scanning.',
    );
  }

  const rawMessage = error instanceof Error ? error.message : String(error ?? '');

  if (Platform.OS === 'ios') {
    const iosCode = NfcErrorIOS.parse(rawMessage);
    if (iosCode === NfcErrorIOS.errCodes.userCancel) {
      return new NfcScanError('USER_CANCELLED', 'NFC scan was cancelled.');
    }
    if (iosCode === NfcErrorIOS.errCodes.radioDisabled) {
      return new NfcScanError(
        'NFC_DISABLED',
        'NFC is disabled on this device. Enable NFC and try again.',
      );
    }
    if (iosCode === NfcErrorIOS.errCodes.unsupportedFeature) {
      return new NfcScanError(
        'NFC_UNSUPPORTED',
        'This device does not support NFC tag scanning.',
      );
    }
  }

  if (/cancel/i.test(rawMessage)) {
    return new NfcScanError('USER_CANCELLED', 'NFC scan was cancelled.');
  }

  return new NfcScanError(
    'SCAN_FAILED',
    rawMessage || 'Unable to read NFC sticker. Hold your phone steady and try again.',
  );
}

export function useNfcScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<NfcScanError | null>(null);
  const mountedRef = useRef(true);
  const scanningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scanningRef.current) {
        NfcManager.cancelTechnologyRequest().catch(() => {});
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const cancelScan = useCallback(async () => {
    await NfcManager.cancelTechnologyRequest().catch(() => {});
    scanningRef.current = false;
    if (mountedRef.current) {
      setIsScanning(false);
    }
  }, []);

  const scanTag = useCallback(async (options?: ScanTagOptions): Promise<NfcScanResult> => {
    if (mountedRef.current) {
      setError(null);
      setIsScanning(true);
    }
    scanningRef.current = true;

    let techRequested = false;

    try {
      const supported = await NfcManager.isSupported();
      if (!supported) {
        throw new NfcScanError(
          'NFC_UNSUPPORTED',
          'This device does not support NFC tag scanning.',
        );
      }

      await ensureNfcStarted();

      if (Platform.OS === 'android') {
        const enabled = await NfcManager.isEnabled();
        if (!enabled) {
          throw new NfcScanError(
            'NFC_DISABLED',
            'NFC is turned off. Enable NFC in Android settings and try again.',
          );
        }
      } else {
        try {
          const enabled = await NfcManager.isEnabled();
          if (enabled === false) {
            throw new NfcScanError(
              'NFC_DISABLED',
              'NFC is currently unavailable on this device.',
            );
          }
        } catch (err) {
          if (err instanceof NfcScanError) {
            throw err;
          }
          // Some iOS builds do not implement isEnabled(); proceed to session request.
        }
      }

      const alertMessage =
        options?.alertMessage ?? 'Hold the top of your phone against the Prove It sticker.';

      await NfcManager.requestTechnology(NfcTech.Ndef, {
        alertMessage,
        invalidateAfterFirstRead: true,
      });
      techRequested = true;

      const tag = await NfcManager.getTag();
      if (!tag) {
        throw new NfcScanError(
          'INVALID_TAG_PAYLOAD',
          'Could not read tag data. Hold your phone steady against the sticker and try again.',
        );
      }

      if (!tag.id) {
        throw new NfcScanError(
          'MISSING_HARDWARE_UID',
          'No physical hardware UID was exposed by this NFC tag.',
        );
      }

      const hardwareUid = normalizeHardwareUid(tag.id);
      if (!isValidSevenByteUid(hardwareUid)) {
        throw new NfcScanError(
          'MISSING_HARDWARE_UID',
          'This tag does not provide a valid 7-byte NTAG213/215 hardware UID.',
        );
      }

      const parsed = extractStickerFromTag(tag);
      if (!parsed) {
        throw new NfcScanError(
          'INVALID_TAG_PAYLOAD',
          'This NFC tag does not contain a valid Prove It sticker link (/t/{uuid}).',
        );
      }

      return {
        uuid: parsed.uuid,
        hardwareUid,
        rawUri: parsed.rawUri,
      };
    } catch (err) {
      const nfcErr = classifyNfcError(err);
      if (mountedRef.current) {
        setError(nfcErr);
      }
      throw nfcErr;
    } finally {
      if (techRequested) {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
      }
      scanningRef.current = false;
      if (mountedRef.current) {
        setIsScanning(false);
      }
    }
  }, []);

  return {
    isScanning,
    error,
    clearError,
    scanTag,
    cancelScan,
  };
}
