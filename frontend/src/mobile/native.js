// Recursos nativos do app (Capacitor): leitor de código de barras (ML Kit) e status da rede.
// No navegador do PC (desenvolvimento) o leitor fica indisponível e a rede usa navigator.onLine.
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState as InstallState } from '@capacitor-mlkit/barcode-scanning';

export const isNativeApp = () => Capacitor.isNativePlatform();

// --- [BLOCO: Leitor de Código de Barras] ---
const FORMATS = [
  BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE,
  BarcodeFormat.Itf, BarcodeFormat.Code128,
];

export async function scannerAvailable() {
  if (!isNativeApp()) return false;
  try {
    const { supported } = await BarcodeScanner.isSupported();
    return supported;
  } catch {
    return false;
  }
}

// Retorna o código lido, ou null se o usuário cancelar.
export async function scanBarcode(onStatus) {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    // Primeiro uso: o leitor do Google Play Services é baixado uma única vez (precisa de internet)
    onStatus?.('Instalando o leitor de código (somente no primeiro uso)...');
    await new Promise((resolve, reject) => {
      let handle;
      BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
        if (event.state === InstallState.COMPLETED) { handle?.remove(); resolve(); }
        if (event.state === InstallState.FAILED || event.state === InstallState.CANCELED) {
          handle?.remove();
          reject(new Error('Falha ao instalar o leitor.'));
        }
      }).then((h) => { handle = h; });
      BarcodeScanner.installGoogleBarcodeScannerModule().catch(reject);
    });
    onStatus?.(null);
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: FORMATS });
    return barcodes?.[0]?.rawValue || null;
  } catch (err) {
    if (String(err?.message || err).toLowerCase().includes('cancel')) return null;
    throw err;
  }
}

// --- [BLOCO: Status da Rede] ---
export async function isOnline() {
  try {
    const status = await Network.getStatus();
    return status.connected;
  } catch {
    return navigator.onLine;
  }
}

export function onNetworkChange(callback) {
  let handle = null;
  Network.addListener('networkStatusChange', (status) => callback(status.connected))
    .then((h) => { handle = h; })
    .catch(() => {
      const on = () => callback(true);
      const off = () => callback(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      handle = { remove: () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); } };
    });
  return () => handle?.remove();
}
