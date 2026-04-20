export function parseNodeVersion(versionText) {
  const cleaned = String(versionText).trim().replace(/^v/, '');
  const [majorText = '0', minorText = '0', patchText = '0'] = cleaned.split('.');

  return {
    major: Number.parseInt(majorText, 10),
    minor: Number.parseInt(minorText, 10),
    patch: Number.parseInt(patchText, 10),
  };
}

export function isSupportedNodeVersion(version) {
  if (version.major >= 23) {
    return true;
  }

  if (version.major === 22) {
    return version.minor >= 12;
  }

  if (version.major === 20) {
    return version.minor >= 19;
  }

  return false;
}

function formatVersion(version) {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export function assertSupportedNodeVersion(versionText) {
  const version =
    typeof versionText === 'string' ? parseNodeVersion(versionText) : versionText;

  if (
    !Number.isInteger(version.major) ||
    !Number.isInteger(version.minor) ||
    !Number.isInteger(version.patch)
  ) {
    throw new Error(`Unable to parse the current Node version: ${versionText}`);
  }

  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `chrome-devtools-mcp requires Node ^20.19.0 || ^22.12.0 || >=23, current version is ${formatVersion(version)}`,
    );
  }

  return version;
}
