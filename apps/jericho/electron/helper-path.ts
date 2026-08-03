import path from 'node:path';

export function electronKeychainHelperPath(options: {
  appPath: string; resourcesPath: string; packaged: boolean;
}): string {
  const root = options.packaged
    ? path.join(options.resourcesPath, 'app.asar.unpacked')
    : options.appPath;
  return path.join(root, 'electron', 'dist', 'jericho-keychain-helper');
}
