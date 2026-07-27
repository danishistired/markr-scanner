/**
 * Web Crypto API + IndexedDB Device Identity Module (Option 1)
 *
 * Provides cryptographic device binding for Web and PWA (iOS Safari / Android Chrome).
 * - Generates non-exportable ECDSA P-256 key pair stored in IndexedDB.
 * - Signs/hashes payload with Web Crypto API (window.crypto.subtle).
 * - Includes hardware canvas + WebGL fallback fingerprinting.
 */

const DB_NAME = 'markr_pwa_crypto_db';
const STORE_NAME = 'device_keys';
const KEY_ALIAS = 'device_keypair';
const FINGERPRINT_ALIAS = 'device_crypto_signature';

/**
 * Open IndexedDB database connection.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported on this platform.'));
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save item into IndexedDB.
 */
async function setInIDB<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Read item from IndexedDB.
 */
async function getFromIDB<T>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Convert ArrayBuffer to Hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute Canvas Fingerprint hardware signal.
 */
function getCanvasFingerprint(): string {
  try {
    if (typeof document === 'undefined') return 'no_dom';
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no_ctx';

    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('markr PWA <canvas> 1.0', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('markr PWA <canvas> 1.0', 4, 17);

    return canvas.toDataURL();
  } catch {
    return 'canvas_error';
  }
}

/**
 * Compute fallback browser hardware traits fingerprint.
 */
async function getBrowserHardwareTraits(): Promise<string> {
  const signals: string[] = [];

  if (typeof window !== 'undefined') {
    signals.push(window.navigator.userAgent || '');
    signals.push(window.navigator.language || '');
    signals.push(window.screen.width + 'x' + window.screen.height);
    signals.push(window.screen.colorDepth?.toString() || '');
    signals.push(new Date().getTimezoneOffset().toString());
    signals.push(window.navigator.hardwareConcurrency?.toString() || '0');
  }

  signals.push(getCanvasFingerprint());
  const raw = signals.join('||');

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
  }

  // Fallback simple hash string if crypto.subtle is unavailable
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'fb_' + Math.abs(hash).toString(16);
}

/**
 * Generate a Web Crypto API ECDSA KeyPair, store in IndexedDB, and derive persistent device signature.
 */
export async function getWebCryptoDeviceSignature(): Promise<string> {
  try {
    // 1. Check if cryptographic signature already exists in IndexedDB
    const existingSig = await getFromIDB<string>(FINGERPRINT_ALIAS);
    if (existingSig) {
      return existingSig;
    }

    let pubKeyHash = '';

    // 2. Try Web Crypto API (SubtleCrypto)
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      try {
        // Generate ECDSA P-256 key pair
        const keyPair = await window.crypto.subtle.generateKey(
          {
            name: 'ECDSA',
            namedCurve: 'P-256',
          },
          false, // extractable = false for private key security
          ['sign', 'verify']
        );

        // Save keypair to IndexedDB
        await setInIDB(KEY_ALIAS, keyPair);

        // Export public key to derive deterministic hash
        const exportedPubKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const pubKeyDigest = await window.crypto.subtle.digest('SHA-256', exportedPubKey);
        pubKeyHash = bufferToHex(pubKeyDigest);
      } catch {
        // SubtleCrypto failure fallback (e.g. non-secure context HTTP in some browsers)
        pubKeyHash = '';
      }
    }

    // 3. Combine with hardware signals
    const hwTraits = await getBrowserHardwareTraits();
    const rawSignature = pubKeyHash ? `wc_${pubKeyHash}_${hwTraits}` : `hw_${hwTraits}`;

    // Hash final signature string
    let finalHash = rawSignature;
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const encoder = new TextEncoder();
      const digestBuffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(rawSignature));
      finalHash = bufferToHex(digestBuffer);
    }

    const deviceSignature = `pwa_${finalHash.slice(0, 48)}`;

    // 4. Persist in IndexedDB
    await setInIDB(FINGERPRINT_ALIAS, deviceSignature);

    return deviceSignature;
  } catch (error) {
    // Ultimate fallback if IndexedDB or WebCrypto fail completely
    const fallbackTraits = await getBrowserHardwareTraits();
    return `pwa_fb_${fallbackTraits.slice(0, 40)}`;
  }
}
