// Android TV / Google TV: one app for phones and TVs (Google Play "TV" listing).
// What Google Play checks before showing the app on a TV (developer.android.com/training/tv/start/start):
//   - the main activity has the LEANBACK_LAUNCHER category (else the app is invisible on TV),
//   - touchscreen is NOT required (else the app is invisible on TV),
//   - android.software.leanback is declared, not required (the same app stays on phones),
//   - a 320x180 banner for the TV home screen (application android:banner, xhdpi),
//   - no hardware a TV may lack is required: the camera and the microphone permissions would otherwise imply
//     required camera / microphone features and hide the app on most TVs.
// No react-native-tvos needed: Android TV runs the normal React Native Android build (D-pad focus works with
// FocusPressable). Run `npx expo prebuild --clean` (or an EAS build) after changing this file.

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const NOT_REQUIRED = [
  'android.hardware.touchscreen',
  'android.software.leanback',
  'android.hardware.camera',
  'android.hardware.camera.any',
  'android.hardware.camera.autofocus',
  'android.hardware.microphone',
  'android.hardware.faketouch',
];

function withTvManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // 1. Features: declared, none required.
    const features = (manifest['uses-feature'] = manifest['uses-feature'] ?? []);
    for (const name of NOT_REQUIRED) {
      const found = features.find((f) => f.$['android:name'] === name);
      if (found) found.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }

    // 2. Banner on the application.
    const app = manifest.application[0];
    app.$['android:banner'] = '@drawable/tv_banner';

    // 3. LEANBACK_LAUNCHER next to LAUNCHER on the main activity.
    const main = (app.activity ?? []).find((a) =>
      (a['intent-filter'] ?? []).some((f) => (f.category ?? []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER')),
    );
    if (!main) throw new Error('with-android-tv: no LAUNCHER activity found');
    const filter = main['intent-filter'].find((f) => (f.category ?? []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER'));
    if (!filter.category.some((c) => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
      filter.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
    }
    return cfg;
  });
}

function withTvBanner(config, { banner }) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.resolve(cfg.modRequest.projectRoot, banner);
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable-xhdpi');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, path.join(dir, 'tv_banner.png'));
      return cfg;
    },
  ]);
}

module.exports = function withAndroidTv(config, props = {}) {
  const banner = props.banner ?? './assets/images/tv-banner.png';
  return withTvBanner(withTvManifest(config), { banner });
};
