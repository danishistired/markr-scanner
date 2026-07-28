/**
 * Web Crypto API + IndexedDB Device Identity Module (Option 1)
 *
 * Provides cryptographic device binding for Web and PWA (iOS Safari / Android Chrome).
 * - Generates non-exportable ECDSA P-256 key pair stored in IndexedDB.
 * - Signs/hashes payload with Web Crypto API (window.crypto.subtle).
 * - Includes hardware canvas + browser traits fallback fingerprinting.
 *
 * Improvements over v1:
 * - Cached DB connection to avoid re-opening on every call.
 * - Canvas fingerprint is hashed before use (not stored as raw base64).
 * - Guards against empty/corrupt stored signatures.
 * - Added WebGL renderer signal for stronger fingerprint.
 */

const DB_NAME = 'markr_pwa_crypto_db';
const DB_VERSION = 1;
const STORE_NAME = 'device_keys';
const KEY_ALIAS = 'device_keypair';
const FINGERPRINT_ALIAS = 'device_crypto_signature';

// Cached DB connection — avoid re-opening on every call
let _dbCache: IDBDatabase | null = null;

/**
 * Open (or return cached) IndexedDB database connection.
 */
function openDB(): Promise<IDBDatabase> {
  if (_dbCache) return Promise.resolve(_dbCache);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported on this platform.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      _dbCache = request.result;
      // If connection is forcibly closed, clear cache
      _dbCache.onclose = () => { _dbCache = null; };
      resolve(_dbCache);
    };
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
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Convert ArrayBuffer to lowercase hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 hash a string. Returns hex digest.
 */
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Compute Canvas fingerprint — hashed to avoid storing large base64 strings.
 */
async function getCanvasFingerprintHash(): Promise<string> {
  try {
    if (typeof document === 'undefined') return 'no_dom';
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no_ctx';

    // Layer multiple renders to maximize GPU-level differentiation
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f03';
    ctx.fillRect(100, 2, 100, 28);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.font = '15px Arial';
    ctx.fillText('markr \u00AE 2026', 2, 20);
    ctx.font = '11px serif';
    ctx.fillStyle = '#1a73e8';
    ctx.fillText('\u2663 PWA \u2665 \u03A9', 2, 40);

    const raw = canvas.toDataURL('image/png');
    // Hash it — never store raw base64 (up to 50KB!)
    return await sha256(raw);
  } catch {
    return 'canvas_error';
  }
}

/**
 * Get WebGL renderer info as an additional hardware signal.
 */
function getWebGLRenderer(): string {
  try {
    if (typeof document === 'undefined') return 'no_dom';
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null
      || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return 'no_webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return 'no_ext';
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string || 'unknown_gpu';
  } catch {
    return 'webgl_error';
  }
}

/**
 * Compute combined browser/hardware traits fingerprint hash.
 * Collects multiple high-entropy signals and hashes them together.
 */
async function getBrowserHardwareTraits(): Promise<string> {
  const signals: string[] = [];

  if (typeof window !== 'undefined') {
    signals.push(window.navigator.userAgent || 'no_ua');
    signals.push(window.navigator.language || 'no_lang');
    signals.push(`${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);
    signals.push(new Date().getTimezoneOffset().toString());
    signals.push(window.navigator.hardwareConcurrency?.toString() ?? '0');
    // deviceMemory is non-standard but present on Chrome/Edge
    signals.push((window.navigator as Navigator & { deviceMemory?: number }).deviceMemory?.toString() ?? '0');
    signals.push(window.navigator.platform || 'no_platform');
  }

  // Canvas hash (GPU renderer differences)
  const canvasHash = await getCanvasFingerprintHash();
  signals.push(canvasHash);

  // WebGL GPU renderer string
  signals.push(getWebGLRenderer());

  const raw = signals.join('||');
  return sha256(raw);
}

/**
 * Validate that a stored signature is non-empty and structurally valid.
 * A real pwa_ signature is: 'pwa_' + 64-char SHA-256 hex = 68 chars minimum.
 * Error-state fallbacks like 'pwa_err_...' or 'pwa_fb_...' are shorter and rejected.
 */
function isValidSignature(sig: unknown): sig is string {
  if (typeof sig !== 'string') return false;
  // Must start with 'pwa_' and be a full SHA-256 derived signature (68+ chars)
  if (!sig.startsWith('pwa_') || sig.length < 68) return false;
  // Must NOT be an error-state fallback
  if (sig.startsWith('pwa_err_') || sig.startsWith('pwa_fb_')) return false;
  return true;
}

/**
 * Generate a Web Crypto API ECDSA KeyPair, store in IndexedDB,
 * and derive a persistent deterministic device signature.
 *
 * Flow:
 *   1. Return cached signature from IndexedDB if valid.
 *   2. Generate ECDSA P-256 keypair via SubtleCrypto.
 *   3. Export public key → SHA-256 hash.
 *   4. Combine with hardware traits → final device signature.
 *   5. Persist to IndexedDB.
 */
export async function getWebCryptoDeviceSignature(): Promise<string> {
  try {
    // 1. Return cached signature if valid
    const existingSig = await getFromIDB<string>(FINGERPRINT_ALIAS);
    if (isValidSignature(existingSig)) {
      return existingSig;
    }

    let pubKeyHash = '';

    // 2. Generate ECDSA P-256 keypair (requires HTTPS / secure context)
    if (typeof window !== 'undefined' && window.isSecureContext && window.crypto?.subtle) {
      try {
        const keyPair = await window.crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          false, // extractable = false — private key is non-exportable
          ['sign', 'verify']
        );

        // Persist keypair in IndexedDB
        await setInIDB(KEY_ALIAS, keyPair);

        // Export only the public key to derive a deterministic ID
        const exportedPubKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const pubKeyDigest = await window.crypto.subtle.digest('SHA-256', exportedPubKey);
        pubKeyHash = bufferToHex(pubKeyDigest);
      } catch {
        // SubtleCrypto unavailable (HTTP context, old browser): fall through to hw-only fingerprint
        pubKeyHash = '';
      }
    }

    // 3. Combine pubKeyHash + hardware traits into final signature
    const hwTraits = await getBrowserHardwareTraits();
    const rawSignature = pubKeyHash
      ? `wc|${pubKeyHash}|${hwTraits}`
      : `hw|${hwTraits}`;

    // 4. Hash entire combined string for fixed-length output
    const finalHash = await sha256(rawSignature);
    const deviceSignature = `pwa_${finalHash}`;

    // 5. Persist
    await setInIDB(FINGERPRINT_ALIAS, deviceSignature);

    return deviceSignature;
  } catch {
    // Ultimate fallback — not persisted, will be recomputed next launch
    try {
      const fallback = await getBrowserHardwareTraits();
      return `pwa_fb_${fallback.slice(0, 48)}`;
    } catch {
      return `pwa_err_${Date.now().toString(36)}`;
    }
  }
}

/**
 * Clear the cached device signature from IndexedDB.
 * Called by fingerprint.ts when a corrupt/error-state signature is detected,
 * forcing a clean recompute on the next call to getWebCryptoDeviceSignature().
 */
export async function clearCryptoCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const r1 = store.delete(FINGERPRINT_ALIAS);
      const r2 = store.delete(KEY_ALIAS);
      let done = 0;
      const finish = () => { if (++done === 2) resolve(); };
      r1.onsuccess = finish; r1.onerror = finish;
      r2.onsuccess = finish; r2.onerror = finish;
    });
  } catch {
    // Ignore — best effort
  }
}
