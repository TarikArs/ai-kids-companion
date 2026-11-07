import { Platform } from 'react-native';

/**
 * A readable name for this device, sent when it is linked (« Mac · Chrome », « iPad · Safari », « Samsung SM-A515F »).
 * The parent can rename it afterwards (« TV du salon »). No extra package: the browser's user agent on the web, the
 * system's own constants on a phone or tablet.
 */
export function deviceName(): string {
  if (Platform.OS === 'web') return webName(String((globalThis as any).navigator?.userAgent ?? ''));
  const c = (Platform.constants ?? {}) as { Brand?: string; Model?: string; Manufacturer?: string };
  if (Platform.OS === 'android') {
    const brand = cap(c.Brand ?? c.Manufacturer ?? 'Android');
    const model = (c.Model ?? '').replace(new RegExp(`^${brand}\\s*`, 'i'), '');
    return `${brand}${model ? ` ${model}` : ''}${Platform.isTV ? ' · TV' : ''}`.slice(0, 60);
  }
  if (Platform.OS === 'ios') return Platform.isTV ? 'Apple TV' : (Platform as { isPad?: boolean }).isPad ? 'iPad' : 'iPhone';
  return cap(Platform.OS);
}

function webName(ua: string): string {
  const touchMac = /Macintosh/.test(ua) && (globalThis as any).navigator?.maxTouchPoints > 1; // an iPad asks for the desktop site
  const os = /SMART-TV|SmartTV|Tizen|Web0S|webOS|HbbTV|BRAVIA|AFT\w|Android TV|GoogleTV|CrKey/i.test(ua)
    ? 'TV'
    : /iPad/.test(ua) || touchMac
      ? 'iPad'
      : /iPhone/.test(ua)
        ? 'iPhone'
        : /Android/.test(ua)
          ? androidModel(ua)
          : /Windows/.test(ua)
            ? 'Windows'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'Mac'
              : /CrOS/.test(ua)
                ? 'Chromebook'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : 'Navigateur';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : '';
  return browser ? `${os} · ${browser}` : os;
}

/** « Android 14; SM-A515F Build/… » -> « Android SM-A515F ». */
function androidModel(ua: string): string {
  const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
  const model = m?.[1]?.trim();
  return model && model !== 'K' ? `Android ${model}` : 'Android';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
