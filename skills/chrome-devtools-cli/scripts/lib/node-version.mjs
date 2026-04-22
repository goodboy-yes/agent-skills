// 解析版本号字符串（如 "v22.12.0"）为 { major, minor, patch } 结构
export function parseNodeVersion(versionText) {
  // 去除前导 "v" 并按 "." 分割，提取主版本号、次版本号、修订号
  const cleaned = String(versionText).trim().replace(/^v/, '');
  const [majorText = '0', minorText = '0', patchText = '0'] = cleaned.split('.');

  return {
    major: Number.parseInt(majorText, 10),
    minor: Number.parseInt(minorText, 10),
    patch: Number.parseInt(patchText, 10),
  };
}

// 判断当前 Node.js 版本是否在支持范围内：^20.19.0 || ^22.12.0 || >=23
export function isSupportedNodeVersion(version) {
  // Node 23+ 全部支持
  if (version.major >= 23) {
    return true;
  }

  // Node 22 需要至少 22.12.0
  if (version.major === 22) {
    return version.minor >= 12;
  }

  // Node 20 需要至少 20.19.0
  if (version.major === 20) {
    return version.minor >= 19;
  }

  // 其他版本一律不支持
  return false;
}

// 将版本对象格式化为 "vX.Y.Z" 形式
function formatVersion(version) {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

// 断言当前 Node.js 版本满足最低要求，不满足则抛出错误
export function assertSupportedNodeVersion(versionText) {
  // 如果传入的是字符串则先解析为版本对象
  const version =
    typeof versionText === 'string' ? parseNodeVersion(versionText) : versionText;

  // 校验解析结果是否为有效整数
  if (
    !Number.isInteger(version.major) ||
    !Number.isInteger(version.minor) ||
    !Number.isInteger(version.patch)
  ) {
    throw new Error(`Unable to parse the current Node version: ${versionText}`);
  }

  // 检查版本是否在支持范围内
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `chrome-devtools-mcp requires Node ^20.19.0 || ^22.12.0 || >=23, current version is ${formatVersion(version)}`,
    );
  }

  return version;
}
