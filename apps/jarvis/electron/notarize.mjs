import { notarize } from '@electron/notarize';

export default async function notarizeJericho(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    if (process.env.JERICHO_ALLOW_UNSIGNED_LOCAL_BUILD === '1' && !process.env.CI) {
      console.log('Skipping notarization for an explicitly unsigned local build.');
      return;
    }
    throw new Error('Notarization credentials are required for a release build.');
  }
  await notarize({
    appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
}
