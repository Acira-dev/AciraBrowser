'use strict';
// The sentences macOS shows in its own permission questions for the Mac browser (Info.plist usage descriptions). D142 (22 Nov 2026): the camera and
// microphone lines were Acira's, but the sound-capture and Bluetooth lines were still the engine's defaults ("This app needs access to audio capture",
// "This app needs access to Bluetooth"), kept from the engine's Info.plist by the build template. All five are written from here by
// scripts/package-mac-widevine.mjs (the release, over its signed template's own values) and scripts/package-mac.mjs (a fresh bundle).
// The installer shows none of these questions: scripts/package-mac-beta-installer.mjs takes every key named here out of its copy.
const macPermissionTexts = () => ({
  NSCameraUsageDescription: 'Allow a website you choose to use the camera in Acira.',
  NSMicrophoneUsageDescription: 'Allow a website you choose to use the microphone in Acira.',
  // asked when a page records the sound this Mac is playing (sharing a screen or a window with its sound)
  NSAudioCaptureUsageDescription: 'Allow a website you choose to share this Mac\'s sound in Acira.',
  // the two keys macOS has used for Bluetooth, the same sentence
  NSBluetoothAlwaysUsageDescription: 'Allow a website you choose to use Bluetooth devices in Acira.',
  NSBluetoothPeripheralUsageDescription: 'Allow a website you choose to use Bluetooth devices in Acira.',
});
module.exports = { macPermissionTexts };
